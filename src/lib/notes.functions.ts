import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ProcessInput = z.object({ noteId: z.string().uuid() });
const SaveWebLinkInput = z.object({ url: z.string().trim().url().max(2000) });


const SYSTEM_PROMPT = `You turn raw voice notes and/or attached images into structured notes.
Return a single JSON object with keys: heading, summary, tasks.
- heading: one short line (max ~8 words), title case, no trailing punctuation.
- summary: 2-4 concise sentences capturing the key ideas. If images are provided, describe their content and any text visible.
- tasks: array of short actionable to-dos, imperative voice ("Call John about invoice").
  IMPORTANT — Analyze every image carefully and INFER tasks the user could reasonably act on based on what is shown, even if no task is explicitly written:
    * Extract explicit tasks (handwritten TODOs, checklists, whiteboards, sticky notes, screenshots of task lists, emails, messages).
    * Infer implicit tasks from context: a receipt → "File expense for <item>"; a business card → "Save contact for <name>"; a poster/event flyer → "RSVP to <event> on <date>"; a product/book → "Look up <product>" or "Buy <item>"; a bill → "Pay <bill> by <date>"; a screenshot of a bug → "Fix <issue>"; a whiteboard diagram → tasks for the next steps shown; a landmark/place → "Plan visit to <place>".
    * Combine transcript tasks with image-derived tasks. Deduplicate.
    * If truly nothing actionable can be inferred, return an empty array.
Respond ONLY with valid JSON, no code fences.`;

async function transcribeAudio(bytes: Uint8Array, mime: string, apiKey: string): Promise<string> {
  const ext = ({
    "audio/webm": "webm",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
  } as Record<string, string>)[mime.split(";")[0]] ?? "webm";

  const form = new FormData();
  form.append("model", "openai/gpt-4o-mini-transcribe");
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `recording.${ext}`);

  const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Transcription failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // btoa is available in the Worker runtime
  return btoa(bin);
}

async function extractStructured(
  transcript: string | null,
  images: Array<{ mime: string; base64: string }>,
  apiKey: string,
): Promise<{ heading: string; summary: string; tasks: string[] }> {
  const userBlocks: Array<Record<string, unknown>> = [];
  const intro = transcript
    ? `Transcript from the voice recording:\n\n${transcript}\n\n${images.length > 0 ? "Also analyze the attached image(s) as related context." : ""}`
    : images.length > 0
      ? "There is no voice transcript. Analyze the attached image(s) and produce the structured note based on them alone."
      : "No content provided.";
  userBlocks.push({ type: "text", text: intro });
  for (const img of images) {
    userBlocks.push({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.base64}` },
    });
  }

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userBlocks },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI processing failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const stripped = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(stripped);
  }
  const heading = String(parsed.heading ?? "Untitled note").slice(0, 120);
  const summary = String(parsed.summary ?? "").slice(0, 2000);
  const tasksArr = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const tasks = tasksArr
    .map((t: unknown) =>
      typeof t === "string" ? t : typeof t === "object" && t && "text" in (t as any) ? String((t as any).text) : "",
    )
    .filter((t: string) => t.trim().length > 0)
    .slice(0, 20);
  return { heading, summary, tasks };
}

export const processVoiceNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ProcessInput.parse(data))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const { supabase, userId } = context;

    const { data: note, error: noteErr } = await supabase
      .from("voice_notes")
      .select("id, audio_path, image_paths, user_id")
      .eq("id", data.noteId)
      .single();
    if (noteErr || !note) throw new Error("Note not found");
    if (note.user_id !== userId) throw new Error("Forbidden");

    const imagePaths = (Array.isArray((note as any).image_paths)
      ? ((note as any).image_paths as unknown[])
      : []
    )
      .map((p) => (typeof p === "string" ? p : ""))
      .filter(Boolean);

    if (!note.audio_path && imagePaths.length === 0) {
      throw new Error("Note has no audio and no images");
    }

    await supabase.from("voice_notes").update({ status: "transcribing", error: null }).eq("id", note.id);

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      let transcript: string | null = null;
      if (note.audio_path) {
        const { data: file, error: dlErr } = await supabaseAdmin.storage
          .from("voice-notes")
          .download(note.audio_path);
        if (dlErr || !file) throw new Error(`Download failed: ${dlErr?.message ?? "no file"}`);

        const bytes = new Uint8Array(await file.arrayBuffer());
        const mime = file.type || "audio/webm";
        transcript = await transcribeAudio(bytes, mime, apiKey);
        if (!transcript) throw new Error("Empty transcription");
        await supabase.from("voice_notes").update({ status: "processing", transcript }).eq("id", note.id);
      } else {
        await supabase.from("voice_notes").update({ status: "processing" }).eq("id", note.id);
      }

      const images: Array<{ mime: string; base64: string }> = [];
      for (const p of imagePaths) {
        const { data: file, error: dlErr } = await supabaseAdmin.storage.from("voice-notes").download(p);
        if (dlErr || !file) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mime = file.type || (p.endsWith(".png") ? "image/png" : "image/jpeg");
        images.push({ mime, base64: bytesToBase64(bytes) });
      }

      const structured = await extractStructured(transcript, images, apiKey);
      const tasksPayload = structured.tasks.map((text, i) => ({ id: `t${i}`, text, done: false }));

      await supabase
        .from("voice_notes")
        .update({
          status: "ready",
          transcript,
          heading: structured.heading,
          summary: structured.summary,
          tasks: tasksPayload,
        })
        .eq("id", note.id);

      return { ok: true as const };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await supabase.from("voice_notes").update({ status: "failed", error: msg }).eq("id", note.id);
      throw new Error(msg);
    }
  });

const ToggleInput = z.object({
  noteId: z.string().uuid(),
  taskId: z.string(),
});

export const toggleTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ToggleInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: note, error } = await supabase
      .from("voice_notes")
      .select("tasks")
      .eq("id", data.noteId)
      .single();
    if (error || !note) throw new Error("Not found");
    const tasks = (Array.isArray(note.tasks) ? note.tasks : []) as Array<{ id: string; text: string; done: boolean }>;
    const next = tasks.map((t) => (t.id === data.taskId ? { ...t, done: !t.done } : t));
    const { error: upErr } = await supabase.from("voice_notes").update({ tasks: next }).eq("id", data.noteId);
    if (upErr) throw new Error(upErr.message);
    return { ok: true as const };
  });

async function removeNoteFiles(noteRows: Array<{ audio_path: string | null; image_paths: unknown }>) {
  const paths: string[] = [];
  for (const r of noteRows) {
    if (r.audio_path) paths.push(r.audio_path);
    if (Array.isArray(r.image_paths)) {
      for (const p of r.image_paths as unknown[]) if (typeof p === "string" && p) paths.push(p);
    }
  }
  if (paths.length === 0) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.storage.from("voice-notes").remove(paths);
}

const DeleteInput = z.object({ noteId: z.string().uuid() });

export const deleteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => DeleteInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: note } = await supabase
      .from("voice_notes")
      .select("audio_path, image_paths")
      .eq("id", data.noteId)
      .single();
    if (note) await removeNoteFiles([note as any]);
    const { error } = await supabase.from("voice_notes").delete().eq("id", data.noteId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const DeleteNotesInput = z.object({ noteIds: z.array(z.string().uuid()).min(1) });

export const deleteNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => DeleteNotesInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows } = await supabase
      .from("voice_notes")
      .select("audio_path, image_paths")
      .in("id", data.noteIds);
    if (rows && rows.length > 0) await removeNoteFiles(rows as any);
    const { error } = await supabase.from("voice_notes").delete().in("id", data.noteIds);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const DeleteTasksInput = z.object({
  tasks: z.array(z.object({ noteId: z.string().uuid(), taskId: z.string() })).min(1),
});

export const deleteTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => DeleteTasksInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const byNote = new Map<string, Set<string>>();
    for (const t of data.tasks) {
      if (!byNote.has(t.noteId)) byNote.set(t.noteId, new Set());
      byNote.get(t.noteId)!.add(t.taskId);
    }
    for (const [noteId, taskIds] of byNote) {
      const { data: note } = await supabase
        .from("voice_notes")
        .select("tasks")
        .eq("id", noteId)
        .single();
      if (!note) continue;
      const tasks = (Array.isArray(note.tasks) ? note.tasks : []) as Array<{ id: string; text: string; done: boolean }>;
      const next = tasks.filter((t) => !taskIds.has(t.id));
      await supabase.from("voice_notes").update({ tasks: next }).eq("id", noteId);
    }
    return { ok: true as const };
  });

const PinInput = z.object({
  noteId: z.string().uuid(),
  taskId: z.string(),
});

export const pinTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PinInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: note, error } = await supabase
      .from("voice_notes")
      .select("tasks")
      .eq("id", data.noteId)
      .single();
    if (error || !note) throw new Error("Not found");
    const tasks = (Array.isArray(note.tasks) ? note.tasks : []) as Array<{
      id: string;
      text: string;
      done: boolean;
      pinned?: boolean;
    }>;
    const next = tasks.map((t) => (t.id === data.taskId ? { ...t, pinned: !t.pinned } : t));
    const { error: upErr } = await supabase.from("voice_notes").update({ tasks: next }).eq("id", data.noteId);
    if (upErr) throw new Error(upErr.message);
    return { ok: true as const };
  });

const PinNoteInput = z.object({ noteId: z.string().uuid(), pinned: z.boolean() });

export const pinNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PinNoteInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("voice_notes")
      .update({ pinned: data.pinned })
      .eq("id", data.noteId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const EditTaskInput = z.object({
  noteId: z.string().uuid(),
  taskId: z.string(),
  text: z.string().trim().min(1).max(500),
});

export const editTaskText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => EditTaskInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: note, error } = await supabase
      .from("voice_notes")
      .select("tasks")
      .eq("id", data.noteId)
      .single();
    if (error || !note) throw new Error("Not found");
    const tasks = (Array.isArray(note.tasks) ? note.tasks : []) as Array<{
      id: string;
      text: string;
      done: boolean;
      pinned?: boolean;
    }>;
    const next = tasks.map((t) => (t.id === data.taskId ? { ...t, text: data.text } : t));
    const { error: upErr } = await supabase
      .from("voice_notes")
      .update({ tasks: next })
      .eq("id", data.noteId);
    if (upErr) throw new Error(upErr.message);
    return { ok: true as const };
  });

const CUSTOM_HEADING = "__custom__";

const AddCustomTaskInput = z.object({ text: z.string().trim().min(1).max(500) });

export const addCustomTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => AddCustomTaskInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // find-or-create the per-user custom-task bucket
    const { data: existing } = await supabase
      .from("voice_notes")
      .select("id, tasks")
      .eq("user_id", userId)
      .eq("heading", CUSTOM_HEADING)
      .limit(1)
      .maybeSingle();

    const newTask = {
      id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text: data.text,
      done: false,
    };

    if (existing) {
      const tasks = (Array.isArray(existing.tasks) ? existing.tasks : []) as Array<{
        id: string;
        text: string;
        done: boolean;
      }>;
      const { error: upErr } = await supabase
        .from("voice_notes")
        .update({ tasks: [...tasks, newTask] })
        .eq("id", existing.id);
      if (upErr) throw new Error(upErr.message);
      return { ok: true as const, noteId: existing.id, taskId: newTask.id };
    }

    const { data: created, error: insErr } = await supabase
      .from("voice_notes")
      .insert({
        user_id: userId,
        heading: CUSTOM_HEADING,
        status: "ready",
        tasks: [newTask],
      })
      .select("id")
      .single();
    if (insErr || !created) throw new Error(insErr?.message ?? "Insert failed");
    return { ok: true as const, noteId: created.id, taskId: newTask.id };
  });

const WEB_SYSTEM_PROMPT = `You turn a web page into a structured saved note.
Return a single JSON object with keys: heading, summary, tasks.
- heading: one short line (max ~8 words), title case, no trailing punctuation. Prefer the page's own title if it's concise.
- summary: 2-5 sentences capturing what the page is about and the key takeaways.
- tasks: array of short actionable to-dos the user could act on based on the page (e.g. "Read chapter on X", "Watch related video", "Buy <item>", "Try <tool>"). Return [] if nothing useful.
Respond ONLY with valid JSON, no code fences.`;

async function fetchWebPageText(url: string): Promise<{ title: string | null; text: string }> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const ctype = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (!ctype.includes("html") && !ctype.includes("xml") && !ctype.includes("text")) {
    return { title: null, text: raw.slice(0, 20000) };
  }
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim().slice(0, 200) : null;

  const metaOf = (re: RegExp) => {
    const m = raw.match(re);
    return m ? m[1].replace(/\s+/g, " ").trim() : "";
  };
  const metas = [
    metaOf(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
    metaOf(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i),
    metaOf(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
    metaOf(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i),
    metaOf(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i),
  ].filter(Boolean);

  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const combined = [metas.join("\n"), stripped].filter(Boolean).join("\n").trim();
  return { title, text: combined.slice(0, 15000) };
}

async function summarizeWebPage(
  url: string,
  title: string | null,
  text: string,
  apiKey: string,
): Promise<{ heading: string; summary: string; tasks: string[] }> {
  const userMsg = `URL: ${url}\n${title ? `Page title: ${title}\n` : ""}\nPage content:\n${text}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: WEB_SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI processing failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  }
  const heading = String(parsed.heading ?? title ?? "Saved link").slice(0, 120);
  const summary = String(parsed.summary ?? "").slice(0, 2000);
  const tasksArr = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const tasks = tasksArr
    .map((t: unknown) =>
      typeof t === "string" ? t : typeof t === "object" && t && "text" in (t as any) ? String((t as any).text) : "",
    )
    .filter((t: string) => t.trim().length > 0)
    .slice(0, 20);
  return { heading, summary, tasks };
}

export const saveWebLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SaveWebLinkInput.parse(data))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const { supabase, userId } = context;

    const { data: inserted, error: insErr } = await supabase
      .from("voice_notes")
      .insert({ user_id: userId, source_url: data.url, status: "processing" })
      .select("id")
      .single();
    if (insErr || !inserted) throw new Error(insErr?.message ?? "Insert failed");

    try {
      const { title, text } = await fetchWebPageText(data.url);
      const effectiveText =
        text && text.length >= 30
          ? text
          : `Title: ${title ?? "(none)"}\nURL: ${data.url}\n(The page had no readable server-rendered content; summarize based on the URL and title alone.)`;
      const structured = await summarizeWebPage(data.url, title, effectiveText, apiKey);
      const tasksPayload = structured.tasks.map((t, i) => ({ id: `t${i}`, text: t, done: false }));
      await supabase
        .from("voice_notes")
        .update({
          status: "ready",
          heading: structured.heading,
          summary: structured.summary,
          tasks: tasksPayload,
        })
        .eq("id", inserted.id);
      return { ok: true as const, noteId: inserted.id };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await supabase.from("voice_notes").update({ status: "failed", error: msg }).eq("id", inserted.id);
      throw new Error(msg);
    }
  });

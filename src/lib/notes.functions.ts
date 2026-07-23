import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ProcessInput = z.object({ noteId: z.string().uuid() });
const SaveWebLinkInput = z.object({ url: z.string().trim().url().max(2000) });
const SaveTextNoteInput = z.object({
  heading: z.string().trim().max(200).optional().default(""),
  body: z.string().trim().max(20000).optional().default(""),
  imagePaths: z.array(z.string().min(1)).max(20).optional().default([]),
  sourceUrl: z.string().trim().url().max(2000).optional().nullable(),
});


const SYSTEM_PROMPT = `You turn raw voice notes and/or attached images into a structured note.
Return ONE JSON object with keys: heading, summary, tasks, tags. No prose, no code fences.

- heading: short (max ~8 words), title case, no trailing punctuation. Reflect the actual topic — do not use "Untitled" or "Voice Note".
- summary: 2-4 sentences capturing the key ideas. If images are attached, describe what's visible (objects, people, on-screen text, handwriting) and weave that into the summary.
- tasks: array of clear, actionable to-dos, each in imperative voice ("Call John about the invoice", "Buy milk on Tuesday", "Reply to Priya's email").
- tags: 3-6 short lowercase tags (one or two words each, no #, no spaces around, kebab-case ok). Categorize by topic, project, person, place, or type (e.g. "work", "grocery", "travel", "invoice", "meeting", "idea"). No duplicates.

HOW TO EXTRACT TASKS — be smart, not stingy:
1. Pull EVERY concrete action the user mentions or implies they should do. Examples that ARE tasks:
   - "I need to / I have to / I should / remind me to / don't forget to …"
   - "Tomorrow I'll call X", "Book the flight", "Pay the bill by Friday"
   - Handwritten TODO lists, checklists, or bullet points in an image → each item is a task
   - A receipt/bill in an image → "Pay <amount> to <merchant> by <date>" if a due date is visible
   - A meeting/event with a date or time → "Attend <event> on <date>"
   - A promise to someone ("I told Sara I'd send the doc") → "Send the doc to Sara"
2. Rewrite tasks so each one is standalone and specific. Include names, amounts, dates, and objects from the source when they're mentioned.
3. Split compound tasks. "Email Sam and book the venue" → two tasks.
4. Skip only pure musings, opinions, or facts with no action ("The weather was nice", "Interesting article"). If genuinely nothing is actionable, return [].
5. Cap at 8 tasks. Order them by importance / time-sensitivity.

Respond with ONLY the JSON object.`;

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

function parseTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const s = String(raw ?? "")
      .toLowerCase()
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .slice(0, 32);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

async function extractStructured(
  transcript: string | null,
  images: Array<{ mime: string; base64: string }>,
  apiKey: string,
  prior?: { heading?: string | null; summary?: string | null; tasks?: string[] } | null,
): Promise<{ heading: string; summary: string; tasks: string[]; tags: string[] }> {
  const userBlocks: Array<Record<string, unknown>> = [];
  const priorHasContent =
    !!prior && (((prior.heading ?? "").trim().length > 0) || ((prior.summary ?? "").trim().length > 0) || ((prior.tasks?.length ?? 0) > 0));
  if (priorHasContent) {
    const priorText =
      `EXISTING NOTE (previous content — DO NOT discard, MERGE it with the new material into one cohesive note):\n` +
      `- Heading: ${prior?.heading || "(none)"}\n` +
      `- Summary: ${prior?.summary || "(none)"}\n` +
      `- Tasks:\n${(prior?.tasks ?? []).map((t) => `  • ${t}`).join("\n") || "  (none)"}\n\n` +
      `Treat the transcript and images below as ADDITIONAL entries appended to the same note. ` +
      `Produce ONE unified heading, ONE cohesive summary that weaves the previous content together with the new content (do not list them separately, do not drop earlier details), and a merged, de-duplicated task list preserving still-relevant prior tasks.`;
    userBlocks.push({ type: "text", text: priorText });
  }
  const intro = transcript
    ? `${priorHasContent ? "New" : ""} Transcript from ${priorHasContent ? "an additional" : "the"} voice recording:\n\n${transcript}\n\n${images.length > 0 ? "Also analyze the attached image(s) as related context." : ""}`
    : images.length > 0
      ? (priorHasContent
          ? "Newly attached image(s) — analyze them and merge into the note."
          : "There is no voice transcript. Analyze the attached image(s) and produce the structured note based on them alone.")
      : "No new content provided.";
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
      model: "google/gemini-3.5-flash",
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
  const tags = parseTags(parsed.tags);
  return { heading, summary, tasks, tags };
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

    const { data: priorRow } = await supabase
      .from("voice_notes")
      .select("heading, summary, tasks")
      .eq("id", note.id)
      .single();
    const priorTasksArr = Array.isArray((priorRow as any)?.tasks) ? ((priorRow as any).tasks as Array<{ text?: string }>) : [];
    const prior = priorRow
      ? {
          heading: (priorRow as any).heading ?? "",
          summary: (priorRow as any).summary ?? "",
          tasks: priorTasksArr.map((t) => String(t?.text ?? "")).filter((s) => s.trim().length > 0),
        }
      : null;

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

      const structured = await extractStructured(transcript, images, apiKey, prior);
      // Image-only notes (no audio) should not have AI-generated tasks — they're
      // rarely actionable and mostly noise. Users can still add custom tasks.
      const skipTasks = !note.audio_path && imagePaths.length > 0;
      const effectiveTasks = skipTasks ? [] : structured.tasks;
      // Preserve done/pending state for tasks whose text matches a prior task.
      const priorTaskMap = new Map<string, { done: boolean; pending: boolean }>();
      for (const t of priorTasksArr) {
        const key = String((t as any)?.text ?? "").trim().toLowerCase();
        if (!key) continue;
        priorTaskMap.set(key, {
          done: Boolean((t as any)?.done),
          pending: (t as any)?.pending === undefined ? false : Boolean((t as any)?.pending),
        });
      }
      const tasksPayload = effectiveTasks.map((text, i) => {
        const match = priorTaskMap.get(text.trim().toLowerCase());
        return { id: `t${i}`, text, done: match?.done ?? false, pending: match?.pending ?? true };
      });

      await supabase
        .from("voice_notes")
        .update({
          status: "ready",
          transcript,
          heading: structured.heading,
          summary: structured.summary,
          tasks: tasksPayload,
          tags: structured.tags,
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
    await Promise.all(
      Array.from(byNote).map(async ([noteId, taskIds]) => {
        const { data: note } = await supabase
          .from("voice_notes")
          .select("tasks")
          .eq("id", noteId)
          .single();
        if (!note) return;
        const tasks = (Array.isArray(note.tasks) ? note.tasks : []) as Array<{ id: string; text: string; done: boolean }>;
        const next = tasks.filter((t) => !taskIds.has(t.id));
        await supabase.from("voice_notes").update({ tasks: next }).eq("id", noteId);
      }),
    );
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
Return ONE JSON object with keys: heading, summary, tasks, tags. No prose, no code fences.

- heading: short (max ~8 words), title case, no trailing punctuation. Prefer the page's own concise title.
- summary: 2-5 sentences on what the page is about and the key takeaways the reader would want to remember.
- tasks: array of concrete, actionable to-dos the user would plausibly want to do because they saved this page.
- tags: 3-6 short lowercase tags (kebab-case, no #). Cover topic, domain type (e.g. "article", "recipe", "product", "video"), and subject (e.g. "cooking", "startup", "python").

HOW TO EXTRACT TASKS — be smart:
- A product page → "Buy <product>", "Compare <product> vs <alt>" if alternatives are mentioned.
- A recipe → "Cook <dish>", plus grocery items as separate tasks if it's a shopping-worthy list.
- A how-to / tutorial → each major step becomes a task, in order.
- An event / concert / movie release → "Attend <event> on <date>", "Book tickets for <event>".
- A job posting → "Apply to <role> at <company> by <deadline>".
- An article that recommends specific actions → capture each recommendation as its own task.
- Rewrite tasks so they include the specific item, name, date, or amount from the page. No vague verbs.

Skip "Read this later" / "Bookmark this" — saving the note IS the bookmark. If the page is purely informational with no plausible action, return []. Cap at 8 tasks.

Respond with ONLY the JSON object.`;

async function fetchWebPageText(url: string): Promise<{ title: string | null; text: string }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const fcKey = process.env.FIRECRAWL_API_KEY;
  if (!lovableKey || !fcKey) throw new Error("Missing Firecrawl credentials");

  const res = await fetch("https://connector-gateway.lovable.dev/firecrawl/v2/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": fcKey,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Firecrawl scrape failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as any;
  const doc = json?.data ?? json;
  const markdown: string = doc?.markdown ?? "";
  const metadata = doc?.metadata ?? {};
  const title: string | null =
    (metadata.title as string) ?? (metadata.ogTitle as string) ?? null;
  const description: string = (metadata.description as string) ?? "";
  const combined = [description, markdown].filter(Boolean).join("\n\n").trim();
  return { title: title ? title.slice(0, 200) : null, text: combined.slice(0, 20000) };
}


async function summarizeWebPage(
  url: string,
  title: string | null,
  text: string,
  apiKey: string,
): Promise<{ heading: string; summary: string; tasks: string[]; tags: string[] }> {
  const userMsg = `URL: ${url}\n${title ? `Page title: ${title}\n` : ""}\nPage content:\n${text}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-3.5-flash",
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
  const tags = parseTags(parsed.tags);
  return { heading, summary, tasks, tags };
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
      const tasksPayload = structured.tasks.map((t, i) => ({ id: `t${i}`, text: t, done: false, pending: true }));
      await supabase
        .from("voice_notes")
        .update({
          status: "ready",
          heading: structured.heading,
          summary: structured.summary,
          tasks: tasksPayload,
          tags: structured.tags,
        })
        .eq("id", inserted.id);
      return { ok: true as const, noteId: inserted.id };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await supabase.from("voice_notes").update({ status: "failed", error: msg }).eq("id", inserted.id);
      throw new Error(msg);
    }
  });

const ReviewTasksInput = z.object({
  tasks: z.array(z.object({ noteId: z.string().uuid(), taskId: z.string() })).min(1),
});

export const approveTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ReviewTasksInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const byNote = new Map<string, Set<string>>();
    for (const t of data.tasks) {
      if (!byNote.has(t.noteId)) byNote.set(t.noteId, new Set());
      byNote.get(t.noteId)!.add(t.taskId);
    }
    for (const [noteId, taskIds] of byNote) {
      const { data: note } = await supabase.from("voice_notes").select("tasks").eq("id", noteId).single();
      if (!note) continue;
      const tasks = (Array.isArray(note.tasks) ? note.tasks : []) as Array<any>;
      const next = tasks.map((t) => (taskIds.has(t.id) ? { ...t, pending: false } : t));
      await supabase.from("voice_notes").update({ tasks: next }).eq("id", noteId);
    }
    return { ok: true as const };
  });

export const dismissTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ReviewTasksInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const byNote = new Map<string, Set<string>>();
    for (const t of data.tasks) {
      if (!byNote.has(t.noteId)) byNote.set(t.noteId, new Set());
      byNote.get(t.noteId)!.add(t.taskId);
    }
    for (const [noteId, taskIds] of byNote) {
      const { data: note } = await supabase.from("voice_notes").select("tasks").eq("id", noteId).single();
      if (!note) continue;
      const tasks = (Array.isArray(note.tasks) ? note.tasks : []) as Array<any>;
      const next = tasks.filter((t) => !taskIds.has(t.id));
      await supabase.from("voice_notes").update({ tasks: next }).eq("id", noteId);
    }
    return { ok: true as const };
  });

const TEXT_SYSTEM_PROMPT = `You are analyzing a user's written note.
Return ONE JSON object with keys: heading, summary, tasks, tags. No prose, no code fences.

- heading: short (max ~8 words), title case, no trailing punctuation, reflecting the note's actual topic. Never use "Untitled" or generic filler.
- summary: 1-3 sentence recap of the note's key points. Leave "" if the note is too short to summarize meaningfully.
- tasks: array of clear, actionable to-dos extracted from the note (imperative voice, include names/dates/amounts). Skip pure musings. Cap at 8. Return [] if nothing is genuinely actionable.
- tags: 3-6 short lowercase tags (kebab-case, no #) categorizing the note by topic, project, person, or type.

Respond with ONLY the JSON object.`;

async function extractFromText(
  heading: string,
  body: string,
  apiKey: string,
): Promise<{ heading: string; summary: string; tasks: string[]; tags: string[] }> {
  if (!body || body.trim().length < 20) return { heading: "", summary: "", tasks: [], tags: [] };
  const userContent = heading
    ? `Title: ${heading}\n\nNote:\n${body}`
    : `Note:\n${body}\n\n(No title provided — generate one.)`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-3.5-flash",
      messages: [
        { role: "system", content: TEXT_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return { heading: "", summary: "", tasks: [], tags: [] };
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  const outHeading = String(parsed.heading ?? "").slice(0, 120);
  const summary = String(parsed.summary ?? "").slice(0, 2000);
  const tasksArr = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const tasks = tasksArr
    .map((t: unknown) =>
      typeof t === "string" ? t : typeof t === "object" && t && "text" in (t as any) ? String((t as any).text) : "",
    )
    .filter((t: string) => t.trim().length > 0)
    .slice(0, 20);
  const tags = parseTags(parsed.tags);
  return { heading: outHeading, summary, tasks, tags };
}

export const saveTextNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SaveTextNoteInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let finalHeading = data.heading.trim();
    if (!finalHeading) {
      const fallback = data.body.trim().split(/\r?\n/)[0]?.replace(/^#+\s*/, "").slice(0, 80);
      finalHeading = fallback || "Untitled note";
    }

    const { data: inserted, error: insErr } = await supabase
      .from("voice_notes")
      .insert({
        user_id: userId,
        heading: finalHeading,
        transcript: data.body || null,
        summary: "",
        tasks: [],
        tags: [],
        image_paths: data.imagePaths ?? [],
        source_url: data.sourceUrl ?? null,
        status: "ready",
      })
      .select("id")
      .single();
    if (insErr || !inserted) throw new Error(insErr?.message ?? "Insert failed");
    return { ok: true as const, noteId: inserted.id };
  });

const UpdateTextNoteInput = z.object({
  noteId: z.string().uuid(),
  heading: z.string().trim().max(200).optional().default(""),
  body: z.string().max(50000).optional().default(""),
});

export const updateTextNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => UpdateTextNoteInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let finalHeading = data.heading.trim();
    if (!finalHeading) {
      const fallback = data.body.trim().split(/\r?\n/)[0]?.replace(/^#+\s*/, "").slice(0, 80);
      finalHeading = fallback || "Untitled note";
    }
    const { error } = await supabase
      .from("voice_notes")
      .update({ heading: finalHeading, transcript: data.body || null })
      .eq("id", data.noteId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const AppendImagesInput = z.object({
  noteId: z.string().uuid(),
  imagePaths: z.array(z.string().min(1).max(500)).min(1).max(20),
});

export const appendImagesToNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => AppendImagesInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error: selErr } = await supabase
      .from("voice_notes")
      .select("image_paths")
      .eq("id", data.noteId)
      .single();
    if (selErr || !row) throw new Error(selErr?.message ?? "Note not found");
    const existing = Array.isArray((row as any).image_paths)
      ? ((row as any).image_paths as unknown[]).filter((p): p is string => typeof p === "string" && !!p)
      : [];
    const merged = [...existing, ...data.imagePaths].slice(0, 40);
    const { error } = await supabase
      .from("voice_notes")
      .update({ image_paths: merged })
      .eq("id", data.noteId);
    if (error) throw new Error(error.message);
    return { ok: true as const, imagePaths: merged };
  });

const TranscribeClipInput = z.object({
  audioPath: z.string().min(1).max(500),
});

export const transcribeAudioClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => TranscribeClipInput.parse(data))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const { userId } = context;
    if (!data.audioPath.startsWith(`${userId}/`)) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from("voice-notes")
      .download(data.audioPath);
    if (dlErr || !file) throw new Error(`Download failed: ${dlErr?.message ?? "no file"}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = file.type || "audio/webm";
    const transcript = await transcribeAudio(bytes, mime, apiKey);
    if (!transcript) throw new Error("Empty transcription");
    return { transcript };
  });

const GenerateLinkLabelInput = z.object({ url: z.string().trim().url().max(2000) });

export const generateLinkLabel = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GenerateLinkLabelInput.parse(data))
  .handler(async ({ data }) => {
    const url = data.url;
    let hostname = "";
    try {
      hostname = new URL(url).hostname.replace(/^www\./, "");
    } catch {}
    // Try a lightweight fetch of the page and extract <title> / og:title.
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BraintapeBot/1.0; +https://braintape.app)",
          Accept: "text/html,application/xhtml+xml",
        },
      }).finally(() => clearTimeout(timeout));
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("text/html") || ct.includes("application/xhtml")) {
          const html = (await res.text()).slice(0, 200000);
          const og = html.match(
            /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
          )?.[1];
          const tw = html.match(
            /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
          )?.[1];
          const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
          const raw = (og || tw || title || "").trim();
          if (raw) {
            const decoded = raw
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 120);
            return { label: decoded, hostname };
          }
        }
      }
    } catch {
      // fall through to hostname
    }
    return { label: hostname || url, hostname };
  });

const SearchInput = z.object({
  query: z.string().trim().min(1).max(500),
  useAi: z.boolean().optional().default(false),
});

export const searchEverything = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SearchInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const q = data.query.trim();
    const { data: rows } = await supabase
      .from("voice_notes")
      .select("id, heading, summary, tags, tasks, transcript, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    const notes = (rows ?? []).filter((n: any) => n.heading !== "__custom__");

    if (!data.useAi) {
      const needle = q.toLowerCase();
      const noteMatches = notes.filter((n: any) => {
        const hay = [
          n.heading ?? "",
          n.summary ?? "",
          n.transcript ?? "",
          ...(Array.isArray(n.tags) ? n.tags : []),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      });
      const taskMatches: Array<{ noteId: string; taskId: string; text: string; done: boolean; noteHeading: string | null }> = [];
      for (const n of notes) {
        const tasks = Array.isArray((n as any).tasks) ? ((n as any).tasks as any[]) : [];
        for (const t of tasks) {
          if (typeof t?.text === "string" && t.text.toLowerCase().includes(needle)) {
            taskMatches.push({
              noteId: n.id,
              taskId: t.id,
              text: t.text,
              done: Boolean(t.done),
              noteHeading: (n as any).heading === "__custom__" ? null : (n as any).heading ?? null,
            });
          }
        }
      }
      return { noteIds: noteMatches.map((n: any) => n.id), tasks: taskMatches, reasoning: null };
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const catalog = notes.slice(0, 200).map((n: any) => ({
      id: n.id,
      heading: n.heading ?? "",
      summary: (n.summary ?? "").slice(0, 300),
      tags: Array.isArray(n.tags) ? n.tags : [],
    }));
    const sys = `You are a semantic search assistant over the user's personal notes.
Given a query and a JSON catalog of notes (id, heading, summary, tags), return the most relevant note ids ordered by relevance.
Only include notes that are genuinely relevant. If nothing fits, return an empty array.
Return ONE JSON object: { "ids": string[], "reasoning": string }. Reasoning is one short sentence. No prose, no code fences.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Query: ${q}\n\nNotes:\n${JSON.stringify(catalog)}` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    const validIds = new Set(notes.map((n: any) => n.id));
    const ids: string[] = (Array.isArray(parsed.ids) ? parsed.ids : [])
      .map((x: unknown) => String(x))
      .filter((id: string) => validIds.has(id))
      .slice(0, 30);
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 300) : null;
    return { noteIds: ids, tasks: [], reasoning };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ProcessInput = z.object({ noteId: z.string().uuid() });

type ProcessResult = {
  transcript: string;
  heading: string;
  summary: string;
  tasks: string[];
};

const SYSTEM_PROMPT = `You turn a raw voice-note transcript into structured notes.
Return a single JSON object with keys: heading, summary, tasks.
- heading: one short line (max ~8 words), title case, no trailing punctuation.
- summary: 2-4 concise sentences capturing the key ideas.
- tasks: array of short actionable to-dos extracted from the transcript, imperative voice ("Call John about invoice"). Empty array if none.
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

async function extractStructured(transcript: string, apiKey: string): Promise<Omit<ProcessResult, "transcript">> {
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
        { role: "user", content: `Transcript:\n\n${transcript}` },
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
    // best-effort: strip fences
    const stripped = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(stripped);
  }
  const heading = String(parsed.heading ?? "Untitled note").slice(0, 120);
  const summary = String(parsed.summary ?? "").slice(0, 2000);
  const tasksArr = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const tasks = tasksArr
    .map((t: unknown) => (typeof t === "string" ? t : typeof t === "object" && t && "text" in (t as any) ? String((t as any).text) : ""))
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
      .select("id, audio_path, user_id")
      .eq("id", data.noteId)
      .single();
    if (noteErr || !note) throw new Error("Note not found");
    if (note.user_id !== userId) throw new Error("Forbidden");

    await supabase.from("voice_notes").update({ status: "transcribing", error: null }).eq("id", note.id);

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: file, error: dlErr } = await supabaseAdmin.storage
        .from("voice-notes")
        .download(note.audio_path);
      if (dlErr || !file) throw new Error(`Download failed: ${dlErr?.message ?? "no file"}`);

      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = file.type || "audio/webm";

      const transcript = await transcribeAudio(bytes, mime, apiKey);
      if (!transcript) throw new Error("Empty transcription");

      await supabase.from("voice_notes").update({ status: "processing", transcript }).eq("id", note.id);

      const structured = await extractStructured(transcript, apiKey);
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

const DeleteInput = z.object({ noteId: z.string().uuid() });

export const deleteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => DeleteInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: note } = await supabase
      .from("voice_notes")
      .select("audio_path")
      .eq("id", data.noteId)
      .single();
    if (note?.audio_path) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.storage.from("voice-notes").remove([note.audio_path]);
    }
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
      .select("audio_path")
      .in("id", data.noteIds);
    const paths = (rows ?? []).map((r: any) => r.audio_path).filter(Boolean) as string[];
    if (paths.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.storage.from("voice-notes").remove(paths);
    }
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

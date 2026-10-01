// Local-only "server function shims". These preserve the module surface
// used across the app (each export is `(args: { data: X }) => Promise<Y>`)
// but persist to Dexie instead of a cloud DB. AI-only work is delegated
// to the server functions in `./ai.functions`.

import { db, newNote, type LocalNote, type LocalTask } from "./local-db";
import {
  analyzeMediaFn,
  analyzeTextFn,
  analyzeWebLinkFn,
  fetchLinkImageFn,
  generateLinkLabelFn,
  semanticRankFn,
  transcribeClipFn,
  ocrImagesFn,
} from "./ai.functions";
import { evictPhoto, readPhotoBytes, storeLocalPhoto } from "./photo-cache";
import { evictAudio, readAudioBytes, storeLocalAudio } from "./audio-cache";
import { findExistingByMedia, findExistingByText, findExistingByUrl, normalizeUrl } from "./dedupe";
import { activeKeyChain } from "./ai-keys";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const nowIso = () => new Date().toISOString();

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

async function updateNote(id: string, patch: Partial<LocalNote>): Promise<void> {
  await db.notes.update(id, { ...patch, updated_at: nowIso() });
}

async function getNote(id: string): Promise<LocalNote | undefined> {
  return db.notes.get(id);
}

// ---------------------------------------------------------------------------
// Notes: create / analyze
// ---------------------------------------------------------------------------

export async function createMediaNote(input: {
  audioBlob: Blob | null;
  audioMime: string | null;
  durationSeconds: number | null;
  imageBlobs: Blob[];
}): Promise<{ noteId: string }> {
  const imagePaths: string[] = [];
  for (const b of input.imageBlobs) {
    imagePaths.push(await storeLocalPhoto(b));
  }
  let audioPath: string | null = null;
  if (input.audioBlob) audioPath = await storeLocalAudio(input.audioBlob, input.audioMime ?? undefined);

  try {
    const { fingerprintForNote } = await import("./dedupe");
    const provisional = newNote({
      audio_path: audioPath,
      audio_paths: audioPath ? [audioPath] : [],
      image_paths: imagePaths,
      duration_seconds: input.durationSeconds,
      status: "processing",
    });
    const fp = await fingerprintForNote(provisional);
    if (fp.startsWith("blobs:")) {
      const candidates = await db.notes.filter((n) => !n.deleted_at && (n.image_paths?.length ?? 0) + (n.audio_paths?.length ?? (n.audio_path ? 1 : 0)) > 0).toArray();
      for (const c of candidates) {
        const otherFp = await fingerprintForNote(c);
        if (otherFp === fp) return { noteId: c.id };
      }
    }
  } catch {}

  const note = newNote({
    audio_path: audioPath,
    audio_paths: audioPath ? [audioPath] : [],
    image_paths: imagePaths,
    duration_seconds: input.durationSeconds,
    status: "processing",
  });
  await db.notes.put(note);

  void analyzeNoteInBackground(note.id).catch(() => {});
  return { noteId: note.id };
}

async function analyzeNoteInBackground(noteId: string): Promise<void> {
  const note = await getNote(noteId);
  if (!note) return;
  try {
    const segmentPaths: string[] =
      note.audio_paths && note.audio_paths.length > 0
        ? note.audio_paths
        : note.audio_path
          ? [note.audio_path]
          : [];
    let firstAudio: { base64: string; mime: string } | null = null;
    const extraTranscripts: string[] = [];
    const keys = activeKeyChain();

    for (let i = 0; i < segmentPaths.length; i++) {
      const a = await readAudioBytes(segmentPaths[i]);
      if (!a) continue;
      if (i === 0) {
        firstAudio = { base64: bytesToBase64(a.bytes), mime: a.mime };
      } else {
        try {
          const { transcript: t } = await transcribeClipFn({
            data: { audio: { base64: bytesToBase64(a.bytes), mime: a.mime }, keys },
          });
          if (t?.trim()) extraTranscripts.push(t.trim());
        } catch {}
      }
    }
    const images: Array<{ base64: string; mime: string }> = [];
    for (const p of note.image_paths) {
      const im = await readPhotoBytes(p);
      if (im) images.push({ base64: bytesToBase64(im.bytes), mime: im.mime });
    }
    if (!firstAudio && images.length === 0) throw new Error("No content to analyze");
    await updateNote(noteId, { status: "transcribing" });
    const prior = {
      heading: note.heading ?? "",
      summary: note.summary ?? "",
      tasks: (note.tasks ?? []).map((t) => t.text),
    };
    const priorHasContent = prior.heading.trim() || prior.summary.trim() || prior.tasks.length > 0;
    const result = await analyzeMediaFn({
      data: {
        audio: firstAudio,
        images,
        prior: priorHasContent ? prior : null,
        skipTasks: false,
        extraTranscripts,
        keys,
      },
    });

    const priorMap = new Map<string, { done: boolean; pending: boolean }>();
    for (const t of note.tasks ?? []) {
      priorMap.set(t.text.trim().toLowerCase(), { done: !!t.done, pending: t.pending ?? false });
    }
    const tasksPayload: LocalTask[] = result.tasks.map((text, i) => {
      const m = priorMap.get(text.trim().toLowerCase());
      return { id: `t${i}`, text, done: m?.done ?? false, pending: m?.pending ?? true };
    });
    await updateNote(noteId, {
      status: "ready",
      transcript: result.transcript ?? note.transcript,
      heading: result.heading,
      summary: result.summary,
      key_points: result.key_points ?? [],
      tasks: tasksPayload,
      error: null,
    });
    if (images.length > 0) {
      void autoExtractOcr(noteId, images);
    }
  } catch (err: any) {
    await updateNote(noteId, { status: "failed", error: err?.message ?? String(err) });
  }
}

// ---------------------------------------------------------------------------
// PDF documents
// ---------------------------------------------------------------------------

export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export async function createPdfNote(file: File): Promise<{ noteId: string }> {
  if (file.size > MAX_PDF_BYTES) throw new Error("PDF is too large (max 20 MB)");
  const path = `local://files/${crypto.randomUUID()}.pdf`;
  await db.files.put({
    path,
    blob: file,
    size: file.size,
    contentType: "application/pdf",
    cachedAt: Date.now(),
  });
  const note = newNote({
    status: "processing",
    heading: file.name.replace(/\.pdf$/i, ""),
    document: { name: file.name, path, size: file.size, pages: null },
  });
  await db.notes.put(note);
  void analyzePdfInBackground(note.id).catch(() => {});
  return { noteId: note.id };
}

export async function analyzePdfInBackground(noteId: string): Promise<void> {
  const note = await getNote(noteId);
  if (!note?.document) return;
  try {
    const row = await db.files.get(note.document.path);
    if (!row) throw new Error("PDF file is missing on this device");
    const bytes = new Uint8Array(await row.blob.arrayBuffer());
    const { analyzePdfFn } = await import("./pdf.functions");
    const r = await analyzePdfFn({
      data: {
        base64: bytesToBase64(bytes),
        filename: note.document.name,
        keys: activeKeyChain(),
      },
    });
    await updateNote(noteId, {
      status: "ready",
      heading: r.heading,
      summary: r.summary,
      key_points: r.key_points,
      transcript: r.transcript || null,
      tasks: r.tasks.map((text, i) => ({ id: `t${i}`, text, done: false, pending: true })),
      document: { ...note.document, pages: r.pages },
      error: null,
    });
  } catch (err: any) {
    await updateNote(noteId, { status: "failed", error: err?.message ?? String(err) });
  }
}

async function autoExtractOcr(
  noteId: string,
  preloadedImages?: Array<{ base64: string; mime: string }>,
): Promise<void> {
  try {
    const note = await getNote(noteId);
    if (!note) return;
    if (note.ocr_text && note.ocr_text.trim()) return;
    const paths = note.image_paths ?? [];
    if (paths.length === 0) return;
    let images = preloadedImages;
    if (!images || images.length === 0) {
      images = [];
      for (const p of paths) {
        const b = await readPhotoBytes(p);
        if (b) images.push({ base64: bytesToBase64(b.bytes), mime: b.mime });
      }
    }
    if (images.length === 0) return;
    const { text } = await ocrImagesFn({ data: { images, keys: activeKeyChain() } });
    if (!text || !text.trim()) return;
    await updateNote(noteId, { ocr_text: text, ocr_hidden: true });
  } catch {}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function toggleTask({ data }: { data: { noteId: string; taskId: string; done?: boolean } }) {
  const note = await getNote(data.noteId);
  if (!note) return { ok: true as const };
  const next = (note.tasks ?? []).map((t) =>
    t.id === data.taskId ? { ...t, done: typeof data.done === "boolean" ? data.done : !t.done } : t,
  );
  await updateNote(data.noteId, { tasks: next });
  return { ok: true as const };
}

export async function pinTask({ data }: { data: { noteId: string; taskId: string; pinned?: boolean } }) {
  const note = await getNote(data.noteId);
  if (!note) return { ok: true as const };
  const next = (note.tasks ?? []).map((t) =>
    t.id === data.taskId ? { ...t, pinned: typeof data.pinned === "boolean" ? data.pinned : !t.pinned } : t,
  );
  await updateNote(data.noteId, { tasks: next });
  return { ok: true as const };
}

export async function editTaskText({
  data,
}: {
  data: { noteId: string; taskId: string; text: string };
}) {
  const note = await getNote(data.noteId);
  if (!note) return { ok: true as const };
  const next = (note.tasks ?? []).map((t) => (t.id === data.taskId ? { ...t, text: data.text } : t));
  await updateNote(data.noteId, { tasks: next });
  return { ok: true as const };
}

const CUSTOM_HEADING = "__custom__";

export async function addCustomTask({ data }: { data: { text: string } }) {
  const existing = await db.notes.filter((n) => n.heading === CUSTOM_HEADING && !n.deleted_at).first();
  const newTask: LocalTask = {
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text: data.text,
    done: false,
  };
  if (existing) {
    await updateNote(existing.id, { tasks: [...(existing.tasks ?? []), newTask] });
    return { ok: true as const, noteId: existing.id, taskId: newTask.id };
  }
  const note = newNote({ heading: CUSTOM_HEADING, status: "ready", tasks: [newTask] });
  await db.notes.put(note);
  return { ok: true as const, noteId: note.id, taskId: newTask.id };
}

export async function deleteTasks({
  data,
}: {
  data: { tasks: Array<{ noteId: string; taskId: string }> };
}) {
  const byNote = new Map<string, Set<string>>();
  for (const t of data.tasks) {
    if (!byNote.has(t.noteId)) byNote.set(t.noteId, new Set());
    byNote.get(t.noteId)!.add(t.taskId);
  }
  for (const [noteId, taskIds] of byNote) {
    const note = await getNote(noteId);
    if (!note) continue;
    const next = (note.tasks ?? []).filter((t) => !taskIds.has(t.id));
    await updateNote(noteId, { tasks: next });
  }
  return { ok: true as const };
}

export async function approveTasks({
  data,
}: {
  data: { tasks: Array<{ noteId: string; taskId: string }> };
}) {
  const byNote = new Map<string, Set<string>>();
  for (const t of data.tasks) {
    if (!byNote.has(t.noteId)) byNote.set(t.noteId, new Set());
    byNote.get(t.noteId)!.add(t.taskId);
  }
  for (const [noteId, taskIds] of byNote) {
    const note = await getNote(noteId);
    if (!note) continue;
    const next = (note.tasks ?? []).map((t) => (taskIds.has(t.id) ? { ...t, pending: false } : t));
    await updateNote(noteId, { tasks: next });
  }
  return { ok: true as const };
}

export async function dismissTasks({
  data,
}: {
  data: { tasks: Array<{ noteId: string; taskId: string }> };
}) {
  return deleteTasks({ data });
}

export async function pinNote({ data }: { data: { noteId: string; pinned: boolean } }) {
  await updateNote(data.noteId, { pinned: data.pinned });
  return { ok: true as const };
}

export async function deleteNote({ data }: { data: { noteId: string } }) {
  const now = nowIso();
  await db.notes.update(data.noteId, { deleted_at: now, updated_at: now });
  return { ok: true as const };
}

export async function deleteNotes({ data }: { data: { noteIds: string[] } }) {
  const now = nowIso();
  for (const id of data.noteIds) await db.notes.update(id, { deleted_at: now, updated_at: now });
  return { ok: true as const };
}

export async function restoreNotes({ data }: { data: { noteIds: string[] } }) {
  const now = nowIso();
  for (const id of data.noteIds) await db.notes.update(id, { deleted_at: null, updated_at: now });
  return { ok: true as const };
}

async function purgeSingle(id: string) {
  const note = await getNote(id);
  if (!note) return;
  for (const p of note.image_paths) await evictPhoto(p);
  if (note.audio_path) await evictAudio(note.audio_path);
  await db.notes.delete(id);
}

export async function purgeNotes({ data }: { data: { noteIds: string[] } }) {
  for (const id of data.noteIds) {
    const n = await getNote(id);
    if (n?.deleted_at) await purgeSingle(id);
  }
  return { ok: true as const, purged: data.noteIds.length };
}

export async function purgeExpiredNotes() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const all = await db.notes.toArray();
  let purged = 0;
  for (const n of all) {
    if (n.deleted_at && new Date(n.deleted_at).getTime() < cutoff) {
      await purgeSingle(n.id);
      purged++;
    }
  }
  return { ok: true as const, purged };
}

export async function deleteAccount() {
  await db.notes.clear();
  await db.photos.clear();
  await db.audios.clear();
  await db.meta.clear();
  await db.collections.clear();
  return { ok: true as const };
}

export async function processVoiceNote({ data }: { data: { noteId: string } }) {
  await analyzeNoteInBackground(data.noteId);
  return { ok: true as const };
}

export async function saveWebLink({ data }: { data: { url: string } }) {
  const url = /^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`;
  const existing = await findExistingByUrl(url);
  if (existing) return { ok: true as const, noteId: existing, duplicate: true as const };
  const note = newNote({ source_url: normalizeUrl(url), status: "processing" });
  await db.notes.put(note);

  try {
    const { lookupTmdbFn } = await import("./tmdb.functions");
    const media = await lookupTmdbFn({ data: { url } });
    if (media) {
      const existingMedia = await findExistingByMedia(media.type, media.tmdb_id);
      if (existingMedia && existingMedia !== note.id) {
        await db.notes.delete(note.id);
        return { ok: true as const, noteId: existingMedia, duplicate: true as const };
      }
      await updateNote(note.id, {
        status: "ready",
        heading: media.title,
        summary: media.overview || null,
        media: (() => {
          const { original_url: _o, ...rest } = media;
          return { ...rest, watch_status: null, watched_at: null, watched_episodes: [] };
        })(),
      });
      await fileMediaNoteIntoCollection(note.id, media.type);
      return { ok: true as const, noteId: note.id, duplicate: false as const };
    }
  } catch {}

  const { isYouTubeUrl, parseYouTubeId } = await import("./youtube");
  const ytid = isYouTubeUrl(url) ? parseYouTubeId(url) : null;
  if (ytid) {
    try {
      const { fetchYouTubeFn } = await import("./youtube.functions");
      const meta = await fetchYouTubeFn({ data: { url } });
      await updateNote(note.id, {
        heading: meta.title ?? undefined,
        summary: meta.description ? meta.description.slice(0, 300) : null,
        youtube: {
          video_id: meta.videoId,
          canonical_url: meta.canonicalUrl,
          title: meta.title,
          channel_name: meta.channelName,
          channel_url: meta.channelUrl,
          channel_id: meta.channelId ?? null,
          thumbnail_url: meta.thumbnailUrl,
          description: meta.description ?? null,
          published_at: meta.publishedAt ?? null,
          duration_seconds: meta.durationSeconds ?? null,
          view_count: meta.viewCount ?? null,
          keywords: meta.keywords ?? [],
          captions_available: !!meta.captions,
        },
      });
      try {
        const { analyzeYouTubeFn } = await import("./ai.functions");
        const ai = await analyzeYouTubeFn({
          data: {
            url,
            title: meta.title,
            channelName: meta.channelName ?? undefined,
            description: meta.description,
            captions: meta.captions,
            keys: activeKeyChain(),
          },
        });
        await updateNote(note.id, {
          status: "ready",
          heading: ai.heading,
          summary: ai.summary,
          key_points: ai.key_points,
          tasks: ai.tasks.map((text, i) => ({ id: `t${i}`, text, done: false, pending: true })),
        });
      } catch {
        await updateNote(note.id, { status: "ready" });
      }
      return { ok: true as const, noteId: note.id, duplicate: false as const };
    } catch {}
  }

  void (async () => {
    try {
      const result = await analyzeWebLinkFn({ data: { url, keys: activeKeyChain() } });
      let imgPath: string | null = null;
      if (result.imageUrl) {
        try {
          const imgRes = await fetchLinkImageFn({ data: { url: result.imageUrl } });
          if (imgRes.ok) {
            const raw = Uint8Array.from(atob(imgRes.base64), (c) => c.charCodeAt(0));
            const blob = new Blob([raw], { type: imgRes.mime });
            imgPath = await storeLocalPhoto(blob);
          }
        } catch {}
      }
      await updateNote(note.id, {
        status: "ready",
        heading: result.heading,
        summary: result.summary,
        key_points: result.key_points,
        tasks: result.tasks.map((text, i) => ({ id: `t${i}`, text, done: false, pending: true })),
        tags: result.tags,
        image_paths: imgPath ? [imgPath] : [],
      });
    } catch (err: any) {
      await updateNote(note.id, { status: "failed", error: err?.message ?? String(err) });
    }
  })();

  return { ok: true as const, noteId: note.id, duplicate: false as const };
}

export async function saveTextNote({
  data,
}: {
  data: { heading?: string; body?: string };
}) {
  const heading = (data.heading ?? "").trim();
  const body = (data.body ?? "").trim();
  if (!heading && !body) throw new Error("Note cannot be empty");

  const existing = await findExistingByText(heading, body);
  if (existing) return { ok: true as const, noteId: existing, duplicate: true as const };

  const note = newNote({
    status: "ready",
    heading: heading || "Untitled note",
    summary: body || null,
    transcript: body || null,
  });
  await db.notes.put(note);

  if (body.length >= 40) {
    void (async () => {
      try {
        const enriched = await analyzeTextFn({ data: { heading, body, keys: activeKeyChain() } });
        if (enriched.summary || enriched.key_points.length > 0) {
          await updateNote(note.id, {
            heading: enriched.heading || note.heading,
            summary: enriched.summary || note.summary,
            key_points: enriched.key_points,
            tasks: enriched.tasks.map((text, i) => ({ id: `t${i}`, text, done: false, pending: true })),
            tags: enriched.tags,
          });
        }
      } catch {}
    })();
  }

  return { ok: true as const, noteId: note.id, duplicate: false as const };
}

export async function updateTextNote({
  data,
}: {
  data: { noteId: string; heading?: string; body?: string };
}) {
  const note = await getNote(data.noteId);
  if (!note) throw new Error("Note not found");
  const heading = (data.heading ?? note.heading ?? "").trim();
  const body = (data.body ?? note.summary ?? "").trim();
  await updateNote(data.noteId, {
    heading: heading || "Untitled note",
    summary: body,
    transcript: body || note.transcript,
  });
  return { ok: true as const };
}

export async function appendImagesToNote({
  data,
}: {
  data: { noteId: string; imageBlobs: Blob[] };
}) {
  const note = await getNote(data.noteId);
  if (!note) throw new Error("Note not found");
  const newPaths: string[] = [];
  for (const b of data.imageBlobs) newPaths.push(await storeLocalPhoto(b));
  const merged = [...(note.image_paths ?? []), ...newPaths];
  await updateNote(data.noteId, { image_paths: merged });
  return { ok: true as const, count: merged.length };
}

export async function extractOcrForNote({ data }: { data: { noteId: string } }) {
  const note = await getNote(data.noteId);
  if (!note) throw new Error("Note not found");
  const paths = note.image_paths ?? [];
  if (paths.length === 0) throw new Error("No images to scan");
  const images: Array<{ base64: string; mime: string }> = [];
  for (const p of paths) {
    const b = await readPhotoBytes(p);
    if (b) images.push({ base64: bytesToBase64(b.bytes), mime: b.mime });
  }
  if (images.length === 0) throw new Error("Images unavailable");
  const { text } = await ocrImagesFn({ data: { images, keys: activeKeyChain() } });
  await updateNote(data.noteId, { ocr_text: text || null });
  return { ok: true as const, text };
}

export async function updateImagePaths({
  data,
}: {
  data: { noteId: string; imagePaths: string[] };
}) {
  const note = await getNote(data.noteId);
  if (!note) return { ok: true as const };
  const removed = (note.image_paths ?? []).filter((p) => !data.imagePaths.includes(p));
  for (const p of removed) await evictPhoto(p);
  await updateNote(data.noteId, { image_paths: data.imagePaths });
  return { ok: true as const };
}

export async function transcribeAudioClip({ data }: { data: { audioPath: string } }) {
  const a = await readAudioBytes(data.audioPath);
  if (!a) throw new Error("Audio clip not found");
  const { transcript } = await transcribeClipFn({
    data: { audio: { base64: bytesToBase64(a.bytes), mime: a.mime }, keys: activeKeyChain() },
  });
  return { transcript };
}

export async function generateLinkLabel({ data }: { data: { url: string } }) {
  return generateLinkLabelFn({ data: { ...data, keys: activeKeyChain() } });
}

async function fileMediaNoteIntoCollection(noteId: string, type: "movie" | "tv") {
  try {
    const { ensureCollectionByTitle, addNotesToCollection, MOVIES_COLLECTION, TV_COLLECTION } =
      await import("./collections");
    const c = await ensureCollectionByTitle(type === "tv" ? TV_COLLECTION : MOVIES_COLLECTION);
    await addNotesToCollection(c.id, [noteId]);
  } catch {}
}

export async function addTmdbMedia({
  data,
}: {
  data: {
    type: "movie" | "tv";
    tmdb_id: number;
    title: string;
    poster_path: string | null;
    release_date: string | null;
    vote_average: number;
    overview: string | null;
  };
}) {
  const media = data;
  const existingMedia = await findExistingByMedia(media.type, media.tmdb_id);
  if (existingMedia) return { ok: true as const, noteId: existingMedia, duplicate: true as const };

  const note = newNote({
    status: "ready",
    heading: media.title,
    summary: media.overview || null,
    media: {
      type: media.type,
      tmdb_id: media.tmdb_id,
      title: media.title,
      poster_path: media.poster_path,
      release_date: media.release_date,
      vote_average: media.vote_average,
      overview: media.overview ?? "",
      imdb_id: null,
      tagline: null,
      backdrop_path: null,
      runtime: null,
      genres: [],
      homepage: null,
      watch_status: null,
      watched_at: null,
      watched_episodes: [],
    },
  });
  await db.notes.put(note);
  await fileMediaNoteIntoCollection(note.id, media.type);
  return { ok: true as const, noteId: note.id, duplicate: false as const };
}

export async function searchEverything({
  data,
}: {
  data: { query: string; useAi?: boolean };
}) {
  const q = data.query.trim();
  const all = await db.notes.orderBy("created_at").reverse().toArray();
  const notes = all.filter((n) => !n.deleted_at && n.heading !== "__custom__");

  if (!data.useAi) {
    const needle = q.toLowerCase();
    const noteMatches = notes.filter((n) => {
      const hay = [n.heading ?? "", n.summary ?? "", n.transcript ?? "", ...(n.tags ?? [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
    const tasks: Array<{
      noteId: string;
      taskId: string;
      text: string;
      done: boolean;
      noteHeading: string | null;
    }> = [];
    for (const n of all) {
      if (n.deleted_at) continue;
      for (const t of n.tasks ?? []) {
        if (t.text.toLowerCase().includes(needle)) {
          tasks.push({
            noteId: n.id,
            taskId: t.id,
            text: t.text,
            done: !!t.done,
            noteHeading: n.heading === "__custom__" ? null : n.heading,
          });
        }
      }
    }
    return { noteIds: noteMatches.map((n) => n.id), tasks, reasoning: null };
  }

  const catalog = notes.slice(0, 200).map((n) => ({
    id: n.id,
    heading: n.heading ?? "",
    summary: (n.summary ?? "").slice(0, 300),
    tags: n.tags ?? [],
  }));
  const { ids, reasoning } = await semanticRankFn({
    data: { query: q, catalog, keys: activeKeyChain() },
  });
  return { noteIds: ids, tasks: [] as any[], reasoning };
}

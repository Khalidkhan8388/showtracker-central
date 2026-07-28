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

/**
 * Create a local voice/image note from freshly captured blobs, persist the
 * blobs, then run AI analysis and update the note. Callers get the noteId
 * back so they can navigate/refresh.
 */
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

  // Dedupe by blob hash so accidental double-saves (e.g. multi-fire share
  // targets) collapse to the existing note instead of creating a twin.
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

  // Fire-and-forget analysis. Errors mark the note failed but never throw.
  void analyzeNoteInBackground(note.id).catch(() => {});
  return { noteId: note.id };
}

async function analyzeNoteInBackground(noteId: string): Promise<void> {
  const note = await getNote(noteId);
  if (!note) return;
  try {
    // Voice notes can now have multiple audio segments (base clip + any
    // "continue recording" appends). Transcribe each and join.
    const segmentPaths: string[] =
      note.audio_paths && note.audio_paths.length > 0
        ? note.audio_paths
        : note.audio_path
          ? [note.audio_path]
          : [];
    let firstAudio: { base64: string; mime: string } | null = null;
    const extraTranscripts: string[] = [];
    for (let i = 0; i < segmentPaths.length; i++) {
      const a = await readAudioBytes(segmentPaths[i]);
      if (!a) continue;
      if (i === 0) {
        firstAudio = { base64: bytesToBase64(a.bytes), mime: a.mime };
      } else {
        try {
          const { transcript: t } = await transcribeClipFn({
            data: { audio: { base64: bytesToBase64(a.bytes), mime: a.mime } },
          });
          if (t?.trim()) extraTranscripts.push(t.trim());
        } catch {
          /* skip failing segment */
        }
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
        skipTasks: false, // extract tasks from voice and image notes alike
        extraTranscripts,
      },
    });
    // Preserve done/pending state where task text matches.
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
    // Auto-OCR any images on media notes (voice+image or image-only).
    // Text notes are excluded because they go through saveTextNote, not here.
    if (images.length > 0) {
      void autoExtractOcr(noteId, images);
    }
  } catch (err: any) {
    await updateNote(noteId, { status: "failed", error: err?.message ?? String(err) });
  }
}

/**
 * Silently run OCR on a note's images and store the result hidden by default.
 * User can reveal via the "Show extracted text" button on the note detail.
 * Skips if OCR already exists or note has no images.
 */
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
    const { text } = await ocrImagesFn({ data: { images } });
    if (!text || !text.trim()) return;
    await updateNote(noteId, { ocr_text: text, ocr_hidden: true });
  } catch {
    /* silent — user can retry manually */
  }
}

// ---------------------------------------------------------------------------
// Public API — module surface shared with all the routes/components.
// Each export accepts `{ data: X }` and returns `{ ok: true, ... }` to match
// the historical server-function signature so callers keep working.
// ---------------------------------------------------------------------------

// -- CRUD ----

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
  // Local-only "delete account" = wipe every trace of user data from this device.
  await db.notes.clear();
  await db.photos.clear();
  await db.audios.clear();
  await db.meta.clear();
  await db.collections.clear();
  return { ok: true as const };
}

// -- AI-driven creators ----

export async function processVoiceNote({ data }: { data: { noteId: string } }) {
  await analyzeNoteInBackground(data.noteId);
  return { ok: true as const };
}

export async function saveWebLink({ data }: { data: { url: string } }) {
  const url = /^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`;
  // Dedupe by normalized URL (strips utm_*, fbclid, trailing slash, www., etc).
  const existing = await findExistingByUrl(url);
  if (existing) return { ok: true as const, noteId: existing, duplicate: true as const };
  const note = newNote({ source_url: normalizeUrl(url), status: "processing" });
  await db.notes.put(note);
  // 1) Try TMDB detection first — movies/TV get a dedicated card + detail page.
  try {
    const { lookupTmdbFn } = await import("./tmdb.functions");
    const media = await lookupTmdbFn({ data: { url } });
    if (media) {
      const existingMedia = await findExistingByMedia(media.type, media.tmdb_id);
      if (existingMedia && existingMedia !== note.id) {
        await db.notes.delete(note.id);
        return { ok: true as const, noteId: existingMedia, media: true as const, duplicate: true as const };
      }
      await updateNote(note.id, {
        status: "ready",
        heading: media.title,
        summary: media.tagline || media.overview.slice(0, 240) || null,
        tags: media.genres.slice(0, 6).map((g) => g.toLowerCase().replace(/\s+/g, "-")),
        media: {
          ...media,
          watch_status: "watchlist",
          watched_at: null,
          watched_episodes: [],
        },
      });
      try {
        const { ensureCollectionByTitle, addNotesToCollection, MOVIES_COLLECTION, TV_COLLECTION } = await import("./collections");
        const c = await ensureCollectionByTitle(media.type === "tv" ? TV_COLLECTION : MOVIES_COLLECTION);
        await addNotesToCollection(c.id, [note.id]);
      } catch {}
      return { ok: true as const, noteId: note.id, media: true as const };
    }
  } catch {
    // Fall through to normal AI link processing.
  }
  // 1b) YouTube — dedicated fetcher + AI analysis using title + description + captions.
  try {
    const { parseYouTubeId } = await import("./youtube");
    if (parseYouTubeId(url)) {
      const { fetchYouTubeFn } = await import("./youtube.functions");
      const yt = await fetchYouTubeFn({ data: { url } });
      let heading = yt.title ?? "YouTube video";
      let summary = yt.description?.slice(0, 400) ?? null;
      let keyPoints: string[] = [];
      let tasksPayload: LocalTask[] = [];
      try {
        const { analyzeYouTubeFn } = await import("./ai.functions");
        const ai = await analyzeYouTubeFn({
          data: {
            title: yt.title,
            channelName: yt.channelName,
            description: yt.description,
            captions: yt.captions,
            url: yt.canonicalUrl,
          },
        });
        heading = ai.heading || heading;
        summary = ai.summary || summary;
        keyPoints = ai.key_points ?? [];
        tasksPayload = ai.tasks.map((t, i) => ({ id: `t${i}`, text: t, done: false, pending: true }));
      } catch (aiErr) {
        console.error("[youtube] AI analysis failed, keeping metadata-only card", aiErr);
      }
      const tags = (yt.keywords ?? [])
        .slice(0, 6)
        .map((k) => k.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, ""))
        .filter(Boolean);
      await updateNote(note.id, {
        status: "ready",
        heading: heading.slice(0, 140),
        summary,
        tasks: tasksPayload,
        key_points: keyPoints,
        tags,
        source_url: normalizeUrl(yt.canonicalUrl),
        youtube: {
          video_id: yt.videoId,
          canonical_url: yt.canonicalUrl,
          title: yt.title,
          channel_name: yt.channelName,
          channel_url: yt.channelUrl,
          channel_id: yt.channelId,
          thumbnail_url: yt.thumbnailUrl,
          description: yt.description,
          published_at: yt.publishedAt,
          duration_seconds: yt.durationSeconds,
          view_count: yt.viewCount,
          keywords: yt.keywords ?? [],
          captions_available: (yt.captions?.length ?? 0) > 40,
        },
      });
      return { ok: true as const, noteId: note.id, youtube: true as const };
    }
  } catch (ytErr) {
    console.error("[youtube] fetch failed, falling back to generic web link", ytErr);
  }
  // 1c) Instagram — dedicated fetcher: image + full caption + author metadata.
  const { isInstagramUrl: isIgUrl } = await import("./instagram");
  const isIg = isIgUrl(url);
  try {
    if (isIg) {
      const { fetchInstagramFn } = await import("./instagram.functions");
      const ig = await fetchInstagramFn({ data: { url } });

      const caption = ig.caption ?? "";
      const author = ig.username ? `@${ig.username}` : ig.displayName ?? "Instagram";
      let heading = `${author} on Instagram`;
      // The raw caption is never surfaced — we only keep the AI's summary,
      // tasks and any place names found in the caption.
      let summary: string | null = null;
      let places: string[] = [];
      let tasksPayload: LocalTask[] = [];
      if (caption.trim().length >= 12) {
        try {
          const { analyzeInstagramFn } = await import("./ai.functions");
          const ai = await analyzeInstagramFn({ data: { caption, username: ig.username } });
          if (ai.heading) heading = ai.heading.slice(0, 90);
          if (ai.summary) summary = ai.summary;
          places = ai.places ?? [];
          tasksPayload = (ai.tasks ?? []).map((t, i) => ({
            id: `t${i}`,
            text: t,
            done: false,
            pending: true,
          }));
        } catch {
          /* keep the author-derived heading */
        }
      }
      // Persist the post image locally so the card works offline.
      let imagePaths: string[] = [];
      if (ig.imageUrl) {
        try {
          const img = await fetchLinkImageFn({ data: { url: ig.imageUrl } });
          if (img.ok) {
            const bin = atob(img.base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            imagePaths = [await storeLocalPhoto(new Blob([bytes], { type: img.mime }), img.mime)];
          }
        } catch {
          /* image is optional */
        }
      }
      const tags = Array.from(
        new Set(
          (caption.match(/#[\p{L}\p{N}_]{2,30}/gu) ?? [])
            .map((t) => t.slice(1).toLowerCase())
            .slice(0, 6),
        ),
      );
      await updateNote(note.id, {
        status: "ready",
        heading,
        summary,
        transcript: null,
        tasks: tasksPayload,
        image_paths: imagePaths,
        tags,
        source_url: normalizeUrl(ig.canonicalUrl),
        instagram: {
          shortcode: ig.shortcode,
          kind: ig.kind,
          canonical_url: ig.canonicalUrl,
          username: ig.username,
          display_name: ig.displayName,
          caption: null,
          like_count: ig.likeCount,
          comment_count: ig.commentCount,
          posted_at: ig.postedAt,
          is_video: ig.isVideo,
          thumbnail_url: ig.imageUrl ?? null,
          places,
        },
      });

      return { ok: true as const, noteId: note.id, instagram: true as const };
    }
  } catch (igErr) {
    console.error("[instagram] fetch failed", igErr);
  }
  if (isIg) {
    // Never fall through to the generic scraper for Instagram — it only ever
    // reaches the login/browser-update wall. Save a minimal Instagram card.
    const { parseInstagram } = await import("./instagram");
    const p = parseInstagram(url);
    await updateNote(note.id, {
      status: "ready",
      heading: "Instagram post",
      summary: null,
      source_url: normalizeUrl(url),
      instagram: {
        shortcode: p?.shortcode ?? "",
        kind: p?.kind ?? "post",
        canonical_url: url,
        username: null,
        display_name: null,
        caption: null,
        like_count: null,
        comment_count: null,
        posted_at: null,
        is_video: (p?.kind ?? "post") !== "post",
      },
    });
    return { ok: true as const, noteId: note.id, instagram: true as const };
  }

  // 2) Fall back to standard AI enrichment

  try {
    const result = await analyzeWebLinkFn({ data: { url } });
    const tasksPayload: LocalTask[] = result.tasks.map((t, i) => ({
      id: `t${i}`,
      text: t,
      done: false,
      pending: true,
    }));
    // Try to grab an og:image and persist it as the note's cover.
    let imagePaths: string[] = [];
    if (result.imageUrl) {
      try {
        const img = await fetchLinkImageFn({ data: { url: result.imageUrl } });
        if (img.ok) {
          const bin = atob(img.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: img.mime });
          const path = await storeLocalPhoto(blob, img.mime);
          imagePaths = [path];
        }
      } catch {}
    }
    await updateNote(note.id, {
      status: "ready",
      heading: result.heading,
      summary: result.summary,
      tasks: tasksPayload,
      image_paths: imagePaths,
    });
    if (imagePaths.length > 0) {
      void autoExtractOcr(note.id);
    }
  } catch (err: any) {
    await updateNote(note.id, { status: "failed", error: err?.message ?? String(err) });
    throw err;
  }
  return { ok: true as const, noteId: note.id };
}

export async function saveTextNote({
  data,
}: {
  data: {
    heading: string;
    body: string;
    imagePaths?: string[];
    sourceUrl?: string | null;
  };
}) {
  let heading = (data.heading ?? "").trim();
  const body = (data.body ?? "").trim();
  if (!heading) {
    const fallback = body.split(/\r?\n/)[0]?.replace(/^#+\s*/, "").slice(0, 80);
    heading = fallback || "Untitled note";
  }
  // Dedupe: identical heading + body (and no images/url/audio) collapses to
  // the existing entry so accidental re-saves never create a twin.
  if (!data.imagePaths?.length && !data.sourceUrl) {
    const existing = await findExistingByText(heading, body);
    if (existing) return { ok: true as const, noteId: existing, duplicate: true as const };
  }
  const note = newNote({
    heading,
    transcript: body || null,
    image_paths: data.imagePaths ?? [],
    source_url: data.sourceUrl ?? null,
    status: "ready",
  });
  await db.notes.put(note);
  // Optional AI enrichment for meaningful notes — fire-and-forget.
  if (body.length >= 40) {
    void (async () => {
      try {
        const enriched = await analyzeTextFn({ data: { heading, body } });
        // Text notes never get AI-extracted tasks — tasks come only from
        // voice, image, or URL notes.
        await updateNote(note.id, {
          heading: enriched.heading || heading,
          summary: enriched.summary,
        });
      } catch {
        /* ignore */
      }
    })();
  }
  return { ok: true as const, noteId: note.id };
}

export async function updateTextNote({
  data,
}: {
  data: { noteId: string; heading: string; body: string };
}) {
  let heading = (data.heading ?? "").trim();
  if (!heading) {
    const fallback = (data.body ?? "").trim().split(/\r?\n/)[0]?.replace(/^#+\s*/, "").slice(0, 80);
    heading = fallback || "Untitled note";
  }
  await updateNote(data.noteId, { heading, transcript: data.body || null });
  return { ok: true as const };
}

export async function appendImagesToNote({
  data,
}: {
  data: { noteId: string; imagePaths: string[] };
}) {
  const note = await getNote(data.noteId);
  if (!note) return { ok: true as const, imagePaths: data.imagePaths };
  const merged = [...(note.image_paths ?? []), ...data.imagePaths].slice(0, 40);
  await updateNote(data.noteId, { image_paths: merged });
  return { ok: true as const, imagePaths: merged };
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
  const { text } = await ocrImagesFn({ data: { images } });
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
  // Evict removed photos from local blob store.
  const removed = (note.image_paths ?? []).filter((p) => !data.imagePaths.includes(p));
  for (const p of removed) await evictPhoto(p);
  await updateNote(data.noteId, { image_paths: data.imagePaths });
  return { ok: true as const };
}

export async function transcribeAudioClip({ data }: { data: { audioPath: string } }) {
  const a = await readAudioBytes(data.audioPath);
  if (!a) throw new Error("Audio clip not found");
  const { transcript } = await transcribeClipFn({
    data: { audio: { base64: bytesToBase64(a.bytes), mime: a.mime } },
  });
  return { transcript };
}

export async function generateLinkLabel({ data }: { data: { url: string } }) {
  return generateLinkLabelFn({ data });
}

/** Ensure a media note is filed into the right auto collection. */
async function fileMediaNoteIntoCollection(noteId: string, type: "movie" | "tv") {
  try {
    const { ensureCollectionByTitle, addNotesToCollection, MOVIES_COLLECTION, TV_COLLECTION } =
      await import("./collections");
    const c = await ensureCollectionByTitle(type === "tv" ? TV_COLLECTION : MOVIES_COLLECTION);
    await addNotesToCollection(c.id, [noteId]);
  } catch (err) {
    console.error("[collections] failed to file media note", err);
  }
}

/** Add a movie/TV show to the app by TMDB id, from the in-app search. */
export async function addTmdbMedia({
  data,
}: {
  data: { type: "movie" | "tv"; tmdb_id: number };
}) {
  // Check if already saved to avoid duplicates.
  const existing = await db.notes
    .filter((n) => !n.deleted_at && n.media?.type === data.type && n.media?.tmdb_id === data.tmdb_id)
    .first();
  if (existing) {
    // Still make sure it's filed — a previous add may have raced or the
    // auto-collection could have been deleted / recreated in the meantime.
    await fileMediaNoteIntoCollection(existing.id, data.type);
    return { ok: true as const, noteId: existing.id, duplicate: true as const };
  }

  const { lookupTmdbByIdFn } = await import("./tmdb.functions");
  const media = await lookupTmdbByIdFn({ data: { type: data.type, tmdb_id: data.tmdb_id } });
  if (!media) throw new Error("Could not fetch details from TMDB");

  const note = newNote({
    source_url: media.original_url,
    status: "ready",
    heading: media.title,
    summary: media.tagline || media.overview.slice(0, 240) || null,
    tags: media.genres.slice(0, 6).map((g) => g.toLowerCase().replace(/\s+/g, "-")),
    media: {
      ...media,
      watch_status: "watchlist",
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
  const { ids, reasoning } = await semanticRankFn({ data: { query: q, catalog } });
  return { noteIds: ids, tasks: [] as any[], reasoning };
}

// Enforces "no two notes with the same content". Runs at save-time on each
// save path, and as a background sweep on app boot so any duplicate that
// slipped through (e.g. multi-fire SW share) is collapsed to the oldest.

import { db, type LocalNote } from "./local-db";
import { readPhotoBytes } from "./photo-cache";
import { readAudioBytes } from "./audio-cache";

const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "gclsrc", "dclid", "yclid", "msclkid", "mc_cid", "mc_eid",
  "ref", "ref_src", "ref_url", "referrer", "source", "s", "si",
  "igshid", "igsh", "sh", "share", "shared", "spm", "vero_id", "vero_conv",
  "_hsenc", "_hsmi", "hsCtaTracking", "hsa_acc", "hsa_cam",
];

export function normalizeUrl(input: string): string {
  const raw = (input || "").trim();
  if (!raw) return "";
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    // Strip empty query & hash
    if ([...u.searchParams].length === 0) u.search = "";
    u.hash = "";
    // Drop trailing slash on the pathname (but keep root "/")
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return raw.toLowerCase();
  }
}

function normText(s: string | null | undefined) {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPath(kind: "photo" | "audio", path: string): Promise<string | null> {
  try {
    const bytes = kind === "photo" ? await readPhotoBytes(path) : await readAudioBytes(path);
    if (!bytes) return null;
    return await sha256Hex(bytes.bytes);
  } catch {
    return null;
  }
}

export async function fingerprintForNote(note: LocalNote): Promise<string> {
  // Media (movie / tv) — TMDB id is the identity.
  if (note.media?.tmdb_id) return `media:${note.media.type}:${note.media.tmdb_id}`;
  // Web link — normalized URL is the identity.
  if (note.source_url) return `url:${normalizeUrl(note.source_url)}`;
  // Voice / image note — hash the underlying blobs, tolerant of ordering.
  const parts: string[] = [];
  for (const p of note.audio_paths ?? (note.audio_path ? [note.audio_path] : [])) {
    const h = await hashPath("audio", p);
    if (h) parts.push(`a:${h}`);
  }
  for (const p of note.image_paths ?? []) {
    const h = await hashPath("photo", p);
    if (h) parts.push(`i:${h}`);
  }
  if (parts.length > 0) return `blobs:${parts.sort().join("|")}`;
  // Text note — heading + body.
  const body = normText(note.transcript);
  const heading = normText(note.heading);
  if (body || heading) return `text:${heading}\n${body}`;
  return `id:${note.id}`;
}

// Look for an existing (non-deleted) note that matches the same identity.
// Returns the note's id if found, otherwise null. Used at save-time to
// short-circuit duplicate creation.
export async function findExistingByUrl(url: string): Promise<string | null> {
  const norm = normalizeUrl(url);
  if (!norm) return null;
  const all = await db.notes.filter((n) => !n.deleted_at && !!n.source_url).toArray();
  for (const n of all) {
    if (normalizeUrl(n.source_url!) === norm) return n.id;
  }
  return null;
}

export async function findExistingByMedia(type: "movie" | "tv", tmdbId: number): Promise<string | null> {
  const all = await db.notes.filter((n) => !n.deleted_at && n.media?.tmdb_id === tmdbId && n.media?.type === type).toArray();
  return all[0]?.id ?? null;
}

export async function findExistingByText(heading: string, body: string): Promise<string | null> {
  const h = normText(heading);
  const b = normText(body);
  if (!h && !b) return null;
  const all = await db.notes.filter((n) => !n.deleted_at && !n.source_url && !n.media && (n.image_paths?.length ?? 0) === 0 && !n.audio_path).toArray();
  for (const n of all) {
    if (normText(n.heading) === h && normText(n.transcript) === b) return n.id;
  }
  return null;
}

// Boot-time sweep: group notes by fingerprint, keep the oldest, soft-delete
// the rest. Safe to run repeatedly — cheap when there are no duplicates.
export async function pruneDuplicateNotes(): Promise<number> {
  const all = await db.notes.filter((n) => !n.deleted_at).toArray();
  const groups = new Map<string, LocalNote[]>();
  for (const n of all) {
    const fp = await fingerprintForNote(n);
    const arr = groups.get(fp) ?? [];
    arr.push(n);
    groups.set(fp, arr);
  }
  let removed = 0;
  const nowIso = new Date().toISOString();
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const [, ...dupes] = arr;
    for (const d of dupes) {
      await db.notes.update(d.id, { deleted_at: nowIso, updated_at: nowIso });
      removed++;
    }
  }
  return removed;
}

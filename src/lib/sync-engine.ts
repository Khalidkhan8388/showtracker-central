// Local-only "sync engine" — the app has no cloud, so this module just
// exposes optimistic write helpers on top of Dexie and stubs the legacy
// sync surface so nothing needs to import supabase.

import { db, type LocalNote } from "./local-db";
import { evictAudio } from "./audio-cache";
import { evictPhoto } from "./photo-cache";

const nowIso = () => new Date().toISOString();

export async function startSync(): Promise<void> {
  /* no-op: nothing to sync in local-only mode. */
}

export async function resync(): Promise<void> {
  /* no-op */
}

export async function markPendingDelete(_ids: string[]): Promise<void> {
  /* no-op */
}
export async function clearPendingDelete(_ids: string[]): Promise<void> {
  /* no-op */
}
export async function flushPendingDeletes(): Promise<void> {
  /* no-op */
}

export async function patchLocalNote(id: string, patch: Partial<LocalNote>): Promise<void> {
  await db.notes.update(id, { ...patch, updated_at: nowIso() });
}

export async function deleteLocalNotes(ids: string[]): Promise<void> {
  const now = nowIso();
  for (const id of ids) await db.notes.update(id, { deleted_at: now, updated_at: now });
}

export async function restoreLocalNotes(ids: string[]): Promise<void> {
  const now = nowIso();
  for (const id of ids) await db.notes.update(id, { deleted_at: null, updated_at: now });
}

export async function hardDeleteLocalNotes(ids: string[]): Promise<void> {
  for (const id of ids) {
    const n = await db.notes.get(id);
    if (n) {
      for (const p of n.image_paths ?? []) await evictPhoto(p);
      if (n.audio_path) await evictAudio(n.audio_path);
    }
  }
  await db.notes.bulkDelete(ids);
}


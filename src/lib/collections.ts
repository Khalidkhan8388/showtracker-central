// Local-only collections: group notes together. Many-to-many via an
// id array stored on the collection row.

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalCollection } from "./local-db";

const nowIso = () => new Date().toISOString();

export async function createCollection(title: string): Promise<LocalCollection> {
  const t = title.trim();
  if (!t) throw new Error("Collection needs a title.");
  const now = nowIso();
  const row: LocalCollection = {
    id: crypto.randomUUID(),
    title: t,
    note_ids: [],
    created_at: now,
    updated_at: now,
  };
  await db.collections.put(row);
  return row;
}

export async function ensureCollectionByTitle(title: string): Promise<LocalCollection> {
  const t = title.trim();
  const existing = (await db.collections.toArray()).find(
    (c) => c.title.trim().toLowerCase() === t.toLowerCase(),
  );
  if (existing) return existing;
  return createCollection(t);
}

export const MOVIES_COLLECTION = "Movies";
export const TV_COLLECTION = "TV Shows";

/** Auto-file every movie/TV note into the right collection. Safe to run repeatedly. */
export async function backfillMediaCollections(): Promise<void> {
  const notes = await db.notes.toArray();
  const movieIds = notes.filter((n) => n.media?.type === "movie" && !n.deleted_at).map((n) => n.id);
  const tvIds = notes.filter((n) => n.media?.type === "tv" && !n.deleted_at).map((n) => n.id);
  if (movieIds.length) {
    const c = await ensureCollectionByTitle(MOVIES_COLLECTION);
    await addNotesToCollection(c.id, movieIds);
  }
  if (tvIds.length) {
    const c = await ensureCollectionByTitle(TV_COLLECTION);
    await addNotesToCollection(c.id, tvIds);
  }
}

export async function renameCollection(id: string, title: string): Promise<void> {
  const t = title.trim();
  if (!t) return;
  await db.collections.update(id, { title: t, updated_at: nowIso() });
}

export async function deleteCollection(id: string): Promise<void> {
  await db.collections.delete(id);
}

/**
 * Delete any collection whose members no longer reference an alive note.
 * Callers pass the current set of alive (non-deleted) note ids so we can
 * detect collections that ended up empty because their members were trashed.
 */
export async function pruneEmptyCollections(aliveNoteIds: Set<string>): Promise<number> {
  const all = await db.collections.toArray();
  let pruned = 0;
  for (const c of all) {
    const alive = (c.note_ids ?? []).filter((id) => aliveNoteIds.has(id));
    if (alive.length === 0) {
      await db.collections.delete(c.id);
      pruned++;
    }
  }
  return pruned;
}

export async function addNotesToCollection(id: string, noteIds: string[]): Promise<void> {
  const c = await db.collections.get(id);
  if (!c) return;
  const set = new Set(c.note_ids);
  for (const n of noteIds) set.add(n);
  await db.collections.update(id, { note_ids: Array.from(set), updated_at: nowIso() });
}

export async function removeNotesFromCollection(id: string, noteIds: string[]): Promise<void> {
  const c = await db.collections.get(id);
  if (!c) return;
  const drop = new Set(noteIds);
  await db.collections.update(id, {
    note_ids: c.note_ids.filter((n) => !drop.has(n)),
    updated_at: nowIso(),
  });
}

export function useCollections(): LocalCollection[] | undefined {
  return useLiveQuery(async () => {
    const rows = await db.collections.toArray();
    return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, []);
}

export function useCollection(id: string | undefined): LocalCollection | undefined | null {
  useEffect(() => {}, [id]);
  return useLiveQuery(async () => {
    if (!id) return null;
    return (await db.collections.get(id)) ?? null;
  }, [id]);
}

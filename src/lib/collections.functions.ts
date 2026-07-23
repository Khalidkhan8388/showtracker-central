// Local-only collection helpers. Backed entirely by Dexie.
import { db, type LocalCollection, type LocalCollectionEntry } from "./local-db";

const nowIso = () => new Date().toISOString();
const junctionKey = (collectionId: string, noteId: string) => `${collectionId}::${noteId}`;

export async function createCollection(input: {
  name: string;
  description?: string | null;
  color?: string | null;
}): Promise<LocalCollection> {
  const now = nowIso();
  const row: LocalCollection = {
    id: crypto.randomUUID(),
    name: input.name.trim() || "Untitled collection",
    description: (input.description ?? "").trim() || null,
    view_mode: "grid",
    cover_image_path: null,
    color: input.color ?? null,
    sort_order: Date.now(),
    pinned: false,
    created_at: now,
    updated_at: now,
  };
  await db.collections.put(row);
  return row;
}

export async function updateCollection(
  id: string,
  patch: Partial<Omit<LocalCollection, "id" | "created_at">>,
): Promise<void> {
  await db.collections.update(id, { ...patch, updated_at: nowIso() });
}

export async function deleteCollection(id: string): Promise<void> {
  await db.transaction("rw", db.collections, db.collectionEntries, async () => {
    await db.collections.delete(id);
    const rows = await db.collectionEntries.where("collection_id").equals(id).toArray();
    if (rows.length) await db.collectionEntries.bulkDelete(rows.map((r) => r.key));
  });
}

export async function addNotesToCollection(
  collectionId: string,
  noteIds: string[],
): Promise<{ added: number }> {
  if (!noteIds.length) return { added: 0 };
  const now = nowIso();
  const entries: LocalCollectionEntry[] = noteIds.map((noteId) => ({
    key: junctionKey(collectionId, noteId),
    collection_id: collectionId,
    note_id: noteId,
    added_at: now,
  }));
  await db.collectionEntries.bulkPut(entries);
  await db.collections.update(collectionId, { updated_at: now });
  return { added: entries.length };
}

export async function removeNotesFromCollection(
  collectionId: string,
  noteIds: string[],
): Promise<void> {
  if (!noteIds.length) return;
  await db.collectionEntries.bulkDelete(noteIds.map((id) => junctionKey(collectionId, id)));
  await db.collections.update(collectionId, { updated_at: nowIso() });
}

// Called when a note is fully purged (not just soft-deleted) so we don't
// keep ghost junction rows pointing at nothing.
export async function purgeNoteFromAllCollections(noteId: string): Promise<void> {
  const rows = await db.collectionEntries.where("note_id").equals(noteId).toArray();
  if (rows.length) await db.collectionEntries.bulkDelete(rows.map((r) => r.key));
}

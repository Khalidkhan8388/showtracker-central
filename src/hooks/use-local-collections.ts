import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalCollection } from "@/lib/local-db";

export type CollectionWithCount = LocalCollection & { count: number };

export function useLocalCollections(): CollectionWithCount[] | undefined {
  return useLiveQuery(async () => {
    const [cols, entries] = await Promise.all([
      db.collections.toArray(),
      db.collectionEntries.toArray(),
    ]);
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.collection_id, (counts.get(e.collection_id) ?? 0) + 1);
    return cols
      .map<CollectionWithCount>((c) => ({ ...c, count: counts.get(c.id) ?? 0 }))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, []);
}

export function useLocalCollection(id: string | undefined): LocalCollection | null | undefined {
  return useLiveQuery(async () => {
    if (!id) return null;
    return (await db.collections.get(id)) ?? null;
  }, [id]);
}

export function useCollectionNoteIds(collectionId: string | undefined): string[] | undefined {
  return useLiveQuery(async () => {
    if (!collectionId) return [];
    const rows = await db.collectionEntries
      .where("collection_id")
      .equals(collectionId)
      .toArray();
    return rows
      .sort((a, b) => (b.added_at ?? "").localeCompare(a.added_at ?? ""))
      .map((r) => r.note_id);
  }, [collectionId]);
}

// For "Add to collection" sheet: shows which collections a given note is
// already in, so the sheet can show a checkmark.
export function useCollectionsForNote(noteId: string | undefined): Set<string> | undefined {
  return useLiveQuery(async () => {
    if (!noteId) return new Set<string>();
    const rows = await db.collectionEntries.where("note_id").equals(noteId).toArray();
    return new Set(rows.map((r) => r.collection_id));
  }, [noteId]);
}

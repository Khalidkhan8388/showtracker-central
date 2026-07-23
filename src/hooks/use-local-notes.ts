import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalNote } from "@/lib/local-db";
import { startSync } from "@/lib/sync-engine";

/**
 * Subscribe to all *active* local notes (not in Trash), newest first.
 */
export function useLocalNotes(): LocalNote[] | undefined {
  useEffect(() => {
    void startSync();
  }, []);
  return useLiveQuery(async () => {
    const rows = await db.notes.orderBy("created_at").reverse().toArray();
    return rows.filter((r) => !r.deleted_at);
  }, []);
}

export function useLocalNote(id: string | undefined): LocalNote | undefined | null {
  useEffect(() => {
    void startSync();
  }, []);
  return useLiveQuery(async () => {
    if (!id) return null;
    return (await db.notes.get(id)) ?? null;
  }, [id]);
}

/** Subscribe to trashed (soft-deleted) notes, most recently trashed first. */
export function useLocalDeletedNotes(): LocalNote[] | undefined {
  useEffect(() => {
    void startSync();
  }, []);
  return useLiveQuery(async () => {
    const rows = await db.notes.toArray();
    return rows
      .filter((r) => !!r.deleted_at)
      .sort((a, b) => (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""));
  }, []);
}

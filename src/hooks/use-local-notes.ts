import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalNote } from "@/lib/local-db";
import { startSync } from "@/lib/sync-engine";

/**
 * Subscribe to all local notes, newest first. Returns `undefined` on the
 * very first render before Dexie has responded (typically <10ms). After
 * that, updates from either optimistic local writes or realtime pushes
 * re-render automatically via Dexie's live-query broadcasts.
 */
export function useLocalNotes(): LocalNote[] | undefined {
  useEffect(() => {
    void startSync();
  }, []);
  return useLiveQuery(() => db.notes.orderBy("created_at").reverse().toArray(), []);
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

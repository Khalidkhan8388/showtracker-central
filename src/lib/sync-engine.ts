import { supabase } from "@/integrations/supabase/client";
import { db, normalizeRow, type LocalNote, type LocalTask } from "./local-db";
import { deleteNotes as deleteNotesFn } from "./notes.functions";

const PENDING_DELETE_KEY = (uid: string) => `pending_delete:${uid}`;

async function readPendingDeletes(uid: string): Promise<Set<string>> {
  const row = await db.meta.get(PENDING_DELETE_KEY(uid));
  if (!row?.value) return new Set();
  try {
    return new Set(JSON.parse(row.value) as string[]);
  } catch {
    return new Set();
  }
}

async function writePendingDeletes(uid: string, ids: Set<string>): Promise<void> {
  await db.meta.put({ key: PENDING_DELETE_KEY(uid), value: JSON.stringify([...ids]) });
}

export async function markPendingDelete(ids: string[]): Promise<void> {
  if (!currentUserId || ids.length === 0) return;
  const set = await readPendingDeletes(currentUserId);
  for (const id of ids) set.add(id);
  await writePendingDeletes(currentUserId, set);
}

export async function clearPendingDelete(ids: string[]): Promise<void> {
  if (!currentUserId || ids.length === 0) return;
  const set = await readPendingDeletes(currentUserId);
  for (const id of ids) set.delete(id);
  await writePendingDeletes(currentUserId, set);
}

/**
 * Retry any soft-deletes that never confirmed with the cloud. Runs on every
 * sync boot so a delete performed offline (or one whose server call failed)
 * eventually reaches Supabase — otherwise the next pullSince would resurrect
 * the row with `deleted_at = null` and it would reappear on refresh.
 */
export async function flushPendingDeletes(): Promise<void> {
  if (!currentUserId) return;
  const pending = await readPendingDeletes(currentUserId);
  if (pending.size === 0) return;
  const ids = [...pending];
  try {
    await deleteNotesFn({ data: { noteIds: ids } });
    await clearPendingDelete(ids);
  } catch {
    // keep pending; will retry on next boot
  }
}

// Module-level singletons — sync runs once per browser tab regardless of
// how many components mount the hook.
let started = false;
let currentUserId: string | null = null;
let channel: ReturnType<typeof supabase.channel> | null = null;
let pulling: Promise<void> | null = null;

// Tombstones: ids the user just deleted locally. Any realtime or pull
// write for these ids is ignored for TOMBSTONE_TTL_MS so a late-arriving
// UPDATE (e.g. a background "processing → ready" event) or a racing
// pullSince can't resurrect a deleted note.
const tombstones = new Map<string, number>();
const TOMBSTONE_TTL_MS = 60_000;
function isTombstoned(id: string): boolean {
  const ts = tombstones.get(id);
  if (!ts) return false;
  if (Date.now() - ts > TOMBSTONE_TTL_MS) {
    tombstones.delete(id);
    return false;
  }
  return true;
}

const LAST_SYNC = (uid: string) => `last_sync:${uid}`;

/**
 * Boot the sync engine. Idempotent — safe to call from every hook mount.
 * Hydrates Dexie with the current user's rows, then attaches a realtime
 * channel that streams future changes into Dexie.
 */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;

  const { data } = await supabase.auth.getUser();
  await switchUser(data.user?.id ?? null);

  supabase.auth.onAuthStateChange((evt, session) => {
    if (evt !== "SIGNED_IN" && evt !== "SIGNED_OUT" && evt !== "USER_UPDATED") return;
    const nextUid = session?.user?.id ?? null;
    if (nextUid !== currentUserId) void switchUser(nextUid);
  });
}

async function switchUser(uid: string | null) {
  currentUserId = uid;
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  if (!uid) {
    // Signed out — clear the local mirror so the next user doesn't see stale rows.
    await db.notes.clear();
    await db.meta.clear();
    return;
  }
  await pullSince(uid);
  await flushPendingDeletes();
  attachRealtime(uid);
}

async function pullSince(uid: string): Promise<void> {
  if (pulling) return pulling;
  pulling = (async () => {
    try {
      const meta = await db.meta.get(LAST_SYNC(uid));
      const since = meta?.value ?? null;
      let q = supabase
        .from("voice_notes")
        .select("*")
        .eq("user_id", uid)
        .order("updated_at", { ascending: true });
      if (since) q = q.gt("updated_at", since);
      const { data, error } = await q;
      if (error || !data) return;
      if (data.length > 0) {
        const pending = await readPendingDeletes(uid);
        const rows = data
          .map((r) => normalizeRow(r as Record<string, unknown>))
          .filter((r) => !isTombstoned(r.id))
          // If the user deleted the note locally but the server hasn't
          // confirmed yet, keep it soft-deleted so it doesn't resurface.
          .map((r) => (pending.has(r.id) ? { ...r, deleted_at: r.deleted_at ?? new Date().toISOString() } : r));
        if (rows.length > 0) await db.notes.bulkPut(rows);
        const newest = rows.reduce((a, r) => (r.updated_at > a ? r.updated_at : a), since ?? "");
        if (newest) await db.meta.put({ key: LAST_SYNC(uid), value: newest });
      }
    } finally {
      pulling = null;
    }
  })();
  return pulling;
}

function attachRealtime(uid: string) {
  channel = supabase
    .channel(`sync_${uid}_${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "voice_notes", filter: `user_id=eq.${uid}` },
      async (payload) => {
        if (payload.eventType === "DELETE") {
          const oldRow = payload.old as { id?: string };
          if (oldRow?.id) {
            tombstones.set(oldRow.id, Date.now());
            await db.notes.delete(oldRow.id);
          }
          return;
        }
        const row = normalizeRow(payload.new as Record<string, unknown>);
        if (isTombstoned(row.id)) return;
        await db.notes.put(row);
        const cur = await db.meta.get(LAST_SYNC(uid));
        if (!cur || row.updated_at > cur.value) {
          await db.meta.put({ key: LAST_SYNC(uid), value: row.updated_at });
        }
      },
    )
    .subscribe();
}

/** Force a re-pull from Supabase — used to roll back after a failed mutation. */
export async function resync(): Promise<void> {
  if (currentUserId) await pullSince(currentUserId);
}

/* ------------------------------ optimistic writes ------------------------------ */
/*  UI mutations write to Dexie first (instant), then the caller fires the        */
/*  server function. If it fails, the caller calls resync() to roll back.         */
/* ------------------------------------------------------------------------------ */

export async function patchLocalNote(id: string, patch: Partial<LocalNote>): Promise<void> {
  const now = new Date().toISOString();
  await db.notes.update(id, { ...patch, updated_at: now });
}

export async function deleteLocalNotes(ids: string[]): Promise<void> {
  // Soft-delete locally so the note stays visible in Trash for 30 days.
  const now = new Date().toISOString();
  for (const id of ids) {
    await db.notes.update(id, { deleted_at: now, updated_at: now });
  }
}

export async function restoreLocalNotes(ids: string[]): Promise<void> {
  const now = new Date().toISOString();
  for (const id of ids) {
    await db.notes.update(id, { deleted_at: null, updated_at: now });
  }
}

export async function hardDeleteLocalNotes(ids: string[]): Promise<void> {
  const now = Date.now();
  for (const id of ids) tombstones.set(id, now);
  await db.notes.bulkDelete(ids);
}

export async function patchLocalTask(
  noteId: string,
  taskId: string,
  patch: Partial<LocalTask>,
): Promise<void> {
  const note = await db.notes.get(noteId);
  if (!note) return;
  const tasks = (note.tasks ?? []).map((t) => (t.id === taskId ? { ...t, ...patch } : t));
  await patchLocalNote(noteId, { tasks });
}

export async function deleteLocalTasks(items: Array<{ noteId: string; taskId: string }>): Promise<void> {
  const byNote = new Map<string, Set<string>>();
  for (const { noteId, taskId } of items) {
    if (!byNote.has(noteId)) byNote.set(noteId, new Set());
    byNote.get(noteId)!.add(taskId);
  }
  for (const [noteId, taskIds] of byNote) {
    const note = await db.notes.get(noteId);
    if (!note) continue;
    const tasks = (note.tasks ?? []).filter((t) => !taskIds.has(t.id));
    await patchLocalNote(noteId, { tasks });
  }
}

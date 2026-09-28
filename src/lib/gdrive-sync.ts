// Automatic Google Drive backup.
//
// Watches the local vault for changes and, a few seconds after things settle,
// quietly pushes a full backup to the user's private Google Drive folder.

import { db } from "./local-db";
import { autoSyncEnabled, backupNow, isConnected } from "./google-drive";

export type SyncState = "idle" | "syncing" | "error" | "offline";

let state: SyncState = "idle";
let lastError: string | null = null;
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let fingerprint = "";
let running = false;

const DEBOUNCE_MS = 5000;
const POLL_MS = 4000;

export function getSyncState() {
  return { state, lastError };
}

function setState(next: SyncState, err: string | null = null) {
  state = next;
  lastError = err;
  window.dispatchEvent(new Event("braintape:gdrive-changed"));
}

async function computeFingerprint(): Promise<string> {
  const [notes, photos, audios, files, collections] = await Promise.all([
    db.notes.toArray(),
    db.photos.count(),
    db.audios.count(),
    db.files.count(),
    db.collections.toArray(),
  ]);
  let newest = "";
  for (const n of notes) if (n.updated_at > newest) newest = n.updated_at;
  for (const c of collections) if (c.updated_at > newest) newest = c.updated_at;
  return `${notes.length}:${photos}:${audios}:${files}:${collections.length}:${newest}`;
}

async function runBackup() {
  if (running) return;
  running = true;
  setState("syncing");
  try {
    await backupNow();
    setState("idle");
  } catch (e) {
    setState("error", e instanceof Error ? e.message : "Backup failed");
  } finally {
    running = false;
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void runBackup(), DEBOUNCE_MS);
}

async function tick() {
  if (!isConnected() || !autoSyncEnabled()) return;
  if (!navigator.onLine) {
    if (state !== "offline") setState("offline");
    return;
  }
  if (state === "offline") setState("idle");
  const fp = await computeFingerprint();
  if (fingerprint === "") {
    fingerprint = fp;
    return;
  }
  if (fp !== fingerprint) {
    fingerprint = fp;
    schedule();
  }
}

/** Start watching for changes. Safe to call more than once. */
export function startDriveAutoSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  void tick();
  poll = setInterval(() => void tick(), POLL_MS);
  window.addEventListener("braintape:gdrive-changed", () => {
    if (isConnected() && autoSyncEnabled() && fingerprint === "") void tick();
  });
}

export function stopDriveAutoSync() {
  if (poll) clearInterval(poll);
  if (timer) clearTimeout(timer);
  poll = null;
  timer = null;
  started = false;
}

/** Push a backup right now (used by the "Back up now" button). */
export async function backupNowManual() {
  await runBackup();
  if (lastError) throw new Error(lastError);
}

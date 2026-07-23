// Client-side Google Drive sync orchestration.
// - Exports local Dexie as JSON, uploads via server fn.
// - Downloads via server fn, imports (replace) locally.
// - Newest-wins based on lastLocalExport vs remote modifiedTime.
import { connectAppUser } from "@/integrations/lovable/appUserConnectorClient";
import { ensureAuth } from "./auth";
import { exportAll, importFromFile } from "./backup";
import {
  startDriveConnect,
  saveDriveConnection,
  getDriveStatus,
  disconnectDrive,
  uploadDriveBackup,
  downloadDriveBackup,
} from "./drive-sync.functions";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const LS_LAST_LOCAL = "braintape.lastLocalExportAt";
const LS_LAST_SYNC = "braintape.lastDriveSyncAt";
export const LS_INTERVAL = "braintape.driveSyncInterval";

export type IntervalKey = "off" | "10m" | "1d" | "5d" | "10d";
export const INTERVAL_MS: Record<IntervalKey, number> = {
  off: 0,
  "10m": 10 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "5d": 5 * 24 * 60 * 60 * 1000,
  "10d": 10 * 24 * 60 * 60 * 1000,
};
export const INTERVAL_LABEL: Record<IntervalKey, string> = {
  off: "Off",
  "10m": "Every 10 minutes",
  "1d": "Every day",
  "5d": "Every 5 days",
  "10d": "Every 10 days",
};

export function getInterval(): IntervalKey {
  if (typeof window === "undefined") return "off";
  const v = localStorage.getItem(LS_INTERVAL) as IntervalKey | null;
  return v && v in INTERVAL_MS ? v : "off";
}
export function setInterval_(v: IntervalKey) {
  localStorage.setItem(LS_INTERVAL, v);
}
export function getLastSyncAt(): number {
  const v = Number(localStorage.getItem(LS_LAST_SYNC) ?? 0);
  return Number.isFinite(v) ? v : 0;
}
function setLastSyncAt(ts: number) {
  localStorage.setItem(LS_LAST_SYNC, String(ts));
}
function getLastLocalAt(): number {
  const v = Number(localStorage.getItem(LS_LAST_LOCAL) ?? 0);
  return Number.isFinite(v) ? v : 0;
}
function bumpLastLocal() {
  localStorage.setItem(LS_LAST_LOCAL, String(Date.now()));
}

export type SyncDirection = "upload" | "download" | "up-to-date";

export type SyncResult = {
  direction: SyncDirection;
  at: number;
  remoteModifiedTime?: string | null;
  bytes?: number;
};

export async function connectDrive(): Promise<{ ok: boolean; error?: string }> {
  await ensureAuth();
  const res = await connectAppUser({
    connectorId: "google_drive",
    gatewayBaseUrl: GATEWAY_BASE_URL,
    start: (targetOrigin) => startDriveConnect({ data: targetOrigin }),
  });
  if (!res.success) return { ok: false, error: res.error };
  if (!res.connectionAPIKey) return { ok: false, error: "No connection key issued." };
  await saveDriveConnection({ data: { connectionAPIKey: res.connectionAPIKey } });
  return { ok: true };
}

export async function fetchStatus() {
  await ensureAuth();
  return getDriveStatus();
}

export async function disconnect() {
  await disconnectDrive();
  localStorage.removeItem(LS_LAST_SYNC);
}

// Mark "local changed" — call after any note/photo/audio mutation
// so newest-wins knows the device is ahead of Drive.
export function markLocalChanged() {
  bumpLastLocal();
}

async function localAsJson(): Promise<string> {
  const blob = await exportAll();
  return await blob.text();
}

export async function syncNow(opts?: { force?: "upload" | "download" }): Promise<SyncResult> {
  await ensureAuth();
  const status = await getDriveStatus();
  if (!status.connected) throw new Error("Google Drive is not connected.");

  const remoteMs = status.remote?.modifiedTime ? Date.parse(status.remote.modifiedTime) : 0;
  const localMs = getLastLocalAt() || getLastSyncAt();

  let direction: SyncDirection;
  if (opts?.force === "upload") direction = "upload";
  else if (opts?.force === "download") direction = "download";
  else if (!status.remote) direction = "upload";
  else if (localMs > remoteMs + 1000) direction = "upload";
  else if (remoteMs > localMs + 1000) direction = "download";
  else direction = "up-to-date";

  if (direction === "up-to-date") {
    const now = Date.now();
    setLastSyncAt(now);
    return { direction, at: now, remoteModifiedTime: status.remote?.modifiedTime ?? null };
  }

  if (direction === "upload") {
    const json = await localAsJson();
    const up = await uploadDriveBackup({ data: { json } });
    const now = Date.now();
    setLastSyncAt(now);
    localStorage.setItem(LS_LAST_LOCAL, String(Date.parse(up.modifiedTime) || now));
    return { direction, at: now, remoteModifiedTime: up.modifiedTime, bytes: up.size };
  }

  // download
  const dl = await downloadDriveBackup();
  if (!dl.found) throw new Error("Backup not found on Drive.");
  const file = new File([dl.json], "braintape-backup.json", { type: "application/json" });
  await importFromFile(file, "replace");
  const now = Date.now();
  setLastSyncAt(now);
  localStorage.setItem(LS_LAST_LOCAL, String(Date.parse(dl.modifiedTime ?? "") || now));
  return { direction, at: now, remoteModifiedTime: dl.modifiedTime, bytes: dl.json.length };
}

// Auto-sync scheduler — runs only while the app is open.
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let autoRunning = false;

export function startAutoSync() {
  if (typeof window === "undefined") return;
  stopAutoSync();
  const tick = async () => {
    const iv = getInterval();
    if (iv === "off") return;
    const due = getLastSyncAt() + INTERVAL_MS[iv];
    const now = Date.now();
    if (now >= due && !autoRunning) {
      autoRunning = true;
      try {
        const status = await getDriveStatus();
        if (status.connected) await syncNow();
      } catch (e) {
        console.warn("[drive] auto-sync failed:", e);
      } finally {
        autoRunning = false;
      }
    }
    autoTimer = setTimeout(tick, 60 * 1000);
  };
  autoTimer = setTimeout(tick, 5000);
}
export function stopAutoSync() {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
}

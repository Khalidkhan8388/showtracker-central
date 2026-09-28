// Google Drive backup — browser side.
//
// Uses Google Identity Services (GIS) to get an access token for the
// `drive.appdata` scope. That scope gives Braintape a private, hidden folder
// inside the user's own Google Drive: nothing shows up among their files and
// no other app can read it.

const GIS_SRC = "https://accounts.google.com/gsi/client";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const BACKUP_NAME = "braintape-vault.json";

const TOKEN_KEY = "gdrive-token";
const EMAIL_KEY = "gdrive-email";
const CONNECTED_KEY = "gdrive-connected";
const LAST_BACKUP_KEY = "gdrive-last-backup";
const AUTO_KEY = "gdrive-auto";

type StoredToken = { token: string; expiresAt: number };

let clientIdPromise: Promise<string> | null = null;
let gisPromise: Promise<void> | null = null;

/* ------------------------------------------------------------------ */
/* small local helpers                                                 */
/* ------------------------------------------------------------------ */

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed?.token || typeof parsed.expiresAt !== "number") return null;
    // refresh a minute early
    if (Date.now() > parsed.expiresAt - 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeToken(token: string, expiresInSeconds: number) {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({ token, expiresAt: Date.now() + expiresInSeconds * 1000 } satisfies StoredToken),
  );
}

export function isConnected(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(CONNECTED_KEY) === "1";
}

export function connectedEmail(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(EMAIL_KEY);
}

export function autoSyncEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(AUTO_KEY) !== "0";
}

export function setAutoSync(on: boolean) {
  localStorage.setItem(AUTO_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event("braintape:gdrive-changed"));
}

export function lastBackupAt(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LAST_BACKUP_KEY);
}

function markBackedUp() {
  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  window.dispatchEvent(new Event("braintape:gdrive-changed"));
}

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

async function getClientId(): Promise<string> {
  if (!clientIdPromise) {
    clientIdPromise = import("./google-config.functions")
      .then((m) => m.getGoogleClientId())
      .then((r) => r.clientId);
  }
  const id = await clientIdPromise;
  if (!id) throw new Error("Google isn't set up for this app yet.");
  return id;
}

function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<void>((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't reach Google. Check your connection."));
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Ask Google for an access token. `interactive` shows the account chooser. */
async function requestToken(interactive: boolean): Promise<string> {
  const cached = readToken();
  if (cached) return cached.token;

  const clientId = await getClientId();
  await loadGis();

  return new Promise<string>((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt: interactive ? "consent" : "",
      callback: (resp: any) => {
        if (resp?.error || !resp?.access_token) {
          reject(new Error(resp?.error_description || "Google sign-in was cancelled."));
          return;
        }
        writeToken(resp.access_token, Number(resp.expires_in ?? 3600));
        localStorage.setItem(CONNECTED_KEY, "1");
        resolve(resp.access_token);
      },
      error_callback: (err: any) => {
        reject(new Error(err?.message || "Google sign-in was cancelled."));
      },
    });
    client.requestAccessToken();
  });
}

async function fetchEmail(token: string): Promise<string | null> {
  try {
    const r = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { user?: { emailAddress?: string } };
    return j.user?.emailAddress ?? null;
  } catch {
    return null;
  }
}

export async function connectGoogle(): Promise<string | null> {
  const token = await requestToken(true);
  const email = await fetchEmail(token);
  if (email) localStorage.setItem(EMAIL_KEY, email);
  localStorage.setItem(CONNECTED_KEY, "1");
  window.dispatchEvent(new Event("braintape:gdrive-changed"));
  return email;
}

export function disconnectGoogle() {
  const cached = readToken();
  if (cached) {
    try {
      (window as any).google?.accounts?.oauth2?.revoke?.(cached.token, () => {});
    } catch {}
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem(CONNECTED_KEY);
  localStorage.removeItem(LAST_BACKUP_KEY);
  window.dispatchEvent(new Event("braintape:gdrive-changed"));
}

/* ------------------------------------------------------------------ */
/* drive calls                                                         */
/* ------------------------------------------------------------------ */

async function findBackupFileId(token: string): Promise<string | null> {
  const url =
    "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder" +
    `&q=${encodeURIComponent(`name='${BACKUP_NAME}'`)}` +
    "&fields=files(id,modifiedTime,size)&pageSize=1";
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Google Drive error (${r.status})`);
  const j = (await r.json()) as { files?: Array<{ id: string }> };
  return j.files?.[0]?.id ?? null;
}

export type DriveBackupInfo = { id: string; modifiedTime: string; size: number } | null;

export async function getRemoteBackupInfo(): Promise<DriveBackupInfo> {
  const token = await requestToken(false);
  const url =
    "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder" +
    `&q=${encodeURIComponent(`name='${BACKUP_NAME}'`)}` +
    "&fields=files(id,modifiedTime,size)&pageSize=1";
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Google Drive error (${r.status})`);
  const j = (await r.json()) as { files?: Array<{ id: string; modifiedTime: string; size?: string }> };
  const f = j.files?.[0];
  return f ? { id: f.id, modifiedTime: f.modifiedTime, size: Number(f.size ?? 0) } : null;
}

/** Upload the whole vault (notes, photos, voice notes, PDFs, collections). */
export async function backupNow(): Promise<void> {
  const token = await requestToken(false);
  const { exportAll } = await import("./backup");
  const blob = await exportAll();

  const existingId = await findBackupFileId(token);
  if (existingId) {
    const r = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: blob,
      },
    );
    if (!r.ok) throw new Error(`Backup failed (${r.status})`);
  } else {
    const boundary = "braintape" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: BACKUP_NAME, parents: ["appDataFolder"] });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!r.ok) throw new Error(`Backup failed (${r.status})`);
  }
  markBackedUp();
}

/** Pull the vault back down and merge it into this device. */
export async function restoreFromDrive(
  mode: "merge" | "replace" = "merge",
): Promise<{ notes: number; photos: number; audios: number }> {
  const token = await requestToken(false);
  const id = await findBackupFileId(token);
  if (!id) throw new Error("No backup found in your Google Drive yet.");
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Restore failed (${r.status})`);
  const blob = await r.blob();
  const file = new File([blob], BACKUP_NAME, { type: "application/json" });
  const { importFromFile } = await import("./backup");
  const summary = await importFromFile(file, mode);
  return { notes: summary.notes, photos: summary.photos, audios: summary.audios };
}

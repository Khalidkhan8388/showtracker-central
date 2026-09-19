// Client-side reader for the Web Share Target inbox the service worker fills.
// Keep raw-IndexedDB access here so it can't drift from sw.js, and provide
// a single `drainAndSaveShares()` helper that both the /share route and the
// background SW-message listener call — so a share never opens the app UI
// unnecessarily.

import { createMediaNote, saveTextNote, saveWebLink } from "./notes.functions";

const DB_NAME = "braintape-share";
const DB_VERSION = 3;
const STORE = "inbox";
const SETTINGS = "settings";
const RECENT_PREFIX = "processed-share:";
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export type SharedFile = { name: string; type: string; buf: ArrayBuffer };
export type SharedItem = {
  id: number;
  ts: number;
  url: string;
  text: string;
  title: string;
  files: SharedFile[];
  fingerprint?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function normalizePart(value?: string) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function fallbackFingerprint(item: SharedItem) {
  const filePart = (item.files ?? []).map((f) => `${f.name}:${f.type}:${f.buf.byteLength}`).join("|");
  return [normalizePart(item.url), normalizePart(item.text), normalizePart(item.title), filePart].join("\n");
}

export async function drainSharedItems(): Promise<SharedItem[]> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return [];
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as SharedItem[]) ?? [];
      store.clear();
      tx.oncomplete = () => resolve(items);
      tx.onerror = () => resolve(items);
    };
    req.onerror = () => resolve([]);
  });
}

const URL_RE = /https?:\/\/[^\s]+/i;

export async function processSharedItem(item: {
  url?: string;
  text?: string;
  title?: string;
  files?: SharedItem["files"];
}): Promise<number> {
  const files = item.files ?? [];
  const images: Blob[] = [];
  let audio: { blob: Blob; mime: string } | null = null;
  for (const f of files) {
    const blob = new Blob([f.buf], { type: f.type || "application/octet-stream" });
    if (f.type.startsWith("image/")) images.push(blob);
    else if (f.type.startsWith("audio/") || f.type.startsWith("video/")) {
      if (!audio) audio = { blob, mime: f.type };
    }
  }

  const raw = `${item.url ?? ""} ${item.text ?? ""}`.trim();
  const match = raw.match(URL_RE);
  if (match) {
    const normalized = /^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`;
    await saveWebLink({ data: { url: normalized } });
    return 1;
  }

  if (images.length > 0 || audio) {
    await createMediaNote({
      audioBlob: audio?.blob ?? null,
      audioMime: audio?.mime ?? null,
      durationSeconds: null,
      imageBlobs: images,
    });
    return 1;
  }

  if ((item.text ?? "").trim()) {
    const heading = (item.title ?? "").trim() || (item.text ?? "").trim().slice(0, 80);
    await saveTextNote({ data: { heading, body: (item.text ?? "").trim() } });
    return 1;
  }

  return 0;
}

// Drain everything in the SW inbox and save it silently. Safe to call from
// multiple places (SW postMessage listener + /share route) — a small in-memory
// lock keeps concurrent drains from double-saving the same item.
let inflight: Promise<number> | null = null;

export function drainAndSaveShares(): Promise<number> {
  if (inflight) return inflight;
  const run = async (): Promise<number> => {
    const items = await drainSharedItems();
    let total = 0;
    const seenThisDrain = new Set<string>();
    let shareDb: IDBDatabase | null = null;
    try {
      shareDb = await openDb();
    } catch {
      shareDb = null;
    }
    for (const it of items) {
      const fingerprint = it.fingerprint || fallbackFingerprint(it);
      if (seenThisDrain.has(fingerprint)) continue;
      seenThisDrain.add(fingerprint);

      let alreadyProcessed = false;
      if (shareDb?.objectStoreNames.contains(SETTINGS)) {
        alreadyProcessed = await new Promise<boolean>((resolve) => {
          const tx = shareDb.transaction(SETTINGS, "readwrite");
          const settings = tx.objectStore(SETTINGS);
          const key = `${RECENT_PREFIX}${fingerprint}`;
          const req = settings.get(key);
          req.onsuccess = () => {
            const last = Number(req.result || 0);
            if (last && Date.now() - last < DEDUPE_WINDOW_MS) {
              resolve(true);
              return;
            }
            settings.put(Date.now(), key);
            resolve(false);
          };
          req.onerror = () => resolve(false);
        });
      }
      if (alreadyProcessed) continue;

      try {
        total += await processSharedItem(it);
      } catch {
        // keep processing remaining items
      }
    }
    return total;
  };
  inflight = (async () => {
    try {
      // Cross-context lock so two tabs / a background boot iframe / the
      // /share route can't race and double-save the same inbox items.
      const locks = (navigator as unknown as { locks?: { request: (name: string, opts: unknown, cb: () => Promise<number>) => Promise<number> } }).locks;
      if (locks?.request) {
        return await locks.request("braintape-share-drain", { mode: "exclusive" }, run);
      }
      return await run();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

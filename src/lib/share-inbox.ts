// Client-side reader for the Web Share Target inbox the service worker fills.
// Keep raw-IndexedDB access here so it can't drift from sw.js, and provide
// a single `drainAndSaveShares()` helper that both the /share route and the
// background SW-message listener call — so a share never opens the app UI
// unnecessarily.

import { createMediaNote, saveTextNote, saveWebLink } from "./notes.functions";

const DB_NAME = "braintape-share";
const STORE = "inbox";

export type SharedFile = { name: string; type: string; buf: ArrayBuffer };
export type SharedItem = {
  id: number;
  ts: number;
  url: string;
  text: string;
  title: string;
  files: SharedFile[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
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
  let saved = 0;

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
  if (images.length > 0 || audio) {
    await createMediaNote({
      audioBlob: audio?.blob ?? null,
      audioMime: audio?.mime ?? null,
      durationSeconds: null,
      imageBlobs: images,
    });
    saved++;
  }

  const raw = `${item.url ?? ""} ${item.text ?? ""}`.trim();
  const match = raw.match(URL_RE);
  if (match) {
    const normalized = /^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`;
    await saveWebLink({ data: { url: normalized } });
    saved++;
  } else if ((item.text ?? "").trim() && !audio && images.length === 0) {
    const heading = (item.title ?? "").trim() || (item.text ?? "").trim().slice(0, 80);
    await saveTextNote({ data: { heading, body: (item.text ?? "").trim() } });
    saved++;
  }

  return saved;
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
    for (const it of items) {
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

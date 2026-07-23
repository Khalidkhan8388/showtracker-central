import { db } from "./local-db";

// Local-only photo cache. All photos live as Blobs in IndexedDB, keyed by
// a synthetic `local://images/<uuid>` path. Object URLs are memoized so
// <img src> stays stable across renders (no flicker).

const urlCache = new Map<string, string>(); // path -> objectURL
const inflight = new Map<string, Promise<string>>();

// Cap at ~500 MB; evict oldest first.
const MAX_BYTES = 500 * 1024 * 1024;

export function getCachedPhotoUrl(path: string): string | undefined {
  return urlCache.get(path);
}

async function hydrate(path: string): Promise<string> {
  const row = await db.photos.get(path);
  if (!row) return "";
  const url = URL.createObjectURL(row.blob);
  urlCache.set(path, url);
  db.photos.update(path, { cachedAt: Date.now() }).catch(() => {});
  return url;
}

export async function getPhotoUrl(path: string): Promise<string> {
  if (!path) return "";
  const mem = urlCache.get(path);
  if (mem) return mem;
  const existing = inflight.get(path);
  if (existing) return existing;
  const p = hydrate(path);
  inflight.set(path, p);
  try {
    return await p;
  } finally {
    inflight.delete(path);
  }
}

export async function warmPhotoCache(paths: string[]): Promise<void> {
  const missing = paths.filter((p) => p && !urlCache.has(p));
  if (missing.length === 0) return;
  try {
    const rows = await db.photos.bulkGet(missing);
    for (let i = 0; i < missing.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (urlCache.has(missing[i])) continue;
      urlCache.set(missing[i], URL.createObjectURL(row.blob));
    }
  } catch {
    /* ignore */
  }
}

/** Persist a new photo Blob and return its local path. */
export async function storeLocalPhoto(blob: Blob, contentType?: string): Promise<string> {
  const ct = contentType || blob.type || "image/jpeg";
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const path = `local://images/${crypto.randomUUID()}.${ext}`;
  await db.photos.put({
    path,
    blob,
    size: blob.size,
    contentType: ct,
    cachedAt: Date.now(),
  });
  // Pre-cache the object URL so the immediate re-render is instant.
  urlCache.set(path, URL.createObjectURL(blob));
  evictIfNeeded().catch(() => {});
  return path;
}

/** Read raw bytes for AI upload. */
export async function readPhotoBytes(path: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const row = await db.photos.get(path);
  if (!row) return null;
  return { bytes: new Uint8Array(await row.blob.arrayBuffer()), mime: row.contentType };
}

let evicting = false;
async function evictIfNeeded(): Promise<void> {
  if (evicting) return;
  evicting = true;
  try {
    const all = await db.photos.orderBy("cachedAt").toArray();
    let total = 0;
    for (const r of all) total += r.size;
    if (total <= MAX_BYTES) return;
    for (const r of all) {
      if (total <= MAX_BYTES) break;
      await db.photos.delete(r.path);
      total -= r.size;
      const url = urlCache.get(r.path);
      if (url) {
        URL.revokeObjectURL(url);
        urlCache.delete(r.path);
      }
    }
  } finally {
    evicting = false;
  }
}

export async function evictPhoto(path: string): Promise<void> {
  const url = urlCache.get(path);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(path);
  }
  try {
    await db.photos.delete(path);
  } catch {
    /* ignore */
  }
}

import { db } from "./local-db";
import { signPath } from "./signed-url-cache";

// Local-first photo cache.
//
// Photos live in IndexedDB as Blobs, keyed by their Supabase storage path.
// The renderer gets an object URL back synchronously when we've already
// downloaded a photo — so thumbnails paint instantly on repeat visits and
// work offline, while first-time loads fall back to a signed URL and get
// cached in the background.
//
// Memory-side object URL cache: URL.createObjectURL is cheap but we keep
// one per path so <img src> stays stable across renders (no flicker).
const urlCache = new Map<string, string>(); // path -> objectURL
const inflight = new Map<string, Promise<string>>();

// Cap the cache at ~200 MB — evicts oldest photos when exceeded.
const MAX_BYTES = 200 * 1024 * 1024;

export function getCachedPhotoUrl(path: string): string | undefined {
  return urlCache.get(path);
}

async function hydrateFromDexie(path: string): Promise<string | undefined> {
  try {
    const row = await db.photos.get(path);
    if (!row) return undefined;
    const url = URL.createObjectURL(row.blob);
    urlCache.set(path, url);
    // touch for LRU
    db.photos.update(path, { cachedAt: Date.now() }).catch(() => {});
    return url;
  } catch {
    return undefined;
  }
}

async function downloadAndCache(path: string): Promise<string> {
  const signed = await signPath(path);
  if (!signed) return "";
  try {
    const res = await fetch(signed);
    if (!res.ok) return signed; // fall back to signed URL
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    urlCache.set(path, objectUrl);
    // Persist in the background — don't block the caller.
    db.photos
      .put({
        path,
        blob,
        size: blob.size,
        contentType: blob.type || "image/jpeg",
        cachedAt: Date.now(),
      })
      .then(() => evictIfNeeded())
      .catch(() => {});
    return objectUrl;
  } catch {
    return signed;
  }
}

/**
 * Returns a URL for the image at `path`. Resolves instantly from the
 * in-memory cache when possible, otherwise from IndexedDB, otherwise
 * downloads once and caches for next time.
 */
export async function getPhotoUrl(path: string): Promise<string> {
  if (!path) return "";
  const mem = urlCache.get(path);
  if (mem) return mem;
  const existing = inflight.get(path);
  if (existing) return existing;
  const p = (async () => {
    const fromDb = await hydrateFromDexie(path);
    if (fromDb) return fromDb;
    return downloadAndCache(path);
  })();
  inflight.set(path, p);
  try {
    return await p;
  } finally {
    inflight.delete(path);
  }
}

/**
 * Prewarm the memory cache from IndexedDB for a batch of paths. Call this
 * once on app boot so home/search thumbnails are ready synchronously on
 * the first render after a reload.
 */
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

let evicting = false;
async function evictIfNeeded(): Promise<void> {
  if (evicting) return;
  evicting = true;
  try {
    const all = await db.photos.orderBy("cachedAt").toArray();
    let total = 0;
    for (const r of all) total += r.size;
    if (total <= MAX_BYTES) return;
    // Delete oldest until under budget.
    for (const r of all) {
      if (total <= MAX_BYTES) break;
      await db.photos.delete(r.path);
      total -= r.size;
      // Revoke in-memory URL so we don't hand out a stale one.
      const url = urlCache.get(r.path);
      if (url) {
        URL.revokeObjectURL(url);
        urlCache.delete(r.path);
      }
    }
  } catch {
    /* ignore */
  } finally {
    evicting = false;
  }
}

/** Remove a single photo from the cache (e.g. after delete). */
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

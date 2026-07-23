import { db } from "./local-db";

const urlCache = new Map<string, string>();

export function getCachedAudioUrl(path: string): string | undefined {
  return urlCache.get(path);
}

export async function getAudioUrl(path: string): Promise<string> {
  if (!path) return "";
  const mem = urlCache.get(path);
  if (mem) return mem;
  const row = await db.audios.get(path);
  if (!row) return "";
  const url = URL.createObjectURL(row.blob);
  urlCache.set(path, url);
  return url;
}

export async function storeLocalAudio(blob: Blob, mime?: string): Promise<string> {
  const ct = mime || blob.type || "audio/webm";
  const ext = ct.includes("mp4") ? "m4a" : ct.includes("ogg") ? "ogg" : ct.includes("mpeg") ? "mp3" : "webm";
  const path = `local://audio/${crypto.randomUUID()}.${ext}`;
  await db.audios.put({
    path,
    blob,
    size: blob.size,
    contentType: ct,
    cachedAt: Date.now(),
  });
  urlCache.set(path, URL.createObjectURL(blob));
  return path;
}

export async function readAudioBytes(path: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const row = await db.audios.get(path);
  if (!row) return null;
  return { bytes: new Uint8Array(await row.blob.arrayBuffer()), mime: row.contentType };
}

export async function evictAudio(path: string): Promise<void> {
  const url = urlCache.get(path);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(path);
  }
  try {
    await db.audios.delete(path);
  } catch {}
}

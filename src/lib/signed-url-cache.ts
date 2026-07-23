import { supabase } from "@/integrations/supabase/client";

// Module-level cache: survives route unmounts/remounts so thumbnails don't
// re-sign on every navigation. Each entry carries an expiry timestamp so we
// re-sign well before Supabase's TTL runs out.
type Entry = { url: string; expiresAt: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();

const TTL_SECONDS = 60 * 60; // 1 hour signed URL
const REFRESH_BEFORE_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export function getCachedSignedUrl(path: string): string | undefined {
  const hit = cache.get(path);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt - REFRESH_BEFORE_MS) return undefined;
  return hit.url;
}

export async function signPath(path: string): Promise<string> {
  const cached = getCachedSignedUrl(path);
  if (cached) return cached;
  const existing = inflight.get(path);
  if (existing) return existing;
  const p = (async () => {
    const { data } = await supabase.storage
      .from("voice-notes")
      .createSignedUrl(path, TTL_SECONDS);
    const url = data?.signedUrl ?? "";
    if (url) cache.set(path, { url, expiresAt: Date.now() + TTL_SECONDS * 1000 });
    return url;
  })();
  inflight.set(path, p);
  try {
    return await p;
  } finally {
    inflight.delete(path);
  }
}

export async function signPaths(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    paths.map(async (p) => {
      const url = await signPath(p);
      if (url) out[p] = url;
    }),
  );
  return out;
}

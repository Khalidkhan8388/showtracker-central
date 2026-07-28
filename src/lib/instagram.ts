// Instagram link helpers (pure, client-safe).

const IG_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
  "instagr.am",
  "www.instagr.am",
]);

export type InstagramKind = "post" | "reel" | "tv";

export function parseInstagram(url: string): { shortcode: string; kind: InstagramKind } | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (!IG_HOSTS.has(u.hostname.toLowerCase())) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  // /p/<code>, /reel/<code>, /reels/<code>, /tv/<code>
  // also /<username>/p/<code> and /<username>/reel/<code>
  const idx = parts.findIndex((p) => p === "p" || p === "reel" || p === "reels" || p === "tv");
  if (idx === -1) return null;
  const shortcode = parts[idx + 1];
  if (!shortcode || !/^[A-Za-z0-9_-]{5,32}$/.test(shortcode)) return null;
  const kind: InstagramKind = parts[idx] === "tv" ? "tv" : parts[idx] === "p" ? "post" : "reel";
  return { shortcode, kind };
}

export function instagramCanonicalUrl(shortcode: string, kind: InstagramKind): string {
  const seg = kind === "reel" ? "reel" : kind === "tv" ? "tv" : "p";
  return `https://www.instagram.com/${seg}/${shortcode}/`;
}

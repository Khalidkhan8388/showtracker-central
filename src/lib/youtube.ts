// Client-safe YouTube URL helpers. No network. No secrets.

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

export function parseYouTubeId(input: string): string | null {
  if (!input) return null;
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!YT_HOSTS.has(host)) return null;
  // youtu.be/<id>
  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return isValidId(id) ? id : null;
  }
  // youtube.com/watch?v=<id>
  const v = u.searchParams.get("v");
  if (v && isValidId(v)) return v;
  // youtube.com/shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
  const parts = u.pathname.split("/").filter(Boolean);
  const marker = parts[0];
  if (["shorts", "embed", "live", "v"].includes(marker) && isValidId(parts[1])) {
    return parts[1];
  }
  return null;
}

function isValidId(s: string | undefined): s is string {
  return !!s && /^[a-zA-Z0-9_-]{11}$/.test(s);
}

export function isYouTubeUrl(url: string): boolean {
  return parseYouTubeId(url) != null;
}

export function youtubeThumb(id: string, quality: "max" | "hq" | "mq" = "max"): string {
  const key = quality === "max" ? "maxresdefault" : quality === "hq" ? "hqdefault" : "mqdefault";
  return `https://i.ytimg.com/vi/${id}/${key}.jpg`;
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function formatYtDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

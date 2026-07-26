import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// -----------------------------------------------------------------------------
// YouTube metadata + caption extraction. Public YouTube endpoints only (oEmbed
// + watch-page HTML). No API key required.
// -----------------------------------------------------------------------------

const YOUTUBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function parseIdFromUrl(input: string): string | null {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return id && YT_ID_RE.test(id) ? id : null;
  }
  if (!/youtube\.com$/.test(host)) return null;
  const v = u.searchParams.get("v");
  if (v && YT_ID_RE.test(v)) return v;
  const parts = u.pathname.split("/").filter(Boolean);
  if (["shorts", "embed", "live", "v"].includes(parts[0]) && parts[1] && YT_ID_RE.test(parts[1])) {
    return parts[1];
  }
  return null;
}

async function fetchOembed(videoUrl: string) {
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(videoUrl)}`,
      { headers: { "User-Agent": YOUTUBE_UA, Accept: "application/json" } },
      8_000,
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      title?: string;
      author_name?: string;
      author_url?: string;
      thumbnail_url?: string;
    };
  } catch {
    return null;
  }
}

type WatchScrape = {
  title: string | null;
  description: string | null;
  channelName: string | null;
  channelUrl: string | null;
  channelId: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  keywords: string[];
  captionUrl: string | null;
};

async function scrapeWatchPage(videoId: string): Promise<WatchScrape> {
  const out: WatchScrape = {
    title: null,
    description: null,
    channelName: null,
    channelUrl: null,
    channelId: null,
    publishedAt: null,
    durationSeconds: null,
    viewCount: null,
    keywords: [],
    captionUrl: null,
  };
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/watch?v=${videoId}&hl=en`,
      {
        headers: {
          "User-Agent": YOUTUBE_UA,
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html,application/xhtml+xml",
        },
      },
      12_000,
    );
    if (!res.ok) return out;
    const html = (await res.text()).slice(0, 800_000);

    // Length (seconds) — appears inside ytInitialPlayerResponse.videoDetails
    const len = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
    if (len) out.durationSeconds = parseInt(len[1], 10);
    const views = html.match(/"viewCount"\s*:\s*"(\d+)"/);
    if (views) out.viewCount = parseInt(views[1], 10);
    const author = html.match(/"author"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (author) out.channelName = jsonUnescape(author[1]);
    const chId = html.match(/"channelId"\s*:\s*"([a-zA-Z0-9_-]+)"/);
    if (chId) {
      out.channelId = chId[1];
      out.channelUrl = `https://www.youtube.com/channel/${chId[1]}`;
    }
    const kws = html.match(/"keywords"\s*:\s*\[([^\]]+)\]/);
    if (kws) {
      out.keywords = Array.from(kws[1].matchAll(/"((?:[^"\\]|\\.)*)"/g))
        .map((m) => jsonUnescape(m[1]))
        .filter(Boolean)
        .slice(0, 8);
    }

    // Prefer og:title
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (ogTitle) out.title = decodeHtml(ogTitle[1]);
    // Prefer richer full description over og:description (which YouTube truncates to ~160 chars)
    const attr = html.match(/"attributedDescriptionBodyText"\s*:\s*\{\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (attr) out.description = jsonUnescape(attr[1]);
    if (!out.description) {
      const shortDesc = html.match(/"shortDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (shortDesc) out.description = jsonUnescape(shortDesc[1]);
    }
    if (!out.description) {
      const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
      if (ogDesc) out.description = decodeHtml(ogDesc[1]);
    }
    const pub = html.match(/<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i);
    if (pub) out.publishedAt = pub[1];

    // Caption track baseUrl (English preferred)
    const capBlock = html.match(/"captionTracks"\s*:\s*(\[[^\]]+\])/);
    if (capBlock) {
      const tracks = Array.from(
        capBlock[1].matchAll(/\{[^{}]*"baseUrl"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*"languageCode"\s*:\s*"([a-zA-Z-]+)"[^{}]*\}/g),
      ).map((m) => ({ url: jsonUnescape(m[1]), lang: m[2] }));
      const en = tracks.find((t) => /^en/i.test(t.lang)) ?? tracks[0];
      if (en) out.captionUrl = en.url;
    }
  } catch {
    // ignore, return what we have
  }
  return out;
}

function jsonUnescape(s: string): string {
  try {
    return JSON.parse(`"${s.replace(/"/g, '\\"').replace(/\\"/g, '\\"')}"`);
  } catch {
    return s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  }
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)));
}

async function fetchCaptions(captionUrl: string | null): Promise<string> {
  if (!captionUrl) return "";
  try {
    // Ask for JSON transcript format (more forgiving to parse than XML).
    const url = captionUrl.includes("fmt=") ? captionUrl : `${captionUrl}&fmt=json3`;
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": YOUTUBE_UA } }, 12_000);
    if (!res.ok) return "";
    const txt = await res.text();
    // json3 shape
    try {
      const j = JSON.parse(txt) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
      if (j?.events) {
        return j.events
          .map((e) => (e.segs ?? []).map((s) => s.utf8 ?? "").join(""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      }
    } catch {}
    // XML fallback
    return decodeHtml(
      txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );
  } catch {
    return "";
  }
}

const Input = z.object({ url: z.string().trim().min(1).max(2000) });

export const fetchYouTubeFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const videoId = parseIdFromUrl(data.url);
    if (!videoId) throw new Error("Not a valid YouTube URL");
    const canonical = `https://www.youtube.com/watch?v=${videoId}`;

    const [oembed, scrape] = await Promise.all([fetchOembed(canonical), scrapeWatchPage(videoId)]);
    const captions = await fetchCaptions(scrape.captionUrl);

    const title = scrape.title ?? oembed?.title ?? null;
    const channelName = scrape.channelName ?? oembed?.author_name ?? null;
    const channelUrl = scrape.channelUrl ?? oembed?.author_url ?? null;
    const thumbnailUrl =
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` ||
      oembed?.thumbnail_url ||
      null;

    return {
      videoId,
      canonicalUrl: canonical,
      title,
      channelName,
      channelUrl,
      channelId: scrape.channelId,
      thumbnailUrl,
      description: scrape.description,
      publishedAt: scrape.publishedAt,
      durationSeconds: scrape.durationSeconds,
      viewCount: scrape.viewCount,
      keywords: scrape.keywords,
      captions: captions.slice(0, 30_000),
    };
  });

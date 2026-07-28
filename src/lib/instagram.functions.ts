import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { instagramCanonicalUrl, parseInstagram, type InstagramKind } from "./instagram";

// Instagram serves full Open Graph metadata (image + full caption + author +
// like/comment counts) to crawler user agents, so we scrape that instead of
// hitting the login-walled HTML the browser gets.

const UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

function meta(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`,
    "i",
  );
  const m = html.match(re);
  if (m) return decodeEntities(m[1]);
  const re2 = new RegExp(
    `<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+(?:property|name)=["']${prop}["'][^>]*>`,
    "i",
  );
  const m2 = html.match(re2);
  return m2 ? decodeEntities(m2[1]) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseCount(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  const mult = m[2]?.toUpperCase() === "B" ? 1e9 : m[2]?.toUpperCase() === "M" ? 1e6 : m[2]?.toUpperCase() === "K" ? 1e3 : 1;
  return Math.round(n * mult);
}

/** Strips invisible separators Instagram injects into captions. */
function cleanCaption(s: string): string {
  return s
    .replace(/[\u2063\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const Input = z.object({ url: z.string().trim().max(2000) });

export const fetchInstagramFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const parsed = parseInstagram(data.url);
    if (!parsed) throw new Error("Not an Instagram URL");
    const canonical = instagramCanonicalUrl(parsed.shortcode, parsed.kind);

    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(canonical, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "text/html,*/*", "Accept-Language": "en-US,en;q=0.9" },
    }).finally(() => clearTimeout(to));
    if (!res.ok) throw new Error(`Instagram fetch failed (${res.status})`);
    const html = (await res.text()).slice(0, 1_500_000);

    const ogTitle = meta(html, "og:title");
    const ogDesc = meta(html, "og:description");
    const imageUrl = meta(html, "og:image");
    const videoUrl = meta(html, "og:video") ?? meta(html, "og:video:secure_url");
    const ogUrl = meta(html, "og:url");

    if (!imageUrl && !ogTitle && !ogDesc) throw new Error("No Instagram metadata found");

    // og:description => `1M likes, 3,709 comments - nasa on July 29, 2023: "caption"`
    let username: string | null = null;
    let displayName: string | null = null;
    let likeCount: number | null = null;
    let commentCount: number | null = null;
    let postedAt: string | null = null;
    let caption: string | null = null;

    if (ogDesc) {
      const m = ogDesc.match(
        /^([\d.,KMB]+)\s+likes?,\s*([\d.,KMB]+)\s+comments?\s*-\s*([^:]+?)\s+on\s+([^:]+?):\s*"([\s\S]*)"?\s*$/i,
      );
      if (m) {
        likeCount = parseCount(m[1]);
        commentCount = parseCount(m[2]);
        username = m[3].trim().replace(/^@/, "") || null;
        const d = new Date(m[4].trim());
        postedAt = isNaN(d.getTime()) ? null : d.toISOString();
        caption = m[5];
      } else {
        caption = ogDesc;
      }
    }

    // og:title => `NASA on Instagram: "caption"` — often the longer/complete caption.
    if (ogTitle) {
      const t = ogTitle.match(/^(.*?)\s+on Instagram:\s*"([\s\S]*?)"?\s*$/i);
      if (t) {
        displayName = t[1].trim() || null;
        if (!caption || t[2].length > caption.length) caption = t[2];
      } else if (!caption) {
        caption = ogTitle;
      }
    }

    // Username fallback from the canonicalised og:url (`/<user>/p/<code>/`).
    if (!username && ogUrl) {
      try {
        const p = new URL(ogUrl).pathname.split("/").filter(Boolean);
        if (p.length > 1 && !["p", "reel", "reels", "tv"].includes(p[0])) username = p[0];
      } catch {}
    }

    caption = caption ? cleanCaption(caption).slice(0, 5000) : null;

    return {
      shortcode: parsed.shortcode,
      kind: parsed.kind as InstagramKind,
      canonicalUrl: canonical,
      imageUrl: imageUrl ?? null,
      isVideo: !!videoUrl || parsed.kind !== "post",
      username,
      displayName,
      caption,
      likeCount,
      commentCount,
      postedAt,
    };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { instagramCanonicalUrl, isInstagramUrl, parseInstagram, type InstagramKind } from "./instagram";

// Instagram strategy (in order):
//  1. /embed/captioned/ — the public oEmbed-style page. No login wall, and it
//     carries the full caption, author handle, like count and full-res image.
//  2. Open Graph metadata served to crawler user agents (image + description).
// The regular HTML page is never used: it always hits the login / "update your
// browser" wall.

const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const UAS = [
  CRAWLER_UA,
  "Twitterbot/1.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];

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
    .replace(/&#0*(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
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
  const mult =
    m[2]?.toUpperCase() === "B" ? 1e9 : m[2]?.toUpperCase() === "M" ? 1e6 : m[2]?.toUpperCase() === "K" ? 1e3 : 1;
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

/** Turns the embed page's caption HTML into plain text. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

const Input = z.object({ url: z.string().trim().max(2000) });

async function fetchHtml(url: string, ua: string): Promise<{ html: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": ua, Accept: "text/html,*/*", "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 2_000_000);
    return { html, finalUrl: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

/** Instagram blocks datacenter IPs often — retry the same URL through the
 *  public reader proxy, asking it for raw HTML so the embed parser still works. */
async function fetchHtmlViaReader(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: controller.signal,
      headers: {
        "x-return-format": "html",
        "User-Agent": CRAWLER_UA,
        Accept: "text/html,*/*",
      },
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 2_000_000);
    return { html, finalUrl: url };
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

/** Direct first, reader proxy second. */
async function fetchAny(url: string): Promise<{ html: string; finalUrl: string } | null> {
  for (const ua of UAS) {
    const r = await fetchHtml(url, ua);
    if (r && r.html.length > 500 && !/login|challenge/i.test(new URL(r.finalUrl).pathname)) return r;
  }
  return await fetchHtmlViaReader(url);
}

/** True for a real post image, not an avatar / sprite / spacer. */
function looksLikeMedia(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/s150x150|s320x320|profile_pic|\/static\//i.test(url)) return false;
  return /cdninstagram|fbcdn/i.test(url);
}

/** Instagram wraps captions in `"..."` inside og tags; strip the wrapper. */
function unquoteCaption(s: string): string {
  return s
    .trim()
    .replace(/^["“]/, "")
    .replace(/["”]\s*[.。]?\s*$/, "")
    .trim();
}

type EmbedData = {
  imageUrl: string | null;
  username: string | null;
  caption: string | null;
  likeCount: number | null;
  isVideo: boolean;
};

function parseEmbed(html: string): EmbedData | null {
  // The embed frame markup is stable: class="EmbeddedMediaImage" / "Caption" /
  // "SocialProof". If none are present we got the generic bundle instead.
  const img = html.match(/class="EmbeddedMediaImage"[^>]*\ssrc="([^"]+)"/i);
  const imgAlt = img ? null : html.match(/\ssrc="(https:\/\/[^"]*cdninstagram[^"]*\.(?:jpg|webp)[^"]*)"/i);
  const imageUrl = decodeEntities(img?.[1] ?? imgAlt?.[1] ?? "") || null;

  const capBlock = html.match(/<div class="Caption">([\s\S]*?)<\/div>/i)?.[1] ?? null;
  let username =
    html.match(/class="CaptionUsername"[^>]*>([^<]+)</i)?.[1] ??
    html.match(/class="UsernameText"[^>]*>([^<]+)</i)?.[1] ??
    null;
  username = username ? decodeEntities(username).trim().replace(/^@/, "") || null : null;

  let caption: string | null = null;
  if (capBlock) {
    let inner = capBlock;
    // Drop the leading username anchor Instagram prepends to the caption.
    inner = inner.replace(/^[\s\S]*?class="CaptionUsername"[^>]*>[^<]*<\/a>/i, "");
    // Keep @mentions / #hashtags as plain text (anchors around them).
    caption = cleanCaption(htmlToText(inner));
    if (caption.length === 0) caption = null;
  }

  const likeRaw = html.match(/>([\d.,KMB]+)\s+likes?</i)?.[1] ?? null;
  const likeCount = likeRaw ? parseCount(likeRaw) : null;
  const isVideo = /class="EmbedVideo|<video|VideoPlayButton/i.test(html);

  if (!imageUrl && !caption && !username) return null;
  return { imageUrl, username, caption, likeCount, isVideo };
}

export const fetchInstagramFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    if (!isInstagramUrl(data.url)) throw new Error("Not an Instagram URL");
    const parsedInput = parseInstagram(data.url);
    // Share links (/share/...) only reveal their shortcode after redirect.
    const startUrl = parsedInput
      ? instagramCanonicalUrl(parsedInput.shortcode, parsedInput.kind)
      : /^https?:\/\//i.test(data.url)
        ? data.url
        : `https://${data.url}`;

    // Resolve the real shortcode first (share links redirect).
    let parsed = parsedInput;
    let finalUrl = startUrl;
    let ogHtml = "";
    const og: {
      title: string | null;
      desc: string | null;
      image: string | null;
      video: string | null;
      url: string | null;
    } = { title: null, desc: null, image: null, video: null, url: null };

    const readOg = (html: string) => {
      og.title = meta(html, "og:title") ?? og.title;
      og.desc = meta(html, "og:description") ?? og.desc;
      og.image = meta(html, "og:image") ?? og.image;
      og.video = meta(html, "og:video") ?? meta(html, "og:video:secure_url") ?? og.video;
      og.url = meta(html, "og:url") ?? og.url;
    };

    for (const ua of UAS) {
      const r = await fetchHtml(startUrl, ua);
      if (!r) continue;
      ogHtml = r.html;
      finalUrl = r.finalUrl;
      readOg(ogHtml);
      if (looksLikeMedia(og.image) || og.desc?.trim()) break;
    }
    // Datacenter IPs sometimes get the login wall — retry through the reader.
    if (!looksLikeMedia(og.image) && !og.desc?.trim()) {
      const r = await fetchHtmlViaReader(startUrl);
      if (r) {
        finalUrl = r.finalUrl;
        readOg(r.html);
      }
    }

    parsed = parsed ?? parseInstagram(og.url ?? "") ?? parseInstagram(finalUrl) ?? null;
    if (!parsed) throw new Error("Could not resolve Instagram post");
    const canonical = instagramCanonicalUrl(parsed.shortcode, parsed.kind);

    // --- Enrichment: the embed page (direct, then reader proxy) -------------
    let embed: EmbedData | null = null;
    for (const ua of UAS) {
      const r = await fetchHtml(`${canonical}embed/captioned/`, ua);
      if (!r) continue;
      embed = parseEmbed(r.html) ?? embed;
      if (embed?.caption && looksLikeMedia(embed?.imageUrl)) break;
    }
    if (!embed?.caption || !looksLikeMedia(embed?.imageUrl)) {
      const r = await fetchAny(`${canonical}embed/captioned/`);
      const viaProxy = r ? parseEmbed(r.html) : null;
      if (viaProxy) {
        embed = {
          imageUrl: looksLikeMedia(embed?.imageUrl) ? embed!.imageUrl : viaProxy.imageUrl,
          username: embed?.username ?? viaProxy.username,
          caption: embed?.caption ?? viaProxy.caption,
          likeCount: embed?.likeCount ?? viaProxy.likeCount,
          isVideo: embed?.isVideo || viaProxy.isVideo,
        };
      }
    }

    // Last, most reliable resort: the reader proxy renders the embed page and
    // returns clean markdown containing handle, likes, comments and the full
    // caption even when Instagram serves us the login wall / JS-only bundle.
    let readerCommentCount: number | null = null;
    if (!embed?.caption || !looksLikeMedia(embed?.imageUrl)) {
      const md = await fetchReaderMarkdown(`${canonical}embed/captioned/`);
      const viaReader = md ? parseReaderMarkdown(md) : null;
      if (viaReader) {
        readerCommentCount = viaReader.commentCount;
        embed = {
          imageUrl: looksLikeMedia(embed?.imageUrl) ? embed!.imageUrl : viaReader.imageUrl,
          username: embed?.username ?? viaReader.username,
          caption: embed?.caption ?? viaReader.caption,
          likeCount: embed?.likeCount ?? viaReader.likeCount,
          isVideo: embed?.isVideo || viaReader.isVideo,
        };
      }
    }


    let username: string | null = embed?.username ?? null;
    let displayName: string | null = null;
    let likeCount: number | null = embed?.likeCount ?? null;
    let commentCount: number | null = null;
    let postedAt: string | null = null;
    let caption: string | null = embed?.caption ?? null;
    // Prefer whichever source actually yielded a real media image.
    const imageUrl = looksLikeMedia(og.image)
      ? og.image
      : looksLikeMedia(embed?.imageUrl)
        ? embed!.imageUrl
        : (og.image ?? embed?.imageUrl ?? null);

    // --- Fallback / enrichment from Open Graph ------------------------------
    // og:description => `1M likes, 3,709 comments - nasa on July 29, 2023: "caption"`
    if (og.desc) {
      const m = og.desc.match(
        /^([\d.,KMB]+)\s+likes?,\s*([\d.,KMB]+)\s+comments?\s*-\s*([^:]+?)\s+on\s+([^:]+?):\s*"([\s\S]*)"?\s*$/i,
      );
      if (m) {
        likeCount = likeCount ?? parseCount(m[1]);
        commentCount = parseCount(m[2]);
        username = username ?? (m[3].trim().replace(/^@/, "") || null);
        const d = new Date(m[4].trim());
        postedAt = isNaN(d.getTime()) ? null : d.toISOString();
        if (!caption) caption = m[5];
      } else if (!caption && !/log in|update your browser|browser/i.test(og.desc)) {
        caption = og.desc;
      }
    }

    // og:title => `NASA on Instagram: "caption"`
    if (og.title) {
      const t = og.title.match(/^(.*?)\s+on Instagram:\s*"([\s\S]*?)"?\s*$/i);
      if (t) {
        displayName = t[1].trim() || null;
        if (!caption || t[2].length > caption.length) caption = t[2];
      }
    }

    // Username fallback from the canonicalised og:url (`/<user>/p/<code>/`).
    if (!username) {
      for (const cand of [og.url, finalUrl]) {
        if (!cand) continue;
        try {
          const p = new URL(cand).pathname.split("/").filter(Boolean);
          if (p.length > 1 && !["p", "reel", "reels", "tv", "share"].includes(p[0])) {
            username = p[0];
            break;
          }
        } catch {}
      }
    }

    caption = caption ? unquoteCaption(cleanCaption(caption)).slice(0, 5000) || null : null;

    if (!imageUrl && !caption) throw new Error("No Instagram metadata found");

    return {
      shortcode: parsed.shortcode,
      kind: parsed.kind as InstagramKind,
      canonicalUrl: canonical,
      imageUrl,
      isVideo: embed?.isVideo || !!og.video || parsed.kind !== "post",
      username,
      displayName,
      caption,
      likeCount,
      commentCount,
      postedAt,
    };
  });

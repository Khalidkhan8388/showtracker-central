import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// -----------------------------------------------------------------------------
// AI-only server functions. These are the ONLY code paths that leave the
// user's device. They accept raw data (base64 blobs, text) and return AI
// results. Nothing is persisted server-side.
// -----------------------------------------------------------------------------

// Keys the device sends along with each request (user's own provider keys).
const KeysSchema = z
  .array(z.object({ provider: z.string(), key: z.string(), model: z.string().optional() }))
  .optional()
  .default([]);

async function router() {
  return await import("./ai-router.server");
}

const AudioSchema = z.object({ base64: z.string().min(1), mime: z.string().min(1) });
const ImageSchema = z.object({ base64: z.string().min(1), mime: z.string().min(1) });


function keyPointsFromRaw(input: unknown, max: number): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((k: unknown) => String(k ?? "").trim())
    .filter((k: string) => k.length > 0)
    .slice(0, max);
}

// ---------- media analysis -------------------------------------------------

const SYSTEM_PROMPT = `You turn raw voice notes and/or attached images into a structured note.
Return ONE JSON object with keys: heading, summary, key_points. No prose, no code fences.

- heading: short (max ~8 words), title case, no trailing punctuation.
- summary: 2-4 sentences. If images are attached, describe what's visible and weave that into the summary.
- key_points: array of 3-6 short bullets (max ~12 words each) capturing the most important ideas, decisions, or facts. Return [] only if there's truly nothing to bullet.

Respond with ONLY the JSON object.`;

const AnalyzeInput = z.object({
  audio: AudioSchema.nullable().optional(),
  images: z.array(ImageSchema).max(20).optional().default([]),
  prior: z
    .object({
      heading: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      // Legacy fields: accepted so older callers still validate, but ignored.
      tasks: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  skipTasks: z.boolean().optional().default(false),
  extraTranscripts: z.array(z.string()).optional().default([]),
  keys: KeysSchema,
});


export const analyzeMediaFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => AnalyzeInput.parse(data))
  .handler(async ({ data }) => {
    const { routedChat, routedTranscribe, parseJsonReply, normalizeKeys } = await router();
    const keys = normalizeKeys(data.keys);

    const images = data.images ?? [];
    const prior = data.prior ?? null;
    const priorHasContent =
      !!prior &&
      (((prior.heading ?? "").trim().length > 0) ||
        ((prior.summary ?? "").trim().length > 0));

    const firstTranscript = data.audio
      ? await routedTranscribe(keys, data.audio.base64, data.audio.mime)
      : null;
    if (data.audio && !firstTranscript) throw new Error("Empty transcription");
    const extras = (data.extraTranscripts ?? []).filter((t) => t && t.trim().length > 0);
    const transcript = [firstTranscript, ...extras].filter(Boolean).join("\n\n") || null;

    const userBlocks: Array<Record<string, unknown>> = [];
    if (priorHasContent) {
      userBlocks.push({
        type: "text",
        text:
          `EXISTING NOTE (merge with new content into ONE cohesive note):\n` +
          `- Heading: ${prior?.heading || "(none)"}\n` +
          `- Summary: ${prior?.summary || "(none)"}\n\n` +
          `Produce ONE unified heading, ONE cohesive summary weaving old + new, and merged, de-duplicated key points.`,
      });
    }
    const intro = transcript
      ? `${priorHasContent ? "New " : ""}Transcript:\n\n${transcript}\n\n${images.length > 0 ? "Also analyze attached image(s)." : ""}`
      : images.length > 0
        ? (priorHasContent ? "Newly attached image(s) — analyze and merge." : "Analyze attached image(s) and produce the structured note.")
        : "No content.";
    userBlocks.push({ type: "text", text: intro });
    for (const img of images) {
      userBlocks.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.base64}` } });
    }

    const raw = await routedChat(keys, {
      system: SYSTEM_PROMPT,
      content: userBlocks,
      json: true,
      needsVision: images.length > 0,
    });
    const parsed: any = parseJsonReply(raw);
    return {
      transcript,
      heading: String(parsed.heading ?? "Untitled note").slice(0, 120),
      summary: String(parsed.summary ?? "").slice(0, 2000),
      key_points: Array.isArray(parsed.key_points)
        ? parsed.key_points
            .map((k: unknown) => String(k ?? "").trim())
            .filter((k: string) => k.length > 0)
            .slice(0, 6)
        : [],
      tasks: [] as string[],
      tags: [] as string[],
    };
  });

// ---------- transcribe a single clip (for append-in-edit) -----------------

const TranscribeClipInput = z.object({ audio: AudioSchema, keys: KeysSchema });
export const transcribeClipFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TranscribeClipInput.parse(d))
  .handler(async ({ data }) => {
    const { routedTranscribe, normalizeKeys } = await router();
    const transcript = await routedTranscribe(
      normalizeKeys(data.keys),
      data.audio.base64,
      data.audio.mime,
    );
    if (!transcript) throw new Error("Empty transcription");
    return { transcript };
  });

// ---------- OCR: extract selectable text from images ---------------------

const OCR_SYSTEM_PROMPT = `You are an OCR engine. Read every image the user attaches and return the visible text VERBATIM.
Preserve line breaks, punctuation, and reading order. Do NOT summarize, translate, or add commentary.
If multiple images are provided, separate each image's text with a line "--- Image N ---".
If an image has no legible text, output "(no text)" for that image.
Return plain text only — no JSON, no code fences.`;

const OcrInput = z.object({ images: z.array(ImageSchema).min(1).max(20), keys: KeysSchema });
export const ocrImagesFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => OcrInput.parse(d))
  .handler(async ({ data }) => {
    const { routedChat, normalizeKeys } = await router();
    const userBlocks: Array<Record<string, unknown>> = [
      { type: "text", text: `Extract the text from ${data.images.length === 1 ? "this image" : `these ${data.images.length} images`}.` },
    ];
    for (const img of data.images) {
      userBlocks.push({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.base64}` } });
    }
    const text = await routedChat(normalizeKeys(data.keys), {
      system: OCR_SYSTEM_PROMPT,
      content: userBlocks,
      needsVision: true,
      timeoutMs: 90_000,
    });
    return { text };
  });


// ---------- web link ------------------------------------------------------

const WEB_SYSTEM_PROMPT = `You turn a web page into a structured saved note.
Return ONE JSON object with keys: heading, summary, key_points. No prose, no code fences.

- heading: short (max ~8 words), title case, no trailing punctuation. Prefer the page's own concise title.
- summary: 2-5 sentences capturing the key takeaways.
- key_points: array of 3-6 short bullets (max ~14 words each) with the most important facts or ideas. Return [] if the page is too thin.

Respond with ONLY the JSON object.`;

function absoluteUrl(base: string, maybe: string | null | undefined): string | null {
  if (!maybe) return null;
  try { return new URL(maybe, base).toString(); } catch { return null; }
}

async function fetchWebPage(url: string): Promise<{ title: string | null; text: string; imageUrl: string | null }> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const fcKey = process.env["FIRECRAWL_API_KEY"];
  if (lovableKey && fcKey) {
    try {
      const res = await fetch("https://connector-gateway.lovable.dev/firecrawl/v2/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": fcKey,
        },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const doc = json?.data ?? json;
        const markdown: string = doc?.markdown ?? "";
        const metadata = doc?.metadata ?? {};
        const title = (metadata.title as string) ?? (metadata.ogTitle as string) ?? null;
        const description = (metadata.description as string) ?? "";
        const combined = [description, markdown].filter(Boolean).join("\n\n").trim();
        const imageUrl = absoluteUrl(url, (metadata.ogImage as string) ?? (metadata.twitterImage as string) ?? null);
        return { title: title ? title.slice(0, 200) : null, text: combined.slice(0, 20000), imageUrl };
      }
    } catch {}
  }
  // Fallback: raw fetch
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (res.ok) {
      const html = (await res.text()).slice(0, 200000);
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
      const og = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)?.[1]
        ?? html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        ?? html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)?.[1]
        ?? null;
      const imageUrl = absoluteUrl(url, og);
      const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 20000);
      return { title, text: stripped, imageUrl };
    }
  } catch {}
  return { title: null, text: "", imageUrl: null };
}

const WebLinkInput = z.object({ url: z.string().trim().url().max(2000), keys: KeysSchema });
export const analyzeWebLinkFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => WebLinkInput.parse(d))
  .handler(async ({ data }) => {
    const { routedChat, normalizeKeys, parseJsonReply } = await router();
    const keys = normalizeKeys(data.keys);
    const { title, text, imageUrl } = await fetchWebPage(data.url);
    const effective = text && text.length >= 30
      ? text
      : `Title: ${title ?? "(none)"}\nURL: ${data.url}\n(The page had no readable content; summarize from the URL and title.)`;
    const raw = await routedChat(keys, {
      system: WEB_SYSTEM_PROMPT,
      content: `URL: ${data.url}\n${title ? `Title: ${title}\n` : ""}\nContent:\n${effective}`,
      json: true,
    });
    const parsed: any = parseJsonReply(raw);
    return {
      heading: String(parsed.heading ?? title ?? "Saved link").slice(0, 120),
      summary: String(parsed.summary ?? "").slice(0, 2000),
      key_points: keyPointsFromRaw(parsed.key_points, 6),
      tasks: [] as string[],
      tags: [] as string[],
      imageUrl: imageUrl ?? null,
    };
  });

const FetchImageInput = z.object({ url: z.string().trim().url().max(4000) });
export const fetchLinkImageFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => FetchImageInput.parse(d))
  .handler(async ({ data }) => {
    try {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(data.url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BraintapeBot/1.0)", Accept: "image/*" },
      }).finally(() => clearTimeout(to));
      if (!res.ok) return { ok: false as const };
      const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
      if (!mime.startsWith("image/")) return { ok: false as const };
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > 8 * 1024 * 1024) return { ok: false as const };
      // Base64 encode
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
      const base64 = btoa(bin);
      return { ok: true as const, mime, base64 };
    } catch {
      return { ok: false as const };
    }
  });

// ---------- text note enrichment ------------------------------------------

const TEXT_SYSTEM_PROMPT = `You analyze a user's written note.
Return ONE JSON object with keys: heading, summary, key_points. No prose, no code fences.

- heading: short (max ~8 words), title case. If a heading is provided, refine it rather than replacing.
- summary: 1-3 sentence recap. Leave "" if too short.
- key_points: array of 0-5 short bullets (max ~12 words each). Return [] if the note is too short to bullet.

Respond with ONLY the JSON object.`;

const TextInput = z.object({
  heading: z.string().trim().max(200).optional().default(""),
  body: z.string().trim().max(50000).optional().default(""),
  keys: KeysSchema,
});
export const analyzeTextFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TextInput.parse(d))
  .handler(async ({ data }) => {
    const empty = {
      heading: data.heading,
      summary: "",
      key_points: [] as string[],
      tasks: [] as string[],
      tags: [] as string[],
    };
    if (!data.body || data.body.trim().length < 20) return empty;
    const { routedChat, normalizeKeys, parseJsonReply } = await router();
    const keys = normalizeKeys(data.keys);
    const content = data.heading
      ? `Title: ${data.heading}\n\nNote:\n${data.body}`
      : `Note:\n${data.body}\n\n(No title — generate one.)`;
    let raw: string;
    try {
      raw = await routedChat(keys, { system: TEXT_SYSTEM_PROMPT, content, json: true });
    } catch {
      return empty;
    }
    const parsed: any = parseJsonReply(raw);
    return {
      heading: String(parsed.heading ?? data.heading ?? "").slice(0, 120),
      summary: String(parsed.summary ?? "").slice(0, 2000),
      key_points: keyPointsFromRaw(parsed.key_points, 5),
      tasks: [] as string[],
      tags: [] as string[],
    };
  });

// ---------- youtube -------------------------------------------------------

const YT_SYSTEM_PROMPT = `You turn YouTube video metadata into a structured saved note.
Return ONE JSON object with keys: heading, summary, key_points. No prose, no code fences.

- heading: short (max ~10 words), title case. Prefer the actual video title lightly refined; NEVER include the channel name or timestamps.
- summary: 3-6 sentences distilling what the video is actually about — the argument, story, or steps — using the captions as the primary source of truth. Do NOT restate the title. Do NOT say "in this video".
- key_points: 3-7 concrete takeaways as short bullet strings. Each ≤ 120 chars. Return [] if the source is too thin.

Respond with ONLY the JSON object.`;

const YouTubeAnalyzeInput = z.object({
  title: z.string().trim().max(400).nullable().optional(),
  channelName: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(20000).nullable().optional(),
  captions: z.string().trim().max(60000).nullable().optional(),
  url: z.string().trim().url().max(2000),
  keys: KeysSchema,
});

export const analyzeYouTubeFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => YouTubeAnalyzeInput.parse(d))
  .handler(async ({ data }) => {
    const { routedChat, normalizeKeys, parseJsonReply } = await router();
    const keys = normalizeKeys(data.keys);
    const parts: string[] = [`URL: ${data.url}`];
    if (data.title) parts.push(`Title: ${data.title}`);
    if (data.channelName) parts.push(`Channel: ${data.channelName}`);
    if (data.description) parts.push(`Description:\n${data.description.slice(0, 4000)}`);
    if (data.captions && data.captions.length > 40) {
      parts.push(`Captions (auto-generated may contain errors):\n${data.captions.slice(0, 24000)}`);
    } else {
      parts.push(`(No captions available — rely on title + description.)`);
    }
    const raw = await routedChat(keys, {
      system: YT_SYSTEM_PROMPT,
      content: parts.join("\n\n"),
      json: true,
    });
    const parsed: any = parseJsonReply(raw);
    return {
      heading: String(parsed.heading ?? data.title ?? "YouTube video").slice(0, 140),
      summary: String(parsed.summary ?? "").slice(0, 2400),
      key_points: keyPointsFromRaw(parsed.key_points, 7),
      tasks: [] as string[],
    };
  });


// ---------- link label ----------------------------------------------------

const LabelInput = z.object({ url: z.string().trim().url().max(2000), keys: KeysSchema });
export const generateLinkLabelFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => LabelInput.parse(d))
  .handler(async ({ data }) => {
    const url = data.url;
    let hostname = "";
    try { hostname = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BraintapeBot/1.0)", Accept: "text/html" },
      }).finally(() => clearTimeout(timeout));
      if (res.ok) {
        const html = (await res.text()).slice(0, 200000);
        const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
        const tw = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
        const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
        const raw = (og || tw || title || "").trim();
        if (raw) {
          const decoded = raw
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/\s+/g, " ").trim().slice(0, 120);
          return { label: decoded, hostname };
        }
      }
    } catch {}

    // No page title could be read (blocked, JS-only, etc.). If the user has
    // their own AI key, ask the model for a short label based on the URL alone.
    try {
      const { routedChat, normalizeKeys, parseJsonReply } = await router();
      const keys = normalizeKeys(data.keys);
      if (keys.length > 0) {
        const raw = await routedChat(keys, {
          system:
            'You write a short, human-readable label (max 8 words, title case, no trailing punctuation) for a saved web link, inferred from its URL. Return ONE JSON object: { "label": string }. No prose, no code fences.',
          content: `URL: ${url}`,
          json: true,
          timeoutMs: 15_000,
        });
        const label = String(parseJsonReply(raw).label ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
        if (label) return { label, hostname };
      }
    } catch {}
    return { label: hostname || url, hostname };
  });

// ---------- semantic search ranking ---------------------------------------

const RankInput = z.object({
  query: z.string().trim().min(1).max(500),
  catalog: z
    .array(
      z.object({
        id: z.string(),
        heading: z.string().nullable().optional(),
        summary: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .max(200),
  keys: KeysSchema,
});
export const semanticRankFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RankInput.parse(d))
  .handler(async ({ data }) => {
    const { routedChat, normalizeKeys, parseJsonReply } = await router();
    const keys = normalizeKeys(data.keys);
    const sys = `You are a semantic search assistant over the user's personal notes.
Given a query and a JSON catalog of notes (id, heading, summary, tags), return the most relevant note ids ordered by relevance.
Only include notes that are genuinely relevant. If nothing fits, return [].
Return ONE JSON object: { "ids": string[], "reasoning": string }. Reasoning is one short sentence.`;
    const raw = await routedChat(keys, {
      system: sys,
      content: `Query: ${data.query}\n\nNotes:\n${JSON.stringify(data.catalog)}`,
      json: true,
    });
    const parsed: any = parseJsonReply(raw);
    const valid = new Set(data.catalog.map((c) => c.id));
    const ids: string[] = (Array.isArray(parsed.ids) ? parsed.ids : [])
      .map((x: unknown) => String(x))
      .filter((id: string) => valid.has(id))
      .slice(0, 30);
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 300) : null;
    return { ids, reasoning };
  });

// ---------- reader view (article extraction) -----------------------------

const ReaderInput = z.object({ url: z.string().trim().url().max(2000) });
export const fetchReaderViewFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ReaderInput.parse(d))
  .handler(async ({ data }) => {
    const url = data.url;
    let hostname = "";
    try { hostname = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(`https://r.jina.ai/${url}`, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "Accept": "text/plain",
          "X-Return-Format": "markdown",
        },
      }).finally(() => clearTimeout(timeout));
      if (!res.ok) throw new Error(`Reader failed (${res.status})`);
      const raw = (await res.text()).slice(0, 200_000);
      // r.jina.ai returns a small header block (Title:, URL Source:, Markdown Content:)
      // then the article. Strip the header so we render body only.
      const marker = raw.indexOf("Markdown Content:");
      const body = (marker >= 0 ? raw.slice(marker + "Markdown Content:".length) : raw).trim();
      const words = body.split(/\s+/).filter(Boolean).length;
      const readingMinutes = Math.max(1, Math.round(words / 220));
      if (!body || words < 30) throw new Error("No readable content found");
      return { markdown: body, hostname, words, readingMinutes };
    } catch (e: any) {
      throw new Error(e?.message ?? "Reader view failed");
    }
  });

// ---------- reminders (deprecated) ----------------------------------------
// Tasks & Reminders were removed from the app. These stay exported so any
// stale caller keeps compiling, but they never touch the AI.

const VerifyRemindersInput = z.object({
  text: z.string().max(20000).optional(),
  nowIso: z.string().optional(),
  candidates: z.array(z.object({ iso: z.string(), title: z.string().optional() })).max(20).optional(),
  existing: z.array(z.string()).max(50).optional(),
});

/** @deprecated Reminders were removed. Always returns an empty list. */
export const verifyRemindersFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => VerifyRemindersInput.parse(d))
  .handler(async () => {
    return { reminders: [] as Array<{ iso: string; title: string }> };
  });

const SmartTimesInput = z.object({
  text: z.string().max(6000).optional(),
  nowIso: z.string().optional(),
  timeZone: z.string().max(80).optional(),
  profileSummary: z.string().max(600).optional(),
  avoidWeekends: z.boolean().optional(),
  existing: z.array(z.string()).max(30).optional(),
});

/** @deprecated Reminders were removed. Always returns an empty list. */
export const suggestSmartTimesFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SmartTimesInput.parse(d))
  .handler(async () => {
    return {
      suggestions: [] as Array<{ iso: string | null; id: string | null; label: string; reason: string }>,
    };
  });

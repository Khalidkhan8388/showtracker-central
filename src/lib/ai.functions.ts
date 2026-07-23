import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// -----------------------------------------------------------------------------
// AI-only server functions. These are the ONLY code paths that leave the
// user's device. They accept raw data (base64 blobs, text) and return AI
// results. Nothing is persisted server-side.
// -----------------------------------------------------------------------------

const MODEL = "google/gemini-3.5-flash";
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

const AudioSchema = z.object({ base64: z.string().min(1), mime: z.string().min(1) });
const ImageSchema = z.object({ base64: z.string().min(1), mime: z.string().min(1) });

// ---------- shared fetch helper (with timeout) ---------------------------

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------- transcription -------------------------------------------------

async function transcribeBytes(base64: string, mime: string, apiKey: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const ext = ({
    "audio/webm": "webm",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
  } as Record<string, string>)[mime.split(";")[0]] ?? "webm";
  const form = new FormData();
  form.append("model", "openai/gpt-4o-mini-transcribe");
  form.append("file", new Blob([bytes], { type: mime }), `recording.${ext}`);
  const res = await fetchWithTimeout(`${GATEWAY}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }, 90_000);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Transcription failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

function parseTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const s = String(raw ?? "")
      .toLowerCase()
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .slice(0, 32);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

function tasksFromRaw(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .map((t: unknown) =>
      typeof t === "string" ? t : typeof t === "object" && t && "text" in (t as any) ? String((t as any).text) : "",
    )
    .filter((t: string) => t.trim().length > 0)
    .slice(0, 20);
}

// ---------- media analysis -------------------------------------------------

const SYSTEM_PROMPT = `You turn raw voice notes and/or attached images into a structured note.
Return ONE JSON object with keys: heading, summary, tasks, tags. No prose, no code fences.

- heading: short (max ~8 words), title case, no trailing punctuation.
- summary: 2-4 sentences. If images are attached, describe what's visible and weave that into the summary.
- tasks: array of clear, actionable to-dos (imperative voice, include names/dates/amounts). Skip pure musings. Cap at 8. Return [] if nothing is genuinely actionable.
- tags: 3-6 short lowercase kebab-case tags. No #, no duplicates.

Respond with ONLY the JSON object.`;

const AnalyzeInput = z.object({
  audio: AudioSchema.nullable().optional(),
  images: z.array(ImageSchema).max(20).optional().default([]),
  prior: z
    .object({
      heading: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      tasks: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  skipTasks: z.boolean().optional().default(false),
});


export const analyzeMediaFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => AnalyzeInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const images = data.images ?? [];
    const prior = data.prior ?? null;
    const priorHasContent =
      !!prior &&
      (((prior.heading ?? "").trim().length > 0) ||
        ((prior.summary ?? "").trim().length > 0) ||
        ((prior.tasks?.length ?? 0) > 0));

    // Kick off transcription in PARALLEL with structuring (both hit the AI
    // gateway independently). Structuring uses the transcript once ready.
    const transcribePromise: Promise<string | null> = data.audio
      ? transcribeBytes(data.audio.base64, data.audio.mime, apiKey)
      : Promise.resolve(null);

    // Await transcription before building the structuring prompt (it needs the text).
    const transcript = await transcribePromise;
    if (data.audio && !transcript) throw new Error("Empty transcription");

    const userBlocks: Array<Record<string, unknown>> = [];
    if (priorHasContent) {
      userBlocks.push({
        type: "text",
        text:
          `EXISTING NOTE (merge with new content into ONE cohesive note):\n` +
          `- Heading: ${prior?.heading || "(none)"}\n` +
          `- Summary: ${prior?.summary || "(none)"}\n` +
          `- Tasks:\n${(prior?.tasks ?? []).map((t) => `  • ${t}`).join("\n") || "  (none)"}\n\n` +
          `Produce ONE unified heading, ONE cohesive summary weaving old + new, and a merged, de-duplicated task list.`,
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

    const res = await fetchWithTimeout(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userBlocks },
        ],
        response_format: { type: "json_object" },
      }),
    }, 120_000);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = j.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
    return {
      transcript,
      heading: String(parsed.heading ?? "Untitled note").slice(0, 120),
      summary: String(parsed.summary ?? "").slice(0, 2000),
      tasks: data.skipTasks ? [] : tasksFromRaw(parsed.tasks),
      tags: parseTags(parsed.tags),
    };
  });

// ---------- transcribe a single clip (for append-in-edit) -----------------

const TranscribeClipInput = z.object({ audio: AudioSchema });
export const transcribeClipFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TranscribeClipInput.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const transcript = await transcribeBytes(data.audio.base64, data.audio.mime, apiKey);
    if (!transcript) throw new Error("Empty transcription");
    return { transcript };
  });

// ---------- web link ------------------------------------------------------

const WEB_SYSTEM_PROMPT = `You turn a web page into a structured saved note.
Return ONE JSON object with keys: heading, summary, tasks, tags. No prose, no code fences.

- heading: short (max ~8 words), title case, no trailing punctuation. Prefer the page's own concise title.
- summary: 2-5 sentences capturing the key takeaways.
- tasks: concrete, actionable to-dos plausibly triggered by saving this page. Skip "Read this later". Cap at 8. Return [] if nothing is actionable.
- tags: 3-6 short kebab-case tags.

Respond with ONLY the JSON object.`;

async function fetchWebPage(url: string): Promise<{ title: string | null; text: string }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const fcKey = process.env.FIRECRAWL_API_KEY;
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
        return { title: title ? title.slice(0, 200) : null, text: combined.slice(0, 20000) };
      }
    } catch {}
  }
  // Fallback: raw fetch
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (res.ok) {
      const html = (await res.text()).slice(0, 200000);
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
      const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 20000);
      return { title, text: stripped };
    }
  } catch {}
  return { title: null, text: "" };
}

const WebLinkInput = z.object({ url: z.string().trim().url().max(2000) });
export const analyzeWebLinkFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => WebLinkInput.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const { title, text } = await fetchWebPage(data.url);
    const effective = text && text.length >= 30
      ? text
      : `Title: ${title ?? "(none)"}\nURL: ${data.url}\n(The page had no readable content; summarize from the URL and title.)`;
    const res = await fetchWithTimeout(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: WEB_SYSTEM_PROMPT },
          { role: "user", content: `URL: ${data.url}\n${title ? `Title: ${title}\n` : ""}\nContent:\n${effective}` },
        ],
        response_format: { type: "json_object" },
      }),
    }, 120_000);
    if (!res.ok) throw new Error(`AI failed (${res.status})`);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = j.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
    return {
      heading: String(parsed.heading ?? title ?? "Saved link").slice(0, 120),
      summary: String(parsed.summary ?? "").slice(0, 2000),
      tasks: tasksFromRaw(parsed.tasks),
      tags: parseTags(parsed.tags),
    };
  });

// ---------- text note enrichment ------------------------------------------

const TEXT_SYSTEM_PROMPT = `You analyze a user's written note.
Return ONE JSON object with keys: heading, summary, tasks, tags. No prose, no code fences.

- heading: short (max ~8 words), title case. If a heading is provided, refine it rather than replacing.
- summary: 1-3 sentence recap. Leave "" if too short.
- tasks: clear actionable to-dos. Cap at 8. Return [] if nothing actionable.
- tags: 3-6 kebab-case tags.

Respond with ONLY the JSON object.`;

const TextInput = z.object({
  heading: z.string().trim().max(200).optional().default(""),
  body: z.string().trim().max(50000).optional().default(""),
});
export const analyzeTextFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TextInput.parse(d))
  .handler(async ({ data }) => {
    if (!data.body || data.body.trim().length < 20) {
      return { heading: data.heading, summary: "", tasks: [] as string[], tags: [] as string[] };
    }
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const content = data.heading
      ? `Title: ${data.heading}\n\nNote:\n${data.body}`
      : `Note:\n${data.body}\n\n(No title — generate one.)`;
    const res = await fetchWithTimeout(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: TEXT_SYSTEM_PROMPT },
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
      }),
    }, 120_000);
    if (!res.ok) return { heading: data.heading, summary: "", tasks: [], tags: [] };
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = j.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    return {
      heading: String(parsed.heading ?? data.heading ?? "").slice(0, 120),
      summary: String(parsed.summary ?? "").slice(0, 2000),
      tasks: tasksFromRaw(parsed.tasks),
      tags: parseTags(parsed.tags),
    };
  });

// ---------- link label ----------------------------------------------------

const LabelInput = z.object({ url: z.string().trim().url().max(2000) });
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
});
export const semanticRankFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RankInput.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const sys = `You are a semantic search assistant over the user's personal notes.
Given a query and a JSON catalog of notes (id, heading, summary, tags), return the most relevant note ids ordered by relevance.
Only include notes that are genuinely relevant. If nothing fits, return [].
Return ONE JSON object: { "ids": string[], "reasoning": string }. Reasoning is one short sentence.`;
    const res = await fetchWithTimeout(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Query: ${data.query}\n\nNotes:\n${JSON.stringify(data.catalog)}` },
        ],
        response_format: { type: "json_object" },
      }),
    }, 120_000);
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = j.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    const valid = new Set(data.catalog.map((c) => c.id));
    const ids: string[] = (Array.isArray(parsed.ids) ? parsed.ids : [])
      .map((x: unknown) => String(x))
      .filter((id: string) => valid.has(id))
      .slice(0, 30);
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 300) : null;
    return { ids, reasoning };
  });

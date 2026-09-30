// Routes AI work through the user's own API keys first, falling back to the
// built-in Lovable AI gateway only when no key works (or none is configured).
// Keys arrive with each request from the device; nothing is persisted here.

export type UserKey = {
  provider: "gemini" | "groq" | "openai" | "openrouter";
  key: string;
  model?: string;
};

const BASE_URLS: Record<UserKey["provider"], string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

const DEFAULT_MODELS: Record<UserKey["provider"], string> = {
  gemini: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  openai: "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
};

const VISION_PROVIDERS = new Set<UserKey["provider"]>(["gemini", "openai", "openrouter"]);

export const GATEWAY = "https://ai.gateway.lovable.dev/v1";
export const GATEWAY_MODEL = "google/gemini-3.5-flash";

export function normalizeKeys(input: unknown): UserKey[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((k: any) => k && typeof k.key === "string" && k.key.trim() && k.provider in BASE_URLS)
    .map((k: any) => ({
      provider: k.provider as UserKey["provider"],
      key: String(k.key).trim(),
      model: typeof k.model === "string" && k.model.trim() ? k.model.trim() : undefined,
    }));
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export type ChatOptions = {
  system: string;
  /** Plain string, or OpenAI-style content blocks (for images). */
  content: string | Array<Record<string, unknown>>;
  json?: boolean;
  /** Set when the content includes images — non-vision keys are skipped. */
  needsVision?: boolean;
  timeoutMs?: number;
};

/**
 * Runs a chat completion against the user's keys in order, then the built-in
 * gateway. Returns the assistant's text. Throws only if everything failed.
 */
export async function routedChat(keys: UserKey[], opts: ChatOptions): Promise<string> {
  const timeout = opts.timeoutMs ?? 120_000;
  const failures: string[] = [];

  const candidates = (opts.needsVision ? keys.filter((k) => VISION_PROVIDERS.has(k.provider)) : keys);

  for (const k of candidates) {
    const model = k.model || DEFAULT_MODELS[k.provider];
    try {
      const res = await fetchWithTimeout(
        `${BASE_URLS[k.provider]}/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${k.key}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: opts.system },
              { role: "user", content: opts.content },
            ],
            ...(opts.json ? { response_format: { type: "json_object" } } : {}),
          }),
        },
        timeout,
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        failures.push(`${k.provider}: ${res.status} ${body.slice(0, 120)}`);
        continue;
      }
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = (j.choices?.[0]?.message?.content ?? "").trim();
      if (!text) {
        failures.push(`${k.provider}: empty response`);
        continue;
      }
      return text;
    } catch (e: any) {
      failures.push(`${k.provider}: ${e?.message ?? "request failed"}`);
    }
  }

  // Fallback: built-in gateway.
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    throw new Error(
      failures.length
        ? `All AI keys failed — ${failures.join(" | ")}`
        : "No AI key available. Add one in Profile.",
    );
  }
  const res = await fetchWithTimeout(
    `${GATEWAY}/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GATEWAY_MODEL,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.content },
        ],
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    },
    timeout,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const tail = failures.length ? ` (your keys: ${failures.join(" | ")})` : "";
    throw new Error(`AI failed (${res.status}): ${body.slice(0, 160)}${tail}`);
  }
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (j.choices?.[0]?.message?.content ?? "").trim();
}

/** Parses a JSON object out of a model reply, tolerating code fences. */
export function parseJsonReply(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch {}
      }
      return {};
    }
  }
}

const AUDIO_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};

/**
 * Transcribes audio. Uses Groq Whisper when the user has a Groq key
 * (free + instant), otherwise the built-in gateway.
 */
export async function routedTranscribe(
  keys: UserKey[],
  base64: string,
  mime: string,
): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const ext = AUDIO_EXT[mime.split(";")[0]!] ?? "webm";
  const failures: string[] = [];

  const groq = keys.filter((k) => k.provider === "groq");
  for (const k of groq) {
    try {
      const form = new FormData();
      form.append("model", "whisper-large-v3");
      form.append("file", new Blob([bytes], { type: mime }), `recording.${ext}`);
      const res = await fetchWithTimeout(
        `${BASE_URLS.groq}/audio/transcriptions`,
        { method: "POST", headers: { Authorization: `Bearer ${k.key}` }, body: form },
        90_000,
      );
      if (!res.ok) {
        failures.push(`groq: ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text ?? "").trim();
      if (text) return text;
      failures.push("groq: empty transcript");
    } catch (e: any) {
      failures.push(`groq: ${e?.message ?? "failed"}`);
    }
  }

  // OpenAI keys can also transcribe.
  for (const k of keys.filter((x) => x.provider === "openai")) {
    try {
      const form = new FormData();
      form.append("model", "whisper-1");
      form.append("file", new Blob([bytes], { type: mime }), `recording.${ext}`);
      const res = await fetchWithTimeout(
        `${BASE_URLS.openai}/audio/transcriptions`,
        { method: "POST", headers: { Authorization: `Bearer ${k.key}` }, body: form },
        90_000,
      );
      if (!res.ok) {
        failures.push(`openai: ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text ?? "").trim();
      if (text) return text;
    } catch (e: any) {
      failures.push(`openai: ${e?.message ?? "failed"}`);
    }
  }

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    throw new Error(
      failures.length
        ? `Transcription failed — ${failures.join(" | ")}`
        : "No AI key available for transcription. Add a Groq key in Profile.",
    );
  }
  const form = new FormData();
  form.append("model", "openai/gpt-4o-mini-transcribe");
  form.append("file", new Blob([bytes], { type: mime }), `recording.${ext}`);
  const res = await fetchWithTimeout(
    `${GATEWAY}/audio/transcriptions`,
    { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form },
    90_000,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const tail = failures.length ? ` (your keys: ${failures.join(" | ")})` : "";
    throw new Error(`Transcription failed (${res.status}): ${body.slice(0, 160)}${tail}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/**
 * Reads a PDF with the user's Gemini key (native API handles inline PDFs).
 * Returns null when no Gemini key is available or all attempts failed.
 */
export async function routedPdf(
  keys: UserKey[],
  base64: string,
  prompt: string,
): Promise<string | null> {
  for (const k of keys.filter((x) => x.provider === "gemini")) {
    const model = k.model || DEFAULT_MODELS.gemini;
    try {
      const res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": k.key },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: "application/pdf", data: base64 } },
                ],
              },
            ],
          }),
        },
        180_000,
      );
      if (!res.ok) continue;
      const j = (await res.json()) as any;
      const text = (j?.candidates?.[0]?.content?.parts ?? [])
        .map((p: any) => p?.text ?? "")
        .join("")
        .trim();
      if (text) return text;
    } catch {}
  }
  return null;
}

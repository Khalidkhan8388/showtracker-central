// User-supplied AI provider keys, stored on this device only (localStorage).
// Keys are sent with each Ask request and tried in order; the first one that
// answers wins. Nothing is stored on a server.

export type AiProvider = "gemini" | "groq" | "openai" | "openrouter";

export type AiKey = {
  id: string;
  provider: AiProvider;
  key: string;
  model?: string;
  enabled: boolean;
};

export const PROVIDERS: Record<
  AiProvider,
  { label: string; defaultModel: string; baseURL: string; hint: string }
> = {
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    hint: "Free key from aistudio.google.com",
  },
  groq: {
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    baseURL: "https://api.groq.com/openai/v1",
    hint: "Free key from console.groq.com",
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    baseURL: "https://api.openai.com/v1",
    hint: "Key from platform.openai.com",
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "openai/gpt-4o-mini",
    baseURL: "https://openrouter.ai/api/v1",
    hint: "Key from openrouter.ai/keys",
  },
};

const STORAGE_KEY = "braintape-ai-keys";

export function listKeys(): AiKey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as AiKey[]) : [];
  } catch {
    return [];
  }
}

export function saveKeys(keys: AiKey[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  window.dispatchEvent(new Event("braintape:ai-keys-changed"));
}

export function addKey(provider: AiProvider, key: string, model?: string): AiKey[] {
  const next = [
    ...listKeys(),
    {
      id: Math.random().toString(36).slice(2, 10),
      provider,
      key: key.trim(),
      model: model?.trim() || undefined,
      enabled: true,
    },
  ];
  saveKeys(next);
  return next;
}

export function removeKey(id: string): AiKey[] {
  const next = listKeys().filter((k) => k.id !== id);
  saveKeys(next);
  return next;
}

export function toggleKey(id: string): AiKey[] {
  const next = listKeys().map((k) => (k.id === id ? { ...k, enabled: !k.enabled } : k));
  saveKeys(next);
  return next;
}

export function moveKey(id: string, dir: -1 | 1): AiKey[] {
  const keys = listKeys();
  const i = keys.findIndex((k) => k.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return keys;
  const next = [...keys];
  const a = next[i]!;
  next[i] = next[j]!;
  next[j] = a;
  saveKeys(next);
  return next;
}

/** What gets sent to the server with an Ask request. */
export function activeKeyChain() {
  return listKeys()
    .filter((k) => k.enabled && k.key)
    .map((k) => ({
      provider: k.provider,
      key: k.key,
      model: k.model || PROVIDERS[k.provider].defaultModel,
    }));
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/** Quick connectivity check straight from the browser. */
export async function testKey(k: AiKey): Promise<void> {
  const p = PROVIDERS[k.provider];
  const res = await fetch(`${p.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${k.key}` },
    body: JSON.stringify({
      model: k.model || p.defaultModel,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Key was rejected."
        : res.status === 429
          ? "Key is rate limited right now."
          : `Failed (${res.status}) ${text.slice(0, 120)}`
    );
  }
}

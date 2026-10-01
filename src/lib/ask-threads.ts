import type { UIMessage } from "ai";
import type { LocalNote } from "./local-db";

export type AskThread = { id: string; title: string; updatedAt: string; messages: UIMessage[] };

const KEY = "braintape.ask.threads";

export function loadThreads(): AskThread[] {
  if (typeof window === "undefined") return [];
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveThreads(threads: AskThread[]) {
  localStorage.setItem(KEY, JSON.stringify(threads));
  window.dispatchEvent(new Event("braintape-ask-threads"));
}

export function getThread(id: string): AskThread | undefined {
  return loadThreads().find((t) => t.id === id);
}

export function createThread(): AskThread {
  const t: AskThread = { id: crypto.randomUUID().slice(0, 8), title: "New chat", updatedAt: new Date().toISOString(), messages: [] };
  saveThreads([t, ...loadThreads()]);
  return t;
}

export function saveThreadMessages(id: string, messages: UIMessage[]) {
  const threads = loadThreads();
  const firstUser = messages.find((m) => m.role === "user");
  const firstText = firstUser?.parts.find((p) => p.type === "text") as { text?: string } | undefined;
  const existing = threads.find((t) => t.id === id);
  const title = existing && existing.title !== "New chat" ? existing.title : (firstText?.text?.slice(0, 60) || "New chat");
  const next: AskThread = { id, title, updatedAt: new Date().toISOString(), messages };
  saveThreads([next, ...threads.filter((t) => t.id !== id)]);
}

export function deleteThread(id: string) {
  saveThreads(loadThreads().filter((t) => t.id !== id));
}

// ---------------------------------------------------------------------------
// Retrieval: pick the most relevant cards to send along with the question.
// ---------------------------------------------------------------------------

export type AskCard = { id: string; kind: string; title: string; date: string; text: string };

function kindOf(n: LocalNote): string {
  if (n.document) return "pdf";
  if (n.media) return n.media.type === "tv" ? "tv show" : "movie";
  if (n.youtube) return "youtube video";
  if (n.duration_seconds != null) return "voice note";
  if (n.source_url) return "web link";
  if (n.image_paths?.length && !n.transcript) return "photo";
  return "note";
}

function toCard(n: LocalNote, long: boolean): AskCard {
  const parts: string[] = [];
  if (n.media) {
    const m = n.media;
    parts.push(`${m.title} (${m.release_date?.slice(0, 4) ?? "?"}) — status: ${m.watch_status ?? "none"}. Genres: ${(m.genres ?? []).join(", ")}. ${m.overview}`);
    if (m.type === "tv") parts.push(`Episodes watched: ${m.watched_episodes?.length ?? 0}/${m.number_of_episodes ?? "?"}`);
  }
  if (n.youtube) parts.push(`YouTube by ${n.youtube.channel_name ?? "?"}`);
  if (n.source_url) parts.push(`URL: ${n.source_url}`);
  if (n.summary) parts.push(`Summary: ${n.summary}`);
  if (n.key_points?.length) parts.push(`Key points: ${n.key_points.join("; ")}`);
  if (n.tasks?.length) parts.push(`Tasks: ${n.tasks.map((t) => `${t.done ? "[x]" : "[ ]"} ${t.text}`).join("; ")}`);
  if (n.reminders?.length) parts.push(`Reminders: ${n.reminders.join(", ")}`);
  if (n.tags?.length) parts.push(`Tags: ${n.tags.join(", ")}`);
  const body = n.transcript || n.ocr_text || "";
  if (body) parts.push(`Content: ${body.slice(0, long ? 4000 : 500)}`);
  return {
    id: n.id,
    kind: kindOf(n),
    title: n.heading || n.media?.title || "Untitled",
    date: n.created_at.slice(0, 10),
    text: parts.join("\n"),
  };
}

const STOP = new Set("the a an and or of to in on for is are was were what which who how when where my me i do did does have has with about from that this it any all".split(" "));

export function pickCards(notes: LocalNote[], query: string, max = 40): AskCard[] {
  const live = notes.filter((n) => !n.deleted_at);
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const scored = live.map((n, i) => {
    const hay = [n.heading, n.summary, n.transcript, n.ocr_text, n.media?.title, n.youtube?.title, n.tags?.join(" "), n.key_points?.join(" "), n.tasks?.map((t) => t.text).join(" ")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score += (n.heading ?? "").toLowerCase().includes(w) ? 3 : 1;
    // light recency bias so general questions ("what did I save lately") work
    score += Math.max(0, 1 - i / 50) * 0.5;
    return { n, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map(({ n }, idx) => toCard(n, idx < 6));
}

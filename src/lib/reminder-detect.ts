// Detect actionable reminders: chrono-parsed date + nearby action verb/phrase.
// Returns a small ranked list, each with a suggested title + ISO date.

import * as chrono from "chrono-node";

export type ActionSuggestion = {
  iso: string;
  /** Millisecond bucket used for dedupe. */
  key: number;
  /** Short human title, e.g. "Call John", "Email Sarah the brief". */
  title: string;
  /** Chrono match text (for debugging / display). */
  matchedText: string;
};

const ACTION_VERBS = [
  "call", "email", "text", "message", "dm", "ping",
  "meet", "meeting", "sync", "catch up", "catchup",
  "send", "share", "forward", "reply", "respond",
  "follow up", "followup", "check in", "checkin", "check on",
  "remind", "reminder",
  "submit", "review", "sign", "approve", "renew", "cancel",
  "pay", "book", "buy", "order", "pick up", "pickup", "drop off", "dropoff",
  "return", "ship", "deliver",
  "finish", "complete", "prepare", "draft", "write", "read", "watch", "attend",
  "deadline", "due",
];

const INTENT_PHRASES = [
  "don't forget", "dont forget", "do not forget",
  "make sure to", "make sure i", "make sure we",
  "need to", "have to", "gotta", "should",
  "remember to", "note to self",
  "todo", "to-do", "to do",
];

// Words we strip from the head of a title fragment.
const LEADING_STOP = new Set([
  "i", "we", "you", "they", "he", "she",
  "please", "pls", "plz",
  "should", "must", "need", "have", "has", "had", "gotta", "gonna", "will", "would", "could", "can",
  "to", "the", "a", "an", "my", "our", "your",
  "also", "just", "then",
]);

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function cleanFragment(raw: string): string {
  let s = raw
    .replace(/[\s\r\n]+/g, " ")
    .replace(/^[\s,.;:!?\-–—•*"'`(){}\[\]]+|[\s,.;:!?\-–—•*"'`(){}\[\]]+$/g, "")
    .trim();
  // Drop leading connective/stop words.
  const parts = s.split(/\s+/);
  while (parts.length > 1 && LEADING_STOP.has(parts[0].toLowerCase())) parts.shift();
  s = parts.join(" ");
  // Cap length.
  if (s.length > 60) s = s.slice(0, 57).trimEnd() + "…";
  return s;
}

/** Find an action verb / intent phrase near the chrono match and derive a title. */
function extractTitleAround(text: string, matchStart: number, matchEnd: number): string | null {
  const before = text.slice(Math.max(0, matchStart - 120), matchStart);
  const after = text.slice(matchEnd, Math.min(text.length, matchEnd + 120));
  const lowerBefore = before.toLowerCase();
  const lowerAfter = after.toLowerCase();

  // Search sentence/clause boundary window in "before" text (preferred).
  const clauseSplit = /[.!?\n;]/g;
  let clauseStart = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    if (clauseSplit.test(before[i])) { clauseStart = i + 1; break; }
  }
  const beforeClause = before.slice(clauseStart);
  const lowerBeforeClause = beforeClause.toLowerCase();

  // 1) Try intent phrase followed by verb+object.
  for (const p of INTENT_PHRASES) {
    const idx = lowerBeforeClause.lastIndexOf(p);
    if (idx >= 0) {
      const tail = beforeClause.slice(idx + p.length);
      const cleaned = cleanFragment(tail);
      if (cleaned.length >= 2) return titleCase(cleaned);
    }
  }

  // 2) Try action verb in the same clause (before the date).
  let bestVerbIdx = -1;
  let bestVerb = "";
  for (const v of ACTION_VERBS) {
    const re = new RegExp(`\\b${v.replace(/ /g, "\\s+")}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(lowerBeforeClause)) !== null) {
      if (m.index > bestVerbIdx) {
        bestVerbIdx = m.index;
        bestVerb = v;
      }
    }
  }
  if (bestVerbIdx >= 0) {
    const tail = beforeClause.slice(bestVerbIdx, bestVerbIdx + bestVerb.length + 60);
    const cleaned = cleanFragment(tail);
    if (cleaned.length >= 2) return titleCase(cleaned);
  }

  // 3) Try action verb *after* the date ("on Friday, call John").
  for (const v of ACTION_VERBS) {
    const re = new RegExp(`\\b${v.replace(/ /g, "\\s+")}\\b`, "i");
    const m = re.exec(lowerAfter);
    if (m) {
      const tail = after.slice(m.index, m.index + v.length + 60);
      const cleaned = cleanFragment(tail);
      if (cleaned.length >= 2) return titleCase(cleaned);
    }
  }

  return null;
}

export function detectActionReminders(text: string, now: Date = new Date()): ActionSuggestion[] {
  if (!text || text.trim().length === 0) return [];
  const results = chrono.parse(text, now, { forwardDate: true });
  const out: ActionSuggestion[] = [];
  const seen = new Set<number>();

  for (const r of results) {
    let d = r.start?.date();
    if (!d) continue;
    if (!r.start.isCertain("day") && !r.start.isCertain("weekday")) continue;

    let diff = d.getTime() - now.getTime();
    if (diff < 60 * 1000 && diff > -24 * 3600 * 1000) {
      d = new Date(d.getTime() + 24 * 3600 * 1000);
      diff = d.getTime() - now.getTime();
    }
    if (diff < 60 * 1000) continue;
    if (diff > 365 * 24 * 3600 * 1000) continue;

    const start = r.index ?? 0;
    const end = start + (r.text?.length ?? 0);
    const title = extractTitleAround(text, start, end);
    if (!title) continue; // action intent required

    const key = Math.floor(d.getTime() / 60000) * 60000;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      iso: new Date(key).toISOString(),
      key,
      title,
      matchedText: r.text ?? "",
    });
  }

  out.sort((a, b) => a.key - b.key);
  return out.slice(0, 5);
}

import { useEffect, useMemo, useRef, useState } from "react";
import * as chrono from "chrono-node";
import { Bell, X, Plus, Loader2 } from "lucide-react";
import { detectActionReminders } from "@/lib/reminder-detect";
import { verifyRemindersFn } from "@/lib/ai.functions";

type Props = {
  /** Concatenated scannable text (heading + body + transcript + ocr + summary). */
  text: string;
  /** Reminders already saved on the note (ISO strings) — used to filter suggestions. */
  existing: string[];
  /** True when the user previously dismissed the suggestion for this note. */
  dismissed: boolean;
  onAccept: (isoDate: string, title?: string) => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
};

type Suggestion = { key: number; iso: string; title: string };

/** Parse every distinct future date/time chrono can find. */
function parseAllFutureDates(text: string): Date[] {
  if (!text || text.trim().length === 0) return [];
  const now = new Date();
  const results = chrono.parse(text, now, { forwardDate: true });
  const seen = new Set<number>();
  const out: Date[] = [];
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
    if (diff > 10 * 365 * 24 * 3600 * 1000) continue;

    const key = Math.floor(d.getTime() / 60000) * 60000;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(new Date(key));
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out.slice(0, 8);
}

function formatChipTime(d: Date): string {
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const sameDay =
    sameYear &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();

  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  if (isTomorrow) return `Tomorrow ${time}`;
  const dateStr = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${dateStr} · ${time}`;
}

const CACHE_PREFIX = "braintape.reminderVerify.v1:";
function loadCache(key: string): Suggestion[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as Suggestion[];
  } catch { return null; }
}
function saveCache(key: string, val: Suggestion[]) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(val)); } catch {}
}

export function ReminderSuggestionChip({ text, existing, dismissed, onAccept, onDismiss }: Props) {
  const [debounced, setDebounced] = useState(text);
  const [addedLocal, setAddedLocal] = useState<Set<number>>(new Set());
  const [verified, setVerified] = useState<Suggestion[]>([]);
  const [verifying, setVerifying] = useState(false);
  const verifyReqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 200);
    return () => clearTimeout(t);
  }, [text]);


  const existingKeys = useMemo(() => {
    const s = new Set<number>();
    for (const iso of existing) {
      const t = new Date(iso).getTime();
      if (!isNaN(t)) s.add(Math.floor(t / 60000) * 60000);
    }
    return s;
  }, [existing]);

  // Local candidate detection (fast, offline).
  const localCandidates = useMemo(() => {
    if (dismissed) return [] as Array<{ iso: string; title?: string; key: number }>;
    const titled = new Map<number, string>();
    for (const a of detectActionReminders(debounced)) titled.set(a.key, a.title);
    const dates = parseAllFutureDates(debounced);
    return dates.map((d) => ({
      key: d.getTime(),
      iso: d.toISOString(),
      title: titled.get(d.getTime()),
    }));
  }, [debounced, dismissed]);

  // AI verification pass — corrects titles, drops overlaps, ensures full text.
  useEffect(() => {
    if (dismissed) { setVerified([]); setVerifying(false); return; }
    const candidates = localCandidates.filter((c) => !existingKeys.has(c.key));
    if (candidates.length === 0) { setVerified([]); setVerifying(false); return; }

    const cacheKey = JSON.stringify({
      c: candidates.map((c) => [c.iso, c.title ?? ""]),
      e: Array.from(existingKeys).sort(),
      t: debounced.slice(0, 4000),
    });
    const cached = cacheRef.current.get(cacheKey);
    if (cached) { setVerified(cached); setVerifying(false); return; }

    const reqId = ++verifyReqId.current;
    setVerifying(true);
    const timer = setTimeout(async () => {
      try {
        const res = await verifyRemindersFn({
          data: {
            text: debounced.slice(0, 12000),
            nowIso: new Date().toISOString(),
            candidates: candidates.map(({ iso, title }) => ({ iso, title })),
            existing,
          },
        });
        if (reqId !== verifyReqId.current) return;
        const items: Suggestion[] = (res?.reminders ?? [])
          .filter((r) => !existingKeys.has(Math.floor(new Date(r.iso).getTime() / 60000) * 60000))
          .map((r) => ({ key: new Date(r.iso).getTime(), iso: r.iso, title: r.title }));
        cacheRef.current.set(cacheKey, items);
        setVerified(items);
      } catch {
        if (reqId !== verifyReqId.current) return;
        // Fallback: show local candidates with best-effort titles, no truncation ellipsis.
        const fallback: Suggestion[] = candidates.map((c) => ({
          key: c.key,
          iso: c.iso,
          title: (c.title && c.title.replace(/[…]+/g, "").trim()) || "Reminder",
        }));
        setVerified(fallback);
      } finally {
        if (reqId === verifyReqId.current) setVerifying(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [localCandidates, existingKeys, existing, debounced, dismissed]);

  const suggestions = useMemo(
    () => verified.filter((s) => !addedLocal.has(s.key) && !existingKeys.has(s.key)),
    [verified, addedLocal, existingKeys],
  );

  if (dismissed) return null;
  if (!verifying && suggestions.length === 0) return null;

  const color = "var(--reminder-strong, #d97706)";
  const showLabel = !verifying && suggestions.length === 1;

  return (
    <div
      className="flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-2 pr-1 shadow-sm backdrop-blur-md"
      style={{
        borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
        background: `color-mix(in oklab, ${color} 12%, var(--background))`,
      }}
      role="group"
      aria-label="Reminder suggestions"
    >
      {verifying ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" style={{ color }} aria-hidden="true" />
      ) : (
        <Bell className="h-3 w-3 shrink-0" style={{ color }} aria-hidden="true" />
      )}
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        {verifying && suggestions.length === 0 && (
          <span className="shrink-0 px-1 text-[11px] leading-tight text-foreground">
            Verifying with AI…
          </span>
        )}
        {showLabel && (
          <span className="shrink-0 pr-0.5 text-[11px] leading-tight text-foreground">
            Remind
          </span>
        )}
        {suggestions.map((s) => {
          const d = new Date(s.iso);
          const when = formatChipTime(d);
          const label = `${s.title} · ${when}`;
          return (
            <button
              key={s.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAddedLocal((prev) => {
                  const n = new Set(prev);
                  n.add(s.key);
                  return n;
                });
                void onAccept(s.iso, s.title);
              }}
              className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold text-white active:opacity-70"
              style={{ background: color }}
              aria-label={`Set reminder ${label}`}
              title={label}
            >
              <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
        {verifying && suggestions.length > 0 && (
          <span className="shrink-0 px-1 text-[11px] leading-tight text-muted-foreground">
            Verifying…
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-black/5 active:opacity-60 dark:hover:bg-white/10"
        aria-label="Dismiss reminder suggestions"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

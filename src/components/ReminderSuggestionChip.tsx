import { useEffect, useMemo, useState } from "react";
import * as chrono from "chrono-node";
import { Bell, X, Plus } from "lucide-react";
import { detectActionReminders } from "@/lib/reminder-detect";

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

type Suggestion = { key: number; iso: string; title?: string };

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
  return out.slice(0, 6);
}

function formatChipTime(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();

  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `today ${time}`;
  if (isTomorrow) return `tomorrow ${time}`;
  const diffDays = Math.round((d.getTime() - now.getTime()) / (24 * 3600 * 1000));
  if (diffDays >= 2 && diffDays <= 6) {
    const wd = d.toLocaleDateString(undefined, { weekday: "short" });
    return `${wd} ${time}`;
  }
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

export function ReminderSuggestionChip({ text, existing, dismissed, onAccept, onDismiss }: Props) {
  const [debounced, setDebounced] = useState(text);
  const [addedLocal, setAddedLocal] = useState<Set<number>>(new Set());

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

  const suggestions: Suggestion[] = useMemo(() => {
    if (dismissed) return [];
    const titled = new Map<number, string>();
    for (const a of detectActionReminders(debounced)) titled.set(a.key, a.title);
    const dates = parseAllFutureDates(debounced);
    const merged: Suggestion[] = dates.map((d) => ({
      key: d.getTime(),
      iso: d.toISOString(),
      title: titled.get(d.getTime()),
    }));
    return merged.filter((s) => !existingKeys.has(s.key) && !addedLocal.has(s.key));
  }, [debounced, dismissed, existingKeys, addedLocal]);

  if (suggestions.length === 0) return null;

  const color = "var(--reminder-strong, #d97706)";
  const multi = suggestions.length > 1;

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
      <Bell className="h-3 w-3 shrink-0" style={{ color }} aria-hidden="true" />
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        {!multi && (
          <span className="shrink-0 pr-0.5 text-[11px] leading-tight text-foreground">
            Remind
          </span>
        )}
        {suggestions.map((s) => {
          const d = new Date(s.iso);
          const when = formatChipTime(d);
          const label = s.title ? `${s.title} · ${when}` : when;
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
              className="inline-flex h-6 max-w-[220px] shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold text-white active:opacity-70"
              style={{ background: color }}
              aria-label={`Set reminder ${label}`}
              title={label}
            >
              <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
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

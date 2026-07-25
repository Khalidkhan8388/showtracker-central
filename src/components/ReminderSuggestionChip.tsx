import { useEffect, useMemo, useState } from "react";
import * as chrono from "chrono-node";
import { Bell, X, Check } from "lucide-react";

type Props = {
  /** Concatenated scannable text (heading + body + transcript + ocr + summary). */
  text: string;
  /** True when the note already has a reminder set. */
  hasReminder: boolean;
  /** True when the user previously dismissed the suggestion for this note. */
  dismissed: boolean;
  onAccept: (isoDate: string) => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
};

function parseFirstFutureDate(text: string): Date | null {
  if (!text || text.trim().length === 0) return null;
  const now = new Date();
  const results = chrono.parse(text, now, { forwardDate: true });
  for (const r of results) {
    let d = r.start?.date();
    if (!d) continue;

    // Ignore bare-year matches like "2024" (no month/day/weekday).
    if (!r.start.isCertain("day") && !r.start.isCertain("weekday")) continue;

    // If chrono resolved to a past time today (e.g. "midnight", "9pm" after 9pm),
    // roll forward one day so the suggestion still makes sense.
    let diff = d.getTime() - now.getTime();
    if (diff < 60 * 1000 && diff > -24 * 3600 * 1000) {
      d = new Date(d.getTime() + 24 * 3600 * 1000);
      diff = d.getTime() - now.getTime();
    }

    if (diff < 60 * 1000) continue;
    if (diff > 365 * 24 * 3600 * 1000) continue;

    return d;
  }
  return null;
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
  if (sameDay) return `today at ${time}`;
  if (isTomorrow) return `tomorrow at ${time}`;
  const diffDays = Math.round((d.getTime() - now.getTime()) / (24 * 3600 * 1000));
  if (diffDays >= 2 && diffDays <= 6) {
    const wd = d.toLocaleDateString(undefined, { weekday: "long" });
    return `${wd} at ${time}`;
  }
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${time}`;
}

export function ReminderSuggestionChip({ text, hasReminder, dismissed, onAccept, onDismiss }: Props) {
  const [debounced, setDebounced] = useState(text);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 800);
    return () => clearTimeout(t);
  }, [text]);

  const parsed = useMemo(
    () => (hasReminder || dismissed ? null : parseFirstFutureDate(debounced)),
    [debounced, hasReminder, dismissed],
  );

  if (!parsed) return null;

  const label = formatChipTime(parsed);

  return (
    <div
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 shadow-sm backdrop-blur-md"
      style={{
        borderColor: "color-mix(in oklab, var(--reminder-strong, #d97706) 35%, transparent)",
        background: "color-mix(in oklab, var(--reminder-strong, #d97706) 12%, var(--background))",
      }}
      role="group"
      aria-label="Reminder suggestion"
    >
      <Bell className="h-3 w-3 shrink-0" style={{ color: "var(--reminder-strong, #d97706)" }} />
      <p className="min-w-0 flex-1 truncate text-[11px] leading-tight text-foreground">
        Remind <span className="font-semibold">{label}</span>?
      </p>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onAccept(parsed.toISOString()); }}
        className="inline-flex h-6 items-center gap-0.5 rounded-full px-2 text-[11px] font-semibold text-white active:opacity-70"
        style={{ background: "var(--reminder-strong, #d97706)" }}
        aria-label="Accept reminder suggestion"
      >
        <Check className="h-3 w-3" /> Set
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-black/5 active:opacity-60 dark:hover:bg-white/10"
        aria-label="Dismiss reminder suggestion"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

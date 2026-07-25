import { useEffect, useMemo, useState } from "react";
import { Pin, X, Plus } from "lucide-react";
import { detectActionReminders, type ActionSuggestion } from "@/lib/reminder-detect";

type Props = {
  text: string;
  /** ISO strings already saved on this note. */
  existing: string[];
  /** Once true, banner never shows again for this note. */
  dismissed: boolean;
  onAccept: (iso: string, title: string) => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
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

export function ActionReminderBanner({ text, existing, dismissed, onAccept, onDismiss }: Props) {
  const [debounced, setDebounced] = useState(text);
  const [addedLocal, setAddedLocal] = useState<Set<number>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 800);
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

  const suggestions: ActionSuggestion[] = useMemo(() => {
    if (dismissed) return [];
    return detectActionReminders(debounced).filter(
      (s) => !existingKeys.has(s.key) && !addedLocal.has(s.key),
    );
  }, [debounced, dismissed, existingKeys, addedLocal]);

  if (suggestions.length === 0) return null;
  const color = "var(--reminder-strong, #d97706)";

  return (
    <div
      className="mb-4 rounded-2xl border p-3 shadow-sm"
      style={{
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
        background: `color-mix(in oklab, ${color} 10%, var(--background))`,
      }}
      role="group"
      aria-label="Suggested reminders"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Pin className="h-3.5 w-3.5 shrink-0" style={{ color }} aria-hidden="true" />
          <span
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color }}
          >
            {suggestions.length > 1 ? "Suggested reminders" : "Suggested reminder"}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-black/5 active:opacity-60 dark:hover:bg-white/10"
          aria-label="Dismiss suggestions"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="space-y-1.5">
        {suggestions.map((s) => (
          <li
            key={s.key}
            className="flex items-center justify-between gap-2 rounded-xl bg-background/70 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-foreground">
                {s.title}
              </div>
              <div
                className="mt-0.5 truncate text-[11px] font-medium"
                style={{ color }}
              >
                {formatWhen(s.iso)}
              </div>
            </div>
            <button
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
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-semibold text-white active:opacity-70"
              style={{ background: color }}
              aria-label={`Set reminder for ${s.title}`}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Set
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

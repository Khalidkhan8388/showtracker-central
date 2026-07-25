import { useMemo, useState } from "react";
import { Bell, X, Plus } from "lucide-react";

export type ReminderSuggestion = { iso: string; title: string };

type Props = {
  /** AI-verified suggestions for this note (already de-duped vs existing). */
  suggestions: ReminderSuggestion[];
  dismissed: boolean;
  onAccept: (iso: string, title: string) => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
};

function formatFullWhen(d: Date): string {
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function ReminderSuggestionChip({ suggestions, dismissed, onAccept, onDismiss }: Props) {
  const [addedLocal, setAddedLocal] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => suggestions.filter((s) => !addedLocal.has(s.iso)),
    [suggestions, addedLocal],
  );

  if (dismissed || visible.length === 0) return null;

  const color = "var(--reminder-strong, #d97706)";

  return (
    <div
      className="flex max-w-full items-center gap-1.5 rounded-2xl border py-1.5 pl-2.5 pr-1.5 shadow-sm backdrop-blur-md"
      style={{
        borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
        background: `color-mix(in oklab, ${color} 12%, var(--background))`,
      }}
      role="group"
      aria-label="Reminder suggestions"
    >
      <Bell className="h-3.5 w-3.5 shrink-0" style={{ color }} aria-hidden="true" />
      <div
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        {visible.map((s) => {
          const d = new Date(s.iso);
          const when = formatFullWhen(d);
          const label = `${s.title} · ${when}`;
          return (
            <button
              key={s.iso}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAddedLocal((prev) => {
                  const n = new Set(prev);
                  n.add(s.iso);
                  return n;
                });
                void onAccept(s.iso, s.title);
              }}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold text-white active:opacity-70"
              style={{ background: color }}
              aria-label={`Set reminder ${label}`}
              title={label}
            >
              <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="whitespace-nowrap">{label}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-black/5 active:opacity-60 dark:hover:bg-white/10"
        aria-label="Dismiss reminder suggestions"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

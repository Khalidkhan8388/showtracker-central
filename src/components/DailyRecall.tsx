import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLocalNotes } from "@/hooks/use-local-notes";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Daily recall — one resurfaced older memory per day, shown in the
 * reminders slot above tasks so the section is never empty.
 */
export function DailyRecall() {
  const notes = useLocalNotes();
  const navigate = useNavigate();
  const key = todayKey();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("daily-recall-dismissed") === key;
  });

  const pick = useMemo(() => {
    const all = (notes ?? []).filter(
      (n) => !n.deleted_at && n.heading !== "__custom__",
    );
    if (all.length === 0) return null;
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const older = all.filter((n) => new Date(n.created_at).getTime() < cutoff);
    const pool = older.length > 0 ? older : all;
    // Stable per-day pick.
    const seed = Math.floor(Date.now() / 86_400_000);
    return pool[seed % pool.length];
  }, [notes]);

  if (dismissed || !pick) return null;

  return (
    <section aria-label="Daily recall" className="flex flex-col gap-2">
      <div className="inline-flex items-center gap-1.5">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full"
          style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
        >
          <Sparkles className="h-2.5 w-2.5" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Daily recall
        </span>
      </div>

      <div
        className="flex items-center gap-3 overflow-hidden rounded-[20px] bg-card px-3 py-2.5 ring-1 ring-border/60 active:bg-muted"
        style={{ borderLeft: "3px solid var(--reminder)" }}
      >
        <button
          type="button"
          onClick={() => navigate({ to: "/notes/$id", params: { id: pick.id } })}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight text-foreground">
              {pick.heading || "Untitled memory"}
            </p>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {pick.summary || `Saved ${formatDistanceToNow(new Date(pick.created_at), { addSuffix: true })}`}
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem("daily-recall-dismissed", key);
            setDismissed(true);
          }}
          aria-label="Dismiss daily recall"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-95"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}

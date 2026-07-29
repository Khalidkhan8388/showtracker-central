import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Check, Film, Sparkles, Tv, X } from "lucide-react";
import { format, formatDistanceToNow, isToday, isTomorrow } from "date-fns";
import { useReminders, dismissEpisodeReminder, markEpisodeWatchedAndClear, markMovieWatched, setNoteReminder } from "@/lib/reminders";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { haptic } from "@/lib/haptics";

function whenLabel(iso: string, overdue: boolean) {
  const d = new Date(iso);
  if (overdue) return formatDistanceToNow(d, { addSuffix: true });
  if (isToday(d)) return `Today · ${format(d, "h:mm a")}`;
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "MMM d");
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Now lane — a horizontal row of urgent cards that sits above Tasks.
 * Shows reminders first, falls back to daily recall, then a calm "caught up" state.
 */
export function NowLane() {
  const reminders = useReminders();
  const notes = useLocalNotes();
  const navigate = useNavigate();
  const [dismissedRecall, setDismissedRecall] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("daily-recall-dismissed") === todayKey();
  });

  const recall = useMemo(() => {
    const all = (notes ?? []).filter((n) => !n.deleted_at && n.heading !== "__custom__");
    if (all.length === 0) return null;
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const older = all.filter((n) => new Date(n.created_at).getTime() < cutoff);
    const pool = older.length > 0 ? older : all;
    const seed = Math.floor(Date.now() / 86_400_000);
    return pool[seed % pool.length];
  }, [notes]);

  const visibleReminders = reminders.slice(0, 3);
  const hasReminders = visibleReminders.length > 0;
  const showRecall = !hasReminders && !dismissedRecall && recall;
  const showCaughtUp = !hasReminders && !showRecall;

  return (
    <section aria-label="Now" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Now
        </span>
        {hasReminders && (
          <span className="text-[11px] text-muted-foreground">
            {reminders.length} {reminders.length === 1 ? "reminder" : "reminders"}
          </span>
        )}
      </div>

      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {hasReminders ? (
          visibleReminders.map((r, i) => (
            <ReminderCard
              key={r.id}
              r={r}
              first={i === 0}
              onOpen={() => {
                void haptic.tap();
                navigate({ to: "/notes/$id", params: { id: r.noteId } });
              }}
            />
          ))
        ) : showRecall ? (
          <RecallCard
            recall={recall}
            onOpen={() => {
              void haptic.tap();
              navigate({ to: "/notes/$id", params: { id: recall.id } });
            }}
            onDismiss={() => {
              void haptic.tap();
              localStorage.setItem("daily-recall-dismissed", todayKey());
              setDismissedRecall(true);
            }}
          />
        ) : showCaughtUp ? (
          <CaughtUpCard />
        ) : null}
      </div>
    </section>
  );
}

function ReminderCard({ r, first, onOpen }: { r: ReturnType<typeof useReminders>[number]; first: boolean; onOpen: () => void }) {
  const isMedia = r.kind === "episode" || r.kind === "movie";
  const title = r.kind === "episode" ? r.seriesTitle : r.title;
  const Icon = r.kind === "episode" ? Tv : r.kind === "movie" ? Film : Bell;
  const subtitle =
    r.kind === "episode"
      ? `S${r.season}·E${r.episode} · ${r.epName}`
      : r.kind === "movie"
        ? r.overdue
          ? "Out now"
          : "Releasing soon"
        : r.summary || (r.taskCount > 0 ? `${r.taskCount} task${r.taskCount === 1 ? "" : "s"}` : "Note");

  return (
    <div
      className={`relative flex w-44 shrink-0 snap-start flex-col overflow-hidden rounded-[20px] bg-card p-3 ring-1 ring-border/60 transition-transform active:scale-[0.97] ${
        first ? "border-l-[3px] border-[var(--reminder)]" : ""
      }`}
      style={first ? undefined : { borderLeft: "3px solid transparent" }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-full"
          style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
        >
          <Icon className="h-3 w-3" />
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={
            r.overdue
              ? { background: "var(--reminder)", color: "var(--reminder-foreground)" }
              : { background: "var(--muted)", color: "var(--muted-foreground)" }
          }
        >
          {whenLabel(r.when, r.overdue)}
        </span>
      </div>

      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <p className="line-clamp-2 text-[14px] font-semibold leading-tight text-foreground">{title}</p>
        <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{subtitle}</p>
      </button>

      <div className="mt-2 flex items-center gap-2">
        {isMedia ? (
          <button
            type="button"
            onClick={async () => {
              void haptic.success();
              if (r.kind === "episode") await markEpisodeWatchedAndClear(r.noteId, r.season, r.episode);
              else if (r.kind === "movie") await markMovieWatched(r.noteId);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full active:scale-90"
            style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
            aria-label="Mark watched"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={async () => {
            void haptic.tap();
            if (r.kind === "note") await setNoteReminder(r.noteId, null);
            else {
              const key = r.kind === "episode" ? `${r.when}:${r.epKey}` : `release:${r.when}`;
              await dismissEpisodeReminder(r.noteId, key);
            }
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90"
          aria-label="Dismiss reminder"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function RecallCard({ recall, onOpen, onDismiss }: { recall: NonNullable<ReturnType<typeof useLocalNotes>>[number]; onOpen: () => void; onDismiss: () => void }) {
  return (
    <div className="relative flex w-44 shrink-0 snap-start flex-col overflow-hidden rounded-[20px] bg-card p-3 ring-1 ring-border/60 transition-transform active:scale-[0.97]" style={{ borderLeft: "3px solid var(--reminder)" }}>
      <div className="mb-2 flex items-center justify-between">
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-full"
          style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
        >
          <Sparkles className="h-3 w-3" />
        </span>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
          Daily recall
        </span>
      </div>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <p className="line-clamp-2 text-[14px] font-semibold leading-tight text-foreground">
          {recall.heading || "Untitled memory"}
        </p>
        <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
          {recall.summary || `Saved ${formatDistanceToNow(new Date(recall.created_at), { addSuffix: true })}`}
        </p>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-90"
        aria-label="Dismiss daily recall"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function CaughtUpCard() {
  return (
    <div className="flex w-44 shrink-0 snap-start items-center gap-3 rounded-[20px] bg-card p-3 ring-1 ring-border/60">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Check className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold leading-tight text-foreground">All caught up</p>
        <p className="text-[12px] text-muted-foreground">Nothing needs you right now.</p>
      </div>
    </div>
  );
}

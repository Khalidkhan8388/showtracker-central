import { useNavigate } from "@tanstack/react-router";
import { Bell, Check, X, Tv, Film } from "lucide-react";
import { format, formatDistanceToNow, isToday, isTomorrow } from "date-fns";
import {
  useReminders,
  dismissEpisodeReminder,
  markEpisodeWatchedAndClear,
  markMovieWatched,
  setNoteReminder,
  type Reminder,
} from "@/lib/reminders";

function whenLabel(iso: string, overdue: boolean) {
  const d = new Date(iso);
  if (overdue) return formatDistanceToNow(d, { addSuffix: true });
  if (isToday(d)) return `Today · ${format(d, "h:mm a")}`;
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "MMM d");
}

/**
 * Reminders — compact feed-style list that sits inline above tasks.
 * No hero/carousel: each reminder is a single row in one grouped card.
 */
export function ReminderHero() {
  const reminders = useReminders();
  if (!reminders || reminders.length === 0) return null;

  return (
    <section aria-label="Reminders" className="flex flex-col gap-2">
      <div className="inline-flex items-center gap-1.5">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full"
          style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
        >
          <Bell className="h-2.5 w-2.5" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Reminders · {reminders.length}
        </span>
      </div>

      <ul
        className="overflow-hidden rounded-[20px] bg-card ring-1 ring-border/60"
        style={{ borderLeft: "3px solid var(--reminder)" }}
      >
        {reminders.map((r, i) => (
          <li key={r.id}>
            {i > 0 && <div className="ml-4 h-px bg-border" />}
            <ReminderRow r={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReminderRow({ r }: { r: Reminder }) {
  const navigate = useNavigate();
  const open = () => navigate({ to: "/notes/$id", params: { id: r.noteId } });

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
    <div className="flex items-center gap-3 px-3 py-2.5 active:bg-muted">
      <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {isMedia && (r as any).posterUrl ? (
          <img
            src={(r as any).posterUrl}
            alt=""
            loading="lazy"
            className="h-12 w-9 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight text-foreground">{title}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{subtitle}</p>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={
            r.overdue
              ? { background: "var(--reminder)", color: "var(--reminder-foreground)" }
              : { background: "var(--muted)", color: "var(--muted-foreground)" }
          }
        >
          {whenLabel(r.when, r.overdue)}
        </span>
      </button>

      {isMedia ? (
        <button
          type="button"
          onClick={async () => {
            if (r.kind === "episode") await markEpisodeWatchedAndClear(r.noteId, r.season, r.episode);
            else if (r.kind === "movie") await markMovieWatched(r.noteId);
          }}
          aria-label="Mark watched"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full active:scale-95"
          style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={async () => {
          if (r.kind === "note") await setNoteReminder(r.noteId, null);
          else {
            const key = r.kind === "episode" ? `${r.when}:${r.epKey}` : `release:${r.when}`;
            await dismissEpisodeReminder(r.noteId, key);
          }
        }}
        aria-label="Dismiss reminder"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-95"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

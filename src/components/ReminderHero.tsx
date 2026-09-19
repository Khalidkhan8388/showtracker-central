import { useNavigate } from "@tanstack/react-router";
import { Bell, Check, X, Tv, Film, Clock, Calendar } from "lucide-react";
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
 * ReminderHero — matches the height of the hero note card (16:9).
 * Single reminder = one full-width 16:9 tile.
 * Multiple = horizontal snap carousel of 16:9 tiles.
 */
export function ReminderHero() {
  const reminders = useReminders();
  if (!reminders || reminders.length === 0) return null;
  const single = reminders.length === 1;

  return (
    <section aria-label="Reminders" className="-mx-4">
      <div className="mb-2 flex items-center justify-between px-4">
        <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full"
            style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
          >
            <Bell className="h-3 w-3" />
          </span>
          Reminders
          <span className="text-muted-foreground/70">· {reminders.length}</span>
        </div>
      </div>

      {single ? (
        <div className="px-4">
          <ReminderTile r={reminders[0]} />
        </div>
      ) : (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
          {reminders.map((r) => (
            <div key={r.id} className="w-[88%] shrink-0 snap-start">
              <ReminderTile r={r} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusChip({ overdue, label }: { overdue: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-sm"
      style={{
        background: overdue ? "var(--reminder)" : "rgba(255,255,255,0.92)",
        color: overdue ? "var(--reminder-foreground)" : "#111",
      }}
    >
      {label}
    </span>
  );
}

function ReminderTile({ r }: { r: Reminder }) {
  const navigate = useNavigate();

  if (r.kind === "episode" || r.kind === "movie") {
    const posterUrl = r.posterUrl;
    const title = r.kind === "episode" ? r.seriesTitle : r.title;
    const Icon = r.kind === "episode" ? Tv : Film;
    return (
      <div
        className="relative aspect-[16/9] w-full overflow-hidden rounded-[22px] bg-neutral-900 shadow-sm"
        style={{ boxShadow: "0 0 0 1.5px var(--reminder), 0 6px 18px -8px rgba(0,0,0,0.35)" }}
      >
        {/* Blurred backdrop */}
        {posterUrl && (
          <img
            src={posterUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl opacity-60"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-black/70" />

        <button
          type="button"
          onClick={() => navigate({ to: "/notes/$id", params: { id: r.noteId } })}
          aria-label={`Open ${title}`}
          className="absolute inset-0"
        />

        {/* Content grid: poster + text */}
        <div className="relative z-[1] flex h-full items-stretch gap-3 p-3">
          {posterUrl ? (
            <div className="relative h-full aspect-[2/3] shrink-0 overflow-hidden rounded-xl bg-neutral-800 ring-1 ring-white/10">
              <img src={posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            </div>
          ) : (
            <div className="flex h-full aspect-[2/3] shrink-0 items-center justify-center rounded-xl bg-white/10">
              <Icon className="h-6 w-6 text-white/70" />
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col justify-between text-white">
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center gap-1.5">
                <StatusChip
                  overdue={r.overdue}
                  label={r.overdue ? (r.kind === "episode" ? "Aired" : "Out now") : "Soon"}
                />
                <span className="inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
                  <Calendar className="h-2.5 w-2.5" />
                  {whenLabel(r.when, r.overdue)}
                </span>
              </div>
              <p className="line-clamp-1 text-[16px] font-semibold leading-tight">{title}</p>
              {r.kind === "episode" ? (
                <p className="mt-0.5 line-clamp-2 text-[12px] text-white/80">
                  <span className="font-semibold text-white/95">S{r.season}·E{r.episode}</span> {r.epName}
                </p>
              ) : (
                <p className="mt-0.5 text-[12px] text-white/80">Released</p>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (r.kind === "episode") {
                    await markEpisodeWatchedAndClear(r.noteId, r.season, r.episode);
                  } else {
                    await markMovieWatched(r.noteId);
                  }
                }}
                className="relative z-10 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold shadow-sm active:scale-95"
                style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
              >
                <Check className="h-3.5 w-3.5" />
                Watched
              </button>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  const key = r.kind === "episode" ? `${r.when}:${r.epKey}` : `release:${r.when}`;
                  await dismissEpisodeReminder(r.noteId, key);
                }}
                aria-label="Hide"
                className="relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Note reminder — yellow card
  return (
    <div
      className="relative aspect-[16/9] w-full overflow-hidden rounded-[22px] shadow-sm"
      style={{
        background:
          "linear-gradient(135deg, var(--reminder) 0%, var(--reminder-strong) 100%)",
        color: "var(--reminder-foreground)",
      }}
    >
      <button
        type="button"
        onClick={() => navigate({ to: "/notes/$id", params: { id: r.noteId } })}
        aria-label={`Open ${r.title}`}
        className="absolute inset-0"
      />
      <div className="relative z-[1] flex h-full flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/15">
              <Bell className="h-3 w-3" />
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-black/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              {r.overdue ? "Due" : "Reminder"}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-black/15 px-2 py-0.5 text-[10px] font-medium">
            <Clock className="h-2.5 w-2.5" />
            {whenLabel(r.when, r.overdue)}
          </span>
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-[17px] font-semibold leading-tight">{r.title}</p>
          {r.summary && (
            <p className="mt-1 line-clamp-2 text-[12px] opacity-70">{r.summary}</p>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold opacity-70">
            {r.taskCount > 0 ? `${r.taskCount} task${r.taskCount === 1 ? "" : "s"}` : "Note"}
          </span>
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              await setNoteReminder(r.noteId, null);
            }}
            aria-label="Dismiss reminder"
            className="relative z-10 inline-flex h-7 items-center gap-1 rounded-full bg-black/15 px-3 text-[11px] font-semibold active:scale-95"
          >
            <X className="h-3 w-3" />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

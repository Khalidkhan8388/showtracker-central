import { useNavigate } from "@tanstack/react-router";
import { Bell, Check, X, Tv, Film, StickyNote } from "lucide-react";
import { formatDistanceToNow, format, isToday, isTomorrow } from "date-fns";
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
  if (overdue) return `${formatDistanceToNow(d, { addSuffix: true })}`;
  if (isToday(d)) return `Today · ${format(d, "h:mm a")}`;
  if (isTomorrow(d)) return `Tomorrow`;
  return format(d, "MMM d");
}

export function ReminderHero() {
  const reminders = useReminders();
  if (!reminders || reminders.length === 0) return null;
  const single = reminders.length === 1;

  return (
    <section className="-mx-4 mb-2" aria-label="Reminders">
      <div className="mb-2 flex items-center justify-between px-4">
        <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Bell className="h-3.5 w-3.5" style={{ color: "var(--reminder-strong)" }} />
          Reminders
          <span className="text-muted-foreground font-normal">· {reminders.length}</span>
        </div>
      </div>
      {single ? (
        <div className="px-4">
          <ReminderTile r={reminders[0]} full />
        </div>
      ) : (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 no-scrollbar">
          {reminders.map((r) => (
            <div key={r.id} className="w-[78%] shrink-0 snap-start">
              <ReminderTile r={r} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReminderTile({ r, full }: { r: Reminder; full?: boolean }) {
  const navigate = useNavigate();
  const aspect = full ? "aspect-[16/9]" : "aspect-square";

  if (r.kind === "episode" || r.kind === "movie") {
    const posterUrl = r.posterUrl;
    const title = r.kind === "episode" ? r.seriesTitle : r.title;
    return (
      <div
        className={`relative w-full overflow-hidden rounded-[22px] bg-neutral-900 ${aspect} shadow-sm ring-1`}
        style={{ borderColor: "var(--reminder)", boxShadow: "0 0 0 2px var(--reminder)" }}
      >
        {posterUrl && (
          <img
            src={posterUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/10" />
        <button
          type="button"
          onClick={() => navigate({ to: "/notes/$id", params: { id: r.noteId } })}
          aria-label={`Open ${title}`}
          className="absolute inset-0"
        />
        <div className="absolute left-0 right-0 top-0 flex items-start justify-between p-3">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
          >
            {r.kind === "episode" ? <Tv className="h-3 w-3" /> : <Film className="h-3 w-3" />}
            {r.overdue ? (r.kind === "episode" ? "Aired" : "Released") : "Soon"}
          </span>
          <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white">
            {whenLabel(r.when, r.overdue)}
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-3">
          <p className="line-clamp-1 text-[15px] font-semibold text-white">{title}</p>
          {r.kind === "episode" && (
            <p className="line-clamp-1 text-[12px] text-white/85">
              S{r.season}E{r.episode} · {r.epName}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
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
                const key =
                  r.kind === "episode" ? `${r.when}:${r.epKey}` : `release:${r.when}`;
                await dismissEpisodeReminder(r.noteId, key);
              }}
              className="relative z-10 inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur active:scale-95"
            >
              <X className="h-3.5 w-3.5" />
              Hide
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Note reminder — simple yellow card
  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/notes/$id", params: { id: r.noteId } })}
      className={`relative flex w-full flex-col justify-between overflow-hidden rounded-[22px] p-4 text-left ${aspect} active:scale-[0.99]`}
      style={{ background: "var(--reminder)", color: "var(--reminder-foreground)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: "var(--reminder-foreground)" }}
        >
          <StickyNote className="h-3 w-3" />
          {r.overdue ? "Due" : "Reminder"}
        </span>
        <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-medium">
          {whenLabel(r.when, r.overdue)}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={async (e) => {
            e.stopPropagation();
            await setNoteReminder(r.noteId, null);
          }}
          className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/10 active:scale-90"
          aria-label="Dismiss reminder"
        >
          <X className="h-3 w-3" />
        </span>
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-[16px] font-semibold leading-tight">{r.title}</p>
        {r.summary && (
          <p className="mt-1 line-clamp-2 text-[12px] opacity-75">{r.summary}</p>
        )}
        {r.taskCount > 0 && (
          <p className="mt-1 text-[11px] font-semibold opacity-75">
            {r.taskCount} task{r.taskCount === 1 ? "" : "s"}
          </p>
        )}
      </div>
    </button>
  );
}

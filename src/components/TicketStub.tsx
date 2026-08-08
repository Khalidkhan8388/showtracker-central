import { Link } from "@tanstack/react-router";
import { format, isToday, isYesterday } from "date-fns";
import { Clapperboard, Tv } from "lucide-react";
import { poster as tmdbPoster } from "@/lib/media";
import type { WatchLogEntry } from "@/lib/local-db";
import { formatRuntime, ticketNumber } from "@/lib/watch-history";
import { haptic } from "@/lib/haptics";

function stamp(at: string) {
  const d = new Date(at);
  if (isToday(d)) return `Today · ${format(d, "h:mm a")}`;
  if (isYesterday(d)) return `Yesterday · ${format(d, "h:mm a")}`;
  return format(d, "d MMM yyyy");
}

/**
 * A minimal cinema-stub: poster panel, perforated tear line, details panel.
 * No branding — just what you watched and when.
 */
export function TicketStub({ entry, className = "" }: { entry: WatchLogEntry; className?: string }) {
  const art = tmdbPoster(entry.poster_path, "w342");
  const isEp = entry.type === "tv" && entry.season != null;
  const sub = isEp
    ? `S${entry.season} · E${entry.episode}${entry.episode_title ? ` — ${entry.episode_title}` : ""}`
    : [entry.year, formatRuntime(entry.runtime)].filter(Boolean).join(" · ");

  return (
    <Link
      to="/notes/$id"
      params={{ id: entry.note_id }}
      onClick={() => void haptic.tap()}
      className={`group relative flex overflow-hidden rounded-2xl bg-card ring-1 ring-border/60 press-bounce active:opacity-80 ${className}`}
    >
      {/* Poster panel */}
      <div className="relative w-[76px] shrink-0 overflow-hidden bg-muted">
        {art ? (
          <img
            src={art}
            alt={`${entry.title} poster`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            {entry.type === "tv" ? <Tv className="h-4 w-4" /> : <Clapperboard className="h-4 w-4" />}
          </div>
        )}
      </div>

      {/* Perforation */}
      <div className="relative w-px shrink-0 bg-transparent">
        <div className="absolute inset-y-2 left-0 w-px border-l border-dashed border-border" />
        <div className="absolute -top-1.5 -left-1.5 h-3 w-3 rounded-full bg-background" />
        <div className="absolute -bottom-1.5 -left-1.5 h-3 w-3 rounded-full bg-background" />
      </div>

      {/* Detail panel */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold leading-tight text-foreground">{entry.title}</p>
          {sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {stamp(entry.at)}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
            №{ticketNumber(entry)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Horizontal strip of the most recent stubs. */
export function WatchHistoryStrip({ entries }: { entries: WatchLogEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-2.5 pb-1">
        {entries.map((e) => (
          <TicketStub key={e.id} entry={e} className="h-[86px] w-[248px] shrink-0" />
        ))}
      </div>
    </div>
  );
}

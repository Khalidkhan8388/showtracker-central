import { Link } from "@tanstack/react-router";
import { format, isToday, isYesterday } from "date-fns";
import { Clapperboard, Tv, X, ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

function fullStamp(at: string) {
  const d = new Date(at);
  return format(d, "EEEE, d MMMM yyyy 'at' h:mm a");
}

/**
 * A minimal cinema-stub: poster panel, perforated tear line, details panel.
 * No branding — just what you watched and when.
 */
export function TicketStub({
  entry,
  className = "",
  onClick,
}: {
  entry: WatchLogEntry;
  className?: string;
  onClick?: () => void;
}) {
  const art = tmdbPoster(entry.poster_path, "w342");
  const isEp = entry.type === "tv" && entry.season != null;
  const sub = isEp
    ? `S${entry.season} · E${entry.episode}${entry.episode_title ? ` — ${entry.episode_title}` : ""}`
    : [entry.year, formatRuntime(entry.runtime)].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={() => {
        void haptic.tap();
        onClick?.();
      }}
      aria-label={`Open watch ticket for ${entry.title}`}
      className={`group relative flex overflow-hidden rounded-2xl bg-card ring-1 ring-border/60 press-bounce active:opacity-80 text-left ${className}`}
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
    </button>
  );
}

/** Full-size ticket modal with full date, title/episode, and ticket number. */
function TicketStubModal({ entry, onClose }: { entry: WatchLogEntry; onClose: () => void }) {
  const art = tmdbPoster(entry.poster_path, "w500");
  const isEp = entry.type === "tv" && entry.season != null;
  const sub = isEp
    ? `Season ${entry.season}, Episode ${entry.episode}${entry.episode_title ? ` — ${entry.episode_title}` : ""}`
    : [entry.year, formatRuntime(entry.runtime)].filter(Boolean).join(" · ");

  const [visible, setVisible] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = prev;
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const close = () => {
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 160);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Watch ticket for ${entry.title}`}
      className="fixed inset-0 z-[200] flex items-center justify-center px-6"
      style={{
        background: "color-mix(in oklab, var(--color-background) 50%, transparent)",
        backdropFilter: "blur(16px) saturate(150%)",
        opacity: visible ? 1 : 0,
        transition: "opacity 180ms ease-out",
      }}
      onClick={() => close()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[340px] overflow-hidden rounded-[28px] bg-card ring-1 ring-border/60 shadow-2xl"
        style={{
          transform: visible ? "scale(1) translateY(0)" : "scale(0.92) translateY(12px)",
          opacity: visible ? 1 : 0,
          transition: visible
            ? "transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 180ms ease-out"
            : "transform 160ms ease-in, opacity 160ms ease-in",
        }}
      >
        {/* Poster hero */}
        <div className="relative h-[220px] w-full overflow-hidden bg-muted">
          {art ? (
            <img src={art} alt={`${entry.title} poster`} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              {entry.type === "tv" ? <Tv className="h-10 w-10" /> : <Clapperboard className="h-10 w-10" />}
            </div>
          )}
          <button
            type="button"
            onClick={() => close()}
            className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md press-bounce"
            aria-label="Close ticket"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Perforation */}
        <div className="relative h-3 w-full bg-card">
          <div className="absolute inset-x-5 top-1/2 h-px border-t border-dashed border-border" />
          <div className="absolute -top-3 -left-3 h-6 w-6 rounded-full bg-background" />
          <div className="absolute -top-3 -right-3 h-6 w-6 rounded-full bg-background" />
        </div>

        {/* Body */}
        <div className="space-y-4 bg-card p-5 pt-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {entry.type === "tv" ? <Tv className="h-3.5 w-3.5" /> : <Clapperboard className="h-3.5 w-3.5" />}
              <span>{entry.type === "tv" ? "TV Show" : "Movie"}</span>
            </div>
            <h3 className="mt-1.5 text-[21px] font-semibold leading-[1.15] tracking-tight text-foreground">
              {entry.title}
            </h3>
            {sub && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{sub}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[18px] bg-background p-3 ring-1 ring-border/60">
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Watched</p>
              <p className="mt-1 text-[12px] font-medium leading-snug text-foreground">{fullStamp(entry.at)}</p>
            </div>
            <div className="rounded-[18px] bg-background p-3 ring-1 ring-border/60">
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Ticket No.</p>
              <p className="mt-1 text-[12px] font-medium leading-snug text-foreground font-mono">№{ticketNumber(entry)}</p>
            </div>
          </div>

          <Link
            to="/notes/$id"
            params={{ id: entry.note_id }}
            onClick={() => void haptic.tap()}
            className="flex w-full items-center justify-center gap-2 rounded-[18px] bg-foreground py-3.5 text-[15px] font-medium text-background press-bounce"
          >
            Open note
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Horizontal strip of the most recent stubs. Tapping a stub opens its full ticket. */
export function WatchHistoryStrip({ entries }: { entries: WatchLogEntry[] }) {
  const [selected, setSelected] = useState<WatchLogEntry | null>(null);
  if (!entries.length) return null;
  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-2.5 pb-1">
          {entries.map((e) => (
            <TicketStub key={e.id} entry={e} className="h-[86px] w-[248px] shrink-0" onClick={() => setSelected(e)} />
          ))}
        </div>
      </div>
      {selected && <TicketStubModal entry={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

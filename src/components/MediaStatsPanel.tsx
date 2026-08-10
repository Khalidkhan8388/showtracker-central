import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Check, Clock, Film, Tv } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import {
  poster as tmdbPoster,
  still as tmdbStill,
  totalEpisodes as mediaTotal,
  watchedCount as mediaDone,
  epKey,
  toggleEpisodeWatched,
} from "@/lib/media";
import { fetchTmdbLogoFn } from "@/lib/tmdb.functions";
import { WatchHistorySection } from "@/components/WatchHistorySection";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { LocalMedia, LocalMediaEpisode } from "@/lib/local-db";

export type StatsMember = { id: string; heading: string | null; media?: LocalMedia | null };

type TvMember = { id: string; heading: string | null; media: LocalMedia };
type EpisodeRow = {
  note: TvMember;
  ep: LocalMediaEpisode;
  airMs: number | null;
  watched: boolean;
};

export function EpisodeTracker({ members }: { members: Array<{ id: string; heading: string | null; media?: LocalMedia | null }> }) {
  const now = Date.now();
  const tvShows: TvMember[] = useMemo(
    () =>
      members
        .filter((n) => n.media?.type === "tv")
        .filter((n) => {
          const s = n.media?.watch_status;
          return s !== "dropped" && s !== "watchlist";
        })
        .map((n) => ({ id: n.id, heading: n.heading, media: n.media as LocalMedia })),
    [members],
  );

  const allEps: EpisodeRow[] = useMemo(() => {
    const rows: EpisodeRow[] = [];
    for (const note of tvShows) {
      const watched = new Set(note.media.watched_episodes);
      for (const s of note.media.seasons ?? []) {
        for (const ep of s.episodes) {
          const airMs = ep.air_date ? new Date(ep.air_date).getTime() : null;
          rows.push({
            note,
            ep,
            airMs: Number.isFinite(airMs as number) ? (airMs as number) : null,
            watched: watched.has(epKey(ep.season_number, ep.episode_number)),
          });
        }
      }
    }
    return rows;
  }, [tvShows]);

  const upcoming = useMemo(
    () =>
      allEps
        .filter((r) => r.airMs !== null && r.airMs > now && !r.watched)
        .sort((a, b) => (a.airMs! - b.airMs!))
        .slice(0, 40),
    [allEps, now],
  );

  const nextUp = useMemo(() => {
    const perShow = new Map<string, EpisodeRow>();
    for (const r of allEps) {
      if (r.watched) continue;
      if (r.airMs !== null && r.airMs > now) continue;
      const cur = perShow.get(r.note.id);
      if (
        !cur ||
        r.ep.season_number < cur.ep.season_number ||
        (r.ep.season_number === cur.ep.season_number && r.ep.episode_number < cur.ep.episode_number)
      ) {
        perShow.set(r.note.id, r);
      }
    }
    return Array.from(perShow.values()).sort((a, b) =>
      (a.note.media.title ?? "").localeCompare(b.note.media.title ?? ""),
    );
  }, [allEps, now]);

  const recent = useMemo(() => {
    const cutoff = now - 1000 * 60 * 60 * 24 * 30;
    return allEps
      .filter((r) => r.watched && r.airMs !== null && r.airMs <= now && r.airMs >= cutoff)
      .sort((a, b) => b.airMs! - a.airMs!)
      .slice(0, 40);
  }, [allEps, now]);

  if (tvShows.length === 0) {
    return (
      <p className="rounded-2xl bg-card px-4 py-8 text-center text-[13px] text-muted-foreground ring-1 ring-border/60">
        No TV shows here yet.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <EpSection title="Recently aired" rows={recent} emptyText="Nothing aired recently." showDate />
      <EpSection title="Next up" rows={nextUp} emptyText="You're all caught up." />
      <EpSection title="Upcoming" rows={upcoming} emptyText="Nothing scheduled." showDate />
    </div>
  );
}

function EpSection({
  title,
  rows,
  emptyText,
  showDate,
}: {
  title: string;
  rows: EpisodeRow[];
  emptyText: string;
  showDate?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-card px-4 py-5 text-center text-[12px] text-muted-foreground ring-1 ring-border/60">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <EpRow key={`${r.note.id}-${r.ep.season_number}-${r.ep.episode_number}`} row={r} showDate={showDate} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EpRow({ row, showDate }: { row: EpisodeRow; showDate?: boolean }) {
  const still = tmdbStill(row.ep.still_path, "w185");
  const poster = tmdbPoster(row.note.media.poster_path, "w185");
  const thumb = still ?? poster;
  const airLabel = row.airMs !== null ? format(new Date(row.airMs), "MMM d, yyyy") : "TBA";
  const relLabel =
    row.airMs !== null ? formatDistanceToNow(new Date(row.airMs), { addSuffix: true }) : "TBA";

  return (
    <li className="flex items-stretch gap-2 rounded-2xl bg-card p-2 shadow-sm ring-1 ring-border/60">
      <Link
        to="/notes/$id"
        params={{ id: row.note.id }}
        className="flex flex-1 items-stretch gap-3 overflow-hidden active:opacity-80"
      >
        {thumb ? (
          <img
            src={thumb}
            alt={row.ep.name}
            loading="lazy"
            className="h-16 w-24 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
            No image
          </div>
        )}
        <div className="min-w-0 flex-1 py-0.5">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {row.note.media.title}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            S{row.ep.season_number}·E{row.ep.episode_number} {row.ep.name ? `— ${row.ep.name}` : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {showDate ? `${airLabel} · ${relLabel}` : relLabel}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={() =>
          void toggleEpisodeWatched(row.note.id, row.ep.season_number, row.ep.episode_number, !row.watched)
        }
        aria-label={row.watched ? "Mark unwatched" : "Mark watched"}
        className={`my-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
          row.watched
            ? "bg-emerald-500 text-white"
            : "bg-muted text-muted-foreground ring-1 ring-border/60"
        }`}
      >
        <Check className="h-4 w-4" strokeWidth={3} />
      </button>
    </li>
  );
}

export function fmtMinutes(mins: number): string {
  if (!mins || mins < 1) return "0m";
  const d = Math.floor(mins / (60 * 24));
  const h = Math.floor((mins % (60 * 24)) / 60);
  const m = Math.floor(mins % 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m && !d) parts.push(`${m}m`);
  return parts.join(" ") || `${m}m`;
}

type StatCard = { label: string; value: string; sub?: string | null };

export function MediaStats({ members }: { members: Array<{ id: string; heading: string | null; media?: LocalMedia | null }> }) {
  const stats = useMemo(() => {
    const now = Date.now();
    const movies = members.map((n) => n.media).filter((m): m is LocalMedia => !!m && m.type === "movie");
    const shows = members.map((n) => n.media).filter((m): m is LocalMedia => !!m && m.type === "tv");

    // Movie tallies
    let moviesWatched = 0;
    let moviesWatchlist = 0;
    let moviesDropped = 0;
    let moviesWatchedMins = 0;
    let moviesPendingMins = 0;
    let moviesUpcoming = 0;
    let moviesUpcomingMins = 0;
    for (const m of movies) {
      const rt = Math.max(0, m.runtime ?? 0);
      const releaseMs = m.release_date ? new Date(m.release_date).getTime() : null;
      const released = releaseMs === null || !Number.isFinite(releaseMs) || releaseMs <= now;
      if (m.watch_status === "watched") {
        moviesWatched++;
        moviesWatchedMins += rt;
      } else if (m.watch_status === "dropped") {
        moviesDropped++;
      } else if (!released) {
        moviesUpcoming++;
        moviesUpcomingMins += rt;
      } else {
        // watchlist / watching / null on released titles → pending
        moviesWatchlist++;
        moviesPendingMins += rt;
      }
    }

    // TV tallies
    let showsWatchlist = 0;
    let showsWatching = 0;
    let showsCompleted = 0;
    let showsDropped = 0;
    let epsWatched = 0;
    let epsWatchedMins = 0;
    let epsPending = 0; // aired, not watched
    let epsPendingMins = 0;
    let epsUpcoming = 0; // unaired
    let epsUpcomingMins = 0;
    for (const m of shows) {
      switch (m.watch_status) {
        case "watchlist": showsWatchlist++; break;
        case "watching": showsWatching++; break;
        case "watched": showsCompleted++; break;
        case "dropped": showsDropped++; break;
      }
      const watched = new Set(m.watched_episodes);
      const fallbackRt = Math.max(0, m.runtime ?? 0);
      const isDropped = m.watch_status === "dropped";
      for (const s of m.seasons ?? []) {
        for (const ep of s.episodes) {
          const rt = Math.max(0, ep.runtime ?? fallbackRt);
          const airedMs = ep.air_date ? new Date(ep.air_date).getTime() : null;
          const aired = airedMs !== null && Number.isFinite(airedMs) && airedMs <= now;
          if (watched.has(epKey(ep.season_number, ep.episode_number))) {
            epsWatched++;
            epsWatchedMins += rt;
          } else if (isDropped) {
            // dropped shows: don't count remaining episodes as pending/upcoming
            continue;
          } else if (aired) {
            epsPending++;
            epsPendingMins += rt;
          } else if (airedMs !== null) {
            epsUpcoming++;
            epsUpcomingMins += rt;
          }
        }
      }
    }

    const totalMinsWatched = moviesWatchedMins + epsWatchedMins;

    return {
      hasMovies: movies.length > 0,
      hasShows: shows.length > 0,
      totals: { count: members.length, mins: totalMinsWatched },
      movies: {
        total: movies.length,
        watched: moviesWatched,
        watchlist: moviesWatchlist,
        dropped: moviesDropped,
        watchedMins: moviesWatchedMins,
        pendingMins: moviesPendingMins,
        upcoming: moviesUpcoming,
        upcomingMins: moviesUpcomingMins,
      },
      shows: {
        total: shows.length,
        watchlist: showsWatchlist,
        watching: showsWatching,
        completed: showsCompleted,
        dropped: showsDropped,
        epsWatched, epsWatchedMins,
        epsPending, epsPendingMins,
        epsUpcoming, epsUpcomingMins,
      },
    };
  }, [members]);

  const StatTile = ({ label, value, sub }: StatCard) => (
    <div className="rounded-2xl bg-card p-3 ring-1 ring-border/60">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-[22px] font-bold leading-none tracking-tight text-foreground tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );

  const Header = ({ icon, title }: { icon: React.ReactNode; title: string }) => (
    <div className="mb-2 mt-6 flex items-center gap-2 px-1">
      {icon}
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
    </div>
  );

  return (
    <div className="pb-24">
      {/* Ticket stubs deck */}
      <div className="mb-4">
        <WatchHistorySection
          tmdbIds={members.map((m) => m.media?.tmdb_id).filter((x): x is number => typeof x === "number")}
          limit={50}
          variant="deck"
        />
      </div>

      {/* Watched shelf */}
      <WatchedShelf members={members} />

      {/* Time watched — compact */}
      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-border/60">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Time watched</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {(() => {
              const parts: string[] = [];
              if (stats.hasMovies) parts.push(`${stats.movies.watched} movie${stats.movies.watched === 1 ? "" : "s"}`);
              if (stats.hasShows) parts.push(`${stats.shows.epsWatched} episode${stats.shows.epsWatched === 1 ? "" : "s"}`);
              return parts.length ? parts.join(" · ") : "Nothing watched yet";
            })()}
          </p>
        </div>
        <p className="shrink-0 text-[18px] font-bold leading-none tracking-tight tabular-nums text-foreground">
          {fmtMinutes(stats.totals.mins)}
        </p>
      </div>




      {stats.hasMovies && (
        <>
          <Header icon={<Film className="h-3.5 w-3.5 text-muted-foreground" />} title="Movies" />
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Watched"
              value={`${stats.movies.watched}`}
              sub={`of ${stats.movies.total} · ${fmtMinutes(stats.movies.watchedMins)}`}
            />
            <StatTile
              label="Pending"
              value={`${stats.movies.watchlist}`}
              sub={stats.movies.pendingMins > 0 ? `~${fmtMinutes(stats.movies.pendingMins)} to go` : "Nothing queued"}
            />
            {stats.movies.upcoming > 0 && (
              <StatTile
                label="Upcoming"
                value={`${stats.movies.upcoming}`}
                sub={stats.movies.upcomingMins > 0 ? `~${fmtMinutes(stats.movies.upcomingMins)} unreleased` : "Not yet released"}
              />
            )}
            {stats.movies.dropped > 0 && (
              <StatTile label="Dropped" value={`${stats.movies.dropped}`} sub="Not counted below" />
            )}
          </div>
        </>
      )}

      {stats.hasShows && (
        <>
          <Header icon={<Tv className="h-3.5 w-3.5 text-muted-foreground" />} title="TV Shows" />
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Episodes watched"
              value={`${stats.shows.epsWatched}`}
              sub={fmtMinutes(stats.shows.epsWatchedMins)}
            />
            <StatTile
              label="Pending (aired)"
              value={`${stats.shows.epsPending}`}
              sub={stats.shows.epsPendingMins > 0 ? `~${fmtMinutes(stats.shows.epsPendingMins)} to catch up` : "All caught up"}
            />
            <StatTile
              label="Upcoming"
              value={`${stats.shows.epsUpcoming}`}
              sub={stats.shows.epsUpcoming > 0 ? `~${fmtMinutes(stats.shows.epsUpcomingMins)} unaired` : "Nothing scheduled"}
            />
            <StatTile
              label="Shows"
              value={`${stats.shows.total}`}
              sub={`${stats.shows.watching} watching · ${stats.shows.completed} done`}
            />
          </div>

          {/* Shows status breakdown */}
          <div className="mt-3 rounded-2xl bg-card p-3 ring-1 ring-border/60">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Show status</p>
            <ul className="grid grid-cols-2 gap-y-1 text-[12px]">
              <li className="flex items-center justify-between pr-3"><span className="text-muted-foreground">Watchlist</span><span className="font-semibold tabular-nums">{stats.shows.watchlist}</span></li>
              <li className="flex items-center justify-between pr-3"><span className="text-muted-foreground">Watching</span><span className="font-semibold tabular-nums">{stats.shows.watching}</span></li>
              <li className="flex items-center justify-between pr-3"><span className="text-muted-foreground">Completed</span><span className="font-semibold tabular-nums">{stats.shows.completed}</span></li>
              <li className="flex items-center justify-between pr-3"><span className="text-muted-foreground">Dropped</span><span className="font-semibold tabular-nums">{stats.shows.dropped}</span></li>
            </ul>
          </div>
        </>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3" /> Runtimes from TMDB · dropped items counted in totals
      </p>
    </div>
  );
}

// ============================================================
// Watched shelf — minimal DVD spines that open a CD case dialog
// ============================================================

type ShelfMember = { id: string; heading: string | null; media?: LocalMedia | null };

export function WatchedShelf({ members }: { members: Array<ShelfMember> }) {
  const [open, setOpen] = useState<ShelfMember | null>(null);

  const watched = useMemo(() => {
    return members.filter((m) => {
      const md = m.media;
      if (!md) return false;
      if (md.type === "movie") return md.watch_status === "watched";
      if (md.type === "tv") {
        if (md.watch_status === "watched") return true;
        // A show counts as "on the shelf" once every aired episode is checked
        const total = mediaTotal(md);
        const done = mediaDone(md);
        return total > 0 && done >= total;
      }
      return false;
    });
  }, [members]);

  if (watched.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Shelf
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">{watched.length}</span>
      </div>

      {/* Shelf row */}
      <div className="relative">
        <div className="scrollbar-none flex items-end gap-[10px] overflow-x-auto px-2 pb-2 pt-1">
          {watched.map((m) => (
            <SpineTile key={m.id} member={m} onOpen={() => setOpen(m)} />
          ))}
        </div>
        {/* subtle shelf line */}
        <div className="mx-1 h-px bg-border/70" />
        <div className="mx-1 mt-[2px] h-[3px] rounded-b-md bg-gradient-to-b from-border/40 to-transparent" />
      </div>

      <MediaCaseDialog member={open} onClose={() => setOpen(null)} />
    </div>
  );
}


function SpineTile({ member, onOpen }: { member: ShelfMember; onOpen: () => void }) {
  const md = member.media!;
  const posterUrl = md.poster_path ? tmdbPoster(md.poster_path, "w342") : null;
  const title = md.title || member.heading || "Untitled";

  // Fetch the show/movie's official title logo (transparent PNG). Cached by
  // TanStack Query — displayed rotated on the spine so it looks like the
  // real poster/DVD wordmark rather than typeset text.
  const { data: logo } = useQuery({
    queryKey: ["tmdb-logo", md.type, md.tmdb_id],
    queryFn: () => fetchTmdbLogoFn({ data: { type: md.type, tmdb_id: md.tmdb_id } }),
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    enabled: !!md.tmdb_id,
  });
  const logoUrl = logo?.file_path ? `https://image.tmdb.org/t/p/w500${logo.file_path}` : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative h-[172px] w-[38px] flex-shrink-0 overflow-hidden rounded-[3px] shadow-[0_2px_6px_rgba(0,0,0,0.35)] transition-transform active:scale-[0.97]"
      aria-label={`Open ${title}`}
    >
      {posterUrl ? (
        // Rotate the full poster 90° so its own title artwork reads vertically
        // like a real DVD spine — the poster is the text.
        <img
          src={posterUrl}
          alt=""
          className="absolute left-1/2 top-1/2 h-[38px] w-[172px] max-w-none -translate-x-1/2 -translate-y-1/2 rotate-90 object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 bg-neutral-800" />
      )}
      {/* left crease highlight */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-gradient-to-r from-white/25 to-transparent" />
      {/* right shadow */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-[3px] bg-gradient-to-l from-black/50 to-transparent" />
      {/* soft vertical scrim so wordmark reads on any poster */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-black/25 to-black/60" />

      {/* Title wordmark — the movie/show's own poster logo, rotated to spine
          orientation. Falls back to a display-serif italic title while the
          logo loads or when TMDB has no logo asset. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {logoUrl ? (
          <div className="flex h-[38px] w-[168px] -rotate-90 items-center justify-center">
            <img
              src={logoUrl}
              alt={title}
              className="max-h-[26px] max-w-[132px] object-contain"
              style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.85)) brightness(1.1) contrast(1.05)" }}
              loading="lazy"
            />

          </div>
        ) : (
          <span
            className="max-h-[160px] whitespace-nowrap font-serif text-[12px] font-semibold italic leading-none tracking-[0.02em] text-white"
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              textShadow: "0 1px 3px rgba(0,0,0,0.85), 0 0 8px rgba(0,0,0,0.5)",
            }}
          >
            {title}
          </span>
        )}
      </div>

    </button>
  );

}

function MediaCaseDialog({ member, onClose }: { member: ShelfMember | null; onClose: () => void }) {
  const navigate = useNavigate();
  const md = member?.media ?? null;
  const posterUrl = md?.poster_path ? tmdbPoster(md.poster_path, "w500") : null;
  const title = md?.title || member?.heading || "Untitled";
  const year = md?.release_date ? new Date(md.release_date).getFullYear() : null;

  return (
    <Dialog open={!!member} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-[360px] gap-0 overflow-hidden rounded-3xl border-0 bg-neutral-900 p-0 text-white shadow-2xl [&>button]:text-white/70 [&>button]:hover:text-white"
      >

        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">Disc case preview</DialogDescription>

        {member && md && (
          <>
            {/* Case: poster + disc */}
            <div className="relative flex bg-neutral-800/40 p-3">
              {/* Cover art (left) */}
              <div className="case-poster-in relative z-10 w-[46%] flex-shrink-0 overflow-hidden rounded-sm shadow-[4px_0_12px_rgba(0,0,0,0.5)]">
                {posterUrl ? (
                  <img src={posterUrl} alt={title} className="h-full w-full object-cover" />
                ) : (
                  <div className="aspect-[2/3] w-full bg-neutral-700" />
                )}
              </div>

              {/* Black case with disc (right) */}
              <div className="relative ml-1 flex-1 overflow-hidden rounded-sm bg-black shadow-inner">
                {/* disc */}
                <div className="disc-slide-out absolute left-1/2 top-1/2 h-[78%] w-[78%]">
                  <div className="relative h-full w-full overflow-hidden rounded-full bg-neutral-900 shadow-[0_6px_18px_rgba(0,0,0,0.55)]">
                    {posterUrl && (
                      <img
                        src={posterUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover opacity-70 blur-[0.5px]"
                      />
                    )}
                    {/* glossy sheen */}
                    <div className="absolute inset-0 bg-[conic-gradient(from_210deg,rgba(255,255,255,0)_0deg,rgba(255,255,255,0.18)_40deg,rgba(255,255,255,0)_120deg,rgba(255,255,255,0.12)_240deg,rgba(255,255,255,0)_360deg)]" />
                    {/* center hub */}
                    <div className="absolute left-1/2 top-1/2 h-[26%] w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-300 ring-1 ring-black/40">
                      <div className="absolute left-1/2 top-1/2 h-[38%] w-[38%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-900" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Meta */}
            <div className="px-5 pb-5 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
                {md.type === "movie" ? "Movie" : "TV Show"}
                {year ? ` · ${year}` : ""}
              </p>
              <h3 className="mt-1 text-[17px] font-semibold leading-tight tracking-tight">
                {title}
              </h3>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = member.id;
                    onClose();
                    navigate({ to: "/notes/$id", params: { id } });
                  }}
                  className="flex-1 rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-neutral-900 active:scale-[0.98]"
                >
                  Open details
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full bg-white/10 px-4 py-2.5 text-[13px] font-semibold text-white/90 active:scale-[0.98]"
                >
                  Close
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

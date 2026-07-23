import { useMemo, useState } from "react";
import { Film, Tv, Star, Clock, Calendar, Globe, ChevronDown, Check, Circle, Trash2 } from "lucide-react";
import type { LocalMedia, WatchStatus } from "@/lib/local-db";
import {
  backdrop,
  epKey,
  poster,
  setWatchStatus,
  still,
  toggleEpisodeWatched,
  toggleSeasonWatched,
  totalEpisodes,
  WATCH_COLORS,
  WATCH_LABEL,
  watchedCount,
} from "@/lib/media";

const STATUSES: WatchStatus[] = ["watchlist", "watching", "watched", "dropped"];

export function MediaDetail({ noteId, media, onDelete }: { noteId: string; media: LocalMedia; onDelete: () => void }) {
  const isTv = media.type === "tv";
  const year = media.release_date ? media.release_date.slice(0, 4) : null;
  const lastYear = media.last_air_date ? media.last_air_date.slice(0, 4) : null;
  const [openSeason, setOpenSeason] = useState<number | null>(() => {
    // Open the next unwatched season by default
    if (!isTv || !media.seasons?.length) return null;
    const watched = new Set(media.watched_episodes);
    for (const s of media.seasons) {
      for (const ep of s.episodes) {
        if (!watched.has(epKey(s.season_number, ep.episode_number))) return s.season_number;
      }
    }
    return media.seasons[0].season_number;
  });

  const total = totalEpisodes(media);
  const done = watchedCount(media);
  const posterUrl = poster(media.poster_path, "w500");
  const backdropUrl = backdrop(media.backdrop_path, "w1280");
  const watchedSet = useMemo(() => new Set(media.watched_episodes), [media.watched_episodes]);

  return (
    <div className="pb-8">
      {/* Backdrop hero */}
      <div className="relative -mx-5 aspect-[16/9] overflow-hidden bg-neutral-900">
        {backdropUrl ? (
          <img
            src={backdropUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-70"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : posterUrl ? (
          <img
            src={posterUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-40 blur-2xl scale-110"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      </div>

      <div className="-mt-16 flex items-end gap-4 px-1">
        <div
          className="relative h-40 w-28 shrink-0 overflow-hidden rounded-2xl bg-neutral-800 shadow-2xl ring-1 ring-black/20"
          style={posterUrl ? { backgroundImage: `url(${posterUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        >
          {!posterUrl && (
            <div className="flex h-full w-full items-center justify-center text-white/40">
              {isTv ? <Tv className="h-8 w-8" /> : <Film className="h-8 w-8" />}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <div className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {isTv ? <Tv className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
            {isTv ? "TV Show" : "Movie"}
          </div>
          <h1 className="text-[22px] font-bold leading-tight tracking-tight text-foreground">{media.title}</h1>
          {media.tagline && <p className="mt-1 text-[13px] italic text-muted-foreground line-clamp-2">{media.tagline}</p>}
        </div>
      </div>

      {/* Meta chips */}
      <div className="mt-4 flex flex-wrap gap-1.5 text-[11px]">
        {(year || lastYear) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {year}
            {isTv && lastYear && lastYear !== year ? `–${lastYear}` : ""}
          </span>
        )}
        {media.runtime != null && media.runtime > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            {media.runtime}m{isTv ? "/ep" : ""}
          </span>
        )}
        {media.vote_average != null && media.vote_average > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            <Star className="h-3 w-3 fill-current" />
            {media.vote_average.toFixed(1)}
          </span>
        )}
        {isTv && total > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-muted-foreground">
            {done}/{total} eps
          </span>
        )}
      </div>

      {media.genres.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {media.genres.map((g) => (
            <span key={g} className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              {g}
            </span>
          ))}
        </div>
      )}

      {/* Watch status */}
      <section className="mt-6">
        <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</h2>
        <div className="grid grid-cols-4 gap-1.5">
          {STATUSES.map((s) => {
            const active = media.watch_status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => void setWatchStatus(noteId, active ? null : s)}
                className={`rounded-2xl px-2 py-2.5 text-[12px] font-semibold transition-colors ${
                  active ? WATCH_COLORS[s] : "bg-muted text-muted-foreground active:opacity-70"
                }`}
              >
                {WATCH_LABEL[s]}
              </button>
            );
          })}
        </div>
      </section>

      {/* Overview */}
      {media.overview && (
        <section className="mt-6">
          <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Overview</h2>
          <p className="rounded-2xl bg-card px-4 py-3 text-[14px] leading-relaxed text-foreground shadow-sm">
            {media.overview}
          </p>
        </section>
      )}

      {/* Links */}
      <section className="mt-4 flex flex-wrap gap-2">
        <a
          href={`https://www.themoviedb.org/${media.type}/${media.tmdb_id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-[12px] font-medium text-foreground active:opacity-60"
        >
          <Globe className="h-3 w-3" /> TMDB
        </a>
        {media.imdb_id && (
          <a
            href={`https://www.imdb.com/title/${media.imdb_id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full bg-yellow-400/20 px-3 py-1.5 text-[12px] font-medium text-yellow-800 active:opacity-60 dark:text-yellow-300"
          >
            IMDb
          </a>
        )}
        {media.homepage && (
          <a
            href={media.homepage}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-[12px] font-medium text-foreground active:opacity-60"
          >
            <Globe className="h-3 w-3" /> Official
          </a>
        )}
      </section>

      {/* Episodes (TV) */}
      {isTv && media.seasons && media.seasons.length > 0 && (
        <section className="mt-8">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Episodes</h2>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {done}/{total}
            </span>
          </div>
          <ul className="space-y-2">
            {media.seasons.map((s) => {
              const seasonWatched = s.episodes.filter((e) => watchedSet.has(epKey(s.season_number, e.episode_number))).length;
              const allWatched = seasonWatched === s.episodes.length && s.episodes.length > 0;
              const open = openSeason === s.season_number;
              return (
                <li key={s.season_number} className="overflow-hidden rounded-2xl bg-card shadow-sm">
                  <div className="flex items-center gap-2 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void toggleSeasonWatched(noteId, s.season_number, !allWatched)}
                      aria-label={allWatched ? "Mark season unwatched" : "Mark season watched"}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                        allWatched
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-muted-foreground/40 text-transparent"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenSeason(open ? null : s.season_number)}
                      className="flex flex-1 items-center justify-between text-left"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-foreground">{s.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {seasonWatched}/{s.episodes.length} watched
                          {s.air_date ? ` · ${s.air_date.slice(0, 4)}` : ""}
                        </p>
                      </div>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>
                  {open && (
                    <ul className="border-t border-border/60">
                      {s.episodes.map((ep) => {
                        const k = epKey(s.season_number, ep.episode_number);
                        const watched = watchedSet.has(k);
                        const stillUrl = still(ep.still_path, "w185");
                        return (
                          <li key={k} className="border-b border-border/40 last:border-b-0">
                            <button
                              type="button"
                              onClick={() => void toggleEpisodeWatched(noteId, s.season_number, ep.episode_number)}
                              className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-muted/50"
                            >
                              {stillUrl ? (
                                <img
                                  src={stillUrl}
                                  alt=""
                                  loading="lazy"
                                  className="h-12 w-20 shrink-0 rounded-md object-cover ring-1 ring-black/10"
                                />
                              ) : (
                                <div className="h-12 w-20 shrink-0 rounded-md bg-muted" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p
                                  className={`text-[13px] font-semibold leading-tight ${
                                    watched ? "text-muted-foreground line-through" : "text-foreground"
                                  }`}
                                >
                                  {ep.episode_number}. {ep.name}
                                </p>
                                {ep.air_date && (
                                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                    {ep.air_date}
                                    {ep.runtime ? ` · ${ep.runtime}m` : ""}
                                  </p>
                                )}
                                {ep.overview && (
                                  <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                                    {ep.overview}
                                  </p>
                                )}
                              </div>
                              {watched ? (
                                <Check className="mt-1 h-5 w-5 shrink-0 text-emerald-500" strokeWidth={3} />
                              ) : (
                                <Circle className="mt-1 h-5 w-5 shrink-0 text-muted-foreground/50" strokeWidth={1.5} />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[12px] font-medium text-destructive active:opacity-60"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </div>
  );
}

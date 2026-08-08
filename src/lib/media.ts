import { db, type LocalMedia, type LocalNote, type WatchStatus } from "./local-db";
import { logEpisodeWatched, logMovieWatched, unlogEpisode, unlogMovie } from "./watch-history";


export const TMDB_IMG = "https://image.tmdb.org/t/p";
export const poster = (path: string | null, size: "w185" | "w342" | "w500" | "original" = "w342") =>
  path ? `${TMDB_IMG}/${size}${path}` : null;
export const backdrop = (path: string | null, size: "w780" | "w1280" | "original" = "w1280") =>
  path ? `${TMDB_IMG}/${size}${path}` : null;
export const still = (path: string | null, size: "w185" | "w300" = "w300") =>
  path ? `${TMDB_IMG}/${size}${path}` : null;
export const profile = (path: string | null, size: "w185" | "h632" = "w185") =>
  path ? `${TMDB_IMG}/${size}${path}` : null;

export const epKey = (s: number, e: number) => `S${s}E${e}`;

export function totalEpisodes(m: LocalMedia): number {
  if (m.type !== "tv") return 0;
  return (m.seasons ?? []).reduce((n, s) => n + s.episodes.length, 0);
}

export function watchedCount(m: LocalMedia): number {
  return m.watched_episodes.length;
}

export const WATCH_LABEL: Record<WatchStatus, string> = {
  watchlist: "Watchlist",
  watching: "Watching",
  watched: "Watched",
  dropped: "Dropped",
};

export const WATCH_COLORS: Record<WatchStatus, string> = {
  watchlist: "bg-amber-500 text-white",
  watching: "bg-sky-500 text-white",
  watched: "bg-emerald-500 text-white",
  dropped: "bg-neutral-500 text-white",
};

async function patchMedia(noteId: string, patch: Partial<LocalMedia>) {
  const n = await db.notes.get(noteId);
  if (!n?.media) return;
  const all = await db.notes.toArray();
  const targets = all.filter(
    (x) =>
      !x.deleted_at &&
      !!x.media &&
      x.media.type === n.media!.type &&
      x.media.tmdb_id === n.media!.tmdb_id,
  );
  const now = new Date().toISOString();
  for (const t of (targets.length ? targets : [n])) {
    if (!t.media) continue;
    const media: LocalMedia = { ...t.media, ...patch };
    await db.notes.update(t.id, { media, updated_at: now } as Partial<LocalNote>);
  }
}


export async function setWatchStatus(noteId: string, status: WatchStatus | null) {
  const n = await db.notes.get(noteId);
  if (!n?.media) return;
  const watchedAt = status === "watched" ? new Date().toISOString() : n.media.watched_at;

  // Ticket-stub history for movies (TV history is tracked per episode).
  if (n.media.type === "movie") {
    if (status === "watched") await logMovieWatched(n, n.media, watchedAt ?? new Date().toISOString());
    else await unlogMovie(n.media.tmdb_id);
  }

  // Apply to every note that points at the same title so the status is
  // identical no matter which collection/filter you're looking at.
  const all = await db.notes.toArray();
  const siblings = all.filter(
    (x) =>
      !x.deleted_at &&
      !!x.media &&
      x.media.type === n.media!.type &&
      x.media.tmdb_id === n.media!.tmdb_id,
  );
  const targets = siblings.length ? siblings : [n];
  const now = new Date().toISOString();
  for (const t of targets) {
    if (!t.media) continue;
    const media: LocalMedia = { ...t.media, watch_status: status, watched_at: watchedAt };
    await db.notes.update(t.id, { media, updated_at: now } as Partial<LocalNote>);
  }
}



export async function toggleEpisodeWatched(noteId: string, season: number, episode: number, watched?: boolean) {
  const n = await db.notes.get(noteId);
  if (!n?.media) return;
  const key = epKey(season, episode);
  const set = new Set(n.media.watched_episodes);
  const shouldBe = watched ?? !set.has(key);
  if (shouldBe) set.add(key);
  else set.delete(key);
  const arr = Array.from(set);
  // Auto-promote status
  let status: WatchStatus | null = n.media.watch_status;
  const total = totalEpisodes(n.media);
  if (arr.length > 0 && total > 0) {
    status = arr.length >= total ? "watched" : (status && status !== "watchlist" ? status : "watching");
  }
  await patchMedia(noteId, {
    watched_episodes: arr,
    watch_status: status,
    watched_at: arr.length >= total && total > 0 ? new Date().toISOString() : n.media.watched_at,
  });
}

export async function toggleSeasonWatched(noteId: string, season: number, watched: boolean) {
  const n = await db.notes.get(noteId);
  if (!n?.media) return;
  const s = (n.media.seasons ?? []).find((x) => x.season_number === season);
  if (!s) return;
  const set = new Set(n.media.watched_episodes);
  for (const ep of s.episodes) {
    const k = epKey(season, ep.episode_number);
    if (watched) set.add(k);
    else set.delete(k);
  }
  const arr = Array.from(set);
  const total = totalEpisodes(n.media);
  let status: WatchStatus | null = n.media.watch_status;
  if (arr.length > 0 && total > 0) {
    status = arr.length >= total ? "watched" : (status && status !== "watchlist" ? status : "watching");
  }
  await patchMedia(noteId, {
    watched_episodes: arr,
    watch_status: status,
  });
}

/** Cheap client-side check: is this URL plausibly a movie/TV link? */
export function looksLikeMediaUrl(url: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "themoviedb.org" || host === "imdb.com") return true;
    if (host === "letterboxd.com" || host.endsWith(".letterboxd.com")) return true;
    if (host === "trakt.tv") return true;
    return false;
  } catch {
    return false;
  }
}

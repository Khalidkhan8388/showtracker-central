import { db, type LocalMedia, type LocalNote, type WatchStatus } from "./local-db";

export const TMDB_IMG = "https://image.tmdb.org/t/p";
export const poster = (path: string | null, size: "w185" | "w342" | "w500" | "original" = "w342") =>
  path ? `${TMDB_IMG}/${size}${path}` : null;
export const backdrop = (path: string | null, size: "w780" | "w1280" | "original" = "w1280") =>
  path ? `${TMDB_IMG}/${size}${path}` : null;
export const still = (path: string | null, size: "w185" | "w300" = "w300") =>
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

function fireCompletion(m: LocalMedia) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("braintape:media-completed", {
      detail: {
        tmdb_id: m.tmdb_id,
        type: m.type,
        title: m.title,
        poster_path: m.poster_path,
      },
    }),
  );
}

async function patchMedia(noteId: string, patch: Partial<LocalMedia>) {
  const n = await db.notes.get(noteId);
  if (!n?.media) return;
  const media: LocalMedia = { ...n.media, ...patch };
  await db.notes.update(noteId, { media, updated_at: new Date().toISOString() } as Partial<LocalNote>);
}

export async function setWatchStatus(noteId: string, status: WatchStatus | null) {
  const n = await db.notes.get(noteId);
  if (!n?.media) return;
  const wasWatched = n.media.watch_status === "watched";
  await patchMedia(noteId, {
    watch_status: status,
    watched_at: status === "watched" ? new Date().toISOString() : n.media.watched_at,
  });
  if (status === "watched" && !wasWatched) fireCompletion(n.media);
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
  const prevCount = n.media.watched_episodes.length;
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
  if (total > 0 && arr.length >= total && prevCount < total) fireCompletion(n.media);
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
  const prevCount = n.media.watched_episodes.length;
  let status: WatchStatus | null = n.media.watch_status;
  if (arr.length > 0 && total > 0) {
    status = arr.length >= total ? "watched" : (status && status !== "watchlist" ? status : "watching");
  }
  await patchMedia(noteId, {
    watched_episodes: arr,
    watch_status: status,
  });
  if (total > 0 && arr.length >= total && prevCount < total) fireCompletion(n.media);
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

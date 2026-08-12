import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalMedia, type LocalNote, type WatchLogEntry } from "./local-db";

export const stubId = (type: "movie" | "tv", tmdbId: number, season?: number | null, episode?: number | null) =>
  type === "movie" ? `movie:${tmdbId}` : `tv:${tmdbId}:S${season ?? 0}E${episode ?? 0}`;

function baseFields(note: LocalNote, m: LocalMedia) {
  return {
    note_id: note.id,
    type: m.type,
    tmdb_id: m.tmdb_id,
    title: m.title,
    poster_path: m.poster_path,
    backdrop_path: m.backdrop_path,
    year: m.release_date ? String(m.release_date).slice(0, 4) : null,
    vote_average: m.vote_average,
    user_rating: m.user_rating ?? null,
  };
}

/** Record a finished movie. */
export async function logMovieWatched(note: LocalNote, m: LocalMedia, at = new Date().toISOString()) {
  const id = stubId("movie", m.tmdb_id);
  const existing = await db.watchlog.get(id);
  if (existing) return;
  const entry: WatchLogEntry = {
    id,
    at,
    ...baseFields(note, m),
    season: null,
    episode: null,
    episode_title: null,
    runtime: m.runtime,
  };
  await db.watchlog.put(entry);
}

/** Record one finished episode. */
export async function logEpisodeWatched(
  note: LocalNote,
  m: LocalMedia,
  season: number,
  episode: number,
  at = new Date().toISOString(),
) {
  const id = stubId("tv", m.tmdb_id, season, episode);
  const existing = await db.watchlog.get(id);
  if (existing) return;
  const ep = (m.seasons ?? [])
    .find((s) => s.season_number === season)
    ?.episodes.find((e) => e.episode_number === episode);
  const entry: WatchLogEntry = {
    id,
    at,
    ...baseFields(note, m),
    season,
    episode,
    episode_title: ep?.name ?? null,
    runtime: ep?.runtime ?? m.runtime,
  };
  await db.watchlog.put(entry);
}

/** Mirror a personal rating onto every stub of the same title. */
export async function setStubRating(tmdbId: number, rating: number | null) {
  const rows = await db.watchlog.where("tmdb_id").equals(tmdbId).toArray();
  for (const r of rows) await db.watchlog.put({ ...r, user_rating: rating });
}

export async function unlogMovie(tmdbId: number) {
  await db.watchlog.delete(stubId("movie", tmdbId));
}

export async function unlogEpisode(tmdbId: number, season: number, episode: number) {
  await db.watchlog.delete(stubId("tv", tmdbId, season, episode));
}

async function all(): Promise<WatchLogEntry[]> {
  const rows = await db.watchlog.toArray();
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/** Full watch history, newest first. */
export function useWatchHistory(limit?: number): WatchLogEntry[] | undefined {
  return useLiveQuery(async () => {
    const rows = await all();
    return limit ? rows.slice(0, limit) : rows;
  }, [limit]);
}

/** Watch history filtered to a set of TMDB ids (used inside a collection). */
export function useWatchHistoryFor(tmdbIds: number[], limit?: number): WatchLogEntry[] | undefined {
  const key = tmdbIds.slice().sort((a, b) => a - b).join(",");
  return useLiveQuery(async () => {
    const set = new Set(key ? key.split(",").map(Number) : []);
    const rows = (await all()).filter((r) => set.has(r.tmdb_id));
    return limit ? rows.slice(0, limit) : rows;
  }, [key, limit]);
}

export function ticketNumber(entry: WatchLogEntry): string {
  let h = 0;
  for (const ch of entry.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(h % 1_000_000).padStart(6, "0");
}

export function formatRuntime(min: number | null): string | null {
  if (!min || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

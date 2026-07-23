import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TMDB = "https://api.themoviedb.org/3";

export type TmdbEpisode = {
  episode_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
};

export type TmdbSeason = {
  season_number: number;
  name: string;
  episode_count: number;
  air_date: string | null;
  poster_path: string | null;
  episodes: TmdbEpisode[];
};

export type TmdbLookup = {
  type: "movie" | "tv";
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  tagline: string | null;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null; // for tv: first_air_date
  last_air_date?: string | null;
  runtime: number | null; // minutes (movie) or episode avg (tv)
  genres: string[];
  vote_average: number | null;
  homepage: string | null;
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: TmdbSeason[]; // tv only
  original_url: string;
};

async function tmdbGet(path: string, key: string, params: Record<string, string> = {}) {
  const url = new URL(TMDB + path);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`TMDB ${path} failed (${res.status})`);
  return res.json() as Promise<any>;
}

function parseTmdbUrl(url: string): { type: "movie" | "tv"; id: number } | null {
  try {
    const u = new URL(url);
    if (!/themoviedb\.org$/i.test(u.hostname) && !/^www\.themoviedb\.org$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/(movie|tv)\/(\d+)/i);
    if (!m) return null;
    return { type: m[1].toLowerCase() as "movie" | "tv", id: Number(m[2]) };
  } catch {
    return null;
  }
}

function parseImdbId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)imdb\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/title\/(tt\d+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function fetchDetails(key: string, type: "movie" | "tv", id: number, originalUrl: string): Promise<TmdbLookup> {
  if (type === "movie") {
    const d = await tmdbGet(`/movie/${id}`, key);
    return {
      type: "movie",
      tmdb_id: id,
      imdb_id: d.imdb_id ?? null,
      title: d.title ?? d.original_title ?? "Untitled",
      tagline: d.tagline || null,
      overview: d.overview ?? "",
      poster_path: d.poster_path ?? null,
      backdrop_path: d.backdrop_path ?? null,
      release_date: d.release_date || null,
      runtime: d.runtime ?? null,
      genres: Array.isArray(d.genres) ? d.genres.map((g: any) => g.name).filter(Boolean) : [],
      vote_average: typeof d.vote_average === "number" ? d.vote_average : null,
      homepage: d.homepage || null,
      original_url: originalUrl,
    };
  }
  // tv
  const d = await tmdbGet(`/tv/${id}`, key);
  const seasonNumbers: number[] = Array.isArray(d.seasons)
    ? d.seasons.map((s: any) => s.season_number).filter((n: number) => n >= 0)
    : [];
  // Fetch each season's episodes in parallel (skip specials season 0 unless it's the only one)
  const wanted = seasonNumbers.filter((n) => n > 0);
  const toFetch = wanted.length ? wanted : seasonNumbers;
  const seasons: TmdbSeason[] = await Promise.all(
    toFetch.map(async (sn) => {
      try {
        const s = await tmdbGet(`/tv/${id}/season/${sn}`, key);
        const episodes: TmdbEpisode[] = Array.isArray(s.episodes)
          ? s.episodes.map((e: any) => ({
              episode_number: e.episode_number,
              name: e.name ?? `Episode ${e.episode_number}`,
              overview: e.overview ?? "",
              air_date: e.air_date || null,
              runtime: e.runtime ?? null,
              still_path: e.still_path ?? null,
            }))
          : [];
        return {
          season_number: s.season_number,
          name: s.name ?? `Season ${s.season_number}`,
          episode_count: episodes.length,
          air_date: s.air_date || null,
          poster_path: s.poster_path ?? null,
          episodes,
        } satisfies TmdbSeason;
      } catch {
        return {
          season_number: sn,
          name: `Season ${sn}`,
          episode_count: 0,
          air_date: null,
          poster_path: null,
          episodes: [],
        } satisfies TmdbSeason;
      }
    }),
  );
  seasons.sort((a, b) => a.season_number - b.season_number);
  const runtimeAvg = Array.isArray(d.episode_run_time) && d.episode_run_time.length
    ? Math.round(d.episode_run_time.reduce((a: number, b: number) => a + b, 0) / d.episode_run_time.length)
    : null;
  // TV imdb_id lives on /external_ids
  let imdb_id: string | null = null;
  try {
    const ext = await tmdbGet(`/tv/${id}/external_ids`, key);
    imdb_id = ext.imdb_id || null;
  } catch {}
  return {
    type: "tv",
    tmdb_id: id,
    imdb_id,
    title: d.name ?? d.original_name ?? "Untitled",
    tagline: d.tagline || null,
    overview: d.overview ?? "",
    poster_path: d.poster_path ?? null,
    backdrop_path: d.backdrop_path ?? null,
    release_date: d.first_air_date || null,
    last_air_date: d.last_air_date || null,
    runtime: runtimeAvg,
    genres: Array.isArray(d.genres) ? d.genres.map((g: any) => g.name).filter(Boolean) : [],
    vote_average: typeof d.vote_average === "number" ? d.vote_average : null,
    homepage: d.homepage || null,
    number_of_seasons: d.number_of_seasons ?? seasons.length,
    number_of_episodes: d.number_of_episodes ?? seasons.reduce((n, s) => n + s.episode_count, 0),
    seasons,
    original_url: originalUrl,
  };
}

async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200_000);
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
    if (og) return og.trim();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    return title ? title.trim() : null;
  } catch {
    return null;
  }
}

function cleanTitleForSearch(raw: string): { query: string; year: number | null } {
  let q = raw
    .replace(/\s*[\|\-–—:·]\s*(IMDb|Rotten Tomatoes|Letterboxd|Netflix|Prime Video|Hulu|HBO|Apple TV\+?|Disney\+|The Movie Database.*)$/i, "")
    .replace(/\s*[\|\-–—:·]\s*(Watch (Online|Free)|Full Movie|Free Streaming).*$/i, "")
    .replace(/\s*\((\d{4})\).*$/, "")
    .replace(/\s*\[.*?\]\s*/g, " ")
    .trim();
  const yearMatch = raw.match(/\((\d{4})\)/) ?? raw.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[1] + (yearMatch[2] ?? "")) : null;
  return { query: q.slice(0, 120), year: Number.isFinite(year!) ? (year as number) : null };
}

const Input = z.object({ url: z.string().trim().url().max(2000) });

export const lookupTmdbFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<TmdbLookup | null> => {
    const key = process.env.TMDB_API_KEY;
    if (!key) throw new Error("TMDB_API_KEY is not configured");

    // 1) Direct TMDB URL
    const tmdb = parseTmdbUrl(data.url);
    if (tmdb) return fetchDetails(key, tmdb.type, tmdb.id, data.url);

    // 2) IMDb URL → /find
    const imdb = parseImdbId(data.url);
    if (imdb) {
      try {
        const r = await tmdbGet(`/find/${imdb}`, key, { external_source: "imdb_id" });
        if (Array.isArray(r.movie_results) && r.movie_results[0]) {
          return fetchDetails(key, "movie", r.movie_results[0].id, data.url);
        }
        if (Array.isArray(r.tv_results) && r.tv_results[0]) {
          return fetchDetails(key, "tv", r.tv_results[0].id, data.url);
        }
      } catch {}
    }

    // 3) Any other URL: pull title and search TMDB
    const title = await fetchPageTitle(data.url);
    if (!title) return null;
    const { query, year } = cleanTitleForSearch(title);
    if (!query) return null;
    try {
      const multi = await tmdbGet(`/search/multi`, key, {
        query,
        include_adult: "false",
        ...(year ? { year: String(year) } : {}),
      });
      const results: any[] = Array.isArray(multi.results) ? multi.results : [];
      const hit = results.find((r) => r.media_type === "movie" || r.media_type === "tv");
      if (!hit) return null;
      return fetchDetails(key, hit.media_type, hit.id, data.url);
    } catch {
      return null;
    }
  });

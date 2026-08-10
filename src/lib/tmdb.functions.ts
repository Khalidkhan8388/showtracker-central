import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TMDB = "https://api.themoviedb.org/3";

export type TmdbEpisode = {
  season_number: number;
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
              season_number: s.season_number,
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

// -- Direct search / lookup used by the in-app search page -------------------

export type TmdbSearchHit = {
  type: "movie" | "tv";
  tmdb_id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  year: string | null;
  vote_average: number | null;
};

const SearchInput = z.object({ query: z.string().trim().min(1).max(120) });

export const searchTmdbFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SearchInput.parse(d))
  .handler(async ({ data }): Promise<TmdbSearchHit[]> => {
    const key = process.env.TMDB_API_KEY;
    if (!key) throw new Error("TMDB_API_KEY is not configured");
    try {
      const r = await tmdbGet(`/search/multi`, key, {
        query: data.query,
        include_adult: "false",
        page: "1",
      });
      const results: any[] = Array.isArray(r.results) ? r.results : [];
      return results
        .filter((x) => x.media_type === "movie" || x.media_type === "tv")
        .slice(0, 20)
        .map((x): TmdbSearchHit => {
          const type = x.media_type as "movie" | "tv";
          const date = (type === "movie" ? x.release_date : x.first_air_date) || null;
          return {
            type,
            tmdb_id: Number(x.id),
            title:
              type === "movie"
                ? (x.title ?? x.original_title ?? "Untitled")
                : (x.name ?? x.original_name ?? "Untitled"),
            overview: x.overview ?? "",
            poster_path: x.poster_path ?? null,
            backdrop_path: x.backdrop_path ?? null,
            year: date ? String(date).slice(0, 4) : null,
            vote_average: typeof x.vote_average === "number" ? x.vote_average : null,
          };
        });
    } catch {
      return [];
    }
  });

const LookupIdInput = z.object({
  type: z.enum(["movie", "tv"]),
  tmdb_id: z.number().int().positive(),
});

export const lookupTmdbByIdFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => LookupIdInput.parse(d))
  .handler(async ({ data }): Promise<TmdbLookup | null> => {
    const key = process.env.TMDB_API_KEY;
    if (!key) throw new Error("TMDB_API_KEY is not configured");
    const url = `https://www.themoviedb.org/${data.type}/${data.tmdb_id}`;
    try {
      return await fetchDetails(key, data.type, data.tmdb_id, url);
    } catch {
      return null;
    }
  });

// -- Title logo (transparent PNG of the movie/show's own title art) ----------

export const fetchTmdbLogoFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => LookupIdInput.parse(d))
  .handler(async ({ data }): Promise<{ file_path: string | null }> => {
    const key = process.env.TMDB_API_KEY;
    if (!key) throw new Error("TMDB_API_KEY is not configured");
    try {
      const r = await tmdbGet(`/${data.type}/${data.tmdb_id}/images`, key, {
        include_image_language: "en,null",
      });
      const logos: any[] = Array.isArray(r.logos) ? r.logos : [];
      if (!logos.length) return { file_path: null };
      // Prefer English PNGs, then transparent-friendly PNG, then anything.
      const score = (l: any) => {
        let s = 0;
        if (l.iso_639_1 === "en") s += 10;
        if (l.iso_639_1 === null) s += 5;
        if (typeof l.file_path === "string" && l.file_path.endsWith(".png")) s += 3;
        if (typeof l.vote_average === "number") s += l.vote_average;
        return s;
      };
      logos.sort((a, b) => score(b) - score(a));
      const pick = logos[0];
      return { file_path: pick?.file_path ?? null };
    } catch {
      return { file_path: null };
    }
  });

// -- Cast (top-billed) -------------------------------------------------------

export type TmdbCastMember = {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
};

export const fetchTmdbCreditsFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => LookupIdInput.parse(d))
  .handler(async ({ data }): Promise<{ cast: TmdbCastMember[] }> => {
    const key = process.env.TMDB_API_KEY;
    if (!key) throw new Error("TMDB_API_KEY is not configured");
    try {
      const path = data.type === "movie"
        ? `/movie/${data.tmdb_id}/credits`
        : `/tv/${data.tmdb_id}/aggregate_credits`;
      const r = await tmdbGet(path, key);
      const raw: any[] = Array.isArray(r.cast) ? r.cast : [];
      const cast: TmdbCastMember[] = raw
        .slice(0, 40)
        .map((c) => ({
          id: Number(c.id),
          name: c.name ?? c.original_name ?? "",
          character: Array.isArray(c.roles) && c.roles[0]?.character
            ? c.roles[0].character
            : (c.character ?? ""),
          profile_path: c.profile_path ?? null,
          order: typeof c.order === "number" ? c.order : 999,
        }))
        .filter((c) => c.name)
        .sort((a, b) => a.order - b.order)
        .slice(0, 20);
      return { cast };
    } catch {
      return { cast: [] };
    }
  });

// -- Person detail -----------------------------------------------------------

export type TmdbPersonCredit = {
  id: number;
  type: "movie" | "tv";
  title: string;
  character: string;
  release_date: string | null;
  poster_path: string | null;
  vote_average: number | null;
};

export type TmdbPersonDetail = {
  id: number;
  name: string;
  biography: string;
  known_for_department: string;
  profile_path: string | null;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  also_known_as: string[];
  credits: TmdbPersonCredit[];
};

const PersonIdInput = z.object({ person_id: z.number().int().positive() });

export const fetchTmdbPersonFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PersonIdInput.parse(d))
  .handler(async ({ data }): Promise<TmdbPersonDetail | null> => {
    const key = process.env.TMDB_API_KEY;
    if (!key) throw new Error("TMDB_API_KEY is not configured");
    try {
      const [person, credits] = await Promise.all([
        tmdbGet(`/person/${data.person_id}`, key),
        tmdbGet(`/person/${data.person_id}/combined_credits`, key),
      ]);

      const raw: any[] = Array.isArray(credits.cast) ? credits.cast : [];
      const mapped: TmdbPersonCredit[] = raw
        .filter((x) => x.media_type === "movie" || x.media_type === "tv")
        .map((x) => {
          const type = x.media_type as "movie" | "tv";
          const date = (type === "movie" ? x.release_date : x.first_air_date) || null;
          return {
            id: Number(x.id),
            type,
            title:
              type === "movie"
                ? (x.title ?? x.original_title ?? "Untitled")
                : (x.name ?? x.original_name ?? "Untitled"),
            character: x.character ?? "",
            release_date: date ? String(date).slice(0, 10) : null,
            poster_path: x.poster_path ?? null,
            vote_average: typeof x.vote_average === "number" ? x.vote_average : null,
          };
        })
        .sort((a, b) => {
          // Sort by release date descending, unknown dates last
          if (!a.release_date && !b.release_date) return 0;
          if (!a.release_date) return 1;
          if (!b.release_date) return -1;
          return b.release_date.localeCompare(a.release_date);
        })
        .slice(0, 50);

      return {
        id: Number(person.id),
        name: person.name ?? "",
        biography: person.biography ?? "",
        known_for_department: person.known_for_department ?? "",
        profile_path: person.profile_path ?? null,
        birthday: person.birthday || null,
        deathday: person.deathday || null,
        place_of_birth: person.place_of_birth || null,
        also_known_as: Array.isArray(person.also_known_as) ? person.also_known_as : [],
        credits: mapped,
      };
    } catch {
      return null;
    }
  });


// -- Discover / trending -----------------------------------------------------

const TrendingInput = z.object({
  type: z.enum(["movie", "tv"]),
  mode: z.enum(["trending", "popular", "top_rated", "upcoming"]).default("trending"),
});

export const tmdbTrendingFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TrendingInput.parse(d))
  .handler(async ({ data }): Promise<TmdbSearchHit[]> => {
    const key = process.env.TMDB_API_KEY;
    if (!key) throw new Error("TMDB_API_KEY is not configured");
    const path =
      data.mode === "trending"
        ? `/trending/${data.type}/week`
        : data.mode === "upcoming"
          ? data.type === "movie"
            ? "/movie/upcoming"
            : "/tv/on_the_air"
          : `/${data.type}/${data.mode}`;
    try {
      const r = await tmdbGet(path, key, { page: "1" });
      const results: any[] = Array.isArray(r.results) ? r.results : [];
      return results.slice(0, 20).map((x): TmdbSearchHit => {
        const date = (data.type === "movie" ? x.release_date : x.first_air_date) || null;
        return {
          type: data.type,
          tmdb_id: Number(x.id),
          title:
            data.type === "movie"
              ? (x.title ?? x.original_title ?? "Untitled")
              : (x.name ?? x.original_name ?? "Untitled"),
          overview: x.overview ?? "",
          poster_path: x.poster_path ?? null,
          backdrop_path: x.backdrop_path ?? null,
          year: date ? String(date).slice(0, 4) : null,
          vote_average: typeof x.vote_average === "number" ? x.vote_average : null,
        };
      });
    } catch {
      return [];
    }
  });

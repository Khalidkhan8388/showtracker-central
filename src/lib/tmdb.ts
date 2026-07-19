const BASE = "https://api.themoviedb.org/3";
export const IMG = (path: string | null | undefined, size: "w200" | "w342" | "w500" | "original" = "w500") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : "";

export function getKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("tmdb_key");
}

async function req<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const key = getKey();
  if (!key) throw new Error("Missing TMDB API key. Add it in Settings.");
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${await res.text()}`);
  return res.json();
}

export type MultiResult = {
  id: number;
  media_type: "movie" | "tv" | "person";
  title?: string;
  name?: string;
  poster_path?: string | null;
  profile_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  known_for_department?: string;
};

export const tmdb = {
  multiSearch: (query: string) =>
    req<{ results: MultiResult[] }>("/search/multi", { query, include_adult: "false" }),
  movie: (id: string | number) =>
    req<any>(`/movie/${id}`, { append_to_response: "credits" }),
  tv: (id: string | number) =>
    req<any>(`/tv/${id}`, { append_to_response: "credits" }),
  season: (id: string | number, season: string | number) =>
    req<any>(`/tv/${id}/season/${season}`),
  person: (id: string | number) =>
    req<any>(`/person/${id}`, { append_to_response: "combined_credits" }),
  trending: () => req<{ results: MultiResult[] }>("/trending/all/week"),
};

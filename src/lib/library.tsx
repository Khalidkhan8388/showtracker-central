import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

export type MovieItem = {
  id: number;
  title: string;
  poster: string | null;
  year: string;
  status: "watchlist" | "watched";
  rating?: number;
  note?: string;
  addedAt: number;
};

export type ShowItem = {
  id: number;
  name: string;
  poster: string | null;
  status: "watchlist" | "watching" | "completed";
  rating?: number;
  note?: string;
  addedAt: number;
  watchedEpisodes: Record<string, number[]>; // seasonNum -> [episodeNumbers]
};

export type PersonItem = {
  id: number;
  name: string;
  photo: string | null;
  followedAt: number;
};

type LibraryState = {
  movies: Record<number, MovieItem>;
  shows: Record<number, ShowItem>;
  people: Record<number, PersonItem>;
};

const STORAGE_KEY = "media_tracker_library_v1";

const empty: LibraryState = { movies: {}, shows: {}, people: {} };

function load(): LibraryState {
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    return { ...empty, ...JSON.parse(raw) };
  } catch {
    return empty;
  }
}

function save(s: LibraryState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

type Ctx = {
  hydrated: boolean;
  state: LibraryState;
  setMovie: (m: MovieItem | null, id: number) => void;
  setShow: (s: ShowItem | null, id: number) => void;
  setPerson: (p: PersonItem | null, id: number) => void;
  toggleEpisode: (showId: number, showBase: Omit<ShowItem, "watchedEpisodes" | "status" | "addedAt"> & { status?: ShowItem["status"] }, season: number, episode: number) => void;
  markSeason: (showId: number, showBase: Omit<ShowItem, "watchedEpisodes" | "status" | "addedAt"> & { status?: ShowItem["status"] }, season: number, episodes: number[]) => void;
  replaceAll: (s: LibraryState) => void;
};

const LibraryCtx = createContext<Ctx | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LibraryState>(empty);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(load());
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setState(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((updater: (s: LibraryState) => LibraryState) => {
    setState((prev) => {
      const next = updater(prev);
      save(next);
      return next;
    });
  }, []);

  const setMovie = useCallback((m: MovieItem | null, id: number) => {
    update((s) => {
      const movies = { ...s.movies };
      if (m) movies[id] = m; else delete movies[id];
      return { ...s, movies };
    });
  }, [update]);

  const setShow = useCallback((sh: ShowItem | null, id: number) => {
    update((s) => {
      const shows = { ...s.shows };
      if (sh) shows[id] = sh; else delete shows[id];
      return { ...s, shows };
    });
  }, [update]);

  const setPerson = useCallback((p: PersonItem | null, id: number) => {
    update((s) => {
      const people = { ...s.people };
      if (p) people[id] = p; else delete people[id];
      return { ...s, people };
    });
  }, [update]);

  const toggleEpisode = useCallback((showId: number, showBase: any, season: number, episode: number) => {
    update((s) => {
      const existing = s.shows[showId];
      const base: ShowItem = existing ?? {
        id: showId,
        name: showBase.name,
        poster: showBase.poster,
        status: "watching",
        addedAt: Date.now(),
        watchedEpisodes: {},
      };
      const key = String(season);
      const arr = new Set(base.watchedEpisodes[key] ?? []);
      if (arr.has(episode)) arr.delete(episode); else arr.add(episode);
      const watchedEpisodes = { ...base.watchedEpisodes, [key]: Array.from(arr).sort((a, b) => a - b) };
      const status: ShowItem["status"] = existing?.status === "completed" ? "completed" : "watching";
      return { ...s, shows: { ...s.shows, [showId]: { ...base, watchedEpisodes, status } } };
    });
  }, [update]);

  const markSeason = useCallback((showId: number, showBase: any, season: number, episodes: number[]) => {
    update((s) => {
      const existing = s.shows[showId];
      const base: ShowItem = existing ?? {
        id: showId,
        name: showBase.name,
        poster: showBase.poster,
        status: "watching",
        addedAt: Date.now(),
        watchedEpisodes: {},
      };
      const key = String(season);
      const watchedEpisodes = { ...base.watchedEpisodes, [key]: episodes };
      return { ...s, shows: { ...s.shows, [showId]: { ...base, watchedEpisodes, status: existing?.status ?? "watching" } } };
    });
  }, [update]);

  const replaceAll = useCallback((next: LibraryState) => update(() => ({ ...empty, ...next })), [update]);

  return (
    <LibraryCtx.Provider value={{ hydrated, state, setMovie, setShow, setPerson, toggleEpisode, markSeason, replaceAll }}>
      {children}
    </LibraryCtx.Provider>
  );
}

export function useLibrary() {
  const ctx = useContext(LibraryCtx);
  if (!ctx) throw new Error("useLibrary must be used within LibraryProvider");
  return ctx;
}

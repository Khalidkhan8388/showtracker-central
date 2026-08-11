import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { addTmdbMedia } from "@/lib/notes.functions";
import { searchTmdbFn } from "@/lib/tmdb.functions";
import type { TmdbSearchHit } from "@/lib/tmdb.functions";
import { poster as posterUrl } from "@/lib/media";
import { MediaCard } from "@/components/MediaCard";
import { haptic } from "@/lib/haptics";
import type { LocalMedia, LocalNote } from "@/lib/local-db";
import { TabBar } from "@/components/TabBar";
import { TitlePill } from "@/components/TitlePill";
import { Search, Loader2, X, Clock, Plus, Check, Film, Tv, Star } from "lucide-react";

export const Route = createFileRoute("/_authenticated/search")({
  head: () => ({
    meta: [
      { title: "Search Movies & TV — Braintape" },
      { name: "description", content: "Find any movie or TV show and add it to your tracker." },
      { property: "og:title", content: "Search Movies & TV — Braintape" },
      { property: "og:description", content: "Find any movie or TV show and add it to your tracker." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchPage,
});

const RECENTS_KEY = "braintape.search.recents";

function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]").slice(0, 6);
  } catch {
    return [];
  }
}

function pushRecent(q: string) {
  if (!q.trim()) return;
  const prev = loadRecents().filter((x) => x.toLowerCase() !== q.toLowerCase());
  localStorage.setItem(RECENTS_KEY, JSON.stringify([q, ...prev].slice(0, 6)));
}

function SearchPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const localNotes = useLocalNotes();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [kbOffset, setKbOffset] = useState(0);

  const mediaNotes = useMemo(
    () => ((localNotes ?? []) as LocalNote[]).filter((n) => !!n.media && !n.deleted_at),
    [localNotes],
  );

  const savedByKey = useMemo(() => {
    const m = new Map<string, LocalNote>();
    for (const n of mediaNotes) {
      if (n.media?.tmdb_id && n.media?.type) m.set(`${n.media.type}:${n.media.tmdb_id}`, n);
    }
    return m;
  }, [mediaNotes]);

  useEffect(() => setRecents(loadRecents()), []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setKbOffset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Debounce keystrokes, then let React Query cache/dedupe the request.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  const enabled = debounced.length >= 2;
  const { data, isFetching } = useQuery({
    queryKey: ["tmdb-search", debounced],
    queryFn: () => searchTmdbFn({ data: { query: debounced } }),
    enabled,
    staleTime: 1000 * 60 * 10,
    placeholderData: keepPreviousData,
  });

  const hits = useMemo<TmdbSearchHit[]>(() => (enabled ? (data ?? []) : []), [enabled, data]);
  const loading = enabled && isFetching;

  async function addMedia(hit: TmdbSearchHit) {
    const key = `${hit.type}:${hit.tmdb_id}`;
    if (adding.has(key) || savedByKey.has(key)) return;
    void haptic.impact();
    setAdding((s) => new Set(s).add(key));
    try {
      await addTmdbMedia({ data: { type: hit.type, tmdb_id: hit.tmdb_id } });
      pushRecent(query);
      setRecents(loadRecents());
      toast.success(`Added ${hit.title} to your library`);
    } catch {
      toast.error(`Couldn't add ${hit.title}`);
    } finally {
      setAdding((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  }

  const library = useMemo(() => {
    const q = debounced.toLowerCase();
    if (!q) return mediaNotes.slice(0, 12);
    return mediaNotes.filter((n) => (n.media?.title ?? "").toLowerCase().includes(q));
  }, [mediaNotes, debounced]);

  const idle = !enabled;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      <TitlePill>Search</TitlePill>

      <div className="px-4 pt-4" style={{ paddingBottom: 220 + kbOffset, contentVisibility: "auto" }}>

        {/* Your library */}
        {library.length > 0 && (
          <section className="mb-6">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {idle ? "Your library" : "In your library"}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{library.length}</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {library.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    void haptic.tap();
                    void navigate({ to: "/notes/$id", params: { id: n.id } });
                  }}
                  className="text-left active:opacity-80"
                >
                  <div className="aspect-[2/3] w-full">
                    <MediaCard media={n.media as LocalMedia} variant="grid" pinned={n.pinned} />
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* TMDB results */}
        {!idle && (
          <section className="mb-6">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Movies &amp; TV
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {loading ? "…" : hits.length}
              </span>
            </div>

            {loading && hits.length === 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="animate-pulse overflow-hidden rounded-[15px] bg-muted"
                    style={{ aspectRatio: "2 / 3" }}
                  />
                ))}
              </div>
            ) : hits.length === 0 ? (
              <div className="rounded-2xl bg-card px-4 py-10 text-center text-[13px] text-muted-foreground">
                <div className="mb-1 font-medium text-foreground">No matches</div>
                Try a different title.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {hits.map((hit) => {
                  const key = `${hit.type}:${hit.tmdb_id}`;
                  const busy = adding.has(key);
                  const saved = savedByKey.get(key);
                  const poster = posterUrl(hit.poster_path, "w342");
                  return (
                    <div
                      key={key}
                      className="relative overflow-hidden bg-muted"
                      style={{ aspectRatio: "2 / 3", borderRadius: 15 }}
                    >
                      {poster ? (
                        <img
                          src={poster}
                          alt={hit.title}
                          loading="lazy"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                          {hit.type === "tv" ? <Tv className="h-6 w-6" /> : <Film className="h-6 w-6" />}
                        </div>
                      )}

                      {hit.vote_average != null && hit.vote_average > 0 && (
                        <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
                          <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                          {hit.vote_average.toFixed(1)}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          if (saved) {
                            void haptic.tap();
                            void navigate({ to: "/notes/$id", params: { id: saved.id } });
                          } else {
                            void addMedia(hit);
                          }
                        }}
                        disabled={busy}
                        aria-label={saved ? `Open ${hit.title}` : `Add ${hit.title}`}
                        className="absolute bottom-1.5 right-1.5 z-10 grid h-7 w-7 place-items-center rounded-full bg-white/95 text-neutral-900 shadow-lg backdrop-blur-md transition active:scale-95"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : saved ? (
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        ) : (
                          <Plus className="h-3.5 w-3.5" strokeWidth={3} />
                        )}
                      </button>

                      <div className="absolute inset-x-0 bottom-0 scrim-t p-2 pt-8">
                        <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
                          {hit.type === "tv" ? <Tv className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
                          {hit.type === "tv" ? "TV" : "Movie"}
                        </span>
                        <p className="line-clamp-2 text-[12px] font-semibold leading-tight scrim-fg">
                          {hit.title}
                        </p>
                        <p className="text-[10px] scrim-fg-70">{hit.year ?? "—"}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Recents */}
        {idle && recents.length > 0 && (
          <div className="mt-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Recent
              </span>
              <button
                onClick={() => {
                  localStorage.removeItem(RECENTS_KEY);
                  setRecents([]);
                }}
                className="text-[11px] text-primary active:opacity-60"
              >
                Clear
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recents.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setQuery(r);
                    inputRef.current?.focus();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[12px] text-foreground active:opacity-60"
                >
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating search field */}
      <div
        className="fixed inset-x-0 bottom-[96px] z-40 px-4"
        style={{ transform: `translateY(-${kbOffset}px)` }}
      >
        <div className="mx-auto flex max-w-md items-center gap-2 rounded-full glass-pill px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-neutral-900/60 dark:text-white/60" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies & TV"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-900/45 dark:text-white dark:placeholder:text-white/45"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="grid h-6 w-6 place-items-center rounded-full bg-black/10 text-neutral-900 dark:bg-white/15 dark:text-white"
            >
              <X className="h-3 w-3" strokeWidth={3} />
            </button>
          )}
        </div>
      </div>
      <TabBar />
    </div>
  );
}

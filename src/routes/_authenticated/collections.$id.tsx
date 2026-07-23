import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Trash2, Plus, X, Check, LayoutGrid, List as ListIcon, CalendarClock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCollection, removeNotesFromCollection, addNotesToCollection, renameCollection, deleteCollection } from "@/lib/collections";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { formatDistanceToNow, format } from "date-fns";
import { getCachedPhotoUrl, warmPhotoCache } from "@/lib/photo-cache";
import { poster as tmdbPoster, still as tmdbStill, WATCH_LABEL, WATCH_COLORS, totalEpisodes as mediaTotal, watchedCount as mediaDone, epKey, toggleEpisodeWatched } from "@/lib/media";
import type { WatchStatus, LocalMedia, LocalMediaEpisode } from "@/lib/local-db";



export const Route = createFileRoute("/_authenticated/collections/$id")({
  head: () => ({
    meta: [
      { title: "Collection — Braintape" },
      { name: "description", content: "Memories in this collection." },
    ],
  }),
  component: CollectionDetail,
});

function CollectionDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const collection = useCollection(id);
  const notes = useLocalNotes();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [view, setView] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    return (localStorage.getItem("collection-view") as "list" | "grid") ?? "list";
  });
  function setViewMode(v: "list" | "grid") {
    setView(v);
    if (typeof window !== "undefined") localStorage.setItem("collection-view", v);
  }

  const memberIds = useMemo(() => new Set(collection?.note_ids ?? []), [collection]);
  const allMembers = useMemo(
    () => (notes ?? []).filter((n) => memberIds.has(n.id) && !n.deleted_at),
    [notes, memberIds],
  );
  const [statusFilter, setStatusFilter] = useState<WatchStatus | "all">("all");
  const [tvView, setTvView] = useState<"posters" | "episodes">("posters");
  const mediaMembers = useMemo(
    () => allMembers.filter((n) => !!(n as any).media),
    [allMembers],
  );
  const hasMedia = mediaMembers.length > 0;
  const hasTv = useMemo(() => mediaMembers.some((n) => (n as any).media?.type === "tv"), [mediaMembers]);

  const statusCounts = useMemo(() => {
    const c: Record<WatchStatus | "all", number> = {
      all: mediaMembers.length,
      watchlist: 0,
      watching: 0,
      watched: 0,
      dropped: 0,
    };
    for (const n of mediaMembers) {
      const s = ((n as any).media?.watch_status ?? null) as WatchStatus | null;
      if (s) c[s]++;
    }
    return c;
  }, [mediaMembers]);
  const members = useMemo(() => {
    if (!hasMedia || statusFilter === "all") return allMembers;
    return allMembers.filter((n) => {
      const m = (n as any).media;
      return m && m.watch_status === statusFilter;
    });
  }, [allMembers, hasMedia, statusFilter]);
  const candidates = useMemo(
    () => (notes ?? []).filter((n) => !memberIds.has(n.id) && !n.deleted_at && n.heading !== "__custom__"),
    [notes, memberIds],
  );


  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    const paths: string[] = [];
    const pairs: Array<{ id: string; path: string }> = [];
    for (const n of members) {
      const p = Array.isArray((n as any).image_paths) ? (n as any).image_paths[0] : null;
      if (!p) continue;
      paths.push(p);
      pairs.push({ id: n.id, path: p });
    }
    if (!paths.length) return;
    // Prime from in-memory cache immediately
    setThumbs((cur) => {
      let next = cur;
      for (const { id: nid, path } of pairs) {
        const u = getCachedPhotoUrl(path);
        if (u && next[nid] !== u) {
          if (next === cur) next = { ...cur };
          next[nid] = u;
        }
      }
      return next;
    });
    void warmPhotoCache(paths).then(() => {
      setThumbs((cur) => {
        let next = cur;
        for (const { id: nid, path } of pairs) {
          const u = getCachedPhotoUrl(path);
          if (u && next[nid] !== u) {
            if (next === cur) next = { ...cur };
            next[nid] = u;
          }
        }
        return next;
      });
    });
  }, [members]);

  if (collection === null) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="text-[15px] text-muted-foreground">Collection not found.</p>
        <Link to="/collections" className="rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground">
          Back to collections
        </Link>
      </div>
    );
  }
  if (collection === undefined) return null;

  function togglePick(nid: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(nid)) next.delete(nid);
      else next.add(nid);
      return next;
    });
  }

  async function confirmAdd() {
    if (picked.size === 0) {
      setPicking(false);
      return;
    }
    await addNotesToCollection(id, Array.from(picked));
    setPicked(new Set());
    setPicking(false);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background">
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                window.history.back();
              } else {
                navigate({ to: "/collections" });
              }
            }}
            aria-label="Back"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:opacity-70"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          {editingTitle ? (
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (title.trim()) await renameCollection(id, title);
                setEditingTitle(false);
              }}
            >
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={async () => {
                  if (title.trim()) await renameCollection(id, title);
                  setEditingTitle(false);
                }}
                className="flex-1 bg-transparent text-[22px] font-bold tracking-tight outline-none"
                maxLength={80}
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setTitle(collection.title);
                setEditingTitle(true);
              }}
              className="flex-1 truncate text-left text-[22px] font-bold tracking-tight"
            >
              {collection.title}
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              if (confirm(`Delete "${collection.title}"? Memories inside won't be deleted.`)) {
                await deleteCollection(id);
                navigate({ to: "/collections" });
              }
            }}
            aria-label="Delete collection"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <section className="flex-1 px-4 pb-24 pt-4">
        {picking ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] text-muted-foreground">
                Select memories to add ({picked.size})
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPicked(new Set());
                    setPicking(false);
                  }}
                  className="rounded-full px-3 py-1.5 text-[13px] font-medium text-muted-foreground active:opacity-70"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAdd}
                  className="rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground active:opacity-80"
                >
                  Add
                </button>
              </div>
            </div>
            {candidates.length === 0 ? (
              <p className="rounded-2xl bg-card px-4 py-8 text-center text-[13px] text-muted-foreground ring-1 ring-border/60">
                No other memories to add.
              </p>
            ) : (
              <ul className="space-y-2">
                {candidates.map((n) => {
                  const sel = picked.has(n.id);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => togglePick(n.id)}
                        className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left shadow-sm ring-1 transition-colors ${
                          sel ? "bg-primary/10 ring-primary/40" : "bg-card ring-border/60"
                        }`}
                      >
                        <div
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            sel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                          }`}
                        >
                          {sel && <Check className="h-3 w-3" strokeWidth={3} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold text-foreground">
                            {n.heading ?? "Untitled"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-3 text-[14px] font-semibold text-muted-foreground active:opacity-70"
              >
                <Plus className="h-4 w-4" />
                Add memories
              </button>
            </div>
            <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
              <div className="pointer-events-auto inline-flex items-center gap-0 rounded-full bg-white/90 p-1 shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150 dark:bg-neutral-900/90 dark:ring-white/10">
                {hasTv && (
                  <>
                    <button
                      type="button"
                      onClick={() => setTvView("posters")}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
                        tvView === "posters"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-neutral-900 hover:bg-black/5 dark:text-white dark:hover:bg-white/10"
                      }`}
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                      Posters
                    </button>
                    <button
                      type="button"
                      onClick={() => setTvView("episodes")}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
                        tvView === "episodes"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-neutral-900 hover:bg-black/5 dark:text-white dark:hover:bg-white/10"
                      }`}
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      Episodes
                    </button>
                  </>
                )}
                {(!hasTv || tvView === "posters") && (
                  <>
                    {hasTv && <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />}
                    <button
                      type="button"
                      aria-label="List view"
                      onClick={() => setViewMode("list")}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                        view === "list"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-neutral-900 hover:bg-black/5 dark:text-white dark:hover:bg-white/10"
                      }`}
                    >
                      <ListIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Grid view"
                      onClick={() => setViewMode("grid")}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                        view === "grid"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-neutral-900 hover:bg-black/5 dark:text-white dark:hover:bg-white/10"
                      }`}
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {hasTv && tvView === "episodes" ? (
              <EpisodeTracker members={mediaMembers} />
            ) : (
            <>
            {hasMedia && (
              <div className="-mx-4 mb-3 overflow-x-auto px-4">
                <div className="inline-flex min-w-full gap-1.5">
                  {((hasTv
                    ? ["all", "watchlist", "watching", "watched", "dropped"]
                    : ["all", "watchlist", "watching", "watched"]) as Array<WatchStatus | "all">).map((s) => {

                    const active = statusFilter === s;
                    const label = s === "all" ? "All" : WATCH_LABEL[s];
                    const count = statusCounts[s];
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStatusFilter(s)}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-card text-muted-foreground ring-1 ring-border/60 active:opacity-70"
                        }`}
                      >
                        {label}
                        <span className={`ml-1.5 text-[11px] ${active ? "text-primary-foreground/80" : "text-muted-foreground/70"}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {members.length === 0 ? (
              <p className="rounded-2xl bg-card px-4 py-8 text-center text-[13px] text-muted-foreground ring-1 ring-border/60">
                {hasMedia && statusFilter !== "all" ? "Nothing here for this status." : "This collection is empty."}
              </p>

            ) : view === "list" ? (
              <ul className="space-y-2">
                {members.map((n) => {
                  const media = (n as any).media as import("@/lib/local-db").LocalMedia | undefined;
                  const posterUrl = media?.poster_path ? tmdbPoster(media.poster_path, "w185") : null;
                  const isTvMedia = media?.type === "tv";
                  const tvTotal = isTvMedia ? mediaTotal(media!) : 0;
                  const tvDone = isTvMedia ? mediaDone(media!) : 0;
                  const tvPct = tvTotal > 0 ? Math.round((tvDone / tvTotal) * 100) : 0;
                  const isDropped = media?.watch_status === "dropped";
                  const year = media?.release_date ? media.release_date.slice(0, 4) : null;
                  return (
                    <li key={n.id}>
                      <div className="flex items-center gap-2">
                        <Link
                          to="/notes/$id"
                          params={{ id: n.id }}
                          className="flex flex-1 items-stretch gap-3 overflow-hidden rounded-2xl bg-card p-2 shadow-sm ring-1 ring-border/60 active:opacity-80"
                        >
                          {media ? (
                            <>
                              <div className="relative h-[102px] w-[68px] shrink-0 overflow-hidden bg-muted" style={{ borderRadius: 10 }}>
                                {posterUrl ? (
                                  <img
                                    src={posterUrl}
                                    alt={media.title}
                                    loading="lazy"
                                    className={`h-full w-full object-cover ${isDropped ? "grayscale" : ""}`}
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                                    {isTvMedia ? "TV" : "Movie"}
                                  </div>
                                )}
                              </div>
                              <div className="flex min-w-0 flex-1 flex-col justify-between py-1 pr-1">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      {isTvMedia ? "TV" : "Movie"}
                                    </span>
                                    {year && (
                                      <span className="text-[10px] text-muted-foreground">• {year}</span>
                                    )}
                                    {typeof media.vote_average === "number" && media.vote_average > 0 && (
                                      <span className="text-[10px] font-semibold text-amber-500">★ {media.vote_average.toFixed(1)}</span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 line-clamp-1 text-[14px] font-semibold text-foreground">
                                    {media.title}
                                  </p>
                                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                                    {media.tagline || media.overview || "No description."}
                                  </p>
                                </div>
                                <div className="mt-1 flex items-center gap-2">
                                  {media.watch_status && (
                                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${WATCH_COLORS[media.watch_status]}`}>
                                      {WATCH_LABEL[media.watch_status]}
                                    </span>
                                  )}
                                  {isTvMedia && tvTotal > 0 ? (
                                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                                        <div className="h-full rounded-full bg-primary" style={{ width: `${tvPct}%` }} />
                                      </div>
                                      <span className="shrink-0 text-[10px] font-medium text-muted-foreground">{tvDone}/{tvTotal}</span>
                                    </div>
                                  ) : media.runtime ? (
                                    <span className="text-[10px] text-muted-foreground">{media.runtime}m</span>
                                  ) : null}
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="min-w-0 flex-1 px-2 py-1.5">
                              <p className="truncate text-[14px] font-semibold text-foreground">
                                {n.heading ?? "Untitled"}
                              </p>
                              <p className="truncate text-[12px] text-muted-foreground">
                                {n.summary ?? formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                              </p>
                            </div>
                          )}
                        </Link>
                        <button
                          type="button"
                          onClick={() => void removeNotesFromCollection(id, [n.id])}
                          aria-label="Remove from collection"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

            ) : (
              <ul className="grid grid-cols-3 gap-2.5">
                {members.map((n) => {
                  const media = (n as any).media as import("@/lib/local-db").LocalMedia | undefined;
                  const posterUrl = media?.poster_path ? tmdbPoster(media.poster_path, "w342") : null;
                  const thumb = thumbs[n.id];
                  const isMedia = !!posterUrl;
                  const isTvMedia = media?.type === "tv";
                  const tvTotal = isTvMedia ? mediaTotal(media!) : 0;
                  const tvDone = isTvMedia ? mediaDone(media!) : 0;
                  const tvPct = tvTotal > 0 ? Math.round((tvDone / tvTotal) * 100) : 0;
                  const isDropped = media?.watch_status === "dropped";
                  return (
                    <li key={n.id} className="relative">
                      <Link
                        to="/notes/$id"
                        params={{ id: n.id }}
                        style={isMedia ? { borderRadius: 15 } : undefined}
                        className={`relative flex ${isMedia ? "aspect-[2/3]" : "aspect-square rounded-2xl"} flex-col justify-between overflow-hidden bg-card shadow-sm ring-1 ring-border/60 active:opacity-80`}
                      >
                        {isMedia ? (
                          <>
                            <img
                              src={posterUrl!}
                              alt={media?.title ?? n.heading ?? "Poster"}
                              loading="lazy"
                              className={`absolute inset-0 h-full w-full object-cover ${isDropped ? "grayscale" : ""}`}
                            />
                            <div className="absolute inset-x-0 bottom-0 scrim-t p-2.5 pt-8">
                              {media?.watch_status && (
                                <span className={`mb-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shadow-sm ${WATCH_COLORS[media.watch_status]}`}>
                                  {WATCH_LABEL[media.watch_status]}
                                </span>
                              )}
                              <p className="line-clamp-2 text-[12px] font-semibold scrim-fg">
                                {media?.title ?? n.heading ?? "Untitled"}
                              </p>
                              {isTvMedia && tvTotal > 0 && (
                                <div className="mt-1.5">
                                  <div className="flex items-center justify-between text-[10px] font-medium scrim-fg-80">
                                    <span>{tvDone}/{tvTotal} ep</span>
                                    <span>{tvPct}%</span>
                                  </div>
                                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full scrim-track">
                                    <div className="h-full rounded-full scrim-fill" style={{ width: `${tvPct}%` }} />
                                  </div>
                                </div>
                              )}
                            </div>

                          </>

                        ) : thumb ? (
                          <>
                            <img
                              src={thumb}
                              alt={n.heading ?? "Memory"}
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                            <div className="absolute inset-0 scrim-t" />
                            <div className="relative z-10 mt-auto p-3">
                              <p className="line-clamp-2 text-[13px] font-semibold scrim-fg">
                                {n.heading ?? "Untitled"}
                              </p>
                              <p className="mt-0.5 text-[10px] scrim-fg-70">
                                {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                              </p>
                            </div>

                          </>
                        ) : (
                          <div className="flex h-full w-full flex-col justify-between p-3">
                            <p className="text-[11px] text-muted-foreground">
                              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                            </p>
                            <div>
                              <p className="line-clamp-2 text-[14px] font-semibold text-foreground">
                                {n.heading ?? "Untitled"}
                              </p>
                              {n.summary && (
                                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                  {n.summary}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </Link>
                      <button
                        type="button"
                        onClick={() => void removeNotesFromCollection(id, [n.id])}
                        aria-label="Remove from collection"
                        className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur active:opacity-70"
                      >

                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

type TvMember = { id: string; heading: string | null; media: LocalMedia };
type EpisodeRow = {
  note: TvMember;
  ep: LocalMediaEpisode;
  airMs: number | null;
  watched: boolean;
};

function EpisodeTracker({ members }: { members: Array<{ id: string; heading: string | null; media?: LocalMedia | null }> }) {
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

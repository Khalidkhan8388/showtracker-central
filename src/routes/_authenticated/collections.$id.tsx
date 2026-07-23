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
          <Link
            to="/collections"
            aria-label="Back"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:opacity-70"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
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
              <div className="inline-flex rounded-full bg-card p-1 ring-1 ring-border/60">
                <button
                  type="button"
                  aria-label="List view"
                  onClick={() => setViewMode("list")}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                    view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  <ListIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Grid view"
                  onClick={() => setViewMode("grid")}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                    view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </div>
            </div>
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
                {members.map((n) => (
                  <li key={n.id}>
                    <div className="flex items-center gap-2">
                      <Link
                        to="/notes/$id"
                        params={{ id: n.id }}
                        className="flex flex-1 items-center gap-3 overflow-hidden rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-border/60 active:opacity-80"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold text-foreground">
                            {n.heading ?? "Untitled"}
                          </p>
                          <p className="truncate text-[12px] text-muted-foreground">
                            {n.summary ?? formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                          </p>
                        </div>
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
                ))}
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
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5 pt-8">
                              {media?.watch_status && (
                                <span className={`mb-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shadow-sm ${WATCH_COLORS[media.watch_status]}`}>
                                  {WATCH_LABEL[media.watch_status]}
                                </span>
                              )}
                              <p className="line-clamp-2 text-[12px] font-semibold text-white">
                                {media?.title ?? n.heading ?? "Untitled"}
                              </p>
                              {isTvMedia && tvTotal > 0 && (
                                <div className="mt-1.5">
                                  <div className="flex items-center justify-between text-[10px] font-medium text-white/85">
                                    <span>{tvDone}/{tvTotal} ep</span>
                                    <span>{tvPct}%</span>
                                  </div>
                                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/20">
                                    <div className="h-full rounded-full bg-white" style={{ width: `${tvPct}%` }} />
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
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                            <div className="relative z-10 mt-auto p-3">
                              <p className="line-clamp-2 text-[13px] font-semibold text-white">
                                {n.heading ?? "Untitled"}
                              </p>
                              <p className="mt-0.5 text-[10px] text-white/70">
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
      </section>
    </div>
  );
}

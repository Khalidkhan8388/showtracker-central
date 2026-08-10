import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Trash2, Plus, X, Check, LayoutGrid, List as ListIcon, CalendarClock, BarChart3, Clock, Film, Tv, Eye, PlayCircle, XCircle, Pin, ArrowUpDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useEffect, useMemo, useState } from "react";
import { useCollection, removeNotesFromCollection, addNotesToCollection, renameCollection, deleteCollection } from "@/lib/collections";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { formatDistanceToNow, format } from "date-fns";
import { getCachedPhotoUrl, warmPhotoCache } from "@/lib/photo-cache";
import { BackButton } from "@/components/BackButton";
import { poster as tmdbPoster, still as tmdbStill, WATCH_LABEL, WATCH_COLORS, totalEpisodes as mediaTotal, watchedCount as mediaDone, epKey, toggleEpisodeWatched, setWatchStatus } from "@/lib/media";
import { deleteNotes, pinNote } from "@/lib/notes.functions";
import type { WatchStatus, LocalMedia, LocalMediaEpisode } from "@/lib/local-db";
import { useLongPress } from "@/lib/use-long-press";

import { WatchHistorySection } from "@/components/WatchHistorySection";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { fetchTmdbLogoFn } from "@/lib/tmdb.functions";





type SortKey =
  | "added-desc"
  | "added-asc"
  | "release-desc"
  | "release-asc"
  | "title"
  | "rating"
  | "status"
  | "progress";

const SORT_LABEL: Record<SortKey, string> = {
  "added-desc": "Recently added",
  "added-asc": "Oldest added",
  "release-desc": "Release date — newest",
  "release-asc": "Release date — oldest",
  title: "Title A–Z",
  rating: "Rating",
  status: "Watch status",
  progress: "Progress",
};

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
  const [removing, setRemoving] = useState(false);
  const [removeSel, setRemoveSel] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
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
  const [sort, setSort] = useState<SortKey>(() => {
    if (typeof window === "undefined") return "added-desc";
    return ((localStorage.getItem("collection-sort") as SortKey) ?? "added-desc");
  });
  function setSortMode(s: SortKey) {
    setSort(s);
    if (typeof window !== "undefined") localStorage.setItem("collection-sort", s);
  }
  const [tvView, setTvView] = useState<"posters" | "episodes" | "stats">("posters");

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
    const base = !hasMedia || statusFilter === "all"
      ? allMembers
      : allMembers.filter((n) => {
          const m = (n as any).media;
          return m && m.watch_status === statusFilter;
        });

    const md = (n: any): LocalMedia | null => (n?.media ?? null) as LocalMedia | null;
    const releaseMs = (n: any) => {
      const m = md(n);
      const d = m?.release_date || (m as any)?.last_air_date || null;
      const t = d ? Date.parse(d) : NaN;
      return Number.isNaN(t) ? null : t;
    };
    const titleOf = (n: any) => (md(n)?.title || n.heading || "").toLowerCase();
    const progressOf = (n: any) => {
      const m = md(n);
      if (!m || m.type !== "tv") return -1;
      const total = mediaTotal(m);
      return total ? mediaDone(m) / total : 0;
    };
    const STATUS_ORDER: Record<string, number> = { watching: 0, watchlist: 1, watched: 2, dropped: 3 };

    const cmp = (a: any, b: any) => {
      switch (sort) {
        case "release-desc": {
          const x = releaseMs(a), y = releaseMs(b);
          if (x === null && y === null) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          return y - x;
        }
        case "release-asc": {
          const x = releaseMs(a), y = releaseMs(b);
          if (x === null && y === null) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          return x - y;
        }
        case "title":
          return titleOf(a).localeCompare(titleOf(b));
        case "rating":
          return (md(b)?.vote_average ?? -1) - (md(a)?.vote_average ?? -1);
        case "status":
          return (STATUS_ORDER[md(a)?.watch_status ?? ""] ?? 9) - (STATUS_ORDER[md(b)?.watch_status ?? ""] ?? 9);
        case "progress":
          return progressOf(b) - progressOf(a);
        case "added-asc":
          return (a.created_at ?? "").localeCompare(b.created_at ?? "");
        case "added-desc":
        default:
          return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      }
    };

    // pinned first, then chosen sort
    return [...base].sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || cmp(a, b));
  }, [allMembers, hasMedia, statusFilter, sort]);

  const allSelectedPinned = useMemo(() => {
    if (removeSel.size === 0) return false;
    for (const id of removeSel) {
      const n = allMembers.find((x) => x.id === id);
      if (!n?.pinned) return false;
    }
    return true;
  }, [removeSel, allMembers]);
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
          <BackButton
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                window.history.back();
              } else {
                void navigate({ to: "/collections" });
              }
            }}
          />
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
                className="flex-1 bg-transparent text-[17px] font-semibold outline-none"
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
              className="flex-1 truncate text-left text-[17px] font-semibold"
            >
              {collection.title}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete collection"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground press-bounce active:opacity-70"
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
                  className="rounded-full px-3 py-1.5 text-[13px] font-medium text-muted-foreground press-bounce active:opacity-70"
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
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] border ${
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
                onClick={() => {
                  if (hasMedia) {
                    navigate({ to: "/search", search: { tab: "media" } });
                  } else {
                    setPicking(true);
                  }
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-3 text-[14px] font-semibold text-muted-foreground press-bounce active:opacity-70"
              >
                <Plus className="h-4 w-4" />
                Add memories
              </button>
            </div>
            {hasMedia && (
            <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
              <div className="pointer-events-auto inline-flex items-center gap-0 rounded-full glass-pill animate-bounce-up p-1">
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
                {hasTv && (
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
                )}
                <button
                  type="button"
                  onClick={() => setTvView("stats")}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
                    tvView === "stats"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-neutral-900 hover:bg-black/5 dark:text-white dark:hover:bg-white/10"
                  }`}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  Stats
                </button>
                {tvView === "posters" && (
                  <>
                    <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />
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
            )}


            {!hasMedia ? (
              <p className="rounded-2xl bg-card px-4 py-8 text-center text-[13px] text-muted-foreground ring-1 ring-border/60">
                This collection is empty.
              </p>
            ) : hasMedia && tvView === "stats" ? (
              <MediaStats members={mediaMembers} />
            ) : hasTv && tvView === "episodes" ? (
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
                            : "bg-card text-muted-foreground ring-1 ring-border/60 press-bounce active:opacity-70"
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
            {hasMedia && (
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                  {members.length} {members.length === 1 ? "title" : "titles"}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="press-bounce inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-[12px] font-semibold text-muted-foreground ring-1 ring-border/60 active:opacity-70"
                    >
                      <ArrowUpDown className="h-3.5 w-3.5" />
                      {SORT_LABEL[sort]}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-52 rounded-2xl">
                    {(Object.keys(SORT_LABEL) as SortKey[])
                      .filter((k) => (k === "progress" ? hasTv : true))
                      .map((k) => (
                        <DropdownMenuItem
                          key={k}
                          onSelect={() => setSortMode(k)}
                          className="flex items-center justify-between gap-3 rounded-xl text-[13px]"
                        >
                          {SORT_LABEL[k]}
                          {sort === k && <Check className="h-4 w-4" />}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

            )}
            {members.length === 0 ? (
              <p className="rounded-2xl bg-card px-4 py-8 text-center text-[13px] text-muted-foreground ring-1 ring-border/60">
                {hasMedia && statusFilter !== "all" ? "Nothing here for this status." : "This collection is empty."}
              </p>

            ) : view === "list" ? (
              <ul className="space-y-2">
                {members.map((n) => (
                  <MediaListRow
                    key={n.id}
                    note={n as any}
                    selected={removeSel.has(n.id)}
                    selectMode={removing}
                    onOpen={() => {
                      if (removing) {
                        setRemoveSel((prev) => {
                          const next = new Set(prev);
                          next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                          return next;
                        });
                      } else {
                        navigate({ to: "/notes/$id", params: { id: n.id } });
                      }
                    }}
                    onLongPress={() => {
                      setRemoving(true);
                      setRemoveSel(new Set([n.id]));
                    }}
                  />
                ))}
              </ul>

            ) : (
              <ul className="grid grid-cols-3 gap-2.5">
                {members.map((n) => (
                  <MediaGridTile
                    key={n.id}
                    note={n as any}
                    thumb={thumbs[n.id]}
                    selected={removeSel.has(n.id)}
                    selectMode={removing}
                    onOpen={() => {
                      if (removing) {
                        setRemoveSel((prev) => {
                          const next = new Set(prev);
                          next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                          return next;
                        });
                      } else {
                        navigate({ to: "/notes/$id", params: { id: n.id } });
                      }
                    }}
                    onLongPress={() => {
                      setRemoving(true);
                      setRemoveSel(new Set([n.id]));
                    }}
                  />
                ))}
              </ul>
            )}
            </>
            )}
          </>
        )}
      </section>

      {removing && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-1 rounded-full glass-pill animate-bounce-up px-2 py-1.5 text-foreground">
            <button
              type="button"
              onClick={() => { setRemoving(false); setRemoveSel(new Set()); }}
              className="rounded-full px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <span className="px-1 text-[12px] tabular-nums text-muted-foreground">{removeSel.size}</span>
            {hasMedia ? (
              <>
                <BulkPillBtn
                  icon={<Eye className="h-3.5 w-3.5" />}
                  label="Watched"
                  tone="watched"
                  disabled={removeSel.size === 0}
                  onClick={async () => {
                    for (const nid of removeSel) await setWatchStatus(nid, "watched");
                    setRemoving(false); setRemoveSel(new Set());
                  }}
                />
                <BulkPillBtn
                  icon={<PlayCircle className="h-3.5 w-3.5" />}
                  label="Watching"
                  tone="watching"
                  disabled={removeSel.size === 0}
                  onClick={async () => {
                    for (const nid of removeSel) await setWatchStatus(nid, "watching");
                    setRemoving(false); setRemoveSel(new Set());
                  }}
                />
                <BulkPillBtn
                  icon={<XCircle className="h-3.5 w-3.5" />}
                  label="Dropped"
                  tone="dropped"
                  disabled={removeSel.size === 0}
                  onClick={async () => {
                    for (const nid of removeSel) await setWatchStatus(nid, "dropped");
                    setRemoving(false); setRemoveSel(new Set());
                  }}
                />
                <BulkPillBtn
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label="Delete"
                  danger
                  disabled={removeSel.size === 0}
                  onClick={() => setConfirmBulkDelete(true)}
                />
              </>
            ) : (
              <>
                <BulkPillBtn
                  icon={<Pin className="h-3.5 w-3.5" />}
                  label={allSelectedPinned ? "Unpin" : "Pin"}
                  disabled={removeSel.size === 0}
                  onClick={async () => {
                    const pin = !allSelectedPinned;
                    for (const nid of removeSel) await pinNote({ data: { noteId: nid, pinned: pin } });
                    setRemoving(false); setRemoveSel(new Set());
                  }}
                />
                <BulkPillBtn
                  icon={<X className="h-3.5 w-3.5" />}
                  label="Remove"
                  disabled={removeSel.size === 0}
                  onClick={async () => {
                    await removeNotesFromCollection(id, Array.from(removeSel));
                    setRemoving(false); setRemoveSel(new Set());
                  }}
                />
                <BulkPillBtn
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label="Delete"
                  danger
                  disabled={removeSel.size === 0}
                  onClick={() => setConfirmBulkDelete(true)}
                />
              </>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {removeSel.size} {removeSel.size === 1 ? "memory" : "memories"}?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll be moved to trash and removed from every collection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await deleteNotes({ data: { noteIds: Array.from(removeSel) } });
                setConfirmBulkDelete(false);
                setRemoving(false);
                setRemoveSel(new Set());
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{collection?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The collection will be removed. Memories inside won't be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await deleteCollection(id);
                navigate({ to: "/collections" });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { EpisodeTracker, MediaStats } from "@/components/MediaStatsPanel";


function BulkPillBtn({
  icon,
  label,
  onClick,
  disabled,
  danger,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  tone?: "watched" | "watching" | "dropped";
}) {
  const toneClass = danger
    ? "bg-red-500 text-white hover:bg-red-600"
    : tone === "watched"
      ? "bg-emerald-500 text-white hover:bg-emerald-600"
      : tone === "watching"
        ? "bg-sky-500 text-white hover:bg-sky-600"
        : tone === "dropped"
          ? "bg-neutral-500 text-white hover:bg-neutral-600 dark:bg-neutral-600 dark:hover:bg-neutral-500"
          : "bg-muted text-foreground hover:bg-muted/80";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[12px] font-semibold shadow-sm transition-colors disabled:opacity-40 ${toneClass}`}
    >
      {icon}
      {label}
    </button>
  );
}


function MediaListRow({
  note,
  selected,
  selectMode,
  onOpen,
  onLongPress,
}: {
  note: any;
  selected: boolean;
  selectMode: boolean;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const lp = useLongPress(onLongPress);
  const media = note.media as LocalMedia | undefined;
  const posterUrl = media?.poster_path ? tmdbPoster(media.poster_path, "w185") : null;
  const isTvMedia = media?.type === "tv";
  const tvTotal = isTvMedia ? mediaTotal(media!) : 0;
  const tvDone = isTvMedia ? mediaDone(media!) : 0;
  const tvPct = tvTotal > 0 ? Math.round((tvDone / tvTotal) * 100) : 0;
  const isDropped = media?.watch_status === "dropped";
  const year = media?.release_date ? media.release_date.slice(0, 4) : null;
  return (
    <li>
      <button
        type="button"
        onClick={(e) => { if (lp.wasLongPress()) { e.preventDefault(); return; } onOpen(); }}
        {...lp.handlers}
        className={`relative flex w-full items-stretch gap-3 overflow-hidden rounded-2xl bg-card p-2 text-left shadow-sm ring-1 ring-border/60 active:opacity-80 ${
          selected ? "ring-2 ring-foreground" : ""
        }`}
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
                  {year && (<span className="text-[10px] text-muted-foreground">• {year}</span>)}
                  {typeof media.vote_average === "number" && media.vote_average > 0 && (
                    <span className="text-[10px] font-semibold text-amber-500">★ {media.vote_average.toFixed(1)}</span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-1 text-[14px] font-semibold text-foreground">{media.title}</p>
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
            <p className="truncate text-[14px] font-semibold text-foreground">{note.heading ?? "Untitled"}</p>
            <p className="truncate text-[12px] text-muted-foreground">
              {note.summary ?? formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
            </p>
          </div>
        )}
        {selectMode && (
          <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-[8px] bg-background/90 shadow ring-1 ring-border">
            {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
          </div>
        )}
        {note.pinned && !selectMode && (
          <div className="absolute right-2 top-2 rounded-full bg-background/90 p-1 shadow ring-1 ring-border">
            <Pin className="h-3 w-3" />
          </div>
        )}
      </button>
    </li>
  );
}

function MediaGridTile({
  note,
  thumb,
  selected,
  selectMode,
  onOpen,
  onLongPress,
}: {
  note: any;
  thumb?: string;
  selected: boolean;
  selectMode: boolean;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const lp = useLongPress(onLongPress);
  const media = note.media as LocalMedia | undefined;
  const posterUrl = media?.poster_path ? tmdbPoster(media.poster_path, "w342") : null;
  const isMedia = !!posterUrl;
  const isTvMedia = media?.type === "tv";
  const tvTotal = isTvMedia ? mediaTotal(media!) : 0;
  const tvDone = isTvMedia ? mediaDone(media!) : 0;
  const tvPct = tvTotal > 0 ? Math.round((tvDone / tvTotal) * 100) : 0;
  const isDropped = media?.watch_status === "dropped";
  return (
    <li className="relative">
      <button
        type="button"
        onClick={(e) => { if (lp.wasLongPress()) { e.preventDefault(); return; } onOpen(); }}
        {...lp.handlers}
        style={isMedia ? { borderRadius: 15 } : undefined}
          className={`relative flex w-full ${isMedia ? "aspect-[2/3]" : "aspect-square rounded-2xl"} flex-col justify-between overflow-hidden bg-card text-left shadow-sm ring-1 ring-border/60 active:opacity-80 ${
          selected ? "ring-2 ring-foreground" : ""
        }`}
      >
        {isMedia ? (
          <>
            <img
              src={posterUrl!}
              alt={media?.title ?? note.heading ?? "Poster"}
              loading="lazy"
              className={`absolute inset-0 h-full w-full object-cover ${isDropped ? "grayscale" : ""}`}
            />
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-start scrim-t p-2.5 pt-8 text-left">
              {media?.watch_status && (
                <span className={`mb-1 inline-flex max-w-full self-start rounded-full px-1.5 py-0.5 text-left text-[9px] font-semibold uppercase tracking-wide shadow-sm ${WATCH_COLORS[media.watch_status]}`}>
                  {WATCH_LABEL[media.watch_status]}
                </span>
              )}
              <p className="w-full line-clamp-2 text-left text-[12px] font-semibold scrim-fg">
                {media?.title ?? note.heading ?? "Untitled"}
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
              alt={note.heading ?? "Memory"}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 scrim-t" />
            <div className="relative z-10 mt-auto p-3">
              <p className="line-clamp-2 text-[13px] font-semibold scrim-fg">{note.heading ?? "Untitled"}</p>
              <p className="mt-0.5 text-[10px] scrim-fg-70">
                {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
              </p>
            </div>
          </>
        ) : (
          <div className="flex h-full w-full flex-col justify-between p-3">
            <p className="text-[11px] text-muted-foreground">
              {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
            </p>
            <div>
              <p className="line-clamp-2 text-[14px] font-semibold text-foreground">{note.heading ?? "Untitled"}</p>
              {note.summary && (
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{note.summary}</p>
              )}
            </div>
          </div>
        )}
        {selectMode && (
          <div className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-[8px] bg-background/90 shadow ring-1 ring-border">
            {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
          </div>
        )}
        {note.pinned && !selectMode && (
          <div className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 shadow ring-1 ring-border">
            <Pin className="h-3 w-3" />
          </div>
        )}
      </button>
    </li>
  );
}

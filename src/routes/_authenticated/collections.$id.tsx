import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Trash2, Plus, X, Check, LayoutGrid, List as ListIcon, CalendarClock, BarChart3, Clock, Film, Tv, Eye, PlayCircle, XCircle, Pin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCollection, removeNotesFromCollection, addNotesToCollection, renameCollection, deleteCollection } from "@/lib/collections";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { formatDistanceToNow, format } from "date-fns";
import { getCachedPhotoUrl, warmPhotoCache } from "@/lib/photo-cache";
import { poster as tmdbPoster, still as tmdbStill, WATCH_LABEL, WATCH_COLORS, totalEpisodes as mediaTotal, watchedCount as mediaDone, epKey, toggleEpisodeWatched, setWatchStatus } from "@/lib/media";
import { deleteNotes, pinNote } from "@/lib/notes.functions";
import type { WatchStatus, LocalMedia, LocalMediaEpisode } from "@/lib/local-db";
import { NoteCard, useLongPress } from "@/components/NoteCard";
import { FeedNoteCard } from "@/components/FeedNoteCard";
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
    // pinned first, stable
    return [...base].sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)));
  }, [allMembers, hasMedia, statusFilter]);
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
            onClick={() => setConfirmDelete(true)}
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
                onClick={() => {
                  if (hasMedia) {
                    navigate({ to: "/search", search: { tab: "media" } });
                  } else {
                    setPicking(true);
                  }
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-3 text-[14px] font-semibold text-muted-foreground active:opacity-70"
              >
                <Plus className="h-4 w-4" />
                Add memories
              </button>
            </div>
            {hasMedia && (
            <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
              <div className="pointer-events-auto inline-flex items-center gap-0 rounded-full bg-white/90 p-1 shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150 dark:bg-neutral-900/90 dark:ring-white/10">
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
              members.length === 0 ? (
                <p className="rounded-2xl bg-card px-4 py-8 text-center text-[13px] text-muted-foreground ring-1 ring-border/60">
                  This collection is empty.
                </p>
              ) : (
                <div className="columns-2 gap-3 [column-fill:_balance]">
                  {members.map((n) => {
                    const sel = removeSel.has(n.id);
                    return (
                      <div key={n.id} className="mb-3 break-inside-avoid">
                        <FeedNoteCard
                          note={n as any}
                          variant="masonry"
                          fullWidth
                          thumbUrl={thumbs[n.id]}
                          selected={sel}
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
                          onToggleSel={() => {
                            setRemoveSel((prev) => {
                              const next = new Set(prev);
                              next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                              return next;
                            });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )
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
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
          <div
            className="pointer-events-auto flex w-full max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-2xl border border-border/60 bg-foreground/95 px-2 py-2 text-background shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] backdrop-blur-md sm:max-w-md"
            role="toolbar"
            aria-label="Bulk actions"
          >
            <button
              type="button"
              onClick={() => { setRemoving(false); setRemoveSel(new Set()); }}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-background/80 hover:bg-background/10 active:opacity-70"
              aria-label="Cancel selection"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-background/10 px-2.5 py-1 text-[11px] font-semibold tabular-nums">
              <span>{removeSel.size}</span>
              <span className="text-background/60">selected</span>
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: "none" }}>
              {hasMedia ? (
                <>
                  <BulkPillBtn
                    icon={<Eye className="h-4 w-4" />}
                    label="Watched"
                    disabled={removeSel.size === 0}
                    onClick={async () => {
                      for (const nid of removeSel) await setWatchStatus(nid, "watched");
                      setRemoving(false); setRemoveSel(new Set());
                    }}
                  />
                  <BulkPillBtn
                    icon={<PlayCircle className="h-4 w-4" />}
                    label="Watching"
                    disabled={removeSel.size === 0}
                    onClick={async () => {
                      for (const nid of removeSel) await setWatchStatus(nid, "watching");
                      setRemoving(false); setRemoveSel(new Set());
                    }}
                  />
                  <BulkPillBtn
                    icon={<XCircle className="h-4 w-4" />}
                    label="Dropped"
                    disabled={removeSel.size === 0}
                    onClick={async () => {
                      for (const nid of removeSel) await setWatchStatus(nid, "dropped");
                      setRemoving(false); setRemoveSel(new Set());
                    }}
                  />
                  <BulkPillBtn
                    icon={<Trash2 className="h-4 w-4" />}
                    label="Delete"
                    danger
                    disabled={removeSel.size === 0}
                    onClick={() => setConfirmBulkDelete(true)}
                  />
                </>
              ) : (
                <>
                  <BulkPillBtn
                    icon={<Pin className="h-4 w-4" />}
                    label={allSelectedPinned ? "Unpin" : "Pin"}
                    disabled={removeSel.size === 0}
                    onClick={async () => {
                      const pin = !allSelectedPinned;
                      for (const nid of removeSel) await pinNote({ data: { noteId: nid, pinned: pin } });
                      setRemoving(false); setRemoveSel(new Set());
                    }}
                  />
                  <BulkPillBtn
                    icon={<X className="h-4 w-4" />}
                    label="Remove"
                    disabled={removeSel.size === 0}
                    onClick={async () => {
                      await removeNotesFromCollection(id, Array.from(removeSel));
                      setRemoving(false); setRemoveSel(new Set());
                    }}
                  />
                  <BulkPillBtn
                    icon={<Trash2 className="h-4 w-4" />}
                    label="Delete"
                    danger
                    disabled={removeSel.size === 0}
                    onClick={() => setConfirmBulkDelete(true)}
                  />
                </>
              )}
            </div>
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

function fmtMinutes(mins: number): string {
  if (!mins || mins < 1) return "0m";
  const d = Math.floor(mins / (60 * 24));
  const h = Math.floor((mins % (60 * 24)) / 60);
  const m = Math.floor(mins % 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m && !d) parts.push(`${m}m`);
  return parts.join(" ") || `${m}m`;
}

type StatCard = { label: string; value: string; sub?: string | null };

function MediaStats({ members }: { members: Array<{ id: string; heading: string | null; media?: LocalMedia | null }> }) {
  const stats = useMemo(() => {
    const now = Date.now();
    const movies = members.map((n) => n.media).filter((m): m is LocalMedia => !!m && m.type === "movie");
    const shows = members.map((n) => n.media).filter((m): m is LocalMedia => !!m && m.type === "tv");

    // Movie tallies
    let moviesWatched = 0;
    let moviesWatchlist = 0;
    let moviesDropped = 0;
    let moviesWatchedMins = 0;
    let moviesPendingMins = 0;
    let moviesUpcoming = 0;
    let moviesUpcomingMins = 0;
    for (const m of movies) {
      const rt = Math.max(0, m.runtime ?? 0);
      const releaseMs = m.release_date ? new Date(m.release_date).getTime() : null;
      const released = releaseMs === null || !Number.isFinite(releaseMs) || releaseMs <= now;
      if (m.watch_status === "watched") {
        moviesWatched++;
        moviesWatchedMins += rt;
      } else if (m.watch_status === "dropped") {
        moviesDropped++;
      } else if (!released) {
        moviesUpcoming++;
        moviesUpcomingMins += rt;
      } else {
        // watchlist / watching / null on released titles → pending
        moviesWatchlist++;
        moviesPendingMins += rt;
      }
    }

    // TV tallies
    let showsWatchlist = 0;
    let showsWatching = 0;
    let showsCompleted = 0;
    let showsDropped = 0;
    let epsWatched = 0;
    let epsWatchedMins = 0;
    let epsPending = 0; // aired, not watched
    let epsPendingMins = 0;
    let epsUpcoming = 0; // unaired
    let epsUpcomingMins = 0;
    for (const m of shows) {
      switch (m.watch_status) {
        case "watchlist": showsWatchlist++; break;
        case "watching": showsWatching++; break;
        case "watched": showsCompleted++; break;
        case "dropped": showsDropped++; break;
      }
      const watched = new Set(m.watched_episodes);
      const fallbackRt = Math.max(0, m.runtime ?? 0);
      const isDropped = m.watch_status === "dropped";
      for (const s of m.seasons ?? []) {
        for (const ep of s.episodes) {
          const rt = Math.max(0, ep.runtime ?? fallbackRt);
          const airedMs = ep.air_date ? new Date(ep.air_date).getTime() : null;
          const aired = airedMs !== null && Number.isFinite(airedMs) && airedMs <= now;
          if (watched.has(epKey(ep.season_number, ep.episode_number))) {
            epsWatched++;
            epsWatchedMins += rt;
          } else if (isDropped) {
            // dropped shows: don't count remaining episodes as pending/upcoming
            continue;
          } else if (aired) {
            epsPending++;
            epsPendingMins += rt;
          } else if (airedMs !== null) {
            epsUpcoming++;
            epsUpcomingMins += rt;
          }
        }
      }
    }

    const totalMinsWatched = moviesWatchedMins + epsWatchedMins;

    return {
      hasMovies: movies.length > 0,
      hasShows: shows.length > 0,
      totals: { count: members.length, mins: totalMinsWatched },
      movies: {
        total: movies.length,
        watched: moviesWatched,
        watchlist: moviesWatchlist,
        dropped: moviesDropped,
        watchedMins: moviesWatchedMins,
        pendingMins: moviesPendingMins,
        upcoming: moviesUpcoming,
        upcomingMins: moviesUpcomingMins,
      },
      shows: {
        total: shows.length,
        watchlist: showsWatchlist,
        watching: showsWatching,
        completed: showsCompleted,
        dropped: showsDropped,
        epsWatched, epsWatchedMins,
        epsPending, epsPendingMins,
        epsUpcoming, epsUpcomingMins,
      },
    };
  }, [members]);

  const StatTile = ({ label, value, sub }: StatCard) => (
    <div className="rounded-2xl bg-card p-3 ring-1 ring-border/60">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-[22px] font-bold leading-none tracking-tight text-foreground tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );

  const Header = ({ icon, title }: { icon: React.ReactNode; title: string }) => (
    <div className="mb-2 mt-6 flex items-center gap-2 px-1">
      {icon}
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
    </div>
  );

  return (
    <div className="pb-24">
      {/* Overall hero */}
      <div className="rounded-3xl bg-primary p-5 text-primary-foreground shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Time watched</p>
        <p className="mt-1 text-[34px] font-bold leading-none tracking-tight tabular-nums">
          {fmtMinutes(stats.totals.mins)}
        </p>
        <p className="mt-2 text-[12px] opacity-80">
          {(() => {
            const parts: string[] = [];
            if (stats.hasMovies) parts.push(`${stats.movies.watched} movie${stats.movies.watched === 1 ? "" : "s"}`);
            if (stats.hasShows) parts.push(`${stats.shows.epsWatched} episode${stats.shows.epsWatched === 1 ? "" : "s"}`);
            return parts.length ? `Across ${parts.join(" · ")}` : "Nothing watched yet";
          })()}
        </p>
      </div>

      {/* Watched shelf */}
      <WatchedShelf members={members} />


      {stats.hasMovies && (
        <>
          <Header icon={<Film className="h-3.5 w-3.5 text-muted-foreground" />} title="Movies" />
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Watched"
              value={`${stats.movies.watched}`}
              sub={`of ${stats.movies.total} · ${fmtMinutes(stats.movies.watchedMins)}`}
            />
            <StatTile
              label="Pending"
              value={`${stats.movies.watchlist}`}
              sub={stats.movies.pendingMins > 0 ? `~${fmtMinutes(stats.movies.pendingMins)} to go` : "Nothing queued"}
            />
            {stats.movies.upcoming > 0 && (
              <StatTile
                label="Upcoming"
                value={`${stats.movies.upcoming}`}
                sub={stats.movies.upcomingMins > 0 ? `~${fmtMinutes(stats.movies.upcomingMins)} unreleased` : "Not yet released"}
              />
            )}
            {stats.movies.dropped > 0 && (
              <StatTile label="Dropped" value={`${stats.movies.dropped}`} sub="Not counted below" />
            )}
          </div>
        </>
      )}

      {stats.hasShows && (
        <>
          <Header icon={<Tv className="h-3.5 w-3.5 text-muted-foreground" />} title="TV Shows" />
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Episodes watched"
              value={`${stats.shows.epsWatched}`}
              sub={fmtMinutes(stats.shows.epsWatchedMins)}
            />
            <StatTile
              label="Pending (aired)"
              value={`${stats.shows.epsPending}`}
              sub={stats.shows.epsPendingMins > 0 ? `~${fmtMinutes(stats.shows.epsPendingMins)} to catch up` : "All caught up"}
            />
            <StatTile
              label="Upcoming"
              value={`${stats.shows.epsUpcoming}`}
              sub={stats.shows.epsUpcoming > 0 ? `~${fmtMinutes(stats.shows.epsUpcomingMins)} unaired` : "Nothing scheduled"}
            />
            <StatTile
              label="Shows"
              value={`${stats.shows.total}`}
              sub={`${stats.shows.watching} watching · ${stats.shows.completed} done`}
            />
          </div>

          {/* Shows status breakdown */}
          <div className="mt-3 rounded-2xl bg-card p-3 ring-1 ring-border/60">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Show status</p>
            <ul className="grid grid-cols-2 gap-y-1 text-[12px]">
              <li className="flex items-center justify-between pr-3"><span className="text-muted-foreground">Watchlist</span><span className="font-semibold tabular-nums">{stats.shows.watchlist}</span></li>
              <li className="flex items-center justify-between pr-3"><span className="text-muted-foreground">Watching</span><span className="font-semibold tabular-nums">{stats.shows.watching}</span></li>
              <li className="flex items-center justify-between pr-3"><span className="text-muted-foreground">Completed</span><span className="font-semibold tabular-nums">{stats.shows.completed}</span></li>
              <li className="flex items-center justify-between pr-3"><span className="text-muted-foreground">Dropped</span><span className="font-semibold tabular-nums">{stats.shows.dropped}</span></li>
            </ul>
          </div>
        </>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3" /> Runtimes from TMDB · dropped items counted in totals
      </p>
    </div>
  );
}

// ============================================================
// Watched shelf — minimal DVD spines that open a CD case dialog
// ============================================================

type ShelfMember = { id: string; heading: string | null; media?: LocalMedia | null };

function WatchedShelf({ members }: { members: Array<ShelfMember> }) {
  const [open, setOpen] = useState<ShelfMember | null>(null);

  const watched = useMemo(() => {
    return members.filter((m) => {
      const md = m.media;
      if (!md) return false;
      if (md.type === "movie") return md.watch_status === "watched";
      if (md.type === "tv") {
        if (md.watch_status === "watched") return true;
        // A show counts as "on the shelf" once every aired episode is checked
        const total = mediaTotal(md);
        const done = mediaDone(md);
        return total > 0 && done >= total;
      }
      return false;
    });
  }, [members]);

  if (watched.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Shelf
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">{watched.length}</span>
      </div>

      {/* Shelf row */}
      <div className="relative">
        <div className="scrollbar-none flex items-end gap-[10px] overflow-x-auto px-2 pb-2 pt-1">
          {watched.map((m) => (
            <SpineTile key={m.id} member={m} onOpen={() => setOpen(m)} />
          ))}
        </div>
        {/* subtle shelf line */}
        <div className="mx-1 h-px bg-border/70" />
        <div className="mx-1 mt-[2px] h-[3px] rounded-b-md bg-gradient-to-b from-border/40 to-transparent" />
      </div>

      <MediaCaseDialog member={open} onClose={() => setOpen(null)} />
    </div>
  );
}


function SpineTile({ member, onOpen }: { member: ShelfMember; onOpen: () => void }) {
  const md = member.media!;
  const posterUrl = md.poster_path ? tmdbPoster(md.poster_path, "w342") : null;
  const title = md.title || member.heading || "Untitled";

  // Fetch the show/movie's official title logo (transparent PNG). Cached by
  // TanStack Query — displayed rotated on the spine so it looks like the
  // real poster/DVD wordmark rather than typeset text.
  const { data: logo } = useQuery({
    queryKey: ["tmdb-logo", md.type, md.tmdb_id],
    queryFn: () => fetchTmdbLogoFn({ data: { type: md.type, tmdb_id: md.tmdb_id } }),
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    enabled: !!md.tmdb_id,
  });
  const logoUrl = logo?.file_path ? `https://image.tmdb.org/t/p/w500${logo.file_path}` : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative h-[172px] w-[38px] flex-shrink-0 overflow-hidden rounded-[3px] shadow-[0_2px_6px_rgba(0,0,0,0.35)] transition-transform active:scale-[0.97]"
      aria-label={`Open ${title}`}
    >
      {posterUrl ? (
        // Rotate the full poster 90° so its own title artwork reads vertically
        // like a real DVD spine — the poster is the text.
        <img
          src={posterUrl}
          alt=""
          className="absolute left-1/2 top-1/2 h-[38px] w-[172px] max-w-none -translate-x-1/2 -translate-y-1/2 rotate-90 object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 bg-neutral-800" />
      )}
      {/* left crease highlight */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-gradient-to-r from-white/25 to-transparent" />
      {/* right shadow */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-[3px] bg-gradient-to-l from-black/50 to-transparent" />
      {/* soft vertical scrim so wordmark reads on any poster */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-black/25 to-black/60" />

      {/* Title wordmark — the movie/show's own poster logo, rotated to spine
          orientation. Falls back to a display-serif italic title while the
          logo loads or when TMDB has no logo asset. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {logoUrl ? (
          <div className="flex h-[38px] w-[168px] -rotate-90 items-center justify-center">
            <img
              src={logoUrl}
              alt={title}
              className="max-h-[26px] max-w-[132px] object-contain"
              style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.85)) brightness(1.1) contrast(1.05)" }}
              loading="lazy"
            />

          </div>
        ) : (
          <span
            className="max-h-[160px] whitespace-nowrap font-serif text-[12px] font-semibold italic leading-none tracking-[0.02em] text-white"
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              textShadow: "0 1px 3px rgba(0,0,0,0.85), 0 0 8px rgba(0,0,0,0.5)",
            }}
          >
            {title}
          </span>
        )}
      </div>

    </button>
  );

}

function MediaCaseDialog({ member, onClose }: { member: ShelfMember | null; onClose: () => void }) {
  const navigate = useNavigate();
  const md = member?.media ?? null;
  const posterUrl = md?.poster_path ? tmdbPoster(md.poster_path, "w500") : null;
  const title = md?.title || member?.heading || "Untitled";
  const year = md?.release_date ? new Date(md.release_date).getFullYear() : null;

  return (
    <Dialog open={!!member} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-[360px] gap-0 overflow-hidden rounded-3xl border-0 bg-neutral-900 p-0 text-white shadow-2xl [&>button]:text-white/70 [&>button]:hover:text-white"
      >

        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">Disc case preview</DialogDescription>

        {member && md && (
          <>
            {/* Case: poster + disc */}
            <div className="relative flex bg-neutral-800/40 p-3">
              {/* Cover art (left) */}
              <div className="case-poster-in relative z-10 w-[46%] flex-shrink-0 overflow-hidden rounded-sm shadow-[4px_0_12px_rgba(0,0,0,0.5)]">
                {posterUrl ? (
                  <img src={posterUrl} alt={title} className="h-full w-full object-cover" />
                ) : (
                  <div className="aspect-[2/3] w-full bg-neutral-700" />
                )}
              </div>

              {/* Black case with disc (right) */}
              <div className="relative ml-1 flex-1 overflow-hidden rounded-sm bg-black shadow-inner">
                {/* disc */}
                <div className="disc-slide-out absolute left-1/2 top-1/2 h-[78%] w-[78%]">
                  <div className="relative h-full w-full overflow-hidden rounded-full bg-neutral-900 shadow-[0_6px_18px_rgba(0,0,0,0.55)]">
                    {posterUrl && (
                      <img
                        src={posterUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover opacity-70 blur-[0.5px]"
                      />
                    )}
                    {/* glossy sheen */}
                    <div className="absolute inset-0 bg-[conic-gradient(from_210deg,rgba(255,255,255,0)_0deg,rgba(255,255,255,0.18)_40deg,rgba(255,255,255,0)_120deg,rgba(255,255,255,0.12)_240deg,rgba(255,255,255,0)_360deg)]" />
                    {/* center hub */}
                    <div className="absolute left-1/2 top-1/2 h-[26%] w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-300 ring-1 ring-black/40">
                      <div className="absolute left-1/2 top-1/2 h-[38%] w-[38%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-900" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Meta */}
            <div className="px-5 pb-5 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
                {md.type === "movie" ? "Movie" : "TV Show"}
                {year ? ` · ${year}` : ""}
              </p>
              <h3 className="mt-1 text-[17px] font-semibold leading-tight tracking-tight">
                {title}
              </h3>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = member.id;
                    onClose();
                    navigate({ to: "/notes/$id", params: { id } });
                  }}
                  className="flex-1 rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-neutral-900 active:scale-[0.98]"
                >
                  Open details
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full bg-white/10 px-4 py-2.5 text-[13px] font-semibold text-white/90 active:scale-[0.98]"
                >
                  Close
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkPillBtn({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
        danger
          ? "bg-red-500/95 text-white hover:bg-red-500"
          : "bg-background text-foreground hover:bg-background/90"
      }`}
    >
      {icon}
      <span className="hidden xs:inline">{label}</span>
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
          <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 shadow ring-1 ring-border">
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
          <div className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 shadow ring-1 ring-border">
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

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
// Local-only app — no auth/user identity.
import { BottomNav } from "@/components/BottomNav";
import { LogOut, CheckCircle2, Loader2, AlertCircle, Mic, Circle, Trash2, X, Check, ChevronRight, Pin, PinOff, Link2, Image as ImageIcon, Search, Sparkles, Plus, FolderPlus, Folder } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { deleteNotes, pinNote } from "@/lib/notes.functions";
import { Markdown } from "@/components/Markdown";
import { useTheme } from "@/lib/theme";
import { getCachedPhotoUrl, getPhotoUrl, warmPhotoCache } from "@/lib/photo-cache";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { patchLocalNote, deleteLocalNotes, resync, clearPendingDelete } from "@/lib/sync-engine";
import { useCollections, addNotesToCollection, createCollection, backfillMediaCollections } from "@/lib/collections";
import { MediaCard } from "@/components/MediaCard";
import { poster as tmdbPoster } from "@/lib/media";
import { FeedNoteCard as NoteCard } from "@/components/FeedNoteCard";
import { MemoriesSection } from "@/components/MemoriesSection";
import { haptic } from "@/lib/haptics";
import { SectionLabel, SectionHeader as UISectionHeader } from "@/components/SectionLabel";

import { AddToCollectionSheet } from "@/components/AddToCollectionSheet";

import { toast } from "sonner";






export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Home — Braintape" },
      { name: "description", content: "Your voice-first second brain." },
    ],
  }),
  component: Home,
});

type Note = {
  id: string;
  status: "recording" | "uploaded" | "transcribing" | "processing" | "ready" | "failed";
  heading: string | null;
  summary: string | null;
  duration_seconds: number | null;
  created_at: string;
  pinned: boolean;
  image_paths: string[] | null;
  source_url: string | null;
  transcript: string | null;
};


function Home() {
  const localNotes = useLocalNotes();
  const notes = (localNotes ?? null) as Note[] | null;
  const [hideMedia, setHideMedia] = useState(false);
  useEffect(() => {
    const read = () => {
      setHideMedia(localStorage.getItem("hide-media-on-home") === "1");
    };
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "hide-media-on-home") read();
    };
    const onCustom = () => read();
    window.addEventListener("storage", onStorage);
    window.addEventListener("braintape:pref-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("braintape:pref-changed", onCustom);
    };
  }, []);

  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const delNotesFn = deleteNotes;
  const pinNoteFn = pinNote;
  const navigate = useNavigate();
  const [showAddToCollection, setShowAddToCollection] = useState(false);
  const allCollections = useCollections();



  // Auto-file existing movie/TV notes into their collections (one-time per mount).
  useEffect(() => {
    void backfillMediaCollections();
  }, []);



  const noteSelectMode = selectedNotes.size > 0;

  const [collapsed, setCollapsed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    // IntersectionObserver fires reliably during iOS momentum scrolling,
    // unlike `scroll` events which pause until the fling settles.
    const io = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);



  // Sign only images we haven't signed yet — cache is keyed by storage path so
  // Signed URL cache is module-level so it survives route unmounts/remounts;
  // this stops thumbnails from re-signing every time we transition back.
  const signInFlightRef = useRef<Set<string>>(new Set());
  const signThumbsFor = useCallback((rows: Note[]) => {
    const paths: string[] = [];
    const toFetch: Array<{ id: string; path: string }> = [];
    for (const n of rows) {
      const p = Array.isArray(n.image_paths) ? n.image_paths[0] : null;
      if (!p) continue;
      paths.push(p);
      const cached = getCachedPhotoUrl(p);
      if (cached) {
        setThumbs((cur) => (cur[n.id] === cached ? cur : { ...cur, [n.id]: cached }));
        continue;
      }
      if (signInFlightRef.current.has(p)) continue;
      signInFlightRef.current.add(p);
      toFetch.push({ id: n.id, path: p });
    }
    // Warm the in-memory cache from IndexedDB so instant paints kick in.
    if (paths.length) {
      void warmPhotoCache(paths).then(() => {
        setThumbs((cur) => {
          let next = cur;
          for (const n of rows) {
            const p = Array.isArray(n.image_paths) ? n.image_paths[0] : null;
            if (!p) continue;
            const u = getCachedPhotoUrl(p);
            if (u && next[n.id] !== u) {
              if (next === cur) next = { ...cur };
              next[n.id] = u;
            }
          }
          return next;
        });
      });
    }
    if (toFetch.length === 0) return;
    Promise.all(
      toFetch.map(async ({ id, path }) => ({ id, path, url: await getPhotoUrl(path) })),
    ).then((pairs) => {
      setThumbs((cur) => {
        const next = { ...cur };
        for (const { id, path, url } of pairs) {
          signInFlightRef.current.delete(path);
          if (url) next[id] = url;
        }
        return next;
      });
    });
  }, []);

  // Whenever the local note set changes, re-check thumbnails for new rows.
  useEffect(() => {
    if (notes) signThumbsFor(notes);
  }, [notes, signThumbsFor]);


  function ProfileInitial() {
    return <span>B</span>;
  }


  function toggleNoteSel(id: string) {
    void haptic.select();
    setSelectedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmDeleteNotes() {
    const ids = Array.from(selectedNotes);
    if (ids.length === 0) return;
    void haptic.heavy();
    await deleteLocalNotes(ids);
    setSelectedNotes(new Set());
    try {
      await delNotesFn({ data: { noteIds: ids } });
      await clearPendingDelete(ids);
    } catch {
      void resync();
    }
  }


  async function togglePinSelected() {
    const ids = Array.from(selectedNotes);
    if (ids.length === 0 || !notes) return;
    void haptic.impact();
    // If any selected is unpinned, pin all; otherwise unpin all.
    const anyUnpinned = notes.some((n) => selectedNotes.has(n.id) && !n.pinned);
    const nextPinned = anyUnpinned;
    await Promise.all(ids.map((id) => patchLocalNote(id, { pinned: nextPinned })));
    setSelectedNotes(new Set());
    try {
      await Promise.all(ids.map((noteId) => pinNoteFn({ data: { noteId, pinned: nextPinned } })));
    } catch {
      void resync();
    }
  }



  const selectMode = noteSelectMode;

  // Memoized derivations — only recompute when notes actually change.
  const derived = useMemo(() => {
    if (!notes) return null;
    const displayNotes = notes.filter((n) => n.heading !== "__custom__" && (!hideMedia || !(n as any).media));
    const pinnedNotes = displayNotes.filter((n) => n.pinned);
    const hasPinned = pinnedNotes.length > 0;
    const latest = displayNotes[0];
    // No hero card: pinned entries render as a feed block above tasks, and every
    // unpinned note flows into the normal memories feed.
    const stripSource = displayNotes.filter((n) => !n.pinned);
    const stripIds = new Set<string>();
    const strip: Note[] = [];
    for (const n of stripSource.slice(0, 5)) {
      if (!stripIds.has(n.id)) {
        stripIds.add(n.id);
        strip.push(n);
      }
    }
    const grid = stripSource.slice(5);


    return {
      displayNotes,
      latest,
      pinnedNotes,
      hasPinned,
      strip,
      grid,

      hasAnyContent: displayNotes.length > 0,
    };
  }, [notes, hideMedia]);



  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      {/* iOS large-title header */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background">
        <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-2">
          <div className="min-w-0">
            <h1
              style={{
                transform: collapsed ? "scale(0.625)" : "scale(1)",
                transformOrigin: "left center",
                willChange: "transform",
              }}
              className="font-bold tracking-tight leading-none text-[32px] transition-transform duration-200 ease-out motion-reduce:transition-none"
            >
              Braintape
            </h1>
            {notes && notes.length > 0 && (
              <p
                style={{
                  opacity: collapsed ? 0 : 1,
                  height: collapsed ? 0 : "1.25rem",
                  marginTop: collapsed ? 0 : "0.25rem",
                  willChange: "opacity",
                }}
                className="overflow-hidden text-[13px] text-muted-foreground transition-opacity duration-150 ease-out motion-reduce:transition-none"
              >
                {notes.filter((n) => n.heading !== "__custom__").length} notes · {formatDistanceToNow(new Date(notes[0].created_at), { addSuffix: true })}
              </p>
            )}
          </div>
          <Link
            to="/profile"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[14px] font-semibold press-bounce active:opacity-70"
            aria-label="Profile"
          >
            <ProfileInitial />
          </Link>

        </div>


      </header>

      <section className="flex-1 px-4 pb-32 pt-2">
        <div ref={sentinelRef} aria-hidden="true" className="h-6 -mt-2" />

        {notes === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-2xl bg-card px-6 py-12 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Mic className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[17px] font-semibold text-foreground">No notes yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Tap the mic and start talking.</p>
          </div>
        ) : !derived || !derived.hasAnyContent ? (
          <div className="rounded-2xl bg-card px-6 py-12 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Mic className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[17px] font-semibold text-foreground">No notes yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Tap the mic and start talking.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <MemoriesSection
              notes={derived.displayNotes as any}
              thumbs={thumbs}
              selected={selectedNotes}
              selectMode={noteSelectMode}
              onToggleSel={toggleNoteSel}
            />

          </div>
        )}
      </section>




      {selectMode ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-center px-5">
          <div className="pointer-events-auto inline-flex items-center gap-0 rounded-full glass-pill animate-bounce-up p-1">
            <button
              onClick={() => {
                void haptic.tap();
                setSelectedNotes(new Set());
              }}
              aria-label="Cancel selection"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-900 hover:bg-black/5 active:scale-90 press-bounce active:opacity-70 dark:text-white dark:hover:bg-white/10"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
            {noteSelectMode && (
              <button
                onClick={() => {
                  void haptic.impact();
                  void togglePinSelected();
                }}
                aria-label="Pin selected"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-black/5 active:scale-90 press-bounce active:opacity-70 dark:text-white dark:hover:bg-white/10"
              >
                <Pin aria-hidden="true" className="h-3.5 w-3.5" />
                Pin
              </button>
            )}
            {noteSelectMode && (
              <button
                onClick={() => {
                  void haptic.tap();
                  setShowAddToCollection(true);
                }}
                aria-label="Add to collection"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-black/5 active:scale-90 press-bounce active:opacity-70 dark:text-white dark:hover:bg-white/10"
              >
                <FolderPlus aria-hidden="true" className="h-3.5 w-3.5" />
                Collect
              </button>
            )}
            <div className="mx-1 h-4 w-px bg-black/10 dark:bg-white/10" />
            <button
              onClick={() => {
                void haptic.heavy();
                void confirmDeleteNotes();
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-destructive/90 px-3 py-2 text-xs font-semibold text-destructive-foreground shadow-sm active:scale-90 active:opacity-90"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </div>
      ) : (
        <BottomNav onLibrary={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
      )}

      {showAddToCollection && (
        <AddToCollectionSheet
          collections={allCollections ?? []}
          onClose={() => setShowAddToCollection(false)}
          onPick={async (collectionId) => {
            const ids = Array.from(selectedNotes);
            if (ids.length > 0) await addNotesToCollection(collectionId, ids);
            setSelectedNotes(new Set());
            setShowAddToCollection(false);
          }}
          onCreate={async (title) => {
            const c = await createCollection(title);
            const ids = Array.from(selectedNotes);
            if (ids.length > 0) await addNotesToCollection(c.id, ids);
            setSelectedNotes(new Set());
            setShowAddToCollection(false);
          }}
        />
      )}
    </div>
  );
}

function AnalyzingBadge({ label = "Analyzing", className = "" }: { label?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span>{label}</span>
      <span className="inline-flex gap-0.5">
        <span className="analyzing-dot inline-block h-1 w-1 rounded-full bg-current" />
        <span className="analyzing-dot inline-block h-1 w-1 rounded-full bg-current" />
        <span className="analyzing-dot inline-block h-1 w-1 rounded-full bg-current" />
      </span>
    </span>
  );
}




function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggered = useRef(false);
  const start = () => {
    triggered.current = false;
    timer.current = setTimeout(() => {
      triggered.current = true;
      onLongPress();
    }, ms);
  };
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    handlers: {
      onPointerDown: start,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
    wasLongPress: () => triggered.current,
  };
}




function StatusIcon({ status }: { status: Note["status"] }) {
  if (status === "ready") return <CheckCircle2 className="h-3.5 w-3.5 text-foreground" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
}

function formatDur(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

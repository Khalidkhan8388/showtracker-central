import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
// Local-only app — no auth/user identity.
import { Recorder } from "@/components/Recorder";
import { LogOut, CheckCircle2, Loader2, AlertCircle, Mic, Circle, Trash2, X, Check, ChevronRight, Pin, PinOff, Link2, Image as ImageIcon, Search, Sparkles, Plus, FolderPlus, Folder } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toggleTask, deleteNotes, deleteTasks, pinNote, pinTask, addCustomTask } from "@/lib/notes.functions";
import { Markdown } from "@/components/Markdown";
import { useTheme } from "@/lib/theme";
import { getCachedPhotoUrl, getPhotoUrl, warmPhotoCache } from "@/lib/photo-cache";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { patchLocalNote, patchLocalTask, deleteLocalNotes, deleteLocalTasks, resync, clearPendingDelete } from "@/lib/sync-engine";
import { useCollections, addNotesToCollection, createCollection, backfillMediaCollections } from "@/lib/collections";
import { MediaCard } from "@/components/MediaCard";
import { poster as tmdbPoster } from "@/lib/media";




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
  tasks: Array<{ id: string; text: string; done: boolean; pinned?: boolean; pending?: boolean }> | null;
  duration_seconds: number | null;
  created_at: string;
  pinned: boolean;
  image_paths: string[] | null;
  source_url: string | null;
  transcript: string | null;
};

type TaskKey = string; // `${noteId}::${taskId}`

function Home() {
  const localNotes = useLocalNotes();
  const notes = (localNotes ?? null) as Note[] | null;
  const [hideMedia, setHideMedia] = useState(false);
  useEffect(() => {
    const read = () => setHideMedia(localStorage.getItem("hide-media-on-home") === "1");
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
  const [selectedTasks, setSelectedTasks] = useState<Set<TaskKey>>(new Set());
  const toggleFn = toggleTask;
  const delNotesFn = deleteNotes;
  const delTasksFn = deleteTasks;
  const pinNoteFn = pinNote;
  const navigate = useNavigate();
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const newTaskInputRef = useRef<HTMLInputElement | null>(null);
  const [showAddToCollection, setShowAddToCollection] = useState(false);
  const allCollections = useCollections();

  useEffect(() => {
    if (addingTask) requestAnimationFrame(() => newTaskInputRef.current?.focus());
  }, [addingTask]);

  // Auto-file existing movie/TV notes into their collections (one-time per mount).
  useEffect(() => {
    void backfillMediaCollections();
  }, []);


  async function submitNewTask() {
    const text = newTaskText.trim();
    if (!text) {
      setAddingTask(false);
      return;
    }
    setNewTaskText("");
    setAddingTask(false);
    try {
      await addCustomTask({ data: { text } });
      void resync();
    } catch {
      setNewTaskText(text);
      setAddingTask(true);
    }
  }

  const noteSelectMode = selectedNotes.size > 0;
  const taskSelectMode = selectedTasks.size > 0;

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


  async function onToggle(noteId: string, taskId: string) {
    const note = notes?.find((n) => n.id === noteId);
    const cur = note?.tasks?.find((t) => t.id === taskId);
    const nextDone = !(cur?.done ?? false);
    await patchLocalTask(noteId, taskId, { done: nextDone });
    try {
      await toggleFn({ data: { noteId, taskId, done: nextDone } });
    } catch {
      void resync();
    }
  }

  async function onPinTask(noteId: string, taskId: string, pinned: boolean) {
    const nextPinned = !pinned;
    await patchLocalTask(noteId, taskId, { pinned: nextPinned });
    try {
      await pinTask({ data: { noteId, taskId, pinned: nextPinned } });
    } catch {
      void resync();
    }
  }


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
    setSelectedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleTaskSel(key: TaskKey) {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function confirmDeleteNotes() {
    const ids = Array.from(selectedNotes);
    if (ids.length === 0) return;
    await deleteLocalNotes(ids);
    setSelectedNotes(new Set());
    try {
      await delNotesFn({ data: { noteIds: ids } });
      await clearPendingDelete(ids);
    } catch {
      void resync();
    }
  }

  async function confirmDeleteTasks() {
    const items = Array.from(selectedTasks).map((k) => {
      const [noteId, taskId] = k.split("::");
      return { noteId, taskId };
    });
    if (items.length === 0) return;
    await deleteLocalTasks(items);
    setSelectedTasks(new Set());
    try {
      await delTasksFn({ data: { tasks: items } });
    } catch {
      void resync();
    }
  }

  async function togglePinSelected() {
    const ids = Array.from(selectedNotes);
    if (ids.length === 0 || !notes) return;
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

  async function togglePinSelectedTasks() {
    const keys = Array.from(selectedTasks);
    if (keys.length === 0 || !notes) return;
    const items = keys
      .map((k) => {
        const [noteId, taskId] = k.split("::");
        const n = notes.find((x) => x.id === noteId);
        const t = n?.tasks?.find((x: any) => x.id === taskId);
        return t ? { noteId, taskId, pinned: !!t.pinned } : null;
      })
      .filter(Boolean) as { noteId: string; taskId: string; pinned: boolean }[];
    if (items.length === 0) return;
    const anyUnpinned = items.some((t) => !t.pinned);
    const nextPinned = anyUnpinned;
    await Promise.all(items.map((t) => patchLocalTask(t.noteId, t.taskId, { pinned: nextPinned })));
    setSelectedTasks(new Set());
    try {
      await Promise.all(
        items.map((t) => pinTask({ data: { noteId: t.noteId, taskId: t.taskId, pinned: nextPinned } })),
      );
    } catch {
      void resync();
    }
  }


  const selectMode = noteSelectMode || taskSelectMode;

  // Memoized derivations — only recompute when notes actually change.
  const derived = useMemo(() => {
    if (!notes) return null;
    const displayNotes = notes.filter((n) => n.heading !== "__custom__" && (!hideMedia || !(n as any).media));
    const [latest, ...rest] = displayNotes;
    const pinnedRest = rest.filter((n) => n.pinned);
    const unpinnedRest = rest.filter((n) => !n.pinned);
    const stripIds = new Set<string>();
    const strip: Note[] = [];
    for (const n of [...pinnedRest, ...unpinnedRest.slice(0, 5)]) {
      if (!stripIds.has(n.id)) {
        stripIds.add(n.id);
        strip.push(n);
      }
    }
    const grid = unpinnedRest.slice(5);

    const allTasksRaw = notes.flatMap((n) =>
      (n.tasks ?? []).map((t) => ({
        ...t,
        noteId: n.id,
        noteHeading: n.heading === "__custom__" ? null : n.heading,
      })),
    );
    const suggested = allTasksRaw.filter((t) => t.pending);
    const allTasks = allTasksRaw.filter((t) => !t.pending);
    const pinnedT = allTasks.filter((t) => t.pinned && !t.done);
    const openT = allTasks.filter((t) => !t.pinned && !t.done);
    const doneT = allTasks.filter((t) => t.done);
    const visible = [...pinnedT, ...openT, ...doneT].slice(0, 3);

    return {
      displayNotes,
      latest,
      strip,
      grid,
      suggested,
      allTasks,
      visible,
      doneCount: doneT.length,
      hasAnyContent: displayNotes.length > 0 || allTasks.length > 0,
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
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[14px] font-semibold active:opacity-70"
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
            {derived.latest && (
              <NoteCard
                note={derived.latest}
                variant="hero"
                thumbUrl={thumbs[derived.latest.id]}
                selected={selectedNotes.has(derived.latest.id)}
                selectMode={noteSelectMode}
                onOpen={() => navigate({ to: "/notes/$id", params: { id: derived.latest.id } })}
                onLongPress={() => toggleNoteSel(derived.latest.id)}
                onToggleSel={() => toggleNoteSel(derived.latest.id)}
              />
            )}

            {derived.suggested.length > 0 && (
              <Link
                to="/tasks/review"
                className="flex items-center justify-between rounded-[28px] bg-primary px-5 py-3.5 shadow-sm active:opacity-80"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary-foreground" />
                  <span className="text-[15px] font-semibold text-primary-foreground">
                    {derived.suggested.length} suggested task{derived.suggested.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ChevronRight className="h-5 w-5 text-primary-foreground/80" />
              </Link>
            )}

            {derived.visible.length === 0 && (
              <>
                {addingTask ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitNewTask();
                    }}
                    className="flex w-full items-center gap-2 rounded-[28px] bg-primary px-5 py-3.5 shadow-sm"
                  >
                    <Plus className="h-4 w-4 shrink-0 text-primary-foreground" />
                    <input
                      ref={newTaskInputRef}
                      value={newTaskText}
                      onChange={(e) => setNewTaskText(e.target.value)}
                      onBlur={() => void submitNewTask()}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setNewTaskText("");
                          setAddingTask(false);
                        }
                      }}
                      placeholder="Add a task"
                      maxLength={500}
                      className="flex-1 bg-transparent text-[15px] font-semibold text-primary-foreground outline-none placeholder:text-primary-foreground/60"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingTask(true)}
                    className="flex w-full items-center justify-between rounded-[28px] bg-primary px-5 py-3.5 shadow-sm active:opacity-80"
                  >
                    <div className="flex items-center gap-2">
                      <Plus className="h-4 w-4 text-primary-foreground" />
                      <span className="text-[15px] font-semibold text-primary-foreground">Add a task</span>
                    </div>
                    <ChevronRight className="h-5 w-5 text-primary-foreground/80" />
                  </button>
                )}
              </>
            )}

            {derived.visible.length > 0 && (
              <div className="rounded-[20px] bg-card px-4 py-3 ring-1 ring-border/60">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] text-muted-foreground">
                    {derived.doneCount} of {derived.allTasks.length} completed
                  </span>
                  <Link
                    to="/tasks"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground active:opacity-80"
                    aria-label="Go to tasks"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
                <ul>
                  {derived.visible.map((t) => {
                    const key: TaskKey = `${t.noteId}::${t.id}`;
                    const isSel = selectedTasks.has(key);
                    return (
                      <li key={key}>
                        <TaskRow
                          selectMode={taskSelectMode}
                          selected={isSel}
                          done={t.done}
                          pinned={Boolean(t.pinned)}
                          text={t.text}
                          noteHeading={t.noteHeading}
                          noteId={t.noteId}
                          hideNoteHeading
                          compact
                          onToggleDone={() => onToggle(t.noteId, t.id)}
                          onPin={() => onPinTask(t.noteId, t.id, !!t.pinned)}
                          onLongPress={() => toggleTaskSel(key)}
                          onSelectTap={() => toggleTaskSel(key)}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}


            <CollectionsRow notes={localNotes ?? []} />

            {(derived.strip.length > 0 || derived.grid.length > 0) && (
              <div className="columns-2 gap-3 [column-fill:_balance]">
                {[...derived.strip, ...derived.grid].map((n) => (
                  <div key={n.id} className="mb-3 break-inside-avoid">
                    <NoteCard
                      note={n}
                      variant="masonry"
                      thumbUrl={thumbs[n.id]}
                      selected={selectedNotes.has(n.id)}
                      selectMode={noteSelectMode}
                      onOpen={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
                      onLongPress={() => toggleNoteSel(n.id)}
                      onToggleSel={() => toggleNoteSel(n.id)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>




      {selectMode ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-center px-5">
          <div className="pointer-events-auto inline-flex items-center gap-0 rounded-full bg-white/90 p-1 shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150 dark:bg-neutral-900/90 dark:ring-white/10">
            <button
              onClick={() => {
                setSelectedNotes(new Set());
                setSelectedTasks(new Set());
              }}
              aria-label="Cancel selection"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-900 hover:bg-black/5 active:scale-90 active:opacity-70 dark:text-white dark:hover:bg-white/10"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
            {(noteSelectMode || taskSelectMode) && (
              <button
                onClick={noteSelectMode ? togglePinSelected : togglePinSelectedTasks}
                aria-label="Pin selected"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-black/5 active:scale-90 active:opacity-70 dark:text-white dark:hover:bg-white/10"
              >
                <Pin aria-hidden="true" className="h-3.5 w-3.5" />
                Pin
              </button>
            )}
            {noteSelectMode && (
              <button
                onClick={() => setShowAddToCollection(true)}
                aria-label="Add to collection"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-black/5 active:scale-90 active:opacity-70 dark:text-white dark:hover:bg-white/10"
              >
                <FolderPlus aria-hidden="true" className="h-3.5 w-3.5" />
                Collect
              </button>
            )}
            <div className="mx-1 h-4 w-px bg-black/10 dark:bg-white/10" />
            <button
              onClick={noteSelectMode ? confirmDeleteNotes : confirmDeleteTasks}
              className="inline-flex items-center gap-1.5 rounded-full bg-destructive/90 px-3 py-2 text-xs font-semibold text-destructive-foreground shadow-sm active:scale-90 active:opacity-90"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </div>
      ) : (
        <Recorder onNoteReady={() => { void resync(); }} />
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

function AddToCollectionSheet({
  collections,
  onClose,
  onPick,
  onCreate,
}: {
  collections: Array<{ id: string; title: string; note_ids: string[] }>;
  onClose: () => void;
  onPick: (collectionId: string) => void | Promise<void>;
  onCreate: (title: string) => void | Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-background p-4 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-foreground">Add to collection</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {creating ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const t = title.trim();
              if (!t) return;
              await onCreate(t);
              setTitle("");
              setCreating(false);
            }}
            className="mb-2 flex items-center gap-2 rounded-2xl bg-card px-4 py-3 ring-1 ring-border/60"
          >
            <FolderPlus className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New collection name"
              maxLength={80}
              className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              className="rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground"
            >
              Create
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mb-2 flex w-full items-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-3 text-left text-[14px] font-semibold text-muted-foreground active:opacity-70"
          >
            <Plus className="h-4 w-4" />
            New collection
          </button>
        )}

        <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
          {collections.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void onPick(c.id)}
                className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left ring-1 ring-border/60 active:opacity-80"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
                  <Folder className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-foreground">{c.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {(c.note_ids ?? []).length} {(c.note_ids ?? []).length === 1 ? "memory" : "memories"}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CollectionsRow({ notes }: { notes: import("@/lib/local-db").LocalNote[] }) {
  const collections = useCollections();
  const list = collections ?? [];

  // Build a quick lookup: noteId -> note
  const noteById = useMemo(() => {
    const m = new Map<string, import("@/lib/local-db").LocalNote>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);

  return (
    <div className="-mx-4">
      <div className="flex items-center justify-between px-5 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Collections
        </span>
        <Link
          to="/collections"
          aria-label="Open collections"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
        <Link
          to="/collections"
          style={{ borderRadius: 15 }}
          className="flex aspect-[2/3] w-28 shrink-0 snap-start flex-col items-center justify-center gap-2 border border-dashed border-border bg-card/60 text-muted-foreground active:opacity-70"
        >
          <Plus className="h-5 w-5" />
          <span className="text-[11px] font-medium">New</span>
        </Link>
        {list.map((c) => {
          const ids = c.note_ids ?? [];
          // Prefer a media poster from any member note
          let posterUrl: string | null = null;
          for (const nid of ids) {
            const n = noteById.get(nid);
            const media = (n as any)?.media as import("@/lib/local-db").LocalMedia | undefined;
            if (media?.poster_path) {
              posterUrl = tmdbPoster(media.poster_path, "w342");
              break;
            }
          }
          return (
            <Link
              key={c.id}
              to="/collections/$id"
              params={{ id: c.id }}
              style={{ borderRadius: 15 }}
              className="relative flex aspect-[2/3] w-28 shrink-0 snap-start overflow-hidden bg-card ring-1 ring-border/60 active:opacity-80"
            >
              {posterUrl ? (
                <img
                  src={posterUrl}
                  alt={c.title}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-primary/10 to-transparent" />
              )}
              <div className="absolute inset-x-0 bottom-0 scrim-t p-2 pt-6">
                <span className="mb-0.5 inline-block rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold text-white/90">
                  {ids.length}
                </span>
                <p className="line-clamp-2 text-[12px] font-semibold leading-tight scrim-fg">
                  {c.title}
                </p>
              </div>

            </Link>
          );
        })}
      </div>
    </div>
  );
}


function SectionHeader({ children }: { children: React.ReactNode }) {

  return (
    <h2 className="mb-2 px-1 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
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

const NoteCard = memo(function NoteCard({
  note,
  variant,
  fullWidth,
  thumbUrl,
  selected,
  selectMode,
  onOpen,
  onLongPress,
  onToggleSel,
}: {
  note: Note;
  variant: "wide" | "square" | "hero" | "masonry";
  fullWidth?: boolean;
  thumbUrl?: string;
  selected: boolean;
  selectMode: boolean;
  onOpen: () => void;
  onLongPress: () => void;
  onToggleSel: () => void;
}) {
  const lp = useLongPress(onLongPress);
  const handleClick = (e: React.MouseEvent) => {
    if (lp.wasLongPress()) {
      e.preventDefault();
      return;
    }
    if (selectMode) {
      e.preventDefault();
      onToggleSel();
      return;
    }
    onOpen();
  };

  // Media (movie / TV) short-circuit — dedicated card, no shared chrome.
  const media = (note as any).media as import("@/lib/local-db").LocalMedia | null | undefined;
  if (media) {
    const isHeroV = variant === "hero";
    const sizing = isHeroV
      ? "w-full"
      : variant === "wide"
        ? "aspect-[16/9] w-full"
        : variant === "masonry"
          ? "aspect-[2/3] w-full"
          : fullWidth
            ? "aspect-square w-full"
            : "aspect-[2/3] w-40 shrink-0";
    const mediaVariant = isHeroV ? "hero" : variant === "masonry" ? "grid" : "row";
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        {...lp.handlers}
        className={`${sizing} cursor-pointer select-none`}
      >
        <MediaCard media={media} selectMode={selectMode} selected={selected} pinned={note.pinned} variant={mediaVariant} />
      </div>
    );
  }


  const imageCount = Array.isArray(note.image_paths) ? note.image_paths.length : 0;
  const hasImage = imageCount > 0 && !!thumbUrl;
  const isVoice = note.duration_seconds != null;
  // A "text note" is user-authored (has transcript/body) and not a voice recording.
  // Text notes may optionally include a source_url or images; still render as text.
  const isText = !isVoice && note.transcript != null;
  const isLink = !!note.source_url && !isText;
  const linkHost = (() => {
    if (!note.source_url) return null;
    try { return new URL(note.source_url).hostname.replace(/^www\./, ""); } catch { return null; }
  })();

  const { isDark } = useTheme();
  // MyMind-style soft tinted palette for text notes — deterministic per note.
  // Dark mode uses deeper, desaturated tints that read well on a black background.
  const mymindTintsLight = [
    "#FFF4E0", "#E8F1E4", "#E4EEF7", "#F3E8F0", "#F6EFE1", "#EAEBF6", "#FBE9E2",
  ];
  const mymindTintsDark = [
    "#2A241A", // warm brown
    "#1E2A22", // deep sage
    "#1B2530", // midnight blue
    "#2A1F27", // plum
    "#2A2418", // olive sand
    "#22222E", // indigo
    "#2C1F1A", // rust
  ];
  const mymindTints = isDark ? mymindTintsDark : mymindTintsLight;
  const tintIdx = (() => {
    let h = 0;
    for (let i = 0; i < note.id.length; i++) h = (h * 31 + note.id.charCodeAt(i)) >>> 0;
    return h % mymindTints.length;
  })();
  const textTint = mymindTints[tintIdx];

  const isHero = variant === "hero";
  const isMasonry = variant === "masonry";
  const isWideLike = variant === "wide" || isHero;
  const isSquareLike = variant === "square" || isMasonry;

  // Only text notes get soft tints. Voice and link cards stay clean like image tiles.
  const useTint = false;
  const tintBg = useTint ? mymindTints[tintIdx] : undefined;


  const base = isText
    ? "relative block overflow-hidden rounded-[15px] p-4 transition-all " +
      (selected ? "ring-2 ring-foreground" : "")
    : isHero
      ? "relative block overflow-hidden rounded-[15px] border border-border/60 bg-card p-6 shadow-sm transition-all " +
        (selected ? "ring-2 ring-foreground" : "")
      : useTint
        ? "relative block overflow-hidden rounded-[15px] p-4 transition-all " +
          (selected ? "ring-2 ring-foreground" : "")
        : "relative block overflow-hidden rounded-[15px] border border-border/60 p-3 transition-colors " +
          (selected
            ? "border-foreground bg-muted shadow-sm"
            : "bg-card hover:bg-muted/50");

  let sizing: string;
  if (isHero) {
    sizing = "";
  } else if (variant === "wide") {
    sizing = isText ? "p-5" : "p-4";
  } else if (isMasonry) {
    sizing = hasImage && !isLink && !isText
      ? "flex aspect-[4/5] w-full flex-col gap-2"
      : "flex w-full flex-col gap-3 min-h-[7rem]";
  } else if (fullWidth) {
    sizing = "flex aspect-square w-full flex-col gap-3";
  } else {
    sizing = "flex aspect-square w-40 shrink-0 flex-col gap-3";
  }

  const textNoteStyle: React.CSSProperties | undefined = isText
    ? { backgroundColor: isDark ? "#1c1c1e" : "#ffffff" }
    : tintBg
      ? { backgroundColor: tintBg }
      : undefined;



  const isProcessing = note.status !== "ready" && note.status !== "failed";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      {...lp.handlers}
      style={textNoteStyle}
      className={`${base} ${sizing} cursor-pointer select-none transition-transform duration-200 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${isProcessing ? "analyzing-shimmer" : ""}`}
    >

      {/* Image-forward tile: image fills the card as background (only when not a link) */}
      {isSquareLike && hasImage && !isLink && !isText && (
        <>
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 scrim-t" />
          {imageCount > 1 && (
            <div className="absolute left-2 top-2 z-10 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              +{imageCount - 1}
            </div>
          )}
        </>
      )}

      {selectMode && (
        <div className="absolute right-2 top-2 z-10">
          {selected ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground ring-2 ring-background">
              <Check className="h-3 w-3 text-background" strokeWidth={3} />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full bg-background ring-2 ring-background shadow-sm border border-muted-foreground/40" />
          )}
        </div>
      )}
      {note.pinned && !selectMode && (
        <div className="absolute right-2 top-2 z-10 text-muted-foreground">
          <Pin className="h-3.5 w-3.5 fill-foreground text-foreground" />
        </div>
      )}
      {isWideLike ? (
        <div className="flex items-start gap-4">
          {!isLink && hasImage && (
            <img
              src={thumbUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className={
                isHero
                  ? "h-24 w-24 shrink-0 rounded-2xl object-cover ring-1 ring-border"
                  : "h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-border"
              }
            />
          )}
          <div className="min-w-0 flex-1">
            {isHero ? (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Latest
                </span>
                {isLink && linkHost && (
                  <span className="inline-block rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background">
                    {linkHost}
                  </span>
                )}
              </div>
            ) : (
              isLink && linkHost && (
                <div className="mb-1.5">
                  <span className="inline-block rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background">
                    {linkHost}
                  </span>
                </div>
              )
            )}
            <div className="flex items-center gap-2 pr-6">
              <h3
                className={
                  isHero
                    ? "font-serif text-[24px] font-normal leading-[1.15] tracking-tight text-foreground line-clamp-3"
                    : "truncate text-sm font-semibold"
                }
              >
                {note.heading ?? (note.status === "failed" ? "Failed to process" : <AnalyzingBadge />)}
              </h3>
            </div>
            {note.summary && (
              <p className={`${isHero ? "mt-2 text-[13px]" : "mt-1 text-xs"} line-clamp-2 text-muted-foreground`}>{note.summary}</p>
            )}
            <div className={`${isHero ? "mt-3" : "mt-2"} flex items-center gap-3 text-[11px] text-muted-foreground`}>
              <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
              {note.duration_seconds != null && <span>{formatDur(note.duration_seconds)}</span>}
              {note.tasks && note.tasks.length > 0 && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {note.tasks.filter((t) => t.done).length}/{note.tasks.length}
                </span>
              )}
              {imageCount > 0 && !isLink && (
                <span className="flex items-center gap-1"><ImageIcon className="h-3 w-3" />{imageCount}</span>
              )}
            </div>
          </div>
        </div>
      ) : isText ? (
        <>
          <div className="relative z-10 flex items-start justify-center gap-1.5 px-2">
            <h3 className="font-serif text-[15px] leading-snug font-medium tracking-tight break-words line-clamp-2 text-foreground text-center">
              {note.heading ?? (note.status === "failed" ? "Failed" : <AnalyzingBadge />)}
            </h3>
          </div>
          {note.transcript && (
            <div className="relative z-10 overflow-hidden text-foreground/70 text-center [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" style={{ maxHeight: hasImage ? "9rem" : "16rem" }}>
              <Markdown className="!text-[12px] !leading-snug [&_p]:!text-center [&_h1]:!text-center [&_h2]:!text-center [&_h3]:!text-center [&_ul]:!list-none [&_ul]:!pl-0 [&_ol]:!list-none [&_ol]:!pl-0 [&_h1]:!text-[14px] [&_h1]:!mt-0 [&_h1]:!mb-1 [&_h2]:!text-[13px] [&_h2]:!mt-1 [&_h2]:!mb-1 [&_h3]:!text-[12px] [&_h3]:!mt-1 [&_h3]:!mb-0.5 [&_p]:!my-1 [&_ul]:!my-1 [&_ol]:!my-1 [&_img]:!my-1 [&_img]:!mx-auto [&_img]:!rounded-lg [&_img]:!max-h-24 [&_img]:!w-auto [&_pre]:hidden [&_hr]:hidden">
                {note.transcript}
              </Markdown>
            </div>
          )}

        </>

      ) : (
        <>
          {isLink && linkHost && (
            <div className="relative z-10 flex items-center gap-1.5 text-muted-foreground">
              <Link2 className="h-3 w-3 shrink-0" />
              <span className="truncate text-[10px] font-medium uppercase tracking-wide">
                {linkHost}
              </span>
            </div>
          )}
          {isVoice && !hasImage && (
            <div className="relative z-10 flex items-center gap-1.5 text-muted-foreground">
              <Mic className="h-3 w-3 shrink-0" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Voice</span>
            </div>
          )}
          {!(hasImage && !isLink) && (
            <div className="relative z-10 flex items-start gap-1.5 pr-5">
              <h3 className="text-[13px] font-semibold leading-snug break-words line-clamp-3 text-foreground">
                {note.heading ?? (note.status === "failed" ? "Failed" : <AnalyzingBadge />)}
              </h3>
            </div>
          )}
          {!(hasImage && !isLink) && note.summary && (
            <p className="relative z-10 text-[11px] leading-snug text-muted-foreground line-clamp-2">
              {note.summary}
            </p>
          )}

          <div
            className={`relative z-10 mt-auto flex flex-col gap-1 text-[10px] ${
              hasImage && !isLink ? "scrim-fg-80" : "text-muted-foreground"
            }`}
          >
            {hasImage && !isLink && (
              <h3 className="text-[13px] font-semibold leading-tight break-words scrim-fg line-clamp-3 pr-5">
                {note.heading ?? (note.status === "failed" ? "Failed" : <AnalyzingBadge />)}
              </h3>
            )}

            {note.tasks && note.tasks.length > 0 && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {note.tasks.filter((t) => t.done).length}/{note.tasks.length} tasks
              </span>
            )}
            <div className="flex items-center gap-2">
              <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
              {note.duration_seconds != null && (
                <span className="tabular-nums">{formatDur(note.duration_seconds)}</span>
              )}
            </div>
          </div>
        </>
      )}

    </div>
  );
});

const TaskRow = memo(function TaskRow({
  selectMode,
  selected,
  done,
  pinned,
  text,
  noteHeading,
  noteId,
  onToggleDone,
  onPin,
  onLongPress,
  onSelectTap,
  hideNoteHeading,
  compact,
}: {
  selectMode: boolean;
  selected: boolean;
  done: boolean;
  pinned?: boolean;
  text: string;
  noteHeading: string | null;
  noteId: string;
  onToggleDone: () => void;
  onPin?: () => void;
  onLongPress: () => void;
  onSelectTap: () => void;
  hideNoteHeading?: boolean;
  compact?: boolean;
}) {
  const lp = useLongPress(onLongPress);
  return (
    <div
      {...lp.handlers}
      onClick={(e) => {
        if (lp.wasLongPress()) {
          e.preventDefault();
          return;
        }
        if (selectMode) onSelectTap();
      }}
      className={`flex items-start gap-3 ${compact ? "px-1 py-1.5" : "px-4 py-3"} select-none transition-colors ${
        selected ? "bg-muted" : "active:bg-muted"
      }`}
    >

      <button
        onClick={(e) => {
          e.stopPropagation();
          if (selectMode) {
            onSelectTap();
            return;
          }
          onToggleDone();
        }}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        className="mt-0.5 shrink-0"
      >
        {done ? (
          <CheckCircle2 className="h-5 w-5 text-primary" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`${compact ? "text-[14px]" : "text-[17px]"} leading-snug line-clamp-2 ${
            done ? "text-muted-foreground line-through" : "text-foreground"
          }`}
        >
          {pinned && <Pin className="mr-1 inline h-3.5 w-3.5 -translate-y-0.5 fill-primary text-primary" />}
          {text}
        </p>
        {!hideNoteHeading && noteHeading && (
          selectMode ? (
            <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
              {noteHeading}
            </span>
          ) : (
            <Link
              to="/notes/$id"
              params={{ id: noteId }}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 block truncate text-[13px] text-muted-foreground active:underline"
            >
              {noteHeading}
            </Link>
          )
        )}

      </div>
      {!selectMode && onPin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin();
          }}
          aria-label={pinned ? "Unpin task" : "Pin task"}
          className={`mt-0.5 shrink-0 rounded-full p-1 active:opacity-60 ${
            pinned ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
});


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

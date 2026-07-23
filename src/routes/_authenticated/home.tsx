import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Recorder } from "@/components/Recorder";
import { LogOut, CheckCircle2, Loader2, Mic, Circle, Trash2, X, Check, ChevronRight, Pin, Image as ImageIcon, Sparkles, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useServerFn } from "@tanstack/react-start";
import { toggleTask, deleteNotes, deleteTasks, pinNote } from "@/lib/notes.functions";
import { Markdown } from "@/components/Markdown";

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
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [selectedTasks, setSelectedTasks] = useState<Set<TaskKey>>(new Set());
  const toggleFn = useServerFn(toggleTask);
  const delNotesFn = useServerFn(deleteNotes);
  const delTasksFn = useServerFn(deleteTasks);
  const pinNoteFn = useServerFn(pinNote);
  const navigate = useNavigate();

  const noteSelectMode = selectedNotes.size > 0;
  const taskSelectMode = selectedTasks.size > 0;

  async function onToggle(noteId: string, taskId: string) {
    setNotes((prev) =>
      prev
        ? prev.map((n) =>
            n.id === noteId
              ? { ...n, tasks: (n.tasks ?? []).map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) }
              : n,
          )
        : prev,
    );
    try {
      await toggleFn({ data: { noteId, taskId } });
    } catch {
      load();
    }
  }

  const signedCacheRef = useRef<Map<string, string>>(new Map());
  const signInFlightRef = useRef<Set<string>>(new Set());
  const signThumbsFor = useCallback((rows: Note[]) => {
    const toSign: Array<{ id: string; path: string }> = [];
    for (const n of rows) {
      const p = Array.isArray(n.image_paths) ? n.image_paths[0] : null;
      if (!p) continue;
      const cached = signedCacheRef.current.get(p);
      if (cached) {
        setThumbs((cur) => (cur[n.id] === cached ? cur : { ...cur, [n.id]: cached }));
        continue;
      }
      if (signInFlightRef.current.has(p)) continue;
      signInFlightRef.current.add(p);
      toSign.push({ id: n.id, path: p });
    }
    if (toSign.length === 0) return;
    Promise.all(
      toSign.map(async ({ id, path }) => {
        const { data: s } = await supabase.storage
          .from("voice-notes")
          .createSignedUrl(path, 3600);
        return { id, path, url: s?.signedUrl ?? "" };
      }),
    ).then((pairs) => {
      setThumbs((cur) => {
        const next = { ...cur };
        for (const { id, path, url } of pairs) {
          signInFlightRef.current.delete(path);
          if (url) {
            signedCacheRef.current.set(path, url);
            next[id] = url;
          }
        }
        return next;
      });
    });
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("voice_notes")
      .select("id,status,heading,summary,tasks,duration_seconds,created_at,pinned,image_paths,source_url,transcript")
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as Note[];
    setNotes(rows);
    signThumbsFor(rows);
  }, [signThumbsFor]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("voice_notes_home")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voice_notes" },
        (payload) => {
          const event = payload.eventType;
          if (event === "INSERT") {
            const row = payload.new as Note;
            setNotes((prev) => (prev ? [row, ...prev.filter((n) => n.id !== row.id)] : [row]));
            signThumbsFor([row]);
          } else if (event === "UPDATE") {
            const row = payload.new as Note;
            setNotes((prev) => (prev ? prev.map((n) => (n.id === row.id ? row : n)) : prev));
            signThumbsFor([row]);
          } else if (event === "DELETE") {
            const oldRow = payload.old as { id?: string };
            if (oldRow?.id) {
              setNotes((prev) => (prev ? prev.filter((n) => n.id !== oldRow.id) : prev));
            }
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, signThumbsFor]);

  async function signOut() {
    await supabase.auth.signOut();
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
    setNotes((prev) => (prev ? prev.filter((n) => !selectedNotes.has(n.id)) : prev));
    setSelectedNotes(new Set());
    try {
      await delNotesFn({ data: { noteIds: ids } });
    } catch {
      load();
    }
  }

  async function confirmDeleteTasks() {
    const items = Array.from(selectedTasks).map((k) => {
      const [noteId, taskId] = k.split("::");
      return { noteId, taskId };
    });
    if (items.length === 0) return;
    const keys = new Set(selectedTasks);
    setNotes((prev) =>
      prev
        ? prev.map((n) => ({
            ...n,
            tasks: (n.tasks ?? []).filter((t) => !keys.has(`${n.id}::${t.id}`)),
          }))
        : prev,
    );
    setSelectedTasks(new Set());
    try {
      await delTasksFn({ data: { tasks: items } });
    } catch {
      load();
    }
  }

  async function togglePinSelected() {
    const ids = Array.from(selectedNotes);
    if (ids.length === 0 || !notes) return;
    const anyUnpinned = notes.some((n) => selectedNotes.has(n.id) && !n.pinned);
    const nextPinned = anyUnpinned;
    setNotes((prev) =>
      prev ? prev.map((n) => (selectedNotes.has(n.id) ? { ...n, pinned: nextPinned } : n)) : prev,
    );
    setSelectedNotes(new Set());
    try {
      await Promise.all(ids.map((noteId) => pinNoteFn({ data: { noteId, pinned: nextPinned } })));
    } catch {
      load();
    }
  }

  const selectMode = noteSelectMode || taskSelectMode;

  const derived = useMemo(() => {
    if (!notes) return null;
    const displayNotes = notes.filter((n) => n.heading !== "__custom__");
    const pinnedRest = displayNotes.filter((n) => n.pinned);
    const unpinnedRest = displayNotes.filter((n) => !n.pinned);
    const wall = [...pinnedRest, ...unpinnedRest];


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
    const pct = allTasks.length === 0 ? 0 : Math.round((doneT.length / allTasks.length) * 100);

    return {
      displayNotes,
      latest,
      wall,
      suggested,
      allTasks,
      visible,
      doneCount: doneT.length,
      pct,
      hasAnyContent: displayNotes.length > 0 || allTasks.length > 0,
    };
  }, [notes]);

  const noteCount = notes ? notes.filter((n) => n.heading !== "__custom__").length : 0;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      {/* Editorial header */}
      <header className="px-6 pt-10 pb-6">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[34px] font-bold leading-none tracking-tight text-[#0d0d0d]">
              Braintape
            </h1>
            {noteCount > 0 && notes && (
              <p className="mt-1.5 text-[13px] font-medium text-muted-foreground">
                {noteCount} {noteCount === 1 ? "fragment" : "fragments"} captured
              </p>
            )}
          </div>
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[#0d0d0d] active:opacity-60"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <section className="flex-1 px-6 pb-40">
        {notes === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !derived || !derived.hasAnyContent ? (
          <div className="rounded-3xl bg-card px-6 py-14 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-background">
              <Mic className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-display text-[19px] font-semibold text-[#0d0d0d]">Nothing captured yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Tap the mic and start talking.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Latest hero */}
            {derived.latest && (
              <LatestHero
                note={derived.latest}
                thumbUrl={thumbs[derived.latest.id]}
                selected={selectedNotes.has(derived.latest.id)}
                selectMode={noteSelectMode}
                onOpen={() => navigate({ to: "/notes/$id", params: { id: derived.latest.id } })}
                onLongPress={() => toggleNoteSel(derived.latest.id)}
                onToggleSel={() => toggleNoteSel(derived.latest.id)}
              />
            )}

            {/* Suggested tasks */}
            {derived.suggested.length > 0 && (
              <Link
                to="/tasks/review"
                className="flex items-center justify-between rounded-full bg-[#0d0d0d] px-5 py-3 active:opacity-80"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-[14px] font-semibold text-[#f5f3ee]">
                    {derived.suggested.length} suggested task{derived.suggested.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-[#f5f3ee]/70" />
              </Link>
            )}

            {/* Masonry wall */}
            {derived.wall.length > 0 && (
              <div className="columns-2 gap-3 [column-fill:_balance] space-y-3">
                {derived.wall.map((n) => (
                  <div key={n.id} className="mb-3 break-inside-avoid">
                    <MasonryCard
                      note={n}
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

            {/* Active tasks */}
            <div>
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="font-display text-[17px] font-bold text-[#0d0d0d]">Active Tasks</h2>
                <Link
                  to="/tasks"
                  className="flex items-center gap-2 active:opacity-60"
                  aria-label="Open tasks"
                >
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-card">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${derived.pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
                    {derived.doneCount}/{derived.allTasks.length}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" strokeWidth={2.5} />
                </Link>
              </div>
              {derived.visible.length === 0 ? (
                <Link
                  to="/tasks"
                  className="flex items-center justify-center rounded-2xl border border-border bg-secondary px-4 py-5 text-[14px] font-semibold text-primary active:opacity-70"
                >
                  + Add a task
                </Link>
              ) : (
                <ul className="space-y-2.5">
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
                          onToggleDone={() => onToggle(t.noteId, t.id)}
                          onLongPress={() => toggleTaskSel(key)}
                          onSelectTap={() => toggleTaskSel(key)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {selectMode ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-center gap-2 px-5">
          <button
            onClick={() => {
              setSelectedNotes(new Set());
              setSelectedTasks(new Set());
            }}
            aria-label="Cancel selection"
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#0d0d0d] text-[#f5f3ee] shadow-lg"
          >
            <X className="h-4 w-4" />
          </button>
          {noteSelectMode && (
            <button
              onClick={togglePinSelected}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-[#0d0d0d] px-4 py-2 text-xs font-semibold text-[#f5f3ee] shadow-lg"
            >
              <Pin className="h-3.5 w-3.5" />
              Pin
            </button>
          )}
          <button
            onClick={noteSelectMode ? confirmDeleteNotes : confirmDeleteTasks}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground shadow-lg"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      ) : (
        <Recorder onNoteReady={load} />
      )}
    </div>
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

// ---- Latest hero card ----
const LatestHero = memo(function LatestHero({
  note,
  thumbUrl,
  selected,
  selectMode,
  onOpen,
  onLongPress,
  onToggleSel,
}: {
  note: Note;
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
  const hasImage = Array.isArray(note.image_paths) && note.image_paths.length > 0 && !!thumbUrl;
  const linkHost = (() => {
    if (!note.source_url) return null;
    try { return new URL(note.source_url).hostname.replace(/^www\./, ""); } catch { return null; }
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      {...lp.handlers}
      className={`relative cursor-pointer select-none overflow-hidden rounded-[28px] bg-card p-6 transition-colors ${
        selected ? "ring-2 ring-[#0d0d0d]" : "border border-black/[0.04]"
      }`}
    >
      <div className="absolute right-4 top-4 flex items-center gap-1.5">
        {note.pinned && !selectMode && (
          <Star className="h-4 w-4 fill-primary text-primary" />
        )}
        {selectMode && (
          selected ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0d0d0d] ring-2 ring-background">
              <Check className="h-3 w-3 text-background" strokeWidth={3} />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full bg-background ring-2 ring-background border border-muted-foreground/40" />
          )
        )}
      </div>

      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Latest Thought
      </p>

      {hasImage && (
        <div className="mt-3 -mx-1 overflow-hidden rounded-2xl">
          <img
            src={thumbUrl}
            alt=""
            loading="eager"
            decoding="async"
            className="h-36 w-full object-cover"
          />
        </div>
      )}

      <h2 className="mt-3 font-display text-[20px] font-semibold leading-snug text-[#0d0d0d]">
        {note.heading ?? (note.status === "failed" ? "Failed to process" : "Processing…")}
      </h2>
      {note.summary && (
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-foreground/70">
          {note.summary}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-muted-foreground">
        <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
        {note.duration_seconds != null && <span>· {formatDur(note.duration_seconds)}</span>}
        {linkHost && <span>· {linkHost}</span>}
        {note.tasks && note.tasks.length > 0 && (
          <span className="inline-flex items-center gap-1">
            · <CheckCircle2 className="h-3 w-3" />
            {note.tasks.filter((t) => t.done).length}/{note.tasks.length}
          </span>
        )}
      </div>
    </div>
  );
});

// ---- Masonry card (variant per note kind) ----
const MasonryCard = memo(function MasonryCard({
  note,
  thumbUrl,
  selected,
  selectMode,
  onOpen,
  onLongPress,
  onToggleSel,
}: {
  note: Note;
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

  const imageCount = Array.isArray(note.image_paths) ? note.image_paths.length : 0;
  const hasImage = imageCount > 0 && !!thumbUrl;
  const isVoice = note.duration_seconds != null;
  const isText = !isVoice && note.transcript != null;
  const isLink = !!note.source_url && !isText;
  const linkHost = (() => {
    if (!note.source_url) return null;
    try { return new URL(note.source_url).hostname.replace(/^www\./, ""); } catch { return null; }
  })();

  // Base styles per kind
  const kindClass = isVoice
    ? "bg-primary text-[#0d0d0d]"
    : isLink
      ? "bg-secondary border border-border"
      : isText
        ? "bg-card"
        : "bg-card";

  const ringClass = selected ? "ring-2 ring-[#0d0d0d]" : "";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      {...lp.handlers}
      className={`relative block cursor-pointer select-none overflow-hidden rounded-2xl transition-colors ${kindClass} ${ringClass}`}
    >
      {/* select / pin marker */}
      {selectMode && (
        <div className="absolute right-2 top-2 z-10">
          {selected ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0d0d0d] ring-2 ring-background">
              <Check className="h-3 w-3 text-background" strokeWidth={3} />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full bg-background ring-2 ring-background border border-muted-foreground/40" />
          )}
        </div>
      )}
      {note.pinned && !selectMode && (
        <div className="absolute right-2 top-2 z-10">
          <Star className="h-3.5 w-3.5 fill-primary text-primary drop-shadow" />
        </div>
      )}

      {/* Image note — image dominates */}
      {hasImage && !isLink && (
        <div className="relative">
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full object-cover"
            style={{ aspectRatio: isVoice || isText ? "4/3" : "3/4" }}
          />
          {imageCount > 1 && (
            <div className="absolute left-2 top-2 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              +{imageCount - 1}
            </div>
          )}
        </div>
      )}

      <div className="p-4">
        {/* Voice */}
        {isVoice && (
          <>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-4 items-end gap-0.5">
                <div className="w-1 rounded-full bg-[#0d0d0d]" style={{ height: "40%" }} />
                <div className="w-1 rounded-full bg-[#0d0d0d]" style={{ height: "90%" }} />
                <div className="w-1 rounded-full bg-[#0d0d0d]" style={{ height: "55%" }} />
                <div className="w-1 rounded-full bg-[#0d0d0d]" style={{ height: "100%" }} />
                <div className="w-1 rounded-full bg-[#0d0d0d]" style={{ height: "35%" }} />
                <div className="w-1 rounded-full bg-[#0d0d0d]" style={{ height: "70%" }} />
              </div>
              <span className="text-[10px] font-bold tabular-nums text-[#0d0d0d]">
                {formatDur(note.duration_seconds!)}
              </span>
            </div>
            <p className="text-[12px] font-semibold leading-snug text-[#0d0d0d] line-clamp-4">
              {note.heading ?? (note.status === "failed" ? "Failed" : "Processing…")}
            </p>
          </>
        )}

        {/* Link */}
        {isLink && (
          <>
            <div className="mb-2 flex items-center gap-2">
              {linkHost && (
                <img
                  src={`https://www.google.com/s2/favicons?domain=${linkHost}&sz=32`}
                  alt=""
                  className="h-3.5 w-3.5 flex-shrink-0 rounded-sm"
                />
              )}
              <span className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {linkHost ?? "link"}
              </span>
            </div>
            <p className="text-[12px] font-semibold leading-snug text-[#0d0d0d] line-clamp-4">
              {note.heading ?? (note.status === "failed" ? "Failed" : "Processing…")}
            </p>
          </>
        )}

        {/* Text note */}
        {isText && (
          <>
            <h3 className="font-display text-[13px] font-semibold leading-snug text-[#0d0d0d] line-clamp-2">
              {note.heading ?? (note.status === "failed" ? "Failed" : "Processing…")}
            </h3>
            {note.transcript && (
              <div
                className="mt-1.5 overflow-hidden text-foreground/70 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
                style={{ maxHeight: "8rem" }}
              >
                <Markdown className="!text-[11px] !leading-snug [&_h1]:!text-[12px] [&_h1]:!mt-0 [&_h1]:!mb-1 [&_h2]:!text-[11px] [&_h2]:!mt-1 [&_h2]:!mb-0.5 [&_p]:!my-1 [&_ul]:!my-1 [&_ol]:!my-1 [&_img]:hidden [&_pre]:hidden [&_hr]:hidden">
                  {note.transcript}
                </Markdown>
              </div>
            )}
          </>
        )}

        {/* Image-only (no voice/link/text) — caption row */}
        {!isVoice && !isLink && !isText && hasImage && (
          <p className="text-[12px] font-semibold leading-snug text-[#0d0d0d] line-clamp-2">
            {note.heading ?? (note.status === "failed" ? "Failed" : "Processing…")}
          </p>
        )}

        {/* Voice/link with attached image thumbnail */}
        {hasImage && isLink && (
          <div className="mt-2 -mx-1 overflow-hidden rounded-lg">
            <img src={thumbUrl} alt="" loading="lazy" className="h-16 w-full object-cover" />
          </div>
        )}

        {/* footer meta */}
        <div className="mt-3 flex items-center gap-2 text-[10px] font-medium text-muted-foreground">
          <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
          {note.tasks && note.tasks.length > 0 && (
            <span className="inline-flex items-center gap-1">
              · <CheckCircle2 className="h-2.5 w-2.5" />
              {note.tasks.filter((t) => t.done).length}/{note.tasks.length}
            </span>
          )}
          {imageCount > 0 && !hasImage && (
            <span className="inline-flex items-center gap-1"><ImageIcon className="h-2.5 w-2.5" />{imageCount}</span>
          )}
        </div>
      </div>
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
  onLongPress,
  onSelectTap,
}: {
  selectMode: boolean;
  selected: boolean;
  done: boolean;
  pinned?: boolean;
  text: string;
  noteHeading: string | null;
  noteId: string;
  onToggleDone: () => void;
  onLongPress: () => void;
  onSelectTap: () => void;
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
      className={`flex items-start gap-3 rounded-2xl border border-border bg-secondary px-4 py-3.5 select-none transition-colors ${
        selected ? "ring-2 ring-[#0d0d0d]" : ""
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
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-[#0d0d0d]">
            <Check className="h-3 w-3 text-[#f5f3ee]" strokeWidth={3.5} />
          </div>
        ) : (
          <div className="h-5 w-5 rounded-md border-2 border-border bg-background" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[14px] font-medium leading-snug ${
            done ? "text-muted-foreground line-through" : "text-[#0d0d0d]"
          }`}
        >
          {pinned && <Star className="mr-1 inline h-3 w-3 -translate-y-0.5 fill-primary text-primary" />}
          {text}
        </p>
        {noteHeading && (
          selectMode ? (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {noteHeading}
            </span>
          ) : (
            <Link
              to="/notes/$id"
              params={{ id: noteId }}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 block truncate text-[11px] text-muted-foreground active:underline"
            >
              {noteHeading}
            </Link>
          )
        )}
      </div>
    </div>
  );
});

function formatDur(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

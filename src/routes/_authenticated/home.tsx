import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Recorder } from "@/components/Recorder";
import { LogOut, CheckCircle2, Loader2, AlertCircle, Mic, Circle, Trash2, X, Check, ChevronRight, Pin, Link2, Image as ImageIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useServerFn } from "@tanstack/react-start";
import { toggleTask, deleteNotes, deleteTasks, pinNote } from "@/lib/notes.functions";

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

  async function load() {
    const { data } = await supabase
      .from("voice_notes")
      .select("id,status,heading,summary,tasks,duration_seconds,created_at,pinned,image_paths,source_url")
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as Note[];
    setNotes(rows);
    // Sign first image per note that has one, skip already-signed
    setThumbs((prev) => {
      const needed = rows.filter(
        (n) => Array.isArray(n.image_paths) && n.image_paths.length > 0 && !prev[n.id],
      );
      if (needed.length === 0) return prev;
      Promise.all(
        needed.map(async (n) => {
          const p = n.image_paths![0];
          const { data: s } = await supabase.storage
            .from("voice-notes")
            .createSignedUrl(p, 3600);
          return [n.id, s?.signedUrl ?? ""] as const;
        }),
      ).then((pairs) => {
        setThumbs((cur) => {
          const next = { ...cur };
          for (const [id, url] of pairs) if (url) next[id] = url;
          return next;
        });
      });
      return prev;
    });
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("voice_notes_home")
      .on("postgres_changes", { event: "*", schema: "public", table: "voice_notes" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
    // If any selected is unpinned, pin all; otherwise unpin all.
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

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      <header className="flex items-center justify-between px-5 pt-8 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
            <Mic className="h-4 w-4" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Braintape</h1>
        </div>
        <button
          onClick={signOut}
          className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      <section className="flex-1 px-5 pb-32 pt-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pinned & Recent
        </h2>

        {notes === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">No notes yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">Tap the mic and start talking.</p>
          </div>
        ) : (
          <>
            {(() => {
              const displayNotes = notes.filter((n) => n.heading !== "__custom__");
              if (displayNotes.length === 0 && notes.every((n) => (n.tasks ?? []).length === 0)) {
                return (
                  <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                    <p className="text-sm text-muted-foreground">No notes yet.</p>
                    <p className="mt-1 text-xs text-muted-foreground">Tap the mic and start talking.</p>
                  </div>
                );
              }
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
              return (
                <div className="space-y-4">
                  {latest && (
                    <NoteCard
                      note={latest}
                      variant="wide"
                      thumbUrl={thumbs[latest.id]}
                      selected={selectedNotes.has(latest.id)}
                      selectMode={noteSelectMode}
                      onOpen={() => navigate({ to: "/notes/$id", params: { id: latest.id } })}
                      onLongPress={() => toggleNoteSel(latest.id)}
                      onToggleSel={() => toggleNoteSel(latest.id)}
                    />
                  )}

                  {strip.length > 0 && (
                    <div className="-mx-5 overflow-x-auto pb-2">
                      <div className="flex gap-3 px-5">
                        {strip.map((n) => (
                          <NoteCard
                            key={n.id}
                            note={n}
                            variant="square"
                            thumbUrl={thumbs[n.id]}
                            selected={selectedNotes.has(n.id)}
                            selectMode={noteSelectMode}
                            onOpen={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
                            onLongPress={() => toggleNoteSel(n.id)}
                            onToggleSel={() => toggleNoteSel(n.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {(() => {
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
                    const open = allTasks.filter((t) => !t.pinned && !t.done);
                    const done = allTasks.filter((t) => t.done);
                    const ordered = [...pinnedT, ...open, ...done];
                    const visible = ordered.slice(0, 3);

                    return (
                      <>
                        {suggested.length > 0 && (
                          <div className="pt-4">
                            <Link
                              to="/tasks/review"
                              className="flex items-center justify-between rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
                            >
                              <span>
                                {suggested.length} suggested task{suggested.length === 1 ? "" : "s"} to review
                              </span>
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </div>
                        )}
                        <div className="pt-4">
                          <h2 className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            <span>Tasks</span>
                            <Link
                              to="/tasks"
                              className="inline-flex items-center gap-1 normal-case tracking-normal hover:text-foreground"
                            >
                              <span>
                                {done.length}/{allTasks.length}
                              </span>
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </h2>
                          {visible.length === 0 ? (
                            <Link
                              to="/tasks"
                              className="flex items-center justify-center rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                            >
                              + Add a task
                            </Link>
                          ) : (
                            <ul className="space-y-1.5">
                              {visible.map((t) => {
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
                      </>
                    );
                  })()}


                  {grid.length > 0 && (
                    <div className="pt-4">
                      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        More notes
                      </h2>
                      <div className="grid grid-cols-2 gap-3">
                        {grid.map((n) => (
                          <NoteCard
                            key={n.id}
                            note={n}
                            variant="square"
                            fullWidth
                            thumbUrl={thumbs[n.id]}
                            selected={selectedNotes.has(n.id)}
                            selectMode={noteSelectMode}
                            onOpen={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
                            onLongPress={() => toggleNoteSel(n.id)}
                            onToggleSel={() => toggleNoteSel(n.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
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
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground/80 text-background shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150"
          >
            <X className="h-4 w-4" />
          </button>
          {noteSelectMode && (
            <button
              onClick={togglePinSelected}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-foreground/85 px-4 py-2 text-xs font-semibold text-background shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150"
            >
              <Pin className="h-3.5 w-3.5" />
              Pin
            </button>
          )}
          <button
            onClick={noteSelectMode ? confirmDeleteNotes : confirmDeleteTasks}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-destructive/85 px-4 py-2 text-xs font-semibold text-destructive-foreground shadow-lg ring-1 ring-destructive/20 backdrop-blur-xl backdrop-saturate-150"
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

function NoteCard({
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
  variant: "wide" | "square";
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

  const imageCount = Array.isArray(note.image_paths) ? note.image_paths.length : 0;
  const hasImage = imageCount > 0 && !!thumbUrl;
  const isLink = !!note.source_url;
  const linkHost = (() => {
    if (!note.source_url) return null;
    try { return new URL(note.source_url).hostname.replace(/^www\./, ""); } catch { return null; }
  })();

  const base =
    "relative block overflow-hidden rounded-2xl border-2 p-3 transition-colors " +
    (selected
      ? "border-foreground bg-muted shadow-sm"
      : isLink
        ? "border-dashed border-foreground/70 bg-card hover:bg-muted/40"
        : "border-border bg-card hover:bg-muted/50");
  const sizing =
    variant === "wide"
      ? "p-4"
      : fullWidth
        ? "flex aspect-square w-full flex-col gap-3"
        : "flex aspect-square w-40 shrink-0 flex-col gap-3";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      {...lp.handlers}
      className={`${base} ${sizing} cursor-pointer select-none`}
    >
      {/* Square variant: image fills the card as background (only when not a link) */}
      {variant === "square" && hasImage && !isLink && (
        <>
          <img
            src={thumbUrl}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
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
      {variant === "wide" ? (
        <div className="flex items-start gap-3">
          {!isLink && hasImage && (
            <img
              src={thumbUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-border"
            />
          )}
          <div className="min-w-0 flex-1">
            {isLink && linkHost && (
              <div className="mb-1.5">
                <span className="inline-block rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background">
                  {linkHost}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 pr-6">
              <h3 className="truncate text-sm font-semibold">
                {note.heading ?? (note.status === "failed" ? "Failed to process" : "Processing…")}
              </h3>
            </div>
            {note.summary && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{note.summary}</p>
            )}
            <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
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
      ) : (
        <>
          {isLink && linkHost && (
            <div className="relative z-10">
              <span className="inline-block rounded bg-foreground px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-background max-w-full truncate">
                {linkHost}
              </span>
            </div>
          )}
          <div className="relative z-10 flex items-start gap-1.5 pr-5">
            <h3
              className={`text-xs font-semibold leading-tight break-words ${
                hasImage && !isLink ? "text-white drop-shadow" : ""
              }`}
            >
              {note.heading ?? (note.status === "failed" ? "Failed" : "Processing…")}
            </h3>
          </div>

          <div
            className={`relative z-10 mt-auto flex flex-col gap-1 text-[10px] ${
              hasImage && !isLink ? "text-white/85" : "text-muted-foreground"
            }`}
          >
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
}

function TaskRow({
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
      className={`flex items-start gap-2 rounded-xl border-2 p-3 select-none transition-colors ${
        selected ? "border-foreground bg-muted" : "border-border bg-card"
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
          <CheckCircle2 className="h-4 w-4 text-foreground" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm leading-snug ${
            done ? "text-muted-foreground line-through" : "text-foreground"
          }`}
        >
          {pinned && <Pin className="mr-1 inline h-3 w-3 -translate-y-0.5 fill-foreground text-foreground" />}
          {text}
        </p>
        {noteHeading && (
          selectMode ? (
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
              {noteHeading}
            </span>
          ) : (
            <Link
              to="/notes/$id"
              params={{ id: noteId }}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 block truncate text-[10px] text-muted-foreground hover:underline"
            >
              {noteHeading}
            </Link>
          )
        )}
      </div>
    </div>
  );
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

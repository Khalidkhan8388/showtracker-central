import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Recorder } from "@/components/Recorder";
import {
  LogOut,
  CheckCircle2,
  Loader2,
  Circle,
  Trash2,
  X,
  Check,
  ChevronRight,
  Pin,
  Bookmark,
  FileText,
  Sparkles,
} from "lucide-react";
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
  tasks: Array<{ id: string; text: string; done: boolean }> | null;
  duration_seconds: number | null;
  created_at: string;
  pinned: boolean;
};

type TaskKey = string; // `${noteId}::${taskId}`

function Home() {
  const [notes, setNotes] = useState<Note[] | null>(null);
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
      .select("id,status,heading,summary,tasks,duration_seconds,created_at,pinned")
      .order("created_at", { ascending: false });
    setNotes((data ?? []) as Note[]);
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
    <div className="relative min-h-screen w-full overflow-x-hidden bg-slate-50 text-slate-900">
      {/* Ambient mesh */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-[10%] -left-[15%] h-[45%] w-[80%] rounded-full bg-purple-200/50 blur-[100px]" />
        <div className="absolute top-[30%] -right-[20%] h-[40%] w-[70%] rounded-full bg-indigo-200/50 blur-[100px]" />
        <div className="absolute bottom-[5%] left-[10%] h-[35%] w-[70%] rounded-full bg-rose-100/40 blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col">
        <header className="flex items-end justify-between px-6 pt-12 pb-6">
          <div>
            <h1 className="bg-gradient-to-br from-slate-900 to-slate-500 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              Braintape
            </h1>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-widest text-slate-400">
              Your second brain
            </p>
          </div>
          <button
            onClick={signOut}
            className="rounded-full border border-white/60 bg-white/80 p-2.5 text-slate-500 shadow-sm backdrop-blur-md transition-transform active:scale-95"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </header>

        <section className="flex-1 space-y-8 px-6 pb-36">
          {notes === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : notes.length === 0 ? (
            <div className="rounded-3xl border border-white/60 bg-white/60 p-10 text-center backdrop-blur-md">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                <Sparkles className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-slate-700">No notes yet.</p>
              <p className="mt-1 text-xs text-slate-400">Tap the mic and start talking.</p>
            </div>
          ) : (
            (() => {
              const [latest, ...rest] = notes;
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

              const allTasks = notes.flatMap((n) =>
                (n.tasks ?? []).map((t) => ({ ...t, noteId: n.id, noteHeading: n.heading })),
              );
              const pinnedT = allTasks.filter((t) => (t as any).pinned && !t.done);
              const openT = allTasks.filter((t) => !(t as any).pinned && !t.done);
              const doneT = allTasks.filter((t) => t.done);
              const orderedTasks = [...pinnedT, ...openT, ...doneT];
              const visibleTasks = orderedTasks.slice(0, 3);

              return (
                <>
                  <section>
                    <SectionHeader label="Latest note" badge={latest.status !== "ready" ? undefined : "New"} />
                    <NoteCard
                      note={latest}
                      variant="wide"
                      selected={selectedNotes.has(latest.id)}
                      selectMode={noteSelectMode}
                      onOpen={() => navigate({ to: "/notes/$id", params: { id: latest.id } })}
                      onLongPress={() => toggleNoteSel(latest.id)}
                      onToggleSel={() => toggleNoteSel(latest.id)}
                    />
                  </section>

                  {strip.length > 0 && (
                    <section>
                      <SectionHeader label="Pinned & recent" />
                      <div className="-mx-6 overflow-x-auto pb-2">
                        <div className="no-scrollbar flex gap-4 px-6">
                          {strip.map((n, i) => (
                            <NoteCard
                              key={n.id}
                              note={n}
                              variant="square"
                              accentIndex={i}
                              selected={selectedNotes.has(n.id)}
                              selectMode={noteSelectMode}
                              onOpen={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
                              onLongPress={() => toggleNoteSel(n.id)}
                              onToggleSel={() => toggleNoteSel(n.id)}
                            />
                          ))}
                        </div>
                      </div>
                    </section>
                  )}

                  {allTasks.length > 0 && (
                    <section>
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                          Tasks
                        </h2>
                        <Link
                          to="/tasks"
                          className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm backdrop-blur-md hover:text-slate-900"
                        >
                          <span className="tabular-nums">
                            {doneT.length}/{allTasks.length}
                          </span>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                      <ul className="space-y-2.5">
                        {visibleTasks.map((t) => {
                          const key: TaskKey = `${t.noteId}::${t.id}`;
                          return (
                            <li key={key}>
                              <TaskRow
                                selectMode={taskSelectMode}
                                selected={selectedTasks.has(key)}
                                done={t.done}
                                pinned={Boolean((t as any).pinned)}
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
                    </section>
                  )}

                  {grid.length > 0 && (
                    <section>
                      <SectionHeader label="Older memories" />
                      <div className="grid grid-cols-2 gap-4">
                        {grid.map((n, i) => (
                          <NoteCard
                            key={n.id}
                            note={n}
                            variant="square"
                            fullWidth
                            accentIndex={i + 3}
                            selected={selectedNotes.has(n.id)}
                            selectMode={noteSelectMode}
                            onOpen={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
                            onLongPress={() => toggleNoteSel(n.id)}
                            onToggleSel={() => toggleNoteSel(n.id)}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              );
            })()
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
              className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/50 bg-white/70 text-slate-700 shadow-lg backdrop-blur-2xl backdrop-saturate-150"
            >
              <X className="h-4 w-4" />
            </button>
            {noteSelectMode && (
              <button
                onClick={togglePinSelected}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/40 bg-slate-900/90 px-5 py-2.5 text-xs font-semibold text-white shadow-xl shadow-indigo-500/20 backdrop-blur-2xl"
              >
                <Pin className="h-3.5 w-3.5" />
                Pin
              </button>
            )}
            <button
              onClick={noteSelectMode ? confirmDeleteNotes : confirmDeleteTasks}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/30 bg-rose-500/90 px-5 py-2.5 text-xs font-semibold text-white shadow-xl shadow-rose-500/25 backdrop-blur-2xl"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        ) : (
          <Recorder onNoteReady={load} />
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label, badge }: { label: string; badge?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</h2>
      {badge && (
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-600">
          {badge}
        </span>
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

const ACCENTS = [
  { chip: "bg-indigo-100 text-indigo-600" },
  { chip: "bg-amber-100 text-amber-600" },
  { chip: "bg-rose-100 text-rose-600" },
  { chip: "bg-emerald-100 text-emerald-600" },
  { chip: "bg-sky-100 text-sky-600" },
  { chip: "bg-violet-100 text-violet-600" },
];

function NoteCard({
  note,
  variant,
  fullWidth,
  accentIndex = 0,
  selected,
  selectMode,
  onOpen,
  onLongPress,
  onToggleSel,
}: {
  note: Note;
  variant: "wide" | "square";
  fullWidth?: boolean;
  accentIndex?: number;
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

  const accent = ACCENTS[accentIndex % ACCENTS.length];

  if (variant === "wide") {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        {...lp.handlers}
        className={`group relative cursor-pointer select-none overflow-hidden rounded-[28px] border p-6 transition-all ${
          selected
            ? "border-slate-900 bg-white shadow-lg"
            : "border-white/60 bg-white shadow-xl shadow-indigo-500/5 active:scale-[0.99]"
        }`}
      >
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-indigo-500/10 blur-3xl" />
        <SelectionBadge visible={selectMode} selected={selected} />
        {note.pinned && !selectMode && (
          <div className="absolute right-4 top-4 text-slate-400">
            <Pin className="h-3.5 w-3.5 fill-slate-400" />
          </div>
        )}
        <p className="text-base font-medium leading-relaxed text-slate-800">
          {note.heading ?? (note.status === "failed" ? "Failed to process" : "Processing…")}
        </p>
        {note.summary && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-500">{note.summary}</p>
        )}
        <div className="mt-4 flex items-center gap-3 text-[11px] text-slate-400">
          <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
          {note.duration_seconds != null && (
            <span className="tabular-nums">{formatDur(note.duration_seconds)}</span>
          )}
          {note.tasks && note.tasks.length > 0 && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {note.tasks.filter((t) => t.done).length}/{note.tasks.length}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      {...lp.handlers}
      className={`group relative aspect-square cursor-pointer select-none overflow-hidden rounded-[24px] border p-4 transition-all ${
        fullWidth ? "w-full" : "w-36 shrink-0"
      } ${
        selected
          ? "border-slate-900 bg-white shadow-lg"
          : "border-white/70 bg-white/70 shadow-md shadow-indigo-500/5 backdrop-blur-xl active:scale-[0.98]"
      }`}
    >
      <SelectionBadge visible={selectMode} selected={selected} />
      <div className="flex h-full flex-col justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${accent.chip}`}>
          {note.pinned ? <Bookmark className="h-4 w-4 fill-current" /> : <FileText className="h-4 w-4" />}
        </div>
        <div>
          <h3 className="text-xs font-semibold leading-tight text-slate-800 break-words">
            {note.heading ?? (note.status === "failed" ? "Failed" : "Processing…")}
          </h3>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
            <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
            {note.duration_seconds != null && (
              <span className="tabular-nums">{formatDur(note.duration_seconds)}</span>
            )}
          </div>
          {note.tasks && note.tasks.length > 0 && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
              <CheckCircle2 className="h-3 w-3" />
              {note.tasks.filter((t) => t.done).length}/{note.tasks.length}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectionBadge({ visible, selected }: { visible: boolean; selected: boolean }) {
  if (!visible) return null;
  return (
    <div className="absolute right-3 top-3 z-10">
      {selected ? (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 ring-2 ring-white">
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </div>
      ) : (
        <div className="h-5 w-5 rounded-full border border-slate-300 bg-white ring-2 ring-white shadow-sm" />
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
      className={`flex items-center gap-3 rounded-2xl border p-4 select-none shadow-sm backdrop-blur-md transition-all ${
        selected
          ? "border-slate-900 bg-white"
          : done
            ? "border-emerald-100/70 bg-emerald-50/60"
            : "border-white/60 bg-white/70"
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
        className="shrink-0"
      >
        {done ? (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500">
            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
          </div>
        ) : (
          <div className="h-6 w-6 rounded-full border-2 border-indigo-200" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium leading-snug ${
            done ? "text-slate-400 line-through" : "text-slate-700"
          }`}
        >
          {pinned && (
            <Pin className="mr-1 inline h-3 w-3 -translate-y-0.5 fill-indigo-500 text-indigo-500" />
          )}
          {text}
        </p>
        {noteHeading &&
          (selectMode ? (
            <span className="mt-0.5 block truncate text-[10px] text-slate-400">{noteHeading}</span>
          ) : (
            <Link
              to="/notes/$id"
              params={{ id: noteId }}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 block truncate text-[10px] text-slate-400 hover:underline"
            >
              {noteHeading}
            </Link>
          ))}
      </div>
      <Bookmark className="h-3.5 w-3.5 shrink-0 text-slate-300" />
    </div>
  );
}

function formatDur(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

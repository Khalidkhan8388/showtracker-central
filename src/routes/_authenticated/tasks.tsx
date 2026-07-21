import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, CheckCircle2, Circle, Pin, PinOff, Trash2, X, Pencil, Plus, Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toggleTask, deleteTasks, pinTask, editTaskText, addCustomTask } from "@/lib/notes.functions";

const CUSTOM_HEADING = "__custom__";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — Braintape" },
      { name: "description", content: "All tasks extracted from your notes." },
    ],
  }),
  component: TasksPage,
});

type Task = { id: string; text: string; done: boolean; pinned?: boolean };
type Note = {
  id: string;
  heading: string | null;
  tasks: Task[] | null;
  created_at: string;
};
type TaskKey = string; // `${noteId}::${taskId}`

function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const start = () => {
    fired.current = false;
    clear();
    timer.current = window.setTimeout(() => {
      fired.current = true;
      onLongPress();
    }, ms);
  };
  return {
    handlers: {
      onPointerDown: start,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
    },
    wasLongPress: () => fired.current,
  };
}

function TasksPage() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [selected, setSelected] = useState<Set<TaskKey>>(new Set());
  const [newTask, setNewTask] = useState("");
  const toggleFn = useServerFn(toggleTask);
  const pinFn = useServerFn(pinTask);
  const delFn = useServerFn(deleteTasks);
  const editFn = useServerFn(editTaskText);
  const addFn = useServerFn(addCustomTask);
  const selectMode = selected.size > 0;

  async function load() {
    const { data } = await supabase
      .from("voice_notes")
      .select("id,heading,tasks,created_at")
      .order("created_at", { ascending: false });
    setNotes((data ?? []) as Note[]);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("voice_notes_tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "voice_notes" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function patchTask(noteId: string, taskId: string, patch: Partial<Task>) {
    setNotes((prev) =>
      prev
        ? prev.map((n) =>
            n.id === noteId
              ? { ...n, tasks: (n.tasks ?? []).map((t) => (t.id === taskId ? { ...t, ...patch } : t)) }
              : n,
          )
        : prev,
    );
  }

  async function onToggle(noteId: string, taskId: string, done: boolean) {
    patchTask(noteId, taskId, { done: !done });
    try {
      await toggleFn({ data: { noteId, taskId } });
    } catch {
      load();
    }
  }

  async function onPin(noteId: string, taskId: string, pinned: boolean) {
    patchTask(noteId, taskId, { pinned: !pinned });
    try {
      await pinFn({ data: { noteId, taskId } });
    } catch {
      load();
    }
  }

  function toggleSel(key: TaskKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function confirmDelete() {
    const items = Array.from(selected).map((k) => {
      const [noteId, taskId] = k.split("::");
      return { noteId, taskId };
    });
    if (items.length === 0) return;
    const keys = new Set(selected);
    setNotes((prev) =>
      prev
        ? prev.map((n) => ({
            ...n,
            tasks: (n.tasks ?? []).filter((t) => !keys.has(`${n.id}::${t.id}`)),
          }))
        : prev,
    );
    setSelected(new Set());
    try {
      await delFn({ data: { tasks: items } });
    } catch {
      load();
    }
  }

  async function onEdit(noteId: string, taskId: string, text: string) {
    patchTask(noteId, taskId, { text });
    try {
      await editFn({ data: { noteId, taskId, text } });
    } catch {
      load();
    }
  }

  async function onAdd() {
    const text = newTask.trim();
    if (!text) return;
    setNewTask("");
    try {
      await addFn({ data: { text } });
      load();
    } catch {
      setNewTask(text);
    }
  }

  const allTasks = (notes ?? []).flatMap((n) =>
    (n.tasks ?? []).map((t) => ({
      ...t,
      noteId: n.id,
      noteHeading: n.heading === CUSTOM_HEADING ? null : n.heading,
    })),
  );
  const pinned = allTasks.filter((t) => t.pinned && !t.done);
  const open = allTasks.filter((t) => !t.pinned && !t.done);
  const done = allTasks.filter((t) => t.done);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-5 py-6 pb-32">
      <header className="mb-6 flex items-center gap-3">
        <Link
          to="/home"
          aria-label="Back"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <span className="ml-auto text-sm text-muted-foreground">
          {done.length}/{allTasks.length}
        </span>
      </header>

      {notes === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : allTasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <div className="space-y-6">
          {pinned.length > 0 && (
            <Section label="Pinned">
              <TaskList
                items={pinned}
                selected={selected}
                selectMode={selectMode}
                onToggle={onToggle}
                onPin={onPin}
                onSelectTap={toggleSel}
              />
            </Section>
          )}
          {open.length > 0 && (
            <Section label="Open">
              <TaskList
                items={open}
                selected={selected}
                selectMode={selectMode}
                onToggle={onToggle}
                onPin={onPin}
                onSelectTap={toggleSel}
              />
            </Section>
          )}
          {done.length > 0 && (
            <Section label="Done">
              <TaskList
                items={done}
                selected={selected}
                selectMode={selectMode}
                onToggle={onToggle}
                onPin={onPin}
                onSelectTap={toggleSel}
              />
            </Section>
          )}
        </div>
      )}

      {selectMode && (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-center gap-2 px-5">
          <button
            onClick={() => setSelected(new Set())}
            aria-label="Cancel selection"
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground/80 text-background shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            onClick={confirmDelete}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-destructive/90 px-5 py-2.5 text-sm font-semibold text-destructive-foreground shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      )}
    </main>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h2>
      <ul className="space-y-1.5">{children}</ul>
    </section>
  );
}

function TaskList({
  items,
  selected,
  selectMode,
  onToggle,
  onPin,
  onSelectTap,
}: {
  items: Array<Task & { noteId: string; noteHeading: string | null }>;
  selected: Set<TaskKey>;
  selectMode: boolean;
  onToggle: (noteId: string, taskId: string, done: boolean) => void;
  onPin: (noteId: string, taskId: string, pinned: boolean) => void;
  onSelectTap: (k: TaskKey) => void;
}) {
  return (
    <>
      {items.map((t) => {
        const key: TaskKey = `${t.noteId}::${t.id}`;
        return (
          <li key={key}>
            <TaskRow
              task={t}
              selected={selected.has(key)}
              selectMode={selectMode}
              onToggle={() => onToggle(t.noteId, t.id, t.done)}
              onPin={() => onPin(t.noteId, t.id, !!t.pinned)}
              onLongPress={() => onSelectTap(key)}
              onSelectTap={() => onSelectTap(key)}
            />
          </li>
        );
      })}
    </>
  );
}

function TaskRow({
  task,
  selected,
  selectMode,
  onToggle,
  onPin,
  onLongPress,
  onSelectTap,
}: {
  task: Task & { noteId: string; noteHeading: string | null };
  selected: boolean;
  selectMode: boolean;
  onToggle: () => void;
  onPin: () => void;
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
          onToggle();
        }}
        aria-label={task.done ? "Mark as not done" : "Mark as done"}
        className="mt-0.5 shrink-0"
      >
        {task.done ? (
          <CheckCircle2 className="h-4 w-4 text-foreground" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm leading-snug ${
            task.done ? "text-muted-foreground line-through" : "text-foreground"
          }`}
        >
          {task.text}
        </p>
        {task.noteHeading &&
          (selectMode ? (
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
              {task.noteHeading}
            </span>
          ) : (
            <Link
              to="/notes/$id"
              params={{ id: task.noteId }}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 block truncate text-[10px] text-muted-foreground hover:underline"
            >
              {task.noteHeading}
            </Link>
          ))}
      </div>
      {!selectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin();
          }}
          aria-label={task.pinned ? "Unpin task" : "Pin task"}
          className={`mt-0.5 shrink-0 rounded-md p-1 transition-colors ${
            task.pinned ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground"
          }`}
        >
          {task.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, CheckCircle2, Circle, Pin, PinOff, Trash2, X, Pencil, Plus, Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toggleTask, deleteTasks, pinTask, editTaskText, addCustomTask } from "@/lib/notes.functions";

const CUSTOM_HEADING = "__custom__";

export const Route = createFileRoute("/_authenticated/tasks/")({
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
    (n.tasks ?? [])
      .filter((t: any) => !t.pending)
      .map((t) => ({
        ...t,
        noteId: n.id,
        noteHeading: n.heading === CUSTOM_HEADING ? null : n.heading,
      })),
  );
  const pinned = allTasks.filter((t) => t.pinned && !t.done);
  const open = allTasks.filter((t) => !t.pinned && !t.done);
  const done = allTasks.filter((t) => t.done);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-32">
      {/* iOS large-title header */}
      <header className="sticky top-0 z-10 bg-background/85 backdrop-blur-xl">
        <div className="flex items-center justify-between px-2 pt-3 pb-1">
          <Link
            to="/home"
            aria-label="Back"
            className="inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[17px] text-primary active:opacity-60"
          >
            <ChevronLeft className="h-6 w-6 -ml-1" strokeWidth={2.5} />
            <span>Home</span>
          </Link>
          <span className="px-3 text-[15px] tabular-nums text-muted-foreground">
            {done.length}/{allTasks.length}
          </span>
        </div>
        <div className="px-4 pt-1 pb-3">
          <h1 className="text-[34px] font-bold tracking-tight">Tasks</h1>
        </div>
      </header>

      <div className="flex-1 px-4 pt-2">
        {!selectMode && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAdd();
            }}
            className="mb-6 flex items-center gap-2 rounded-2xl bg-card px-3 py-2 shadow-sm"
          >
            <Plus className="h-5 w-5 shrink-0 text-primary" />
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="Add a task"
              className="flex-1 bg-transparent px-1 py-1.5 text-[17px] outline-none placeholder:text-muted-foreground"
              maxLength={500}
            />
            {newTask.trim() && (
              <button
                type="submit"
                aria-label="Add task"
                className="inline-flex h-8 items-center rounded-full bg-primary px-3 text-[13px] font-semibold text-primary-foreground active:opacity-70"
              >
                Add
              </button>
            )}
          </form>
        )}

        {notes === null ? (
          <p className="text-[15px] text-muted-foreground">Loading…</p>
        ) : allTasks.length === 0 ? (
          <div className="rounded-2xl bg-card px-6 py-12 text-center shadow-sm">
            <p className="text-[17px] font-semibold">No tasks yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Add one above or capture a note.</p>
          </div>
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
                  onEdit={onEdit}
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
                  onEdit={onEdit}
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
                  onEdit={onEdit}
                  onSelectTap={toggleSel}
                />
              </Section>
            )}
          </div>
        )}
      </div>

      {selectMode && (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-center gap-2 px-5">
          <button
            onClick={() => setSelected(new Set())}
            aria-label="Cancel selection"
            className="pointer-events-auto inline-flex h-11 items-center rounded-full bg-card px-5 text-[15px] font-medium text-foreground shadow-lg ring-1 ring-black/5 backdrop-blur-xl"
          >
            Cancel
          </button>
          <button
            onClick={confirmDelete}
            className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full bg-destructive px-5 text-[15px] font-semibold text-destructive-foreground shadow-lg"
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
      <h2 className="mb-2 px-1 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">
        {label}
      </h2>
      <ul className="overflow-hidden rounded-2xl bg-card shadow-sm">{children}</ul>
    </section>
  );
}


function TaskList({
  items,
  selected,
  selectMode,
  onToggle,
  onPin,
  onEdit,
  onSelectTap,
}: {
  items: Array<Task & { noteId: string; noteHeading: string | null }>;
  selected: Set<TaskKey>;
  selectMode: boolean;
  onToggle: (noteId: string, taskId: string, done: boolean) => void;
  onPin: (noteId: string, taskId: string, pinned: boolean) => void;
  onEdit: (noteId: string, taskId: string, text: string) => void;
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
              onEdit={(text) => onEdit(t.noteId, t.id, text)}
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
  onEdit,
  onLongPress,
  onSelectTap,
}: {
  task: Task & { noteId: string; noteHeading: string | null };
  selected: boolean;
  selectMode: boolean;
  onToggle: () => void;
  onPin: () => void;
  onEdit: (text: string) => void;
  onLongPress: () => void;
  onSelectTap: () => void;
}) {
  const lp = useLongPress(onLongPress);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(task.text);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing, task.text]);

  function commit() {
    const t = draft.trim();
    setEditing(false);
    if (t && t !== task.text) onEdit(t);
  }

  return (
    <div
      {...(editing ? {} : lp.handlers)}
      onClick={(e) => {
        if (editing) return;
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
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-md bg-transparent text-sm leading-snug outline-none ring-1 ring-border focus:ring-foreground px-1.5 py-0.5"
            maxLength={500}
          />
        ) : (
          <p
            className={`text-sm leading-snug ${
              task.done ? "text-muted-foreground line-through" : "text-foreground"
            }`}
          >
            {task.text}
          </p>
        )}
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
      {!selectMode && !editing && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            aria-label="Edit task"
            className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
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
        </>
      )}
      {editing && (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            commit();
          }}
          aria-label="Save"
          className="mt-0.5 shrink-0 rounded-md p-1 text-foreground"
        >
          <Check className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

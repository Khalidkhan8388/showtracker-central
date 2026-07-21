import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, CheckCircle2, Circle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toggleTask } from "@/lib/notes.functions";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — Braintape" },
      { name: "description", content: "All tasks extracted from your notes." },
    ],
  }),
  component: TasksPage,
});

type Note = {
  id: string;
  heading: string | null;
  tasks: Array<{ id: string; text: string; done: boolean }> | null;
  created_at: string;
};

function TasksPage() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const toggleFn = useServerFn(toggleTask);

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

  const allTasks = (notes ?? []).flatMap((n) =>
    (n.tasks ?? []).map((t) => ({ ...t, noteId: n.id, noteHeading: n.heading })),
  );
  const open = allTasks.filter((t) => !t.done);
  const done = allTasks.filter((t) => t.done);
  const ordered = [...open, ...done];

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-5 py-6 pb-24">
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
      ) : ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {ordered.map((t) => (
            <li key={`${t.noteId}::${t.id}`}>
              <div className="flex items-start gap-2 rounded-xl border-2 border-border bg-card p-3">
                <button
                  onClick={() => onToggle(t.noteId, t.id)}
                  aria-label={t.done ? "Mark as not done" : "Mark as done"}
                  className="mt-0.5 shrink-0"
                >
                  {t.done ? (
                    <CheckCircle2 className="h-4 w-4 text-foreground" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm leading-snug ${
                      t.done ? "text-muted-foreground line-through" : "text-foreground"
                    }`}
                  >
                    {t.text}
                  </p>
                  {t.noteHeading && (
                    <Link
                      to="/notes/$id"
                      params={{ id: t.noteId }}
                      className="mt-0.5 block truncate text-[10px] text-muted-foreground hover:underline"
                    >
                      {t.noteHeading}
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

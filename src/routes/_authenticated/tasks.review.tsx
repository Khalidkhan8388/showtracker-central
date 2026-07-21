import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { approveTasks, dismissTasks } from "@/lib/notes.functions";
import { ChevronLeft, Check, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tasks/review")({
  head: () => ({
    meta: [{ title: "Review suggested tasks — Braintape" }],
  }),
  component: ReviewPage,
});

type Suggested = {
  noteId: string;
  taskId: string;
  text: string;
  noteHeading: string | null;
};

function ReviewPage() {
  const [items, setItems] = useState<Suggested[] | null>(null);
  const approveFn = useServerFn(approveTasks);
  const dismissFn = useServerFn(dismissTasks);
  const navigate = useNavigate();

  async function load() {
    const { data } = await supabase
      .from("voice_notes")
      .select("id,heading,tasks")
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as Array<{
      id: string;
      heading: string | null;
      tasks: Array<{ id: string; text: string; done: boolean; pending?: boolean }> | null;
    }>;
    const flat: Suggested[] = [];
    for (const n of rows) {
      for (const t of n.tasks ?? []) {
        if (t.pending) {
          flat.push({
            noteId: n.id,
            taskId: t.id,
            text: t.text,
            noteHeading: n.heading === "__custom__" ? null : n.heading,
          });
        }
      }
    }
    setItems(flat);
  }

  useEffect(() => {
    load();
  }, []);

  async function approveOne(s: Suggested) {
    setItems((prev) => (prev ? prev.filter((i) => !(i.noteId === s.noteId && i.taskId === s.taskId)) : prev));
    try {
      await approveFn({ data: { tasks: [{ noteId: s.noteId, taskId: s.taskId }] } });
    } catch {
      load();
    }
  }
  async function dismissOne(s: Suggested) {
    setItems((prev) => (prev ? prev.filter((i) => !(i.noteId === s.noteId && i.taskId === s.taskId)) : prev));
    try {
      await dismissFn({ data: { tasks: [{ noteId: s.noteId, taskId: s.taskId }] } });
    } catch {
      load();
    }
  }
  async function approveAll() {
    if (!items || items.length === 0) return;
    const payload = items.map((i) => ({ noteId: i.noteId, taskId: i.taskId }));
    setItems([]);
    try {
      await approveFn({ data: { tasks: payload } });
      navigate({ to: "/tasks" });
    } catch {
      load();
    }
  }
  async function dismissAll() {
    if (!items || items.length === 0) return;
    const payload = items.map((i) => ({ noteId: i.noteId, taskId: i.taskId }));
    setItems([]);
    try {
      await dismissFn({ data: { tasks: payload } });
      navigate({ to: "/home" });
    } catch {
      load();
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[720px] flex-col px-5 pb-24 pt-6">
      <header className="mb-6 flex items-center justify-between">
        <Link to="/home" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Home
        </Link>
        <h1 className="text-base font-semibold">Suggested tasks</h1>
        <span className="w-14" />
      </header>

      {items === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-sm text-muted-foreground">Nothing to review right now.</p>
          <Link to="/home" className="mt-4 inline-block text-sm font-medium underline">
            Back to home
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {items.length} pending suggestion{items.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-3">
              <button onClick={dismissAll} className="hover:text-foreground">
                Dismiss all
              </button>
              <button onClick={approveAll} className="font-semibold text-foreground">
                Approve all
              </button>
            </div>
          </div>

          <ul className="space-y-2">
            {items.map((s) => (
              <li
                key={`${s.noteId}::${s.taskId}`}
                className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">{s.text}</p>
                  {s.noteHeading && (
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">from {s.noteHeading}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => dismissOne(s)}
                    aria-label="Dismiss"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => approveOne(s)}
                    aria-label="Approve"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
                  >
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

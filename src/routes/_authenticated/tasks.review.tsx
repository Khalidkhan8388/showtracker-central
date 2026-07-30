import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { approveTasks, dismissTasks } from "@/lib/notes.functions";
import { Check, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/tasks/review")({
  head: () => ({ meta: [{ title: "Review suggested tasks — Braintape" }] }),
  component: ReviewPage,
});

type Suggested = {
  noteId: string;
  taskId: string;
  text: string;
  noteHeading: string | null;
};

function ReviewPage() {
  const notes = useLocalNotes();
  const navigate = useNavigate();

  const items = useMemo<Suggested[]>(() => {
    if (!notes) return [];
    const flat: Suggested[] = [];
    for (const n of notes) {
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
    return flat;
  }, [notes]);

  async function approveOne(s: Suggested) {
    await approveTasks({ data: { tasks: [{ noteId: s.noteId, taskId: s.taskId }] } });
  }
  async function dismissOne(s: Suggested) {
    await dismissTasks({ data: { tasks: [{ noteId: s.noteId, taskId: s.taskId }] } });
  }
  async function approveAll() {
    if (items.length === 0) return;
    await approveTasks({ data: { tasks: items.map((i) => ({ noteId: i.noteId, taskId: i.taskId })) } });
    navigate({ to: "/tasks" });
  }
  async function dismissAll() {
    if (items.length === 0) return;
    await dismissTasks({ data: { tasks: items.map((i) => ({ noteId: i.noteId, taskId: i.taskId })) } });
    navigate({ to: "/home" });
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background pb-24">
      <PageHeader title="Suggested" backTo="/home">
        {items.length > 0 && (
          <button
            onClick={approveAll}
            className="rounded-full px-3 py-1 text-[13px] font-semibold text-primary active:opacity-60"
          >
            Approve All
          </button>
        )}
      </PageHeader>

      <div className="flex-1 px-4 pt-2">
        {notes === undefined ? (
          <p className="text-[15px] text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <div className="mt-8 rounded-2xl bg-card px-6 py-12 text-center shadow-sm">
            <p className="text-[17px] font-semibold">All caught up</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Nothing to review right now.</p>
            <Link
              to="/home"
              className="mt-4 inline-block text-[15px] font-medium text-primary active:opacity-60"
            >
              Back to home
            </Link>
          </div>
        ) : (
          <>
            <ul className="overflow-hidden rounded-2xl bg-card shadow-sm">
              {items.map((s, i) => (
                <li key={`${s.noteId}::${s.taskId}`}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[17px] leading-tight text-foreground">{s.text}</p>
                      {s.noteHeading && (
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">from {s.noteHeading}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => dismissOne(s)}
                        aria-label="Dismiss"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground active:opacity-60"
                      >
                        <X className="h-4 w-4" strokeWidth={2.5} />
                      </button>
                      <button
                        onClick={() => approveOne(s)}
                        aria-label="Approve"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground press-bounce active:opacity-70"
                      >
                        <Check className="h-4 w-4" strokeWidth={3} />
                      </button>
                    </div>
                  </div>
                  {i < items.length - 1 && <div className="ml-4 h-px bg-border" />}
                </li>
              ))}
            </ul>

            <button
              onClick={dismissAll}
              className="mt-6 w-full rounded-2xl bg-card py-3.5 text-[17px] text-destructive shadow-sm active:opacity-60"
            >
              Dismiss All
            </button>
          </>
        )}
      </div>
    </div>
  );
}

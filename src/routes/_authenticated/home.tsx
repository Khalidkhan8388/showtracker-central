import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Recorder } from "@/components/Recorder";
import { LogOut, CheckCircle2, Loader2, AlertCircle, Mic } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
};

function Home() {
  const [notes, setNotes] = useState<Note[] | null>(null);

  async function load() {
    const { data } = await supabase
      .from("voice_notes")
      .select("id,status,heading,summary,tasks,duration_seconds,created_at")
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
          Your notes
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
              const [latest, ...rest] = notes;
              return (
                <div className="space-y-4">
                  <Link
                    to="/notes/$id"
                    params={{ id: latest.id }}
                    className="block rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <StatusIcon status={latest.status} />
                      <h3 className="truncate text-sm font-semibold">
                        {latest.heading ?? (latest.status === "failed" ? "Failed to process" : "Processing…")}
                      </h3>
                    </div>
                    {latest.summary && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{latest.summary}</p>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span>{formatDistanceToNow(new Date(latest.created_at), { addSuffix: true })}</span>
                      {latest.duration_seconds != null && <span>{formatDur(latest.duration_seconds)}</span>}
                      {latest.tasks && latest.tasks.length > 0 && (
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {latest.tasks.filter((t) => t.done).length}/{latest.tasks.length}
                        </span>
                      )}
                    </div>
                  </Link>

                  {rest.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {rest.map((n) => (
                        <Link
                          key={n.id}
                          to="/notes/$id"
                          params={{ id: n.id }}
                          className="flex aspect-square flex-col justify-between rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-muted/50"
                        >
                          <div>
                            <div className="flex items-center gap-1.5">
                              <StatusIcon status={n.status} />
                              <h3 className="line-clamp-2 text-xs font-semibold leading-tight">
                                {n.heading ?? (n.status === "failed" ? "Failed" : "Processing…")}
                              </h3>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                            {n.tasks && n.tasks.length > 0 && (
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                {n.tasks.filter((t) => t.done).length}/{n.tasks.length} tasks
                              </span>
                            )}
                            <div className="flex items-center gap-2">
                              <span className="truncate">
                                {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                              </span>
                              {n.duration_seconds != null && (
                                <span className="tabular-nums">{formatDur(n.duration_seconds)}</span>
                              )}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}

      </section>

      <Recorder onNoteReady={load} />
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

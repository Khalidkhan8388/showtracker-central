import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { toggleTask, deleteNote, processVoiceNote, pinNote } from "@/lib/notes.functions";
import { ArrowLeft, Loader2, AlertCircle, Trash2, RefreshCw, Pin } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/notes/$id")({
  head: () => ({ meta: [{ title: "Note — Braintape" }] }),
  component: NoteDetail,
});

type Note = {
  id: string;
  status: "recording" | "uploaded" | "transcribing" | "processing" | "ready" | "failed";
  heading: string | null;
  summary: string | null;
  transcript: string | null;
  tasks: Array<{ id: string; text: string; done: boolean }> | null;
  duration_seconds: number | null;
  error: string | null;
  created_at: string;
  pinned: boolean;
  image_paths: string[] | null;
};

function NoteDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [note, setNote] = useState<Note | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const toggleFn = useServerFn(toggleTask);
  const deleteFn = useServerFn(deleteNote);
  const processFn = useServerFn(processVoiceNote);
  const pinFn = useServerFn(pinNote);

  async function load() {
    const { data } = await supabase.from("voice_notes").select("*").eq("id", id).single();
    setNote(data as Note | null);
    const paths = Array.isArray((data as any)?.image_paths) ? ((data as any).image_paths as string[]) : [];
    if (paths.length > 0) {
      const signed = await Promise.all(
        paths.map((p) => supabase.storage.from("voice-notes").createSignedUrl(p, 3600)),
      );
      setImageUrls(signed.map((r) => r.data?.signedUrl ?? "").filter(Boolean));
    } else {
      setImageUrls([]);
    }
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`voice_note_${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voice_notes", filter: `id=eq.${id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  async function onToggle(taskId: string) {
    if (!note) return;
    // optimistic
    setNote({ ...note, tasks: (note.tasks ?? []).map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) });
    try {
      await toggleFn({ data: { noteId: id, taskId } });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
      load();
    }
  }

  async function onDelete() {
    if (!confirm("Delete this note?")) return;
    try {
      await deleteFn({ data: { noteId: id } });
      navigate({ to: "/home" });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  async function onRetry() {
    try {
      toast.loading("Retrying…", { id });
      await processFn({ data: { noteId: id } });
      toast.success("Done", { id });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed", { id });
    }
  }

  if (!note) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const processing = note.status !== "ready" && note.status !== "failed";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-16">
      <header className="flex items-center justify-between px-5 pt-6 pb-4">
        <Link to="/home" className="rounded-full p-2 hover:bg-muted" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-1">
          <button
            onClick={async () => {
              const next = !note.pinned;
              setNote({ ...note, pinned: next });
              try {
                await pinFn({ data: { noteId: id, pinned: next } });
              } catch (e: any) {
                toast.error(e?.message ?? "Failed");
                load();
              }
            }}
            className={`rounded-full p-2 hover:bg-muted ${note.pinned ? "text-foreground" : "text-muted-foreground"}`}
            aria-label={note.pinned ? "Unpin" : "Pin"}
          >
            <Pin className={`h-4 w-4 ${note.pinned ? "fill-foreground" : ""}`} />
          </button>
          <button onClick={onDelete} className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="px-5">
        {processing && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {note.status === "transcribing" ? "Transcribing audio…" : note.status === "processing" ? "Extracting summary & tasks…" : "Getting started…"}
          </div>
        )}

        {note.status === "failed" && (
          <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> Something went wrong
            </div>
            {note.error && <p className="mt-1 text-xs text-destructive/80">{note.error}</p>}
            <button
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </div>
        )}

        <h1 className="text-2xl font-bold leading-tight tracking-tight">
          {note.heading ?? (processing ? "Processing…" : "Untitled")}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(note.created_at).toLocaleString()}
        </p>

        {imageUrls.length > 0 && (
          <section className="mt-6">
            <div className={`grid gap-2 ${imageUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              {imageUrls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={url}
                    alt=""
                    className="w-full rounded-2xl border border-border object-cover"
                  />
                </a>
              ))}
            </div>
          </section>
        )}

        {note.summary && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Summary</h2>
            <p className="text-sm leading-relaxed">{note.summary}</p>
          </section>
        )}

        {note.tasks && note.tasks.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tasks</h2>
            <ul className="space-y-2">
              {note.tasks.map((t) => (
                <li key={t.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3">
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => onToggle(t.id)}
                      className="mt-0.5 h-4 w-4 accent-foreground"
                    />
                    <span className={`text-sm ${t.done ? "text-muted-foreground line-through" : ""}`}>{t.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {note.transcript && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Transcript</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{note.transcript}</p>
          </section>
        )}
      </div>
    </div>
  );
}

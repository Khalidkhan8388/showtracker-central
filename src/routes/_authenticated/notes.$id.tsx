import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { toggleTask, deleteNote, processVoiceNote, pinNote, updateTextNote } from "@/lib/notes.functions";
import { ChevronLeft, Loader2, AlertCircle, Trash2, RefreshCw, Pin, CheckCircle2, Circle, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";

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
  source_url: string | null;
};


function NoteDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [note, setNote] = useState<Note | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [editHeading, setEditHeading] = useState("");
  const [editBody, setEditBody] = useState("");
  const toggleFn = useServerFn(toggleTask);
  const deleteFn = useServerFn(deleteNote);
  const processFn = useServerFn(processVoiceNote);
  const pinFn = useServerFn(pinNote);
  const updateFn = useServerFn(updateTextNote);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTextNote = !!note && note.duration_seconds == null && note.transcript != null;

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
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const processing = note.status !== "ready" && note.status !== "failed";
  const linkHost = (() => {
    if (!note.source_url) return null;
    try { return new URL(note.source_url).hostname.replace(/^www\./, ""); } catch { return null; }
  })();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-24">
      {/* iOS nav bar */}
      <header className="sticky top-0 z-10 bg-background/85 backdrop-blur-xl">
        <div className="flex items-center justify-between px-2 pt-3 pb-2">
          <Link
            to="/home"
            aria-label="Back"
            className="inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[17px] text-primary active:opacity-60"
          >
            <ChevronLeft className="h-6 w-6 -ml-1" strokeWidth={2.5} />
            <span>Home</span>
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
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full active:opacity-60 ${note.pinned ? "text-primary" : "text-muted-foreground"}`}
              aria-label={note.pinned ? "Unpin" : "Pin"}
            >
              <Pin className={`h-5 w-5 ${note.pinned ? "fill-primary" : ""}`} />
            </button>
            <button
              onClick={onDelete}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-destructive active:opacity-60"
              aria-label="Delete"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="px-4 pt-2">
        {processing && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl bg-card px-4 py-2.5 text-[13px] text-muted-foreground shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {note.status === "transcribing" ? "Transcribing audio…" : note.status === "processing" ? "Extracting summary & tasks…" : "Getting started…"}
          </div>
        )}

        {note.status === "failed" && (
          <div className="mb-4 rounded-2xl bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-destructive">
              <AlertCircle className="h-4 w-4" /> Something went wrong
            </div>
            {note.error && <p className="mt-1 text-[13px] text-muted-foreground">{note.error}</p>}
            <button
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground active:opacity-70"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        )}

        <h1 className="text-[28px] font-bold leading-tight tracking-tight">
          {note.heading ?? (processing ? "Processing…" : "Untitled")}
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {new Date(note.created_at).toLocaleString()}
        </p>

        {note.source_url && (
          <a
            href={note.source_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-muted px-3 py-1.5 text-[13px] text-primary active:opacity-60"
          >
            <Link2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{linkHost ?? note.source_url}</span>
          </a>
        )}

        {imageUrls.length > 0 && (
          <section className="mt-6">
            <div className={`grid gap-2 ${imageUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              {imageUrls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={url}
                    alt=""
                    className="w-full rounded-2xl object-cover shadow-sm"
                  />
                </a>
              ))}
            </div>
          </section>
        )}

        {note.summary && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">
              Summary
            </h2>
            <div className="rounded-2xl bg-card px-4 py-3 shadow-sm">
              <Markdown>{note.summary}</Markdown>
            </div>
          </section>
        )}

        {note.tasks && note.tasks.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">
              Tasks
            </h2>
            <ul className="overflow-hidden rounded-2xl bg-card shadow-sm">
              {note.tasks.map((t, i) => (
                <li key={t.id}>
                  <button
                    onClick={() => onToggle(t.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-muted"
                  >
                    {t.done ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    ) : (
                      <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                    )}
                    <span
                      className={`text-[17px] leading-tight ${
                        t.done ? "text-muted-foreground line-through" : "text-foreground"
                      }`}
                    >
                      {t.text}
                    </span>
                  </button>
                  {i < note.tasks!.length - 1 && <div className="ml-12 h-px bg-border" />}
                </li>
              ))}
            </ul>
          </section>
        )}

        {note.transcript && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">
              Note
            </h2>
            <div className="rounded-2xl bg-card px-4 py-3 shadow-sm">
              <Markdown className="text-foreground">{note.transcript}</Markdown>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

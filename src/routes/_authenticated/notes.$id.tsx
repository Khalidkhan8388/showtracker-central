import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { toggleTask, deleteNote, processVoiceNote, pinNote, updateTextNote } from "@/lib/notes.functions";
import { ChevronLeft, Loader2, AlertCircle, Trash2, RefreshCw, Pin, CheckCircle2, Circle, Link2, Pencil, Check } from "lucide-react";
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

type LinkTarget = { id: string; heading: string };

function resolveWikiLinks(md: string, index: Map<string, string>): string {
  return md.replace(/\[\[([^\]\n]+?)\]\]/g, (_m, raw) => {
    const title = String(raw).trim();
    if (!title) return _m;
    const id = index.get(title.toLowerCase());
    const href = id ? `/notes/${id}` : `/search?q=${encodeURIComponent(title)}`;
    return `[${title}](${href})`;
  });
}

function NoteDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [note, setNote] = useState<Note | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [allNotes, setAllNotes] = useState<LinkTarget[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftHeading, setDraftHeading] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const toggleFn = useServerFn(toggleTask);
  const deleteFn = useServerFn(deleteNote);
  const processFn = useServerFn(processVoiceNote);
  const pinFn = useServerFn(pinNote);
  const updateFn = useServerFn(updateTextNote);

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

  async function loadIndex() {
    const { data } = await supabase
      .from("voice_notes")
      .select("id,heading")
      .neq("id", id);
    const rows = (data ?? []) as Array<{ id: string; heading: string | null }>;
    setAllNotes(
      rows
        .filter((r) => r.heading && r.heading !== "__custom__")
        .map((r) => ({ id: r.id, heading: r.heading as string })),
    );
  }

  useEffect(() => {
    load();
    loadIndex();
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

  const wikiIndex = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of allNotes) m.set(n.heading.toLowerCase(), n.id);
    return m;
  }, [allNotes]);

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

  function startEdit() {
    if (!note) return;
    setDraftHeading(note.heading ?? "");
    setDraftBody(note.transcript ?? "");
    setEditing(true);
    setTimeout(() => bodyRef.current?.focus(), 30);
  }

  async function saveEdit() {
    if (!note) return;
    setSaving(true);
    try {
      await updateFn({ data: { noteId: id, heading: draftHeading, body: draftBody } });
      setEditing(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function insertWikiLink() {
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? draftBody.length;
    const end = ta.selectionEnd ?? draftBody.length;
    const next = draftBody.slice(0, start) + "[[]]" + draftBody.slice(end);
    setDraftBody(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + 2, start + 2);
    }, 0);
  }

  if (!note) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const processing = note.status !== "ready" && note.status !== "failed";
  const isVoice = note.duration_seconds != null;
  const isText = !isVoice;
  const linkHost = (() => {
    if (!note.source_url) return null;
    try { return new URL(note.source_url).hostname.replace(/^www\./, ""); } catch { return null; }
  })();

  const renderedBody = note.transcript ? resolveWikiLinks(note.transcript, wikiIndex) : "";

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
            {isText && !editing && (
              <button
                onClick={startEdit}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-primary active:opacity-60"
                aria-label="Edit"
              >
                <Pencil className="h-5 w-5" />
              </button>
            )}
            {isText && editing && (
              <button
                onClick={saveEdit}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[15px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Done
              </button>
            )}
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

        {editing ? (
          <input
            value={draftHeading}
            onChange={(e) => setDraftHeading(e.target.value)}
            placeholder="Title"
            className="w-full bg-transparent text-[28px] font-bold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50"
          />
        ) : (
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">
            {note.heading ?? (processing ? "Processing…" : "Untitled")}
          </h1>
        )}
        <p className="mt-1 text-[13px] text-muted-foreground">
          {new Date(note.created_at).toLocaleString()}
        </p>

        {note.source_url && !editing && (
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

        {imageUrls.length > 0 && !editing && (
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

        {!editing && !isText && note.summary && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">
              Summary
            </h2>
            <div className="rounded-2xl bg-card px-4 py-3 shadow-sm">
              <Markdown>{resolveWikiLinks(note.summary, wikiIndex)}</Markdown>
            </div>
          </section>
        )}

        {!editing && note.tasks && note.tasks.length > 0 && (
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

        {editing ? (
          <section className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={insertWikiLink}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-[13px] text-primary active:opacity-60"
              >
                <Link2 className="h-3.5 w-3.5" />
                Link a note
              </button>
              <span className="text-[11px] text-muted-foreground">
                Use <code className="rounded bg-muted px-1">[[Title]]</code> to link
              </span>
            </div>
            <textarea
              ref={bodyRef}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder="Start writing…"
              className="min-h-[60vh] w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
            />
            {allNotes.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Link to
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {allNotes.slice(0, 20).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        const ta = bodyRef.current;
                        const start = ta?.selectionStart ?? draftBody.length;
                        const end = ta?.selectionEnd ?? draftBody.length;
                        const snippet = `[[${n.heading}]]`;
                        setDraftBody(draftBody.slice(0, start) + snippet + draftBody.slice(end));
                        setTimeout(() => {
                          ta?.focus();
                          const pos = start + snippet.length;
                          ta?.setSelectionRange(pos, pos);
                        }, 0);
                      }}
                      className="max-w-full truncate rounded-full bg-muted px-2.5 py-1 text-[12px] text-primary active:opacity-60"
                    >
                      {n.heading}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : (
          note.transcript && (
            <section className="mt-6">
              <Markdown className="text-foreground">{renderedBody}</Markdown>
            </section>
          )
        )}
      </div>
    </div>
  );
}

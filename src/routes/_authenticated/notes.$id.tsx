import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { toggleTask, deleteNote, processVoiceNote, pinNote, updateTextNote, appendImagesToNote, transcribeAudioClip } from "@/lib/notes.functions";
import { ChevronLeft, Loader2, AlertCircle, Trash2, RefreshCw, Pin, CheckCircle2, Circle, Link2, Pencil, ImagePlus, X, Share2, Copy, Mic, Square, FileText, Globe, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { BlockEditor } from "@/components/BlockEditor";
import { generateLinkLabel } from "@/lib/notes.functions";
import { useLocalNote, useLocalNotes } from "@/hooks/use-local-notes";
import { patchLocalNote, patchLocalTask, resync } from "@/lib/sync-engine";


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
  

  const toggleFn = useServerFn(toggleTask);
  const deleteFn = useServerFn(deleteNote);
  const processFn = useServerFn(processVoiceNote);
  const pinFn = useServerFn(pinNote);
  const updateFn = useServerFn(updateTextNote);
  const appendImagesFn = useServerFn(appendImagesToNote);

  // Signed-URL cache keyed by storage path, so task/pin updates don't
  // trigger re-signing every image on every realtime hit.
  const signedCacheRef = useRef<Map<string, string>>(new Map());

  async function load() {
    const { data } = await supabase.from("voice_notes").select("*").eq("id", id).single();
    setNote(data as Note | null);
    const paths = Array.isArray((data as any)?.image_paths) ? ((data as any).image_paths as string[]) : [];
    if (paths.length === 0) {
      setImageUrls([]);
      return;
    }
    const missing = paths.filter((p) => !signedCacheRef.current.has(p));
    if (missing.length > 0) {
      const signed = await Promise.all(
        missing.map((p) => supabase.storage.from("voice-notes").createSignedUrl(p, 3600)),
      );
      missing.forEach((p, i) => {
        const url = signed[i]?.data?.signedUrl;
        if (url) signedCacheRef.current.set(p, url);
      });
    }
    setImageUrls(paths.map((p) => signedCacheRef.current.get(p) ?? "").filter(Boolean));
  }

  async function loadIndex() {
    const { data } = await supabase
      .from("voice_notes")
      .select("id,heading")
      .neq("id", id)
      .neq("heading", "__custom__")
      .not("heading", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    const rows = (data ?? []) as Array<{ id: string; heading: string | null }>;
    setAllNotes(
      rows
        .filter((r) => r.heading)
        .map((r) => ({ id: r.id, heading: r.heading as string })),
    );
  }

  useEffect(() => {
    load();
    loadIndex();
    const channel = supabase
      .channel(`voice_note_${id}_${Math.random().toString(36).slice(2)}`)
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
    // Prefer any unsaved draft for this note
    let h = note.heading ?? "";
    let b = note.transcript ?? "";
    try {
      const raw = localStorage.getItem(`braintape:noteDraft:${id}`);
      if (raw) {
        const d = JSON.parse(raw) as { h?: string; b?: string };
        if (d.h !== undefined) h = d.h;
        if (d.b !== undefined) b = d.b;
      }
    } catch {}
    setDraftHeading(h);
    setDraftBody(b);
    setEditing(true);
  }

  function isDirty() {
    return (
      draftHeading !== (note?.heading ?? "") ||
      draftBody !== (note?.transcript ?? "")
    );
  }

  function cancelEdit() {
    if (isDirty() && !confirm("Discard your changes?")) return;
    try { localStorage.removeItem(`braintape:noteDraft:${id}`); } catch {}
    setEditing(false);
    setAddingLink(false);
    setLinkDraft("");
  }

  async function saveEdit() {
    if (!note) return;
    setSaving(true);
    try {
      await updateFn({ data: { noteId: id, heading: draftHeading, body: draftBody } });
      try { localStorage.removeItem(`braintape:noteDraft:${id}`); } catch {}
      setEditing(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // Autosave draft while editing
  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          `braintape:noteDraft:${id}`,
          JSON.stringify({ h: draftHeading, b: draftBody }),
        );
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [editing, draftHeading, draftBody, id]);

  // Keyboard shortcuts: ⌘/Ctrl+Enter save · Esc cancel
  useEffect(() => {
    if (!editing) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        saveEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draftHeading, draftBody]);

  function insertAtCursor(snippet: string) {
    const el = document.querySelector<HTMLTextAreaElement>('[data-block-editor] textarea:focus')
      ?? document.querySelector<HTMLTextAreaElement>('[data-block-editor] textarea');
    setDraftBody((prev) => {
      if (!el || el.value !== prev) {
        const sep = prev.length === 0 || prev.endsWith("\n") ? "" : "\n";
        return prev + sep + snippet;
      }
      const start = el.selectionStart ?? prev.length;
      const end = el.selectionEnd ?? prev.length;
      const next = prev.slice(0, start) + snippet + prev.slice(end);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + snippet.length;
        el.setSelectionRange(pos, pos);
      });
      return next;
    });
  }

  function appendToBody(snippet: string) {
    setDraftBody((prev) => {
      const sep = prev.length === 0 || prev.endsWith("\n") ? "" : "\n";
      return prev + sep + snippet;
    });
  }

  function insertWikiLinkForTitle(title: string) {
    appendToBody(`[[${title}]]`);
  }

  function removeImageFromBody(src: string) {
    setDraftBody((prev) => {
      const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\n?!\\[[^\\]]*\\]\\(${escaped}\\)\\n?`, "g");
      return prev.replace(re, "");
    });
  }

  function removeLinkFromBody(href: string) {
    setDraftBody((prev) => {
      const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\n?(?<!!)\\[[^\\]]*\\]\\(${escaped}\\)\\n?`, "g");
      return prev.replace(re, "");
    });
  }

  const [uploadingImg, setUploadingImg] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const editFileRef = useRef<HTMLInputElement | null>(null);
  const viewAddImagesRef = useRef<HTMLInputElement | null>(null);
  const [addingImages, setAddingImages] = useState(false);
  const linkLabelFn = useServerFn(generateLinkLabel);
  const transcribeClipFn = useServerFn(transcribeAudioClip);

  // Voice-append recorder state
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceElapsed, setVoiceElapsed] = useState(0);
  const voiceRecRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceStartRef = useRef<number>(0);

  function pickAudioMime(): string {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    for (const c of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "audio/webm";
  }

  async function startVoiceAppend() {
    if (voiceRecording || voiceBusy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, { mimeType: mime });
      voiceRecRef.current = rec;
      voiceChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) voiceChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(voiceChunksRef.current, { type: mime });
        voiceChunksRef.current = [];
        stream.getTracks().forEach((t) => t.stop());
        voiceStreamRef.current = null;
        await finishVoiceAppend(blob, mime);
      };
      rec.start();
      voiceStartRef.current = Date.now();
      setVoiceElapsed(0);
      voiceTimerRef.current = setInterval(() => {
        setVoiceElapsed(Math.floor((Date.now() - voiceStartRef.current) / 1000));
      }, 250);
      setVoiceRecording(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Microphone unavailable");
    }
  }

  function stopVoiceAppend() {
    const rec = voiceRecRef.current;
    if (!rec) return;
    if (voiceTimerRef.current) { clearInterval(voiceTimerRef.current); voiceTimerRef.current = null; }
    setVoiceRecording(false);
    setVoiceBusy(true);
    rec.stop();
  }

  async function finishVoiceAppend(blob: Blob, mime: string) {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not signed in");
      const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
      const path = `${uid}/clips/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("voice-notes")
        .upload(path, blob, { contentType: mime, upsert: false });
      if (upErr) throw upErr;
      const { transcript } = await transcribeClipFn({ data: { audioPath: path } });
      const clean = (transcript ?? "").trim();
      if (!clean) throw new Error("Nothing transcribed");
      appendToBody(clean);
      toast.success("Voice added");
    } catch (e: any) {
      toast.error(e?.message ?? "Transcription failed");
    } finally {
      setVoiceBusy(false);
      setVoiceElapsed(0);
    }
  }

  useEffect(() => () => {
    if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
    voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploadingImg(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not signed in");
      const urls: string[] = [];
      for (const f of files) {
        const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
        const path = `${uid}/images/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("voice-notes")
          .upload(path, f, { contentType: f.type || "image/jpeg", upsert: false });
        if (upErr) throw upErr;
        const { data: signed, error: signErr } = await supabase.storage
          .from("voice-notes")
          .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
        if (signErr || !signed) throw signErr ?? new Error("Sign failed");
        urls.push(signed.signedUrl);
      }
      appendToBody(urls.map((u) => `![](${u})`).join("\n"));
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setUploadingImg(false);
    }
  }

  async function commitLink() {
    const raw = linkDraft.trim();
    if (!raw) {
      setAddingLink(false);
      return;
    }
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      new URL(normalized);
    } catch {
      toast.error("Link doesn't look valid");
      return;
    }
    setAddingLink(false);
    setLinkDraft("");
    const placeholder = `__linking_${Date.now()}__`;
    appendToBody(`[${placeholder}](${normalized})`);
    try {
      const { label } = await linkLabelFn({ data: { url: normalized } });
      const clean = (label || normalized).replace(/[\[\]]/g, "").trim() || normalized;
      setDraftBody((prev) => prev.replace(`[${placeholder}](${normalized})`, `[${clean}](${normalized})`));
    } catch {
      let host = normalized;
      try { host = new URL(normalized).hostname.replace(/^www\./, ""); } catch {}
      setDraftBody((prev) => prev.replace(`[${placeholder}](${normalized})`, `[${host}](${normalized})`));
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
  const isVoice = note.duration_seconds != null;
  const isLink = !!note.source_url;
  const isImage = !isVoice && !isLink && Array.isArray(note.image_paths) && note.image_paths.length > 0;
  const isText = !isVoice && !isLink && !isImage;
  const linkHost = (() => {
    if (!note.source_url) return null;
    try { return new URL(note.source_url).hostname.replace(/^www\./, ""); } catch { return null; }
  })();

  function formatDuration(sec: number) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  function relativeTime(iso: string) {
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  const readingMinutes = note.transcript
    ? Math.max(1, Math.round(note.transcript.trim().split(/\s+/).length / 220))
    : 0;
  const doneCount = note.tasks?.filter((t) => t.done).length ?? 0;
  const taskTotal = note.tasks?.length ?? 0;

  async function onShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const title = note?.heading ?? "Note";
    const text = note?.summary ?? note?.transcript?.slice(0, 200) ?? "";
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch {}
  }

  async function copyTranscript() {
    if (!note?.transcript) return;
    try {
      await navigator.clipboard.writeText(note.transcript);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  }

  async function onAddImagesToSaved(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0 || !note) return;
    setAddingImages(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not signed in");
      const paths: string[] = [];
      for (const f of files) {
        const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
        const path = `${uid}/images/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("voice-notes")
          .upload(path, f, { contentType: f.type || "image/jpeg", upsert: false });
        if (upErr) throw upErr;
        paths.push(path);
      }
      await appendImagesFn({ data: { noteId: id, imagePaths: paths } });
      await load();
      toast.success(files.length === 1 ? "Image added — refreshing…" : `${files.length} images added — refreshing…`);
      // Re-run AI so summary/tasks reflect the new photos.
      try {
        await processFn({ data: { noteId: id } });
        await load();
        toast.success("Note updated");
      } catch (err: any) {
        toast.error(err?.message ?? "Refresh failed");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setAddingImages(false);
    }
  }

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
          <div />

        </div>
      </header>

      <div className="px-5 pt-3">
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

        {/* Kind pill */}
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {isVoice ? <Mic className="h-3 w-3" /> : isLink ? <Globe className="h-3 w-3" /> : isImage ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
          <span>{isVoice ? "Voice" : isLink ? "Web" : isImage ? "Image" : "Note"}</span>
        </div>

        <h1 className="text-[30px] font-bold leading-[1.1] tracking-tight">
          {note.heading ?? (processing ? "Processing…" : "Untitled")}
        </h1>

        <p
          className="mt-1.5 text-[13px] text-muted-foreground"
          title={new Date(note.created_at).toLocaleString()}
        >
          {relativeTime(note.created_at)}
          {isVoice && note.duration_seconds != null && (
            <> · {formatDuration(note.duration_seconds)}</>
          )}
          {isText && readingMinutes > 0 && (
            <> · {readingMinutes} min read</>
          )}
        </p>

        {note.source_url && (
          <a
            href={note.source_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-yellow-400/20 px-2.5 py-1 text-[13px] font-medium text-yellow-700 no-underline active:opacity-60"
          >
            {linkHost ? (
              <img
                src={`https://www.google.com/s2/favicons?domain=${linkHost}&sz=32`}
                alt=""
                className="h-3.5 w-3.5 flex-shrink-0 rounded-sm"
              />
            ) : (
              <Link2 className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{linkHost ?? note.source_url}</span>
          </a>
        )}

        {!isText && (
          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Photos {imageUrls.length > 0 && <span className="ml-1 text-muted-foreground/70 tabular-nums">· {imageUrls.length}</span>}
              </h2>
              <button
                onClick={() => viewAddImagesRef.current?.click()}
                disabled={addingImages}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-primary active:opacity-60 disabled:opacity-50"
                aria-label="Add photos"
              >
                {addingImages ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                {addingImages ? "Uploading…" : "Add"}
              </button>
            </div>
            <input
              ref={viewAddImagesRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={onAddImagesToSaved}
            />
            {imageUrls.length > 0 ? (
              <div className={`grid gap-2 ${imageUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                {imageUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl">
                    <img
                      src={url}
                      alt=""
                      loading={i === 0 ? "eager" : "lazy"}
                      decoding="async"
                      className="w-full object-cover shadow-sm transition-transform duration-200 active:scale-[0.98]"
                    />
                  </a>
                ))}
              </div>
            ) : null}
          </section>
        )}

        {!isText && note.summary && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Summary
            </h2>
            <div className="rounded-2xl bg-card px-4 py-3 shadow-sm">
              <Markdown>{resolveWikiLinks(note.summary, wikiIndex)}</Markdown>
            </div>
          </section>
        )}

        {!isImage && note.tasks && note.tasks.length > 0 && (
          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tasks
              </h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                {doneCount}/{taskTotal}
              </span>
            </div>
            <ul className="overflow-hidden rounded-2xl bg-card shadow-sm">
              {note.tasks.map((t, i) => (
                <li key={t.id}>
                  <button
                    onClick={() => onToggle(t.id)}
                    className="flex w-full items-start gap-3 px-4 py-3.5 text-left active:bg-muted"
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
            {isVoice && (
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Transcript
                </h2>
                <button
                  onClick={copyTranscript}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground active:opacity-60"
                  aria-label="Copy transcript"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>
            )}
            <Markdown className="text-[16px] leading-[1.65] text-foreground">{renderedBody}</Markdown>
          </section>
        )}
      </div>

      {/* Full-screen edit overlay */}
      {editing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border/60 bg-background/85 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
            <div className="flex h-12 w-full items-center justify-between">
              <button
                onClick={cancelEdit}
                className="rounded-full px-2 py-1 text-[15px] text-primary active:opacity-60"
              >
                Cancel
              </button>
              <span className="text-[15px] font-semibold tracking-tight text-foreground">Editing</span>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-[14px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save
              </button>
            </div>
          </header>

          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 pt-5 pb-40">
              <input
                autoFocus
                type="text"
                placeholder="Title"
                value={draftHeading}
                onChange={(e) => setDraftHeading(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const first = document.querySelector<HTMLTextAreaElement>('[data-block-editor] textarea');
                    first?.focus();
                  }
                }}
                maxLength={200}
                className="w-full bg-transparent text-[28px] font-bold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
              />
              <div className="mt-4" data-block-editor>
                <BlockEditor
                  value={draftBody}
                  onChange={setDraftBody}
                  fullscreen
                  onRemoveImage={removeImageFromBody}
                  onRemoveLink={removeLinkFromBody}
                  placeholder="Start writing… # heading · - list · > quote · [[Title]] links a note"
                  wikiIndex={wikiIndex}
                />
              </div>

              {(() => {
                const m = draftBody.match(/\[\[([^\[\]\n]*)$/);
                if (!m || allNotes.length === 0) return null;
                const q = m[1].trim().toLowerCase();
                const matches = allNotes
                  .filter((n) => !q || n.heading.toLowerCase().includes(q))
                  .slice(0, 12);
                if (matches.length === 0) return null;
                return (
                  <div className="mt-4">
                    <p className="mb-1.5 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      Link to a note
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {matches.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => insertWikiLinkForTitle(n.heading)}
                          className="max-w-full truncate rounded-full bg-muted px-2.5 py-1 text-[12px] text-primary active:opacity-60"
                        >
                          {n.heading}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Sticky bottom toolbar */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
              <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2">
                <input
                  ref={editFileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={onPickImages}
                />
                {addingLink && (
                  <div className="flex items-center gap-1 rounded-full border border-border bg-background/95 p-1 pl-3 shadow-xl backdrop-blur-xl">
                    <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      type="url"
                      inputMode="url"
                      value={linkDraft}
                      onChange={(e) => setLinkDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitLink(); }
                        if (e.key === "Escape") { setAddingLink(false); setLinkDraft(""); }
                      }}
                      placeholder="Paste a link…"
                      className="flex-1 bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    />
                    <button
                      onClick={() => { setAddingLink(false); setLinkDraft(""); }}
                      aria-label="Cancel"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <button
                      onClick={commitLink}
                      disabled={!linkDraft.trim()}
                      className="inline-flex items-center rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                )}
                <div className="mx-auto inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/90 p-1.5 shadow-xl backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => editFileRef.current?.click()}
                    disabled={uploadingImg}
                    aria-label="Add image"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {uploadingImg ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" strokeWidth={2} />}
                  </button>
                  <button
                    type="button"
                    onClick={voiceRecording ? stopVoiceAppend : startVoiceAppend}
                    disabled={voiceBusy}
                    aria-label={voiceRecording ? "Stop recording" : "Record voice"}
                    className={`inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-full px-2.5 text-foreground hover:bg-muted disabled:opacity-50 ${voiceRecording ? "bg-red-500/10 text-red-600" : ""}`}
                  >
                    {voiceBusy ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : voiceRecording ? (
                      <>
                        <Square className="h-4 w-4 fill-current" />
                        <span className="text-[11px] font-semibold tabular-nums">{voiceElapsed}s</span>
                      </>
                    ) : (
                      <Mic className="h-5 w-5" strokeWidth={2} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingLink((v) => !v)}
                    aria-label="Add link"
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted ${addingLink ? "bg-muted" : ""}`}
                  >
                    <Link2 className="h-5 w-5" strokeWidth={2} />
                  </button>
                  <div className="mx-1 h-5 w-px bg-border" />
                  <button
                    type="button"
                    onClick={() => insertAtCursor("\n- ")}
                    aria-label="Bullet list"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
                  >
                    <span className="text-lg leading-none">•</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertAtCursor("\n# ")}
                    aria-label="Heading"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
                  >
                    <span className="text-sm font-bold">H</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertAtCursor("[[]]")}
                    aria-label="Link a note"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
                  >
                    <span className="text-xs font-semibold tracking-tighter">[[ ]]</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!editing && (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-center px-5">
          <div
            role="toolbar"
            aria-label="Note actions"
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-white/90 p-1.5 shadow-2xl ring-1 ring-black/10 backdrop-blur-2xl backdrop-saturate-150 dark:bg-neutral-900/85 dark:ring-white/10"
          >
            <button
              onClick={startEdit}
              aria-label="Edit"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 hover:bg-black/5 active:scale-90 dark:text-white/80 dark:hover:bg-white/10"
            >
              <Pencil aria-hidden="true" className="h-5 w-5" />
            </button>
            <button
              onClick={onShare}
              aria-label="Share"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 hover:bg-black/5 active:scale-90 dark:text-white/80 dark:hover:bg-white/10"
            >
              <Share2 aria-hidden="true" className="h-5 w-5" />
            </button>
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
              aria-label={note.pinned ? "Unpin" : "Pin"}
              aria-pressed={note.pinned}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 active:scale-90 dark:hover:bg-white/10 ${note.pinned ? "text-primary" : "text-neutral-700 dark:text-white/80"}`}
            >
              <Pin aria-hidden="true" className={`h-5 w-5 ${note.pinned ? "fill-current" : ""}`} />
            </button>
            <div aria-hidden="true" className="mx-1 h-6 w-px bg-black/10 dark:bg-white/10" />
            <button
              onClick={onDelete}
              aria-label="Delete"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-destructive hover:bg-destructive/10 active:scale-90"
            >
              <Trash2 aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>

  );
}

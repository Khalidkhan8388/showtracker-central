import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { storeLocalPhoto, getPhotoUrl } from "@/lib/photo-cache";
import { storeLocalAudio } from "@/lib/audio-cache";
import { toggleTask, deleteNote, processVoiceNote, pinNote, updateTextNote, appendImagesToNote, transcribeAudioClip, extractOcrForNote, updateImagePaths } from "@/lib/notes.functions";
import { ChevronLeft, Loader2, AlertCircle, Trash2, RefreshCw, Pin, CheckCircle2, Circle, Link2, Pencil, ImagePlus, X, Share2, Copy, Mic, Square, FileText, Globe, Image as ImageIcon, ExternalLink, BookOpen } from "lucide-react";
import { ReminderPicker } from "@/components/ReminderPicker";
import { ReminderSuggestionChip } from "@/components/ReminderSuggestionChip";

import { fetchReaderViewFn } from "@/lib/ai.functions";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { MediaDetail } from "@/components/MediaDetail";
import { BlockEditor } from "@/components/BlockEditor";
import { VoicePlayer, HighlightedTranscript } from "@/components/VoicePlayer";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { generateLinkLabel } from "@/lib/notes.functions";
import { useLocalNote, useLocalNotes } from "@/hooks/use-local-notes";
import { patchLocalNote, patchLocalTask, resync, deleteLocalNotes, clearPendingDelete } from "@/lib/sync-engine";


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
  audio_path: string | null;
  audio_paths?: string[] | null;
  key_points?: string[] | null;
  ocr_text?: string | null;
  ocr_hidden?: boolean;
  reminder_at?: string | null;
  reminder_suggestion_dismissed?: boolean;

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
  const noteLocal = useLocalNote(id);
  const note = (noteLocal ?? null) as Note | null;
  const allLocal = useLocalNotes();
  const allNotes: LinkTarget[] = useMemo(
    () =>
      ((allLocal ?? []) as Note[])
        .filter((r) => r.id !== id && r.heading && r.heading !== "__custom__")
        .map((r) => ({ id: r.id, heading: r.heading as string })),
    [allLocal, id],
  );
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftHeading, setDraftHeading] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  

  const toggleFn = toggleTask;
  const deleteFn = deleteNote;
  const processFn = processVoiceNote;
  const pinFn = pinNote;
  const updateFn = updateTextNote;
  const appendImagesFn = appendImagesToNote;

  // Local-first photo cache: pulls from IndexedDB when we've seen the
  // image before, otherwise downloads once and stores it.
  const refreshImages = useCallback(async (paths: string[]) => {
    if (paths.length === 0) {
      setImageUrls([]);
      return;
    }
    const { getPhotoUrl, getCachedPhotoUrl, warmPhotoCache } = await import(
      "@/lib/photo-cache"
    );
    // Paint anything already in memory immediately.
    const immediate = paths.map((p) => getCachedPhotoUrl(p) ?? "");
    if (immediate.some(Boolean)) setImageUrls(immediate.filter(Boolean));
    await warmPhotoCache(paths);
    const urls = await Promise.all(paths.map((p) => getPhotoUrl(p)));
    setImageUrls(urls.filter(Boolean));
  }, []);


  // Kept as a thin alias — call sites use `load()` to force a re-sign after uploads.
  const load = useCallback(async () => {
    await refreshImages(Array.isArray(note?.image_paths) ? (note!.image_paths as string[]) : []);
  }, [refreshImages, note]);

  useEffect(() => {
    void refreshImages(Array.isArray(note?.image_paths) ? (note!.image_paths as string[]) : []);
  }, [note?.image_paths, refreshImages]);

  const wikiIndex = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of allNotes) m.set(n.heading.toLowerCase(), n.id);
    return m;
  }, [allNotes]);

  async function onToggle(taskId: string) {
    if (!note) return;
    const cur = note.tasks?.find((t) => t.id === taskId);
    const nextDone = !(cur?.done ?? false);
    await patchLocalTask(id, taskId, { done: nextDone });
    try {
      await toggleFn({ data: { noteId: id, taskId, done: nextDone } });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
      void resync();
    }
  }



  async function onDelete() {
    if (!confirm("Delete this note?")) return;
    await deleteLocalNotes([id]);
    navigate({ to: "/home" });
    try {
      await deleteFn({ data: { noteId: id } });
      await clearPendingDelete([id]);
    } catch (e: any) {
      toast.error(e?.message ?? "Delete will retry when back online");
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
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ocrBusy, setOcrBusy] = useState(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [readerBusy, setReaderBusy] = useState(false);
  const [readerData, setReaderData] = useState<{ markdown: string; readingMinutes: number; words: number } | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkLabelFn = generateLinkLabel;
  const transcribeClipFn = transcribeAudioClip;

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
      const path = await storeLocalAudio(blob, mime);
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

  // Playback-synced transcript highlight
  const [playerTime, setPlayerTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const onPlayerTime = useCallback((t: number, d: number, p: boolean) => {
    setPlayerTime(t);
    setPlayerDuration(d);
    setPlayerPlaying(p);
  }, []);

  // "Continue recording" — append a new clip's transcript to this saved note.
  const [contRecording, setContRecording] = useState(false);
  const [contBusy, setContBusy] = useState(false);
  const [contElapsed, setContElapsed] = useState(0);
  const contRecRef = useRef<MediaRecorder | null>(null);
  const contChunksRef = useRef<Blob[]>([]);
  const contStreamRef = useRef<MediaStream | null>(null);
  const contTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contStartRef = useRef<number>(0);

  async function startContinueRecording() {
    if (contRecording || contBusy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      contStreamRef.current = stream;
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, { mimeType: mime });
      contRecRef.current = rec;
      contChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) contChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(contChunksRef.current, { type: mime });
        contChunksRef.current = [];
        stream.getTracks().forEach((t) => t.stop());
        contStreamRef.current = null;
        await finishContinueRecording(blob, mime);
      };
      rec.start();
      contStartRef.current = Date.now();
      setContElapsed(0);
      contTimerRef.current = setInterval(() => {
        setContElapsed(Math.floor((Date.now() - contStartRef.current) / 1000));
      }, 250);
      setContRecording(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Microphone unavailable");
    }
  }

  function stopContinueRecording() {
    const rec = contRecRef.current;
    if (!rec) return;
    if (contTimerRef.current) { clearInterval(contTimerRef.current); contTimerRef.current = null; }
    setContRecording(false);
    setContBusy(true);
    rec.stop();
  }

  async function finishContinueRecording(blob: Blob, mime: string) {
    try {
      const path = await storeLocalAudio(blob, mime);
      // Append the new clip to this note's audio_paths so the player can play
      // the full recording end-to-end.
      const existing =
        (note?.audio_paths && note.audio_paths.length > 0
          ? note.audio_paths
          : note?.audio_path
            ? [note.audio_path]
            : []) as string[];
      const nextPaths = [...existing, path];
      await patchLocalNote(id, { audio_paths: nextPaths });
      toast.loading("Analyzing new clip…", { id });
      // Re-run AI over ALL segments so summary, key points, tasks, and
      // transcript reflect the extended recording.
      await processFn({ data: { noteId: id } });
      toast.success("Note updated", { id });
    } catch (e: any) {
      toast.error(e?.message ?? "Continue recording failed", { id });
    } finally {
      setContBusy(false);
      setContElapsed(0);
    }
  }

  useEffect(() => () => {
    if (contTimerRef.current) clearInterval(contTimerRef.current);
    contStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);


  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploadingImg(true);
    try {
      const paths: string[] = [];
      for (const f of files) {
        // Store the raw path — LocalImage resolves it at render time so the
        // reference survives reloads (blob: URLs don't).
        paths.push(await storeLocalPhoto(f, f.type));
      }
      appendToBody(paths.map((p) => `![](${p})`).join("\n"));
    } catch (err: any) {
      toast.error(err?.message ?? "Could not attach image");
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
  // A note is only classified as an "image note" when it has no text body.
  // If the user typed a transcript, treat it as a text note and render images
  // strictly where they were placed inline in the body — no auto gallery.
  const hasBody = typeof note.transcript === "string" && note.transcript.trim().length > 0;
  const isImage = !isVoice && !isLink && !hasBody && Array.isArray(note.image_paths) && note.image_paths.length > 0;
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
      const paths: string[] = [];
      for (const f of files) {
        paths.push(await storeLocalPhoto(f, f.type));
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

  const transcriptForRender = note.transcript
    ? (isImage
        ? note.transcript.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\n{3,}/g, "\n\n").trim()
        : note.transcript)
    : "";
  const renderedBody = transcriptForRender ? resolveWikiLinks(transcriptForRender, wikiIndex) : "";

  const media = (note as any).media as import("@/lib/local-db").LocalMedia | null | undefined;
  if (media) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-24">
        <header className="sticky top-0 z-10 bg-background/85 backdrop-blur-xl">
          <div className="flex items-center justify-between px-2 pt-3 pb-2">
            <button
              type="button"
              aria-label="Back"
              onClick={() => {
                if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
                else void navigate({ to: "/home" });
              }}
              className="inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[17px] text-primary active:opacity-60"
            >
              <ChevronLeft className="h-6 w-6 -ml-1" strokeWidth={2.5} />
              <span>Back</span>
            </button>
          </div>
        </header>
        <div className="px-5">
          <MediaDetail
            noteId={id}
            media={media}
            onDelete={async () => {
              await deleteFn({ data: { noteId: id } });
              if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
              else void navigate({ to: "/home" });
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-24">
      {/* iOS nav bar */}
      <header className="sticky top-0 z-10 bg-background/85 backdrop-blur-xl">
        <div className="flex items-center justify-between px-2 pt-3 pb-2">
          <button
            type="button"
            aria-label="Back"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                window.history.back();
              } else {
                void navigate({ to: "/home" });
              }
            }}
            className="inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[17px] text-primary active:opacity-60"
          >
            <ChevronLeft className="h-6 w-6 -ml-1" strokeWidth={2.5} />
            <span>Back</span>
          </button>
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

        {isLink && note.source_url && (
          <div className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
            {linkHost && (
              <img
                src={`https://www.google.com/s2/favicons?domain=${linkHost}&sz=64`}
                alt=""
                className="h-4 w-4 flex-shrink-0 rounded-sm"
              />
            )}
            <span className="truncate">{linkHost ?? note.source_url}</span>
            {readerData && (
              <>
                <span>·</span>
                <span className="whitespace-nowrap">{readerData.readingMinutes} min read</span>
              </>
            )}
          </div>
        )}

        <input
          ref={viewAddImagesRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onAddImagesToSaved}
        />

        {isLink && imageUrls.length > 0 && (
          <section className="mt-5">
            <a
              href={note.source_url!}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-2xl bg-muted"
            >
              <img
                src={imageUrls[0]}
                alt=""
                className="h-full w-full object-cover"
                style={{ maxHeight: "60vh" }}
              />
            </a>
          </section>
        )}

        {isLink && note.source_url && (
          <section className="mt-5 flex gap-2">
            <a
              href={note.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-[15px] font-semibold text-primary-foreground no-underline active:opacity-70"
            >
              <ExternalLink className="h-4 w-4" />
              Open original
            </a>
            <button
              type="button"
              disabled={readerBusy}
              onClick={async () => {
                if (readerData) {
                  setReaderOpen((v) => !v);
                  return;
                }
                setReaderBusy(true);
                setReaderError(null);
                try {
                  const r = await fetchReaderViewFn({ data: { url: note.source_url! } });
                  setReaderData({ markdown: r.markdown, readingMinutes: r.readingMinutes, words: r.words });
                  setReaderOpen(true);
                } catch (e: any) {
                  setReaderError(e?.message ?? "Reader failed");
                  toast.error(e?.message ?? "Reader failed");
                } finally {
                  setReaderBusy(false);
                }
              }}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-muted px-4 py-3 text-[15px] font-semibold text-foreground active:opacity-70 disabled:opacity-50"
            >
              {readerBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
              {readerData ? (readerOpen ? "Hide reader" : "Reader view") : "Reader view"}
            </button>
          </section>
        )}

        {isLink && note.summary && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Summary
            </h2>
            <p className="text-[16px] leading-[1.6] text-foreground">{note.summary}</p>
          </section>
        )}

        {isLink && readerData && readerOpen && (
          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Reader view
              </h2>
              <span className="text-[11px] text-muted-foreground">
                {readerData.readingMinutes} min · {readerData.words.toLocaleString()} words
              </span>
            </div>
            <article className="prose prose-neutral dark:prose-invert max-w-none rounded-2xl bg-muted/40 p-5 text-[16px] leading-[1.7]">
              <Markdown>{readerData.markdown}</Markdown>
            </article>
          </section>
        )}


        {isImage && imageUrls.length > 0 && (
          <section className="mt-5">
            <div className={imageUrls.length === 1 ? "flex justify-center" : "grid grid-cols-2 gap-2"}>
              {imageUrls.map((url, i) => {
                const path = (note.image_paths ?? [])[i];
                const isSel = path ? selected.has(path) : false;
                const startLongPress = () => {
                  if (longPressRef.current) clearTimeout(longPressRef.current);
                  longPressRef.current = setTimeout(() => {
                    setSelectMode(true);
                    if (path) setSelected((s) => new Set(s).add(path));
                  }, 450);
                };
                const cancelLongPress = () => {
                  if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
                };
                return (
                  <button
                    type="button"
                    key={`${url}-${i}`}
                    onPointerDown={startLongPress}
                    onPointerUp={cancelLongPress}
                    onPointerLeave={cancelLongPress}
                    onPointerCancel={cancelLongPress}
                    onClick={() => {
                      cancelLongPress();
                      if (selectMode) {
                        if (!path) return;
                        setSelected((s) => {
                          const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n;
                        });
                      } else {
                        setLightboxIdx(i);
                      }
                    }}
                    className={`relative block overflow-hidden rounded-2xl bg-muted active:opacity-90 ${imageUrls.length === 1 ? "max-w-full" : ""} ${isSel ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}
                  >
                    <img
                      src={url}
                      alt=""
                      className={imageUrls.length === 1 ? "max-h-[70vh] max-w-full object-contain" : "h-full w-full object-cover"}
                      style={imageUrls.length === 1 ? undefined : { aspectRatio: "1 / 1" }}
                    />
                    {selectMode && (
                      <span className={`absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold ${isSel ? "border-foreground bg-foreground text-background" : "border-white/80 bg-black/40 text-white"}`}>
                        {isSel ? "✓" : ""}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectMode ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-muted-foreground">{selected.size} selected</span>
                <button
                  type="button"
                  disabled={selected.size === 0 || reorderBusy}
                  onClick={async () => {
                    const paths = (note.image_paths ?? []).slice();
                    const picked = paths.filter((p) => selected.has(p));
                    const rest = paths.filter((p) => !selected.has(p));
                    const next = [...picked, ...rest];
                    setReorderBusy(true);
                    try {
                      await updateImagePaths({ data: { noteId: note.id, imagePaths: next } });
                      await patchLocalNote(note.id, { image_paths: next });
                    } finally { setReorderBusy(false); }
                  }}
                  className="rounded-full bg-muted px-3 py-1.5 text-[13px] font-medium active:opacity-70 disabled:opacity-50"
                >
                  Move to front
                </button>
                <button
                  type="button"
                  disabled={selected.size === 0 || reorderBusy}
                  onClick={async () => {
                    const paths = (note.image_paths ?? []).slice();
                    const next = paths.filter((p) => !selected.has(p));
                    if (next.length === paths.length) return;
                    setReorderBusy(true);
                    try {
                      await updateImagePaths({ data: { noteId: note.id, imagePaths: next } });
                      await patchLocalNote(note.id, { image_paths: next });
                      setSelected(new Set());
                      if (next.length === 0) setSelectMode(false);
                    } finally { setReorderBusy(false); }
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-3 py-1.5 text-[13px] font-medium text-destructive active:opacity-70 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => { setSelectMode(false); setSelected(new Set()); }}
                  className="rounded-full px-3 py-1.5 text-[13px] font-medium text-muted-foreground active:opacity-70"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => viewAddImagesRef.current?.click()}
                  disabled={addingImages}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[13px] font-medium text-foreground active:opacity-70 disabled:opacity-50"
                >
                  {addingImages ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  Add photos
                </button>
                <button
                  type="button"
                  disabled={ocrBusy}
                  onClick={async () => {
                    if (note.ocr_text && note.ocr_hidden) {
                      await patchLocalNote(note.id, { ocr_hidden: false });
                      return;
                    }
                    setOcrBusy(true);
                    try {
                      const { text } = await extractOcrForNote({ data: { noteId: note.id } });
                      await patchLocalNote(note.id, { ocr_text: text || null, ocr_hidden: false });
                      toast.success(text ? "Text extracted" : "No text found");
                    } catch (e: any) {
                      toast.error(e?.message ?? "OCR failed");
                    } finally { setOcrBusy(false); }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[13px] font-medium text-foreground active:opacity-70 disabled:opacity-50"
                >
                  {ocrBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                  {note.ocr_text
                    ? (note.ocr_hidden ? "Show extracted text" : "Re-extract text")
                    : "Extract text"}
                </button>
              </div>
            )}
          </section>
        )}

        {isImage && note.ocr_text && !note.ocr_hidden && (
          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Extracted text
              </h2>
              <button
                type="button"
                onClick={async () => {
                  await patchLocalNote(note.id, { ocr_hidden: true });
                }}
                className="rounded-full px-2 py-1 text-[11px] font-medium text-muted-foreground active:opacity-70"
              >
                Hide
              </button>
            </div>
            <pre className="whitespace-pre-wrap rounded-2xl bg-muted/60 p-4 text-[14px] leading-[1.55] text-foreground font-sans selection:bg-foreground selection:text-background">
{note.ocr_text}
            </pre>
          </section>
        )}




        {isImage && note.summary && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Summary
            </h2>
            <p className="text-[16px] leading-[1.6] text-foreground">{note.summary}</p>
          </section>
        )}


        {note.tasks && note.tasks.length > 0 && (
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

        {isVoice && (note.audio_path || (note.audio_paths && note.audio_paths.length > 0)) && (
          <section className="mt-5">
            <VoicePlayer
              audioPaths={
                note.audio_paths && note.audio_paths.length > 0
                  ? note.audio_paths
                  : note.audio_path
                    ? [note.audio_path]
                    : []
              }
              fallbackDuration={note.duration_seconds}
              onTimeUpdate={onPlayerTime}
            />
          </section>
        )}

        {isVoice && note.summary && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Summary
            </h2>
            <p className="text-[16px] leading-[1.6] text-foreground">{note.summary}</p>
          </section>
        )}

        {isVoice && note.key_points && note.key_points.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Key points
            </h2>
            <ul className="space-y-1.5">
              {note.key_points.map((k, i) => (
                <li key={i} className="flex gap-2 text-[15px] leading-[1.55] text-foreground">
                  <span className="mt-[9px] inline-block h-1 w-1 shrink-0 rounded-full bg-foreground/60" />
                  <span>{k}</span>
                </li>
              ))}
            </ul>
          </section>
        )}


        {note.transcript && renderedBody && (
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
            {isVoice ? (
              <HighlightedTranscript
                text={transcriptForRender}
                currentTime={playerTime}
                duration={playerDuration || (note.duration_seconds ?? 0)}
                playing={playerPlaying}
              />
            ) : (
              <Markdown className="text-[16px] leading-[1.65] text-foreground">{renderedBody}</Markdown>
            )}
          </section>
        )}

        {isVoice && !editing && (
          <section className="mt-5">
            <button
              type="button"
              onClick={contRecording ? stopContinueRecording : startContinueRecording}
              disabled={contBusy}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-full py-3 text-[14px] font-semibold shadow-sm active:opacity-70 disabled:opacity-50 ${
                contRecording
                  ? "bg-red-500 text-white"
                  : "bg-card text-foreground ring-1 ring-border"
              }`}
            >
              {contBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Transcribing…
                </>
              ) : contRecording ? (
                <>
                  <Square className="h-4 w-4 fill-current" /> Stop · {contElapsed}s
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" /> Continue recording
                </>
              )}
            </button>
          </section>
        )}



        {/* Reminder suggestion chip moved above the floating action pill */}

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

              {!media && (
                <ReminderSuggestionChip
                  text={[draftHeading, draftBody, note.ocr_text ?? ""].filter(Boolean).join("\n")}
                  hasReminder={!!note.reminder_at}
                  dismissed={!!note.reminder_suggestion_dismissed}
                  onAccept={async (iso) => {
                    await patchLocalNote(id, { reminder_at: iso });
                    toast.success("Reminder set");
                  }}
                  onDismiss={async () => {
                    await patchLocalNote(id, { reminder_suggestion_dismissed: true });
                  }}
                />
              )}



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

      {!editing && !media && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-40 flex justify-center px-5">
          <div className="pointer-events-auto max-w-full">
            <ReminderSuggestionChip
              text={[
                note.heading ?? "",
                note.transcript ?? "",
                note.summary ?? "",
                note.ocr_text ?? "",
                readerData?.markdown ?? "",
              ].filter(Boolean).join("\n")}
              hasReminder={!!note.reminder_at}
              dismissed={!!note.reminder_suggestion_dismissed}
              onAccept={async (iso) => {
                await patchLocalNote(id, { reminder_at: iso });
                toast.success("Reminder set");
              }}
              onDismiss={async () => {
                await patchLocalNote(id, { reminder_suggestion_dismissed: true });
              }}
            />
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
                await patchLocalNote(id, { pinned: next });
                try {
                  await pinFn({ data: { noteId: id, pinned: next } });
                } catch (e: any) {
                  toast.error(e?.message ?? "Failed");
                  void resync();
                }

              }}
              aria-label={note.pinned ? "Unpin" : "Pin"}
              aria-pressed={note.pinned}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 active:scale-90 dark:hover:bg-white/10 ${note.pinned ? "text-primary" : "text-neutral-700 dark:text-white/80"}`}
            >
              <Pin aria-hidden="true" className={`h-5 w-5 ${note.pinned ? "fill-current" : ""}`} />
            </button>
            <ReminderPicker
              value={note.reminder_at}
              onChange={async (iso) => {
                await patchLocalNote(id, { reminder_at: iso });
                toast.success(iso ? "Reminder set" : "Reminder cleared");
              }}
            />
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

      {isImage && (
        <PhotoLightbox
          urls={imageUrls}
          startIndex={lightboxIdx ?? 0}
          open={lightboxIdx !== null}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>

  );
}

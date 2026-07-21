import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, ImagePlus, X, Link2, FileText, Maximize2, Minimize2, Eye, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { processVoiceNote, saveWebLink, saveTextNote } from "@/lib/notes.functions";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";


function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
}

type PendingImage = { file: File; previewUrl: string };

export function Recorder({ onNoteReady }: { onNoteReady?: () => void } = {}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [shrunk, setShrunk] = useState(false);
  const pendingRef = useRef<PendingImage[]>([]);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [textOpen, setTextOpen] = useState(false);
  const [textHeading, setTextHeading] = useState("");
  const [textBody, setTextBody] = useState("");
  const [textMode, setTextMode] = useState<"write" | "preview">("write");
  const [uploadingMd, setUploadingMd] = useState(false);
  const [textFullscreen, setTextFullscreen] = useState(false);
  const textFileRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const processFn = useServerFn(processVoiceNote);
  const saveLinkFn = useServerFn(saveWebLink);
  const saveTextFn = useServerFn(saveTextNote);

  function insertAtCursor(snippet: string) {
    const el = textAreaRef.current;
    setTextBody((prev) => {
      if (!el) return prev + snippet;
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

  async function onPickMarkdownImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploadingMd(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not signed in");
      const paths = await uploadImages(uid, files);
      const urls: string[] = [];
      for (const p of paths) {
        const { data, error } = await supabase.storage
          .from("voice-notes")
          .createSignedUrl(p, 60 * 60 * 24 * 365 * 10);
        if (error || !data) throw error ?? new Error("Could not sign URL");
        urls.push(data.signedUrl);
      }
      const snippet = urls.map((u) => `\n![](${u})\n`).join("");
      insertAtCursor(snippet);
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setUploadingMd(false);
    }
  }

  function promptInsertLink() {
    const url = window.prompt("Link URL");
    if (!url) return;
    const normalized = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    try {
      new URL(normalized);
    } catch {
      toast.error("Link doesn't look valid");
      return;
    }
    const label = window.prompt("Link text (optional)", "") || normalized;
    insertAtCursor(`[${label}](${normalized})`);
  }

  function removeImageFromBody(src: string) {
    setTextBody((prev) => {
      // Remove markdown image with matching src: ![...](src) plus surrounding whitespace/newlines
      const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\n?!\\[[^\\]]*\\]\\(${escaped}\\)\\n?`, "g");
      return prev.replace(re, "");
    });
  }

  function resetTextComposer() {
    setTextHeading("");
    setTextBody("");
    setTextMode("write");
    setTextFullscreen(false);
  }

  async function submitText() {
    const heading = textHeading.trim();
    if (!heading) {
      toast.error("Please add a title");
      return;
    }
    setTextOpen(false);
    setBusy(true);
    try {
      await saveTextFn({
        data: {
          heading,
          body: textBody.trim(),
          imagePaths: [],
          sourceUrl: null,
        },
      });
      resetTextComposer();
      onNoteReady?.();
    } catch (err: any) {
      toast.error(err?.message ?? "Could not save note");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let lastY = typeof window !== "undefined" ? window.scrollY : 0;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - lastY;
        if (y < 24) setShrunk(false);
        else if (dy > 4) setShrunk(true);
        else if (dy < -4) setShrunk(false);
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function submitLink() {
    const url = linkUrl.trim();
    if (!url) return;
    setLinkOpen(false);
    setLinkUrl("");
    setBusy(true);
    try {
      const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      await saveLinkFn({ data: { url: normalized } });
      onNoteReady?.();
    } catch (err: any) {
      toast.error(err?.message ?? "Could not save link");
    } finally {
      setBusy(false);
    }
  }


  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      pendingRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    },
    [],
  );

  function updatePending(next: PendingImage[]) {
    pendingRef.current = next;
    setPending(next);
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => finalizeAudio(mime);
      rec.start();
      recRef.current = rec;
      startRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(
        () => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)),
        250,
      );
    } catch (err: any) {
      toast.error(err?.message ?? "Could not access microphone");
    }
  }

  function stop() {
    if (!recRef.current) return;
    recRef.current.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const next = files.map((f) => ({ file: f, previewUrl: URL.createObjectURL(f) }));
    if (recording) {
      // attach to current recording
      updatePending([...pendingRef.current, ...next]);
    } else {
      // create image-only note immediately
      submitImageOnly(files).catch((err: any) => toast.error(err?.message ?? "Upload failed"));
      next.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    }
  }

  function removePending(idx: number) {
    const copy = [...pendingRef.current];
    const [rm] = copy.splice(idx, 1);
    if (rm) URL.revokeObjectURL(rm.previewUrl);
    updatePending(copy);
  }

  async function uploadImages(uid: string, files: File[]): Promise<string[]> {
    const paths: string[] = [];
    for (const f of files) {
      const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
      const path = `${uid}/images/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("voice-notes")
        .upload(path, f, { contentType: f.type || "image/jpeg", upsert: false });
      if (error) throw error;
      paths.push(path);
    }
    return paths;
  }

  async function submitImageOnly(files: File[]) {
    setBusy(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not signed in");
      const paths = await uploadImages(uid, files);
      const { data: inserted, error: insErr } = await supabase
        .from("voice_notes")
        .insert({ user_id: uid, image_paths: paths, status: "uploaded" })
        .select("id")
        .single();
      if (insErr || !inserted) throw insErr ?? new Error("Insert failed");
      setBusy(false);
      onNoteReady?.();
      processFn({ data: { noteId: inserted.id } })
        .then(() => onNoteReady?.())
        .catch((e) => {
          toast.error(e?.message ?? "Processing failed");
          onNoteReady?.();
        });
    } catch (err: any) {
      setBusy(false);
      throw err;
    }
  }

  async function finalizeAudio(mime: string) {
    setBusy(true);
    try {
      const blob = new Blob(chunksRef.current, { type: mime });
      const attachedImages = pendingRef.current;
      if (blob.size < 2048 && attachedImages.length === 0) {
        toast.error("Recording was too short — try again.");
        setBusy(false);
        return;
      }
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not signed in");

      let audioPath: string | null = null;
      let duration: number | null = null;
      if (blob.size >= 2048) {
        const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        audioPath = `${uid}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("voice-notes")
          .upload(audioPath, blob, { contentType: mime, upsert: false });
        if (upErr) throw upErr;
        duration = Math.max(1, Math.round((Date.now() - startRef.current) / 1000));
      }

      let imagePaths: string[] = [];
      if (attachedImages.length > 0) {
        imagePaths = await uploadImages(
          uid,
          attachedImages.map((p) => p.file),
        );
      }

      const { data: inserted, error: insErr } = await supabase
        .from("voice_notes")
        .insert({
          user_id: uid,
          audio_path: audioPath,
          duration_seconds: duration,
          image_paths: imagePaths,
          status: "uploaded",
        })
        .select("id")
        .single();
      if (insErr || !inserted) throw insErr ?? new Error("Insert failed");

      attachedImages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      updatePending([]);
      setBusy(false);
      onNoteReady?.();
      processFn({ data: { noteId: inserted.id } })
        .then(() => onNoteReady?.())
        .catch((e) => {
          toast.error(e?.message ?? "Processing failed");
          onNoteReady?.();
        });
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
      setBusy(false);
    }
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const mmss = `${mm}:${ss}`;

  const label = busy
    ? "Saving…"
    : recording
      ? `Recording ${mmss}${pending.length > 0 ? ` · ${pending.length} 📷` : ""}`
      : "Tap to record";


  const showSpinner = busy;
  const disabled = busy;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex flex-col items-center gap-2 px-5">
      {pending.length > 0 && (
        <div className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto rounded-2xl bg-foreground/80 p-2 shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150">
          {pending.map((p, i) => (
            <div key={i} className="relative shrink-0">
              <img
                src={p.previewUrl}
                alt=""
                className="h-12 w-12 rounded-lg object-cover ring-1 ring-background/20"
              />
              <button
                onClick={() => removePending(i)}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background text-foreground shadow"
                aria-label="Remove image"
              >
                <X className="h-2.5 w-2.5" strokeWidth={3} />
              </button>
            </div>
          ))}
        </div>
      )}

      {linkOpen && (
        <div className="pointer-events-auto flex w-full max-w-md items-center gap-1 rounded-full bg-foreground/85 p-1 pl-4 shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150">
          <Link2 className="h-4 w-4 shrink-0 text-background/80" />
          <input
            autoFocus
            type="url"
            inputMode="url"
            placeholder="Paste a link…"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitLink();
              if (e.key === "Escape") {
                setLinkOpen(false);
                setLinkUrl("");
              }
            }}
            className="flex-1 bg-transparent px-2 py-1.5 text-sm text-background placeholder:text-background/50 outline-none"
          />
          <button
            onClick={() => {
              setLinkOpen(false);
              setLinkUrl("");
            }}
            aria-label="Cancel"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-background/80 hover:bg-background/15"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            onClick={submitLink}
            disabled={!linkUrl.trim()}
            className="inline-flex items-center rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}

      {textOpen && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 rounded-t-3xl border border-border bg-background p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold tracking-tight">New note</h2>
              <div className="flex items-center gap-1">
                <div className="mr-2 flex items-center rounded-full bg-muted p-0.5 text-xs">
                  <button
                    onClick={() => setTextMode("write")}
                    className={`rounded-full px-3 py-1 font-medium transition ${textMode === "write" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                  >
                    Write
                  </button>
                  <button
                    onClick={() => setTextMode("preview")}
                    className={`rounded-full px-3 py-1 font-medium transition ${textMode === "preview" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                  >
                    Preview
                  </button>
                </div>
                <button
                  onClick={() => setTextOpen(false)}
                  aria-label="Close"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <input
              autoFocus
              type="text"
              placeholder="Title"
              value={textHeading}
              onChange={(e) => setTextHeading(e.target.value)}
              maxLength={200}
              className="w-full bg-transparent text-lg font-semibold tracking-tight text-foreground placeholder:text-muted-foreground outline-none"
            />
            {textMode === "write" ? (
              <textarea
                ref={textAreaRef}
                placeholder={"Write in markdown…\n\n# Heading\n**bold**, *italic*, `code`\n- bullet list\n- [ ] task\n\nUse the buttons below to insert images or links."}
                value={textBody}
                onChange={(e) => setTextBody(e.target.value)}
                maxLength={20000}
                rows={8}
                className="min-h-[200px] w-full flex-1 resize-none rounded-2xl border border-border bg-muted/30 p-3 font-mono text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/40"
              />
            ) : (
              <div className="min-h-[200px] w-full flex-1 overflow-y-auto rounded-2xl border border-border bg-muted/30 p-4">
                {textBody.trim() ? (
                  <Markdown>{textBody}</Markdown>
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
                )}
              </div>
            )}

            <input
              ref={textFileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onPickMarkdownImages}
            />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => textFileRef.current?.click()}
                  disabled={uploadingMd}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {uploadingMd ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  Image
                </button>
                <button
                  onClick={promptInsertLink}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <Link2 className="h-4 w-4" />
                  Link
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    resetTextComposer();
                    setTextOpen(false);
                  }}
                  className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={submitText}
                  disabled={!textHeading.trim()}
                  className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
                >
                  Save note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}



      <div
        className={`pointer-events-auto inline-flex items-center gap-1 rounded-full shadow-2xl ring-1 backdrop-blur-2xl backdrop-saturate-150 transition-all duration-300 ease-out ${
          shrunk ? "scale-90 p-1 opacity-95" : "scale-100 p-1.5 opacity-100"
        } ${
          recording
            ? "bg-destructive/70 ring-destructive/30 animate-pulse"
            : "bg-foreground/60 ring-background/10"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onPickImages}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          aria-label="Attach image"
          className={`inline-flex items-center justify-center rounded-full text-background/70 transition-all duration-300 hover:bg-background/10 hover:text-background active:scale-90 disabled:opacity-50 ${
            shrunk ? "h-9 w-9" : "h-11 w-11"
          }`}
        >
          <ImagePlus className={shrunk ? "h-4 w-4" : "h-5 w-5"} strokeWidth={2} />
        </button>
        <button
          onClick={() => setTextOpen(true)}
          disabled={disabled || recording}
          aria-label="Write text note"
          className={`inline-flex items-center justify-center rounded-full text-background/70 transition-all duration-300 hover:bg-background/10 hover:text-background active:scale-90 disabled:opacity-50 ${
            shrunk ? "h-9 w-9" : "h-11 w-11"
          }`}
        >
          <FileText className={shrunk ? "h-4 w-4" : "h-5 w-5"} strokeWidth={2} />
        </button>
        <button
          onClick={() => setLinkOpen(true)}
          disabled={disabled || recording}
          aria-label="Save web link"
          className={`inline-flex items-center justify-center rounded-full text-background/70 transition-all duration-300 hover:bg-background/10 hover:text-background active:scale-90 disabled:opacity-50 ${
            shrunk ? "h-9 w-9" : "h-11 w-11"
          }`}
        >
          <Link2 className={shrunk ? "h-4 w-4" : "h-5 w-5"} strokeWidth={2} />
        </button>

        <div className="mx-1 h-6 w-px bg-background/10" />

        <button
          onClick={recording ? stop : start}
          disabled={disabled}
          aria-label={recording ? "Stop recording" : "Start recording"}
          className={`group inline-flex items-center gap-2.5 rounded-full bg-background/10 text-background transition-all duration-300 hover:bg-background/15 active:scale-[0.97] disabled:cursor-default ${
            shrunk ? "py-1.5 pl-2.5 pr-4" : "py-2 pl-3 pr-5"
          }`}
        >
          <span className="relative flex items-center justify-center">
            {!recording && !showSpinner && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-1 ring-foreground" />
            )}
            {showSpinner ? (
              <Loader2 className={shrunk ? "h-4 w-4 animate-spin" : "h-5 w-5 animate-spin"} />
            ) : recording ? (
              <Square className={shrunk ? "h-3.5 w-3.5" : "h-4 w-4"} fill="currentColor" />
            ) : (
              <Mic className={shrunk ? "h-4 w-4" : "h-5 w-5"} strokeWidth={2} />
            )}
          </span>
          <span className={`font-semibold tracking-tight tabular-nums ${shrunk ? "text-xs" : "text-sm"}`}>{label}</span>
        </button>
      </div>

    </div>
  );
}

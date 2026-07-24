import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, Square, Loader2, ImagePlus, X, Link2, FileText, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { createMediaNote, processVoiceNote, saveWebLink, saveTextNote, generateLinkLabel } from "@/lib/notes.functions";
import { storeLocalPhoto, getPhotoUrl } from "@/lib/photo-cache";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { BlockEditor } from "@/components/BlockEditor";
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
  const [inlineLinkOpen, setInlineLinkOpen] = useState(false);
  const [inlineLinkUrl, setInlineLinkUrl] = useState("");
  const textFileRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const processFn = processVoiceNote;
  const saveLinkFn = saveWebLink;
  const saveTextFn = saveTextNote;
  const linkLabelFn = generateLinkLabel;

  function insertAtCursor(snippet: string) {
    const el = textAreaRef.current;
    setTextBody((prev) => {
      // If the textarea's value matches the full body, it's a single block: insert at cursor.
      // Otherwise (block editor split by images), append to end to avoid corrupting existing markdown.
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


  async function onPickMarkdownImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploadingMd(true);
    try {
      const paths: string[] = [];
      for (const f of files) {
        const path = await storeLocalPhoto(f, f.type);
        // Warm the object URL cache so the just-inserted image renders instantly.
        await getPhotoUrl(path);
        paths.push(path);
      }
      const snippet = paths.map((p) => `\n![](${p})\n`).join("");
      insertAtCursor(snippet);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not attach image");
    } finally {
      setUploadingMd(false);
    }
  }

  async function insertLinkFromUrl(rawUrl: string) {
    const url = rawUrl.trim();
    if (!url) return;
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try {
      new URL(normalized);
    } catch {
      toast.error("Link doesn't look valid");
      return;
    }
    const placeholderId = `__linking_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;
    insertAtCursor(`\n[${placeholderId}](${normalized})\n`);
    try {
      const { label } = await linkLabelFn({ data: { url: normalized } });
      const clean = (label || normalized).replace(/[\[\]]/g, "").trim() || normalized;
      setTextBody((prev) => prev.replace(`[${placeholderId}](${normalized})`, `[${clean}](${normalized})`));
    } catch {
      const hostname = (() => {
        try { return new URL(normalized).hostname.replace(/^www\./, ""); } catch { return normalized; }
      })();
      setTextBody((prev) => prev.replace(`[${placeholderId}](${normalized})`, `[${hostname}](${normalized})`));
    }
  }


  function removeImageFromBody(src: string) {
    setTextBody((prev) => {
      // Remove markdown image with matching src: ![...](src) plus surrounding whitespace/newlines
      const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\n?!\\[[^\\]]*\\]\\(${escaped}\\)\\n?`, "g");
      return prev.replace(re, "");
    });
  }

  function removeLinkFromBody(href: string) {
    setTextBody((prev) => {
      const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\n?(?<!!)\\[[^\\]]*\\]\\(${escaped}\\)\\n?`, "g");
      return prev.replace(re, "");
    });
  }



  function resetTextComposer() {
    setTextHeading("");
    setTextBody("");
    setTextMode("write");
    setTextFullscreen(false);
    try { localStorage.removeItem("braintape:textDraft"); } catch {}
  }

  function handleCancelText() {
    const dirty = textHeading.trim().length > 0 || textBody.trim().length > 0;
    if (dirty && !confirm("Discard this note?")) return;
    resetTextComposer();
    setTextOpen(false);
    setInlineLinkOpen(false);
    setInlineLinkUrl("");
  }

  // Persist draft while composer is open
  useEffect(() => {
    if (!textOpen) return;
    try {
      const raw = localStorage.getItem("braintape:textDraft");
      if (raw) {
        const d = JSON.parse(raw) as { h?: string; b?: string };
        if (!textHeading && d.h) setTextHeading(d.h);
        if (!textBody && d.b) setTextBody(d.b);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textOpen]);

  useEffect(() => {
    if (!textOpen) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          "braintape:textDraft",
          JSON.stringify({ h: textHeading, b: textBody }),
        );
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [textOpen, textHeading, textBody]);

  // ⌘/Ctrl+Enter to save, Esc to cancel
  useEffect(() => {
    if (!textOpen) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submitText();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancelText();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textOpen, textHeading, textBody]);

  async function submitText() {
    const heading = textHeading.trim();
    const body = textBody.trim();
    if (!heading && !body) {
      toast.error("Add a title or some content");
      return;
    }
    setTextOpen(false);
    setBusy(true);
    try {
      // Extract any `local://images/...` paths embedded in the body so the
      // note's `image_paths` gets populated — powers home/collection thumbnails.
      const imagePaths = Array.from(
        body.matchAll(/!\[[^\]]*\]\((local:\/\/images\/[^)\s]+)\)/g),
      ).map((m) => m[1]);
      await saveTextFn({
        data: {
          heading,
          body,
          imagePaths,
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
      submitImageOnly(files).catch((err: any) => toast.error(err?.message ?? "Could not save images"));
      next.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    }
  }

  function removePending(idx: number) {
    const copy = [...pendingRef.current];
    const [rm] = copy.splice(idx, 1);
    if (rm) URL.revokeObjectURL(rm.previewUrl);
    updatePending(copy);
  }

  async function submitImageOnly(files: File[]) {
    setBusy(true);
    try {
      const { noteId } = await createMediaNote({
        audioBlob: null,
        audioMime: null,
        durationSeconds: null,
        imageBlobs: files,
      });
      setBusy(false);
      onNoteReady?.();
      // analyzeMediaFn runs in the background inside createMediaNote; nothing else to do.
      void noteId;
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
      const durationSeconds =
        blob.size >= 2048 ? Math.max(1, Math.round((Date.now() - startRef.current) / 1000)) : null;

      const { noteId } = await createMediaNote({
        audioBlob: blob.size >= 2048 ? blob : null,
        audioMime: blob.size >= 2048 ? mime : null,
        durationSeconds,
        imageBlobs: attachedImages.map((p) => p.file),
      });
      void noteId;

      attachedImages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      updatePending([]);
      setBusy(false);
      onNoteReady?.();
    } catch (err: any) {
      toast.error(err?.message ?? "Could not save note");
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
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
      {/* Ancillary pills stack ABOVE the main pill without pushing it */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[104px] flex flex-col items-center gap-2 px-5">

      {pending.length > 0 && (
        <div role="list" aria-label="Attached images" className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto rounded-2xl bg-white/85 p-2 shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150 dark:bg-neutral-900/85 dark:ring-white/10">
          {pending.map((p, i) => (
            <div key={i} role="listitem" className="relative shrink-0">
              <img
                src={p.previewUrl}
                alt=""
                className="h-12 w-12 rounded-lg object-cover ring-1 ring-black/10 dark:ring-white/10"
              />
              <button
                onClick={() => removePending(i)}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-white shadow dark:bg-white dark:text-neutral-900"
                aria-label={`Remove image ${i + 1}`}
              >
                <X aria-hidden="true" className="h-2.5 w-2.5" strokeWidth={3} />
              </button>
            </div>
          ))}
        </div>
      )}

      {linkOpen && (
        <div className="pointer-events-auto flex w-full max-w-md items-center gap-1 rounded-full bg-white/90 p-1 pl-4 shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150 dark:bg-neutral-900/90 dark:ring-white/10">
          <Link2 aria-hidden="true" className="h-4 w-4 shrink-0 text-neutral-600 dark:text-white/70" />
          <label htmlFor="recorder-link-input" className="sr-only">Web link</label>
          <input
            id="recorder-link-input"
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
            className="flex-1 bg-transparent px-2 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-500 outline-none dark:text-white dark:placeholder:text-white/50"
          />
          <button
            onClick={() => {
              setLinkOpen(false);
              setLinkUrl("");
            }}
            aria-label="Cancel link entry"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-700 hover:bg-black/5 dark:text-white/80 dark:hover:bg-white/10"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            onClick={submitLink}
            disabled={!linkUrl.trim()}
            aria-label="Save link"
            className="inline-flex items-center rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            Save
          </button>
        </div>

      )}

      {textOpen && typeof document !== "undefined" && createPortal(
        <div className="sheet-slide-up pointer-events-auto fixed inset-0 z-50 flex flex-col bg-background">
          {/* iOS-style top bar */}
          <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border/60 bg-background/85 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
            <div className="flex h-12 w-full items-center justify-between">
              <button
                onClick={handleCancelText}
                className="rounded-full px-2 py-1 text-[15px] text-primary active:opacity-60"
              >
                Cancel
              </button>
              <span className="text-[15px] font-semibold tracking-tight text-foreground">New note</span>
              <button
                onClick={submitText}
                disabled={!textHeading.trim() && !textBody.trim()}
                className="rounded-full bg-primary px-3.5 py-1.5 text-[14px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </header>

          {/* Body: title + editor */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 pt-5 pb-40">
              <input
                autoFocus
                type="text"
                placeholder="Title"
                value={textHeading}
                onChange={(e) => setTextHeading(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    // jump into body
                    const first = document.querySelector<HTMLTextAreaElement>('[data-block-editor] textarea');
                    first?.focus();
                  }
                }}
                maxLength={200}
                className="w-full bg-transparent text-[28px] font-bold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
              />
              <div className="mt-4" data-block-editor>
                <BlockEditor
                  value={textBody}
                  onChange={setTextBody}
                  fullscreen
                  onRemoveImage={removeImageFromBody}
                  onRemoveLink={removeLinkFromBody}
                  placeholder="Start writing… # heading · - list · > quote · [[Title]] links a note"
                />
              </div>
            </div>

            {/* Sticky bottom toolbar */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
              <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2">
                <input
                  ref={textFileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={onPickMarkdownImages}
                />
                {inlineLinkOpen && (
                  <div className="flex items-center gap-1 rounded-full border border-border bg-background/95 p-1 pl-3 shadow-xl backdrop-blur-xl">
                    <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      type="url"
                      inputMode="url"
                      placeholder="Paste a link…"
                      value={inlineLinkUrl}
                      onChange={(e) => setInlineLinkUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const v = inlineLinkUrl;
                          setInlineLinkUrl("");
                          setInlineLinkOpen(false);
                          insertLinkFromUrl(v);
                        } else if (e.key === "Escape") {
                          setInlineLinkOpen(false);
                          setInlineLinkUrl("");
                        }
                      }}
                      className="flex-1 bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                    />
                    <button
                      onClick={() => {
                        setInlineLinkOpen(false);
                        setInlineLinkUrl("");
                      }}
                      aria-label="Cancel"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        const v = inlineLinkUrl;
                        setInlineLinkUrl("");
                        setInlineLinkOpen(false);
                        insertLinkFromUrl(v);
                      }}
                      disabled={!inlineLinkUrl.trim()}
                      className="inline-flex items-center rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                )}
                <div className="mx-auto inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/90 p-1.5 shadow-xl backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => textFileRef.current?.click()}
                    disabled={uploadingMd}
                    aria-label="Add image"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {uploadingMd ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" strokeWidth={2} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInlineLinkOpen((v) => !v)}
                    aria-label="Add link"
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted ${inlineLinkOpen ? "bg-muted" : ""}`}
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
      , document.body)}

      </div>

      {/* Main pill — fixed position, only resizes */}
      <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center px-5">
      <div
        role="toolbar"
        aria-label="Capture actions"
        style={{
          transform: shrunk ? "scale(0.86)" : "scale(1)",
          transformOrigin: "bottom center",
          willChange: "transform",
        }}
        className={`pointer-events-auto inline-flex items-center gap-1 rounded-full p-1.5 shadow-2xl ring-1 transition-transform duration-200 ease-out motion-reduce:transition-none ${
          recording
            ? "bg-destructive/85 ring-destructive/30 animate-pulse"
            : "bg-white/95 ring-black/10 dark:bg-neutral-900/95 dark:ring-white/10"
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
        <Link
          to="/search"
          aria-label="Search"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 hover:text-neutral-900 active:scale-90 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <Search className="h-5 w-5" strokeWidth={2} />
        </Link>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          aria-label="Attach image"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 hover:text-neutral-900 active:scale-90 disabled:opacity-50 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <ImagePlus className="h-5 w-5" strokeWidth={2} />
        </button>
        <button
          onClick={() => setTextOpen(true)}
          disabled={disabled || recording}
          aria-label="Write text note"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 hover:text-neutral-900 active:scale-90 disabled:opacity-50 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <FileText className="h-5 w-5" strokeWidth={2} />
        </button>
        <button
          onClick={() => setLinkOpen(true)}
          disabled={disabled || recording}
          aria-label="Save web link"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 hover:text-neutral-900 active:scale-90 disabled:opacity-50 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <Link2 className="h-5 w-5" strokeWidth={2} />
        </button>

        <div className="mx-1 h-6 w-px bg-black/10 dark:bg-white/10" />

        <button
          onClick={recording ? stop : start}
          disabled={disabled}
          aria-label={recording ? "Stop recording" : "Start recording"}
          className="group inline-flex items-center gap-2.5 rounded-full bg-black/5 py-2 pl-3 pr-5 text-neutral-900 hover:bg-black/10 active:scale-[0.97] disabled:cursor-default dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
        >


          <span className="relative flex items-center justify-center">
            {!recording && !showSpinner && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-1 ring-foreground" />
            )}
            {showSpinner ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : recording ? (
              <Square className="h-4 w-4" fill="currentColor" />
            ) : (
              <Mic className="h-5 w-5" strokeWidth={2} />
            )}
          </span>
          <span className="text-sm font-semibold tracking-tight tabular-nums">{label}</span>
        </button>
      </div>
      </div>

    </div>

  );
}

export { BlockEditor, parseBlocks, serializeBlocks, faviconFor, hostnameOf } from "@/components/BlockEditor";


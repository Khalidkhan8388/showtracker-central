import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, ImagePlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { processVoiceNote } from "@/lib/notes.functions";
import { toast } from "sonner";

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
  const pendingRef = useRef<PendingImage[]>([]);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const processFn = useServerFn(processVoiceNote);

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
    ? "Uploading…"
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

      <div
        className={`pointer-events-auto inline-flex items-center gap-1 rounded-full p-1 shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150 transition-all ${
          recording
            ? "bg-destructive/80 ring-destructive/20 animate-pulse"
            : "bg-foreground/80 ring-black/10"
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
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-background/90 hover:bg-background/15 disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
        <button
          onClick={recording ? stop : start}
          disabled={disabled}
          aria-label={recording ? "Stop recording" : "Start recording"}
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-background disabled:cursor-default"
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full ${
              recording ? "bg-destructive-foreground/20" : "bg-background/15"
            }`}
          >
            {showSpinner ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : recording ? (
              <Square className="h-3 w-3" fill="currentColor" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="tabular-nums">{label}</span>
        </button>
      </div>
    </div>
  );
}

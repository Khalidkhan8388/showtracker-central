import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
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

export function Recorder({ onNoteReady }: { onNoteReady?: () => void } = {}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const processing = false;
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processFn = useServerFn(processVoiceNote);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

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
      rec.onstop = () => finalize(mime);
      rec.start();
      recRef.current = rec;
      startRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 250);
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

  async function finalize(mime: string) {
    setBusy(true);
    try {
      const blob = new Blob(chunksRef.current, { type: mime });
      if (blob.size < 2048) {
        toast.error("Recording was too short — try again.");
        return;
      }
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not signed in");

      const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
      const path = `${uid}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("voice-notes")
        .upload(path, blob, { contentType: mime, upsert: false });
      if (upErr) throw upErr;

      const duration = Math.max(1, Math.round((Date.now() - startRef.current) / 1000));
      const { data: inserted, error: insErr } = await supabase
        .from("voice_notes")
        .insert({ user_id: uid, audio_path: path, duration_seconds: duration, status: "uploaded" })
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
      toast.error(err?.message ?? "Upload failed");
      setBusy(false);
    }
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const mmss = `${mm}:${ss}`;

  const label = busy
    ? "Uploading…"
    : processing
    ? "Transcribing…"
    : recording
    ? `Recording ${mmss}`
    : "Tap to record";

  const showSpinner = busy || processing;
  const disabled = busy || processing;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-40 flex justify-center px-5">
      <div className="pointer-events-auto relative w-[85%] max-w-[340px] overflow-hidden rounded-full border border-white/50 bg-white/40 p-1 shadow-[0_20px_40px_-15px_rgba(79,70,229,0.35)] backdrop-blur-2xl backdrop-saturate-150">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-violet-500/10 opacity-70" />
        <button
          onClick={recording ? stop : start}
          disabled={disabled}
          aria-label={recording ? "Stop recording" : "Start recording"}
          className="relative flex w-full items-center justify-between gap-3 pl-6 pr-1 py-1 transition-transform active:scale-[0.98] disabled:cursor-default"
        >
          <div className="flex items-center gap-3">
            <span
              className={`h-2 w-2 rounded-full ${
                recording ? "animate-pulse bg-rose-500" : showSpinner ? "bg-indigo-500" : "bg-rose-500 animate-pulse"
              }`}
            />
            <span className="text-sm font-semibold tracking-tight text-slate-800 tabular-nums">
              {label}
            </span>
          </div>
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-full text-white shadow-lg transition-colors ${
              recording ? "bg-rose-500" : "bg-slate-900"
            }`}
          >
            {showSpinner ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : recording ? (
              <Square className="h-3.5 w-3.5" fill="currentColor" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </span>
        </button>
      </div>
    </div>
  );
}



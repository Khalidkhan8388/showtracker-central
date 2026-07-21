import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { processVoiceNote } from "@/lib/notes.functions";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
}

export function Recorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processFn = useServerFn(processVoiceNote);
  const navigate = useNavigate();

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

      // fire-and-forget processing, but wait so we can navigate on completion
      toast.loading("Transcribing & summarizing…", { id: inserted.id });
      processFn({ data: { noteId: inserted.id } })
        .then(() => {
          toast.success("Note ready", { id: inserted.id });
        })
        .catch((e) => {
          toast.error(e?.message ?? "Processing failed", { id: inserted.id });
        });

      navigate({ to: "/notes/$id", params: { id: inserted.id } });
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const mmss = `${mm}:${ss}`;
  const label = busy ? "Uploading…" : recording ? `Recording ${mmss}` : "Tap to record";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-center px-5">
      <button
        onClick={recording ? stop : start}
        disabled={busy}
        aria-label={recording ? "Stop recording" : "Start recording"}
        className={`pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-lg ring-1 backdrop-blur-xl backdrop-saturate-150 transition-all disabled:opacity-60 ${
          recording
            ? "bg-destructive/80 text-destructive-foreground ring-destructive/20 animate-pulse"
            : "bg-foreground/80 text-background ring-black/10 hover:scale-[1.03] active:scale-100"
        }`}
      >
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full ${
            recording ? "bg-destructive-foreground/20" : "bg-background/15"
          }`}
        >
          {busy ? (
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
  );
}


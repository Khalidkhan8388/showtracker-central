import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { getAudioUrl } from "@/lib/audio-cache";

const SPEEDS = [1, 1.5, 2] as const;
const BAR_COUNT = 56;

type Props = {
  audioPath: string;
  fallbackDuration?: number | null;
  onTimeUpdate?: (currentTime: number, duration: number, playing: boolean) => void;
};

export function VoicePlayer({ audioPath, fallbackDuration, onTimeUpdate }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number>(fallbackDuration ?? 0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [peaks, setPeaks] = useState<number[]>(() =>
    Array.from({ length: BAR_COUNT }, () => 0.35 + Math.random() * 0.45),
  );
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const u = await getAudioUrl(audioPath);
      if (alive) setUrl(u);
    })();
    return () => { alive = false; };
  }, [audioPath]);

  // Decode a lightweight waveform once (60-ish bars). Best-effort — silently
  // falls back to the placeholder bars if decode isn't supported.
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void (async () => {
      try {
        const buf = await fetch(url).then((r) => r.arrayBuffer());
        const AC: typeof AudioContext =
          window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const audio = await ctx.decodeAudioData(buf.slice(0));
        const channel = audio.getChannelData(0);
        const bucket = Math.max(1, Math.floor(channel.length / BAR_COUNT));
        const out: number[] = [];
        let max = 0;
        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          const start = i * bucket;
          const end = Math.min(channel.length, start + bucket);
          for (let j = start; j < end; j++) sum += Math.abs(channel[j]);
          const v = sum / (end - start);
          out.push(v);
          if (v > max) max = v;
        }
        const normed = out.map((v) => (max > 0 ? Math.max(0.08, v / max) : 0.2));
        if (!cancelled) {
          setPeaks(normed);
          if (!fallbackDuration) setDuration(audio.duration);
        }
        void ctx.close();
      } catch {
        /* keep placeholder bars */
      }
    })();
    return () => { cancelled = true; };
  }, [url, fallbackDuration]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => {
      const next = (i + 1) % SPEEDS.length;
      if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
      return next;
    });
  }, []);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = barRef.current;
      const a = audioRef.current;
      if (!el || !a || !duration) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      a.currentTime = ratio * duration;
      setCurrent(a.currentTime);
    },
    [duration],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    seekFromClientX(e.clientX);
  };

  useEffect(() => {
    onTimeUpdate?.(current, duration, playing);
  }, [current, duration, playing, onTimeUpdate]);

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const timeLabel = useMemo(() => `${fmt(current)} / ${fmt(duration)}`, [current, duration]);

  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <audio
        ref={audioRef}
        src={url || undefined}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = (e.currentTarget as HTMLAudioElement).duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrent((e.currentTarget as HTMLAudioElement).currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow active:scale-95"
        >
          {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current translate-x-[1px]" />}
        </button>

        <div
          ref={barRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          className="relative flex h-10 flex-1 cursor-pointer items-center gap-[2px] touch-none select-none"
        >
          {peaks.map((p, i) => {
            const active = i / peaks.length <= progress;
            return (
              <div
                key={i}
                className="flex-1 rounded-full transition-colors"
                style={{
                  height: `${Math.round(p * 100)}%`,
                  minHeight: 3,
                  background: active
                    ? "hsl(var(--foreground))"
                    : "hsl(var(--muted-foreground) / 0.35)",
                }}
              />
            );
          })}
        </div>

        <button
          type="button"
          onClick={cycleSpeed}
          aria-label={`Playback speed ${SPEEDS[speedIdx]}x`}
          className="inline-flex h-9 min-w-11 items-center justify-center rounded-full bg-muted px-2.5 text-[12px] font-semibold tabular-nums text-foreground active:opacity-70"
        >
          {SPEEDS[speedIdx]}×
        </button>
      </div>
      <div className="mt-2 px-1 text-[11px] font-medium tabular-nums text-muted-foreground">
        {timeLabel}
      </div>
    </div>
  );
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

type HTProps = {
  text: string;
  currentTime: number;
  duration: number;
  playing: boolean;
};

/** Splits transcript into whitespace-separated tokens and highlights the token
 *  proportional to playback position. No per-word timestamps — good enough for
 *  re-listening, doesn't lie about precision. */
export function HighlightedTranscript({ text, currentTime, duration, playing }: HTProps) {
  const tokens = useMemo(() => text.split(/(\s+)/), [text]);
  const wordIdxs = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < tokens.length; i++) if (!/^\s+$/.test(tokens[i])) arr.push(i);
    return arr;
  }, [tokens]);
  const activeToken = useMemo(() => {
    if (!playing || duration <= 0 || wordIdxs.length === 0) return -1;
    const w = Math.min(wordIdxs.length - 1, Math.floor((currentTime / duration) * wordIdxs.length));
    return wordIdxs[w] ?? -1;
  }, [playing, duration, currentTime, wordIdxs]);

  return (
    <p className="text-[16px] leading-[1.7] text-foreground">
      {tokens.map((t, i) =>
        /^\s+$/.test(t) ? (
          <span key={i}>{t}</span>
        ) : (
          <span
            key={i}
            className={
              i === activeToken
                ? "rounded-[3px] bg-primary/15 px-[2px] text-foreground"
                : "text-foreground/85"
            }
          >
            {t}
          </span>
        ),
      )}
    </p>
  );
}

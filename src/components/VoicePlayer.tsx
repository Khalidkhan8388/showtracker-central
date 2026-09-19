import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { getAudioUrl } from "@/lib/audio-cache";

const SPEEDS = [1, 1.5, 2] as const;
const BAR_COUNT = 64;

type Props = {
  /** Single-clip convenience prop. Ignored if `audioPaths` is provided. */
  audioPath?: string;
  /** Multi-clip: base clip + any "continue recording" appends, played in order. */
  audioPaths?: string[];
  fallbackDuration?: number | null;
  onTimeUpdate?: (currentTime: number, duration: number, playing: boolean) => void;
};

export function VoicePlayer({ audioPath, audioPaths, fallbackDuration, onTimeUpdate }: Props) {
  const segments = useMemo(() => {
    const arr = (audioPaths && audioPaths.length > 0 ? audioPaths : audioPath ? [audioPath] : []).filter(Boolean);
    return arr;
  }, [audioPath, audioPaths]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [segIdx, setSegIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0); // running total across segments
  const [segCurrent, setSegCurrent] = useState(0); // within active segment
  const [durations, setDurations] = useState<number[]>([]);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [peaks, setPeaks] = useState<number[]>(() =>
    Array.from({ length: BAR_COUNT }, () => 0.35 + Math.random() * 0.5),
  );
  const [decoded, setDecoded] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const wasPlayingRef = useRef(false);

  // Load object URLs for each segment.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const resolved = await Promise.all(segments.map((p) => getAudioUrl(p)));
      if (alive) setUrls(resolved);
    })();
    return () => { alive = false; };
  }, [segments]);

  // Decode all segments to build one concatenated waveform and per-segment durations.
  useEffect(() => {
    if (urls.length === 0 || urls.some((u) => !u)) return;
    let cancelled = false;
    void (async () => {
      try {
        const AC: typeof AudioContext =
          window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const allSamples: number[] = [];
        const segDurations: number[] = [];
        for (const u of urls) {
          try {
            const buf = await fetch(u).then((r) => r.arrayBuffer());
            const audio = await ctx.decodeAudioData(buf.slice(0));
            const ch = audio.getChannelData(0);
            segDurations.push(audio.duration);
            // downsample to ~2000 samples per segment to keep memory small
            const targetLen = Math.min(ch.length, 2000);
            const step = Math.max(1, Math.floor(ch.length / targetLen));
            for (let i = 0; i < ch.length; i += step) allSamples.push(Math.abs(ch[i]));
          } catch {
            segDurations.push(0);
          }
        }
        void ctx.close();
        if (cancelled) return;
        // Bucket to BAR_COUNT bars.
        const bucket = Math.max(1, Math.floor(allSamples.length / BAR_COUNT));
        const out: number[] = [];
        let max = 0;
        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          const start = i * bucket;
          const end = Math.min(allSamples.length, start + bucket);
          for (let j = start; j < end; j++) sum += allSamples[j];
          const v = sum / Math.max(1, end - start);
          out.push(v);
          if (v > max) max = v;
        }
        const normed = out.map((v) => (max > 0 ? Math.max(0.15, v / max) : 0.25));
        setPeaks(normed);
        setDurations(segDurations);
        setDecoded(true);
      } catch {
        /* keep placeholder bars */
      }
    })();
    return () => { cancelled = true; };
  }, [urls]);

  const totalDuration = useMemo(() => {
    if (durations.length > 0) {
      const s = durations.reduce((a, b) => a + b, 0);
      if (s > 0) return s;
    }
    return fallbackDuration ?? 0;
  }, [durations, fallbackDuration]);

  const priorSum = useCallback((idx: number) => {
    let s = 0;
    for (let i = 0; i < idx && i < durations.length; i++) s += durations[i];
    return s;
  }, [durations]);

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

  // Seek: figure out which segment target time lands in, swap src if needed.
  const seekTo = useCallback(
    (t: number) => {
      if (segments.length === 0) return;
      let remaining = Math.max(0, Math.min(totalDuration, t));
      let target = 0;
      for (let i = 0; i < segments.length; i++) {
        const d = durations[i] ?? 0;
        if (remaining <= d || i === segments.length - 1) {
          target = i;
          break;
        }
        remaining -= d;
      }
      const a = audioRef.current;
      if (!a) return;
      const wasPlaying = !a.paused;
      if (target !== segIdx) {
        setSegIdx(target);
        a.src = urls[target] ?? "";
        a.load();
        const start = () => {
          try { a.currentTime = remaining; } catch {}
          a.playbackRate = SPEEDS[speedIdx];
          if (wasPlaying) void a.play();
          a.removeEventListener("loadedmetadata", start);
        };
        a.addEventListener("loadedmetadata", start);
      } else {
        try { a.currentTime = remaining; } catch {}
      }
      setSegCurrent(remaining);
      setCurrent(priorSum(target) + remaining);
    },
    [segments.length, durations, urls, segIdx, speedIdx, totalDuration, priorSum],
  );

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = barRef.current;
      if (!el || !totalDuration) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      seekTo(ratio * totalDuration);
    },
    [totalDuration, seekTo],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    wasPlayingRef.current = playing;
    seekFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    seekFromClientX(e.clientX);
  };

  useEffect(() => {
    onTimeUpdate?.(current, totalDuration, playing);
  }, [current, totalDuration, playing, onTimeUpdate]);

  // When a segment ends, if there's another queued, advance to it and keep playing.
  const autoPlayNextRef = useRef(false);
  const onSegEnded = useCallback(() => {
    if (segIdx < segments.length - 1) {
      autoPlayNextRef.current = true;
      setSegIdx(segIdx + 1);
      setSegCurrent(0);
    } else {
      setPlaying(false);
    }
  }, [segIdx, segments.length]);

  // After React swaps the <audio src> to the new segment, resume playback.
  useEffect(() => {
    if (!autoPlayNextRef.current) return;
    autoPlayNextRef.current = false;
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = SPEEDS[speedIdx];
    const start = () => {
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
      a.removeEventListener("loadeddata", start);
    };
    if (a.readyState >= 2) start();
    else a.addEventListener("loadeddata", start);
  }, [segIdx, speedIdx]);

  const progress = totalDuration > 0 ? Math.min(1, current / totalDuration) : 0;
  const timeLabel = useMemo(() => `${fmt(current)} / ${fmt(totalDuration)}`, [current, totalDuration]);

  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <audio
        ref={audioRef}
        src={urls[segIdx] || undefined}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = (e.currentTarget as HTMLAudioElement).duration;
          if (Number.isFinite(d) && d > 0 && !decoded) {
            setDurations((prev) => {
              const next = prev.slice();
              next[segIdx] = d;
              return next;
            });
          }
        }}
        onTimeUpdate={(e) => {
          const t = (e.currentTarget as HTMLAudioElement).currentTime;
          setSegCurrent(t);
          setCurrent(priorSum(segIdx) + t);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={onSegEnded}
      />
      {urls[segIdx + 1] && (
        <audio src={urls[segIdx + 1]} preload="auto" style={{ display: "none" }} />
      )}
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
                className="flex-1 rounded-full"
                style={{
                  height: `${Math.round(p * 100)}%`,
                  minHeight: 4,
                  background: active
                    ? "var(--foreground)"
                    : "color-mix(in oklab, var(--foreground) 35%, transparent)",
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
      <div className="mt-2 flex items-center justify-between px-1 text-[11px] font-medium tabular-nums text-muted-foreground">
        <span>{timeLabel}</span>
        {segments.length > 1 && (
          <span className="uppercase tracking-wider">
            Clip {segIdx + 1} / {segments.length}
          </span>
        )}
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

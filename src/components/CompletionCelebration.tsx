import { useEffect, useRef, useState } from "react";
import { poster } from "@/lib/media";
import { fetchTmdbLogoFn, type TmdbLookup } from "@/lib/tmdb.functions";

export type CompletionPayload = {
  tmdb_id: number;
  type: "movie" | "tv";
  title: string;
  poster_path: string | null;
};

type Drop = {
  id: number;
  left: number;      // vw
  delay: number;     // ms
  duration: number;  // ms
  rotate: number;    // deg
  scale: number;
  exploded: boolean;
};

const logoCache = new Map<string, string | null>();

export function CompletionCelebration() {
  const [payload, setPayload] = useState<CompletionPayload | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [drops, setDrops] = useState<Drop[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<CompletionPayload>).detail;
      if (!detail) return;
      trigger(detail);
    }
    window.addEventListener("braintape:media-completed", onEvent as EventListener);
    return () => window.removeEventListener("braintape:media-completed", onEvent as EventListener);
  }, []);

  async function trigger(p: CompletionPayload) {
    setPayload(p);
    // Poster as immediate fallback
    setLogoUrl(poster(p.poster_path, "w342"));
    // Try official logo (higher fidelity), cache per id
    const key = `${p.type}:${p.tmdb_id}`;
    if (logoCache.has(key)) {
      const cached = logoCache.get(key)!;
      if (cached) setLogoUrl(cached);
    } else {
      try {
        const r = await fetchTmdbLogoFn({ data: { type: p.type, tmdb_id: p.tmdb_id } } as any);
        const url = r?.file_path ? `https://image.tmdb.org/t/p/w500${r.file_path}` : null;
        logoCache.set(key, url);
        if (url) setLogoUrl(url);
      } catch {
        logoCache.set(key, null);
      }
    }

    // Build drops
    const count = 22;
    const items: Drop[] = Array.from({ length: count }, (_, i) => ({
      id: Date.now() + i,
      left: Math.random() * 88 + 2, // 2–90vw
      delay: Math.random() * 900,
      duration: 1600 + Math.random() * 1200,
      rotate: (Math.random() - 0.5) * 40,
      scale: 0.75 + Math.random() * 0.6,
      exploded: false,
    }));
    setDrops(items);

    // Auto-dismiss
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => dismiss(), 9000);
  }

  function dismiss() {
    setDrops([]);
    setPayload(null);
    setLogoUrl(null);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function explode(id: number) {
    setDrops((prev) => prev.map((d) => (d.id === id ? { ...d, exploded: true } : d)));
    // Remove after explosion animation
    window.setTimeout(() => {
      setDrops((prev) => {
        const next = prev.filter((d) => d.id !== id);
        if (next.length === 0) {
          setPayload(null);
          setLogoUrl(null);
        }
        return next;
      });
    }, 600);
  }

  if (!payload || drops.length === 0) return null;

  const src = logoUrl || poster(payload.poster_path, "w342");
  if (!src) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[80] overflow-hidden"
      aria-live="polite"
    >
      {/* Congrats banner */}
      <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center px-4">
        <div className="animate-fade-in rounded-full bg-black/85 px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-white shadow-lg backdrop-blur">
          🎉 Finished · {payload.title}
        </div>
      </div>

      {drops.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => explode(d.id)}
          className={`pointer-events-auto absolute -top-40 select-none ${
            d.exploded ? "cc-explode" : "cc-fall"
          }`}
          style={{
            left: `${d.left}vw`,
            animationDelay: `${d.delay}ms`,
            animationDuration: `${d.duration}ms`,
            ["--cc-rot" as any]: `${d.rotate}deg`,
            ["--cc-scale" as any]: d.scale,
          }}
          aria-label={`Pop ${payload.title}`}
        >
          <img
            src={src}
            alt=""
            draggable={false}
            className="h-24 w-auto object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.45)]"
          />
        </button>
      ))}
    </div>
  );
}

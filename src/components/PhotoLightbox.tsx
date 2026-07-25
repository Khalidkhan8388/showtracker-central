import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  urls: string[];
  startIndex?: number;
  open: boolean;
  onClose: () => void;
};

/** Fullscreen image viewer with pinch-to-zoom, drag-to-pan, and swipe-between. */
export function PhotoLightbox({ urls, startIndex = 0, open, onClose }: Props) {
  const [idx, setIdx] = useState(startIndex);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const startRef = useRef<{
    scale: number;
    tx: number;
    ty: number;
    dist: number;
    midX: number;
    midY: number;
    isPinch: boolean;
    swipeStartX: number;
    swipeStartY: number;
  } | null>(null);

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  useEffect(() => {
    if (open) {
      setIdx(startIndex);
      reset();
    }
  }, [open, startIndex, reset]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Esc / arrows
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idx, urls.length]);

  const goPrev = useCallback(() => {
    if (idx > 0) { setIdx(idx - 1); reset(); }
  }, [idx, reset]);
  const goNext = useCallback(() => {
    if (idx < urls.length - 1) { setIdx(idx + 1); reset(); }
  }, [idx, urls.length, reset]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(pointersRef.current.values());
    if (pts.length === 2) {
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      startRef.current = {
        scale, tx, ty,
        dist: Math.hypot(dx, dy),
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
        isPinch: true,
        swipeStartX: e.clientX,
        swipeStartY: e.clientY,
      };
    } else if (pts.length === 1) {
      startRef.current = {
        scale, tx, ty,
        dist: 0, midX: 0, midY: 0,
        isPinch: false,
        swipeStartX: e.clientX,
        swipeStartY: e.clientY,
      };
      setDragging(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(pointersRef.current.values());
    const s = startRef.current;
    if (!s) return;

    if (pts.length === 2 && s.isPinch) {
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const nextScale = Math.max(1, Math.min(6, s.scale * (dist / (s.dist || 1))));
      setScale(nextScale);
    } else if (pts.length === 1) {
      const dx = pts[0].x - s.swipeStartX;
      const dy = pts[0].y - s.swipeStartY;
      if (scale > 1) {
        // pan
        setTx(s.tx + dx);
        setTy(s.ty + dy);
      } else {
        // swipe candidate — apply small horizontal follow
        setTx(dx);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = startRef.current;
    const pt = pointersRef.current.get(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    setDragging(false);
    if (!s || !pt) return;

    if (pointersRef.current.size === 0 && !s.isPinch && scale <= 1) {
      const dx = pt.x - s.swipeStartX;
      const dy = pt.y - s.swipeStartY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) goNext();
        else goPrev();
      }
      setTx(0);
      setTy(0);
    }
    if (pointersRef.current.size === 0) startRef.current = null;
  };

  const onDoubleClick = () => {
    if (scale > 1) reset();
    else setScale(2.5);
  };

  if (!open || urls.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/95 pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between px-3 py-2 text-white">
        <span className="text-[13px] font-medium tabular-nums opacity-80">
          {idx + 1} / {urls.length}
        </span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 active:opacity-70"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        style={{ touchAction: "none" }}
      >
        <img
          src={urls[idx]}
          alt=""
          draggable={false}
          className="max-h-full max-w-full object-contain will-change-transform"
          style={{
            transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
            transition: dragging ? "none" : "transform 160ms ease-out",
          }}
        />

        {idx > 0 && (
          <button
            type="button"
            aria-label="Previous"
            onClick={goPrev}
            className="absolute left-2 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full bg-white/10 p-2 text-white active:opacity-70 md:inline-flex"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {idx < urls.length - 1 && (
          <button
            type="button"
            aria-label="Next"
            onClick={goNext}
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full bg-white/10 p-2 text-white active:opacity-70 md:inline-flex"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      <div className="px-4 py-3 text-center text-[11px] text-white/60">
        Pinch to zoom · Double-tap to toggle · Swipe to browse
      </div>
    </div>
  );
}

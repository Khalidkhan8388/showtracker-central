import { useCallback, useRef, useState } from "react";
import { Clock, X } from "lucide-react";
import { setNoteReminder } from "@/lib/reminders";

/**
 * Wraps a feed card. Right-swipe ~60px opens a full-width reminder panel
 * with four quick chips (Tonight · Tomorrow · Weekend · Next week) and an
 * explicit close (X) button so users can back out without picking anything.
 * Tapping outside the panel also closes it.
 */

type Chip = { key: string; label: string; sub: string; date: () => Date };

function tonight(): Date {
  const d = new Date();
  const eight = new Date(d);
  eight.setHours(20, 0, 0, 0);
  if (d.getTime() >= eight.getTime()) {
    const later = new Date(d.getTime() + 2 * 60 * 60 * 1000);
    later.setSeconds(0, 0);
    return later;
  }
  return eight;
}
function tomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}
function weekend(): Date {
  const d = new Date();
  const dow = d.getDay();
  let add: number;
  if (dow === 6) add = 1;
  else if (dow === 0) add = 6;
  else add = 6 - dow;
  d.setDate(d.getDate() + add);
  d.setHours(10, 0, 0, 0);
  return d;
}
function nextWeek(): Date {
  const d = new Date();
  const dow = d.getDay();
  const add = ((8 - dow) % 7) || 7;
  d.setDate(d.getDate() + add);
  d.setHours(9, 0, 0, 0);
  return d;
}

const CHIPS: Chip[] = [
  { key: "tonight", label: "Tonight", sub: "8pm", date: tonight },
  { key: "tomorrow", label: "Tomorrow", sub: "9am", date: tomorrow },
  { key: "weekend", label: "Weekend", sub: "Sat", date: weekend },
  { key: "week", label: "Next week", sub: "Mon", date: nextWeek },
];

const OPEN_PX = 60;
const MAX_PX = 90;
const H_LOCK_RATIO = 1.2;

export function SwipeReminderCard({
  noteId,
  reminderAt,
  disabled,
  children,
}: {
  noteId: string;
  reminderAt?: string | null;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const dragRef = useRef<HTMLDivElement | null>(null);
  const dxRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const locked = useRef<"h" | "v" | null>(null);
  const swiped = useRef(false);

  const applyTransform = useCallback((x: number, animate: boolean) => {
    const el = dragRef.current;
    if (!el) return;
    el.style.transition = animate
      ? "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)"
      : "none";
    el.style.transform = x === 0 ? "" : `translate3d(${x}px,0,0)`;
  }, []);

  const reset = useCallback(() => {
    dxRef.current = 0;
    applyTransform(0, true);
    setOpen(false);
    locked.current = null;
    start.current = null;
  }, [applyTransform]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || open) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    locked.current = null;
    swiped.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const rawDx = e.clientX - start.current.x;
    const rawDy = e.clientY - start.current.y;
    if (locked.current === null) {
      if (Math.abs(rawDx) < 6 && Math.abs(rawDy) < 6) return;
      if (Math.abs(rawDx) > Math.abs(rawDy) * H_LOCK_RATIO) {
        locked.current = "h";
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } else {
        locked.current = "v";
      }
    }
    if (locked.current !== "h") return;
    // Rubber-band beyond MAX_PX for a natural feel.
    let next = Math.max(0, rawDx);
    if (next > MAX_PX) next = MAX_PX + (next - MAX_PX) * 0.25;
    if (next > 4) swiped.current = true;
    dxRef.current = next;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        applyTransform(dxRef.current, false);
      });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const wasH = locked.current === "h";
    const finalDx = dxRef.current;
    start.current = null;
    locked.current = null;
    if (wasH) {
      if (finalDx >= OPEN_PX) {
        dxRef.current = 0;
        applyTransform(0, true);
        setOpen(true);
      } else {
        dxRef.current = 0;
        applyTransform(0, true);
      }
    }
    setTimeout(() => (swiped.current = false), 300);
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    if (swiped.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };



  const pickChip = async (chip: Chip) => {
    setFlash(chip.label);
    try {
      await setNoteReminder(noteId, chip.date().toISOString());
    } catch {}
    setTimeout(() => {
      setFlash(null);
      reset();
    }, 450);
  };

  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-[15px]">
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={handleClickCapture}
          style={{
            transform: `translateX(${dx}px)`,
            transition: start.current ? "none" : "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
            touchAction: "pan-y",
          }}
          className="relative"
        >
          {children}
          {reminderAt && (
            <div
              className="pointer-events-none absolute bottom-2 left-2 z-20 flex h-5 items-center gap-1 rounded-full bg-amber-500/95 px-1.5 text-[10px] font-semibold text-white shadow-sm"
              aria-label="Reminder set"
            >
              <Clock className="h-3 w-3" />
            </div>
          )}
        </div>

        {/* Hint arrow shown during the drag */}
        {dx > 8 && !open && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-foreground/60"
            style={{ opacity: Math.min(1, dx / OPEN_PX) }}
          >
            <Clock className="h-4 w-4" />
          </div>
        )}
      </div>

      {/* Full-width reminder panel overlays the card when open */}
      {open && (
        <>
          {/* Tap-outside catcher */}
          <button
            type="button"
            aria-label="Close reminder picker"
            onClick={reset}
            className="fixed inset-0 z-30 cursor-default bg-transparent"
          />
          <div
            className="absolute inset-0 z-40 flex items-center gap-1.5 rounded-[15px] border border-foreground/10 bg-background/95 px-2 shadow-lg backdrop-blur-sm animate-fade-in"
            role="dialog"
            aria-label="Set a reminder"
          >
            <div className="flex flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
              {CHIPS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  disabled={flash !== null}
                  onClick={(e) => {
                    e.stopPropagation();
                    void pickChip(c);
                  }}
                  className={`inline-flex min-w-[68px] flex-1 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2 text-[11px] font-medium leading-tight transition-transform active:scale-95 ${
                    flash === c.label
                      ? "scale-105 bg-foreground text-background"
                      : "bg-foreground/10 text-foreground hover:bg-foreground/15"
                  }`}
                >
                  <span className="whitespace-nowrap">{c.label}</span>
                  <span className="text-[10px] font-normal text-muted-foreground">{c.sub}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                reset();
              }}
              aria-label="Close"
              className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground active:scale-95 hover:bg-foreground/15"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

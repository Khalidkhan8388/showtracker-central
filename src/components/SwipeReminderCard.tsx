import { useCallback, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { setNoteReminder } from "@/lib/reminders";

/**
 * Wraps a feed card and adds a right-swipe gesture that reveals four quick
 * reminder chips: Tonight · Tomorrow · Weekend · Next week. Tapping a chip
 * writes reminder_at on the note. A small ⏰ badge overlays cards that
 * already have a reminder set. Does NOT alter left-swipe behaviour.
 */

type Chip = { key: string; label: string; sub: string; date: () => Date };

function tonight(): Date {
  const d = new Date();
  const eight = new Date(d);
  eight.setHours(20, 0, 0, 0);
  // If already past 8pm, schedule for now + 2h.
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
  // Next Saturday 10am; if today is Saturday, Sunday 10am.
  const d = new Date();
  const dow = d.getDay(); // 0 Sun … 6 Sat
  let add: number;
  if (dow === 6) add = 1; // Sat → Sun
  else if (dow === 0) add = 6; // Sun → next Sat
  else add = 6 - dow;
  d.setDate(d.getDate() + add);
  d.setHours(10, 0, 0, 0);
  return d;
}
function nextWeek(): Date {
  // Next Monday 9am.
  const d = new Date();
  const dow = d.getDay();
  const add = ((8 - dow) % 7) || 7; // always in the future
  d.setDate(d.getDate() + add);
  d.setHours(9, 0, 0, 0);
  return d;
}

const CHIPS: Chip[] = [
  { key: "tonight", label: "Tonight", sub: "8pm", date: tonight },
  { key: "tomorrow", label: "Tomorrow", sub: "9am", date: tomorrow },
  { key: "weekend", label: "Weekend", sub: "Sat 10am", date: weekend },
  { key: "week", label: "Next week", sub: "Mon 9am", date: nextWeek },
];

const OPEN_PX = 60; // threshold to latch open
const MAX_PX = 220; // max drag distance
const H_LOCK_RATIO = 1.2; // horizontal must dominate vertical by this ratio

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
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const locked = useRef<"h" | "v" | null>(null);
  const swiped = useRef(false);

  const reset = useCallback(() => {
    setDx(0);
    setOpen(false);
    locked.current = null;
    start.current = null;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    // Only track primary pointer (touch or left-mouse).
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
      if (Math.abs(rawDx) < 8 && Math.abs(rawDy) < 8) return;
      if (Math.abs(rawDx) > Math.abs(rawDy) * H_LOCK_RATIO) {
        locked.current = "h";
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } else {
        locked.current = "v";
      }
    }
    if (locked.current !== "h") return;
    // Only respond to right-swipes; ignore leftwards drag entirely.
    const next = Math.max(0, Math.min(MAX_PX, rawDx));
    if (next > 4) swiped.current = true;
    setDx(next);
    e.preventDefault();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    if (locked.current === "h") {
      if (dx >= OPEN_PX) {
        setDx(OPEN_PX + 20);
        setOpen(true);
      } else {
        reset();
      }
    } else {
      reset();
    }
    start.current = null;
    // Keep swiped flag until the next click cycle finishes.
    setTimeout(() => (swiped.current = false), 300);
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    if (open) {
      e.preventDefault();
      e.stopPropagation();
      reset();
      return;
    }
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
    // Snap closed after the flash.
    setTimeout(() => {
      setFlash(null);
      reset();
    }, 450);
  };

  return (
    <div className="relative overflow-hidden rounded-[15px]">
      {/* Chip strip behind the card (visible as card slides right). */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 flex items-stretch"
        style={{ width: Math.max(dx, open ? OPEN_PX + 20 : 0) }}
        aria-hidden={dx === 0 && !open}
      >
        <div
          className={`pointer-events-auto flex h-full items-center gap-1.5 pl-2 pr-3 ${
            dx > 20 || open ? "opacity-100" : "opacity-0"
          } transition-opacity duration-150`}
        >
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              disabled={!open || flash !== null}
              onClick={(e) => {
                e.stopPropagation();
                void pickChip(c);
              }}
              className={`inline-flex h-[54px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-3 text-[11px] font-medium leading-tight transition-transform active:scale-95 ${
                flash === c.label
                  ? "scale-110 bg-foreground text-background"
                  : "bg-foreground/10 text-foreground hover:bg-foreground/15"
              }`}
            >
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {c.label}
              </span>
              <span className="text-[10px] text-muted-foreground">{c.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Card is translated right to reveal the strip. */}
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
    </div>
  );
}

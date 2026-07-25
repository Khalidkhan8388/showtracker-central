import { useEffect, useRef, useState } from "react";
import { Clock, X } from "lucide-react";
import { setNoteReminder } from "@/lib/reminders";

/**
 * Wraps a feed card and adds a tiny clock button in the top-right corner.
 * Tapping the button opens a small popover with four quick-reminder chips
 * (Tonight · Tomorrow · Weekend · Next week) and an X to close. No swipe
 * gesture — plays nicely with vertical scroll and long-press select.
 * A small ⏰ badge appears on cards that already have a reminder set.
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
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on tap-outside / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const el = rootRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pickChip = async (chip: Chip) => {
    setFlash(chip.label);
    try {
      await setNoteReminder(noteId, chip.date().toISOString());
    } catch {}
    setTimeout(() => {
      setFlash(null);
      setOpen(false);
    }, 400);
  };

  return (
    <div className="relative" ref={rootRef}>
      <div className="relative">
        {children}
        {reminderAt && (
          <div
            className="pointer-events-none absolute bottom-2 left-2 z-20 flex h-5 items-center gap-1 rounded-full bg-amber-500/95 px-1.5 text-[10px] font-semibold text-white shadow-sm"
            aria-label="Reminder set"
          >
            <Clock className="h-3 w-3" />
          </div>
        )}

        {/* Corner button — small, discreet, always tappable */}
        {!disabled && (
          <button
            type="button"
            aria-label={reminderAt ? "Change reminder" : "Set reminder"}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setOpen((v) => !v);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`absolute right-2 top-2 z-30 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-md transition active:scale-90 ${
              reminderAt
                ? "bg-amber-500/95 text-white shadow-sm"
                : "bg-black/45 text-white hover:bg-black/60 dark:bg-white/15 dark:hover:bg-white/25"
            }`}
          >
            <Clock className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute right-2 top-11 z-40 flex items-center gap-1 rounded-2xl border border-foreground/10 bg-background/95 p-1.5 shadow-xl backdrop-blur-md animate-scale-in"
          role="dialog"
          aria-label="Set a reminder"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              disabled={flash !== null}
              onClick={(e) => {
                e.stopPropagation();
                void pickChip(c);
              }}
              className={`inline-flex min-w-[60px] flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-medium leading-tight transition-transform active:scale-95 ${
                flash === c.label
                  ? "scale-105 bg-foreground text-background"
                  : "bg-foreground/10 text-foreground hover:bg-foreground/15"
              }`}
            >
              <span className="whitespace-nowrap">{c.label}</span>
              <span className="text-[10px] font-normal text-muted-foreground">{c.sub}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            aria-label="Close"
            className="ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground active:scale-95 hover:bg-foreground/15"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

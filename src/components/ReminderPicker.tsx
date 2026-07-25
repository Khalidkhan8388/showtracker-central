import { useMemo, useState } from "react";
import { Bell, BellOff, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Preset = { key: string; label: string; sub: string; date: Date };

function buildPresets(): Preset[] {
  const now = new Date();
  const fmt = (d: Date) =>
    d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  if (tonight.getTime() <= now.getTime() + 30 * 60 * 1000) {
    tonight.setTime(now.getTime() + 2 * 60 * 60 * 1000);
    tonight.setMinutes(0, 0, 0);
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const weekend = new Date(now);
  const dow = weekend.getDay();
  const daysToSat = dow === 6 ? 7 : (6 - dow + 7) % 7 || 7;
  weekend.setDate(weekend.getDate() + daysToSat);
  weekend.setHours(10, 0, 0, 0);

  const nextWeek = new Date(now);
  const daysToMon = ((1 - now.getDay() + 7) % 7) || 7;
  nextWeek.setDate(nextWeek.getDate() + daysToMon);
  nextWeek.setHours(9, 0, 0, 0);

  return [
    { key: "tonight", label: "Tonight", sub: fmt(tonight), date: tonight },
    { key: "tomorrow", label: "Tomorrow", sub: fmt(tomorrow), date: tomorrow },
    { key: "weekend", label: "Weekend", sub: fmt(weekend), date: weekend },
    { key: "nextweek", label: "Next week", sub: fmt(nextWeek), date: nextWeek },
  ];
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function MiniCalendar({
  value,
  onChange,
}: {
  value: Date | null;
  onChange: (d: Date) => void;
}) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [cursor, setCursor] = useState(() => {
    const base = value ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const monthLabel = cursor.toLocaleString(undefined, { month: "long", year: "numeric" });
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const firstDow = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const isSame = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between px-1">
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-[13px] font-medium text-neutral-900 dark:text-white">{monthLabel}</div>
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 px-1 pb-1 text-center text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-white/40">
        {WEEKDAYS.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1 px-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="aspect-square" />;
          const disabled = d < today;
          const selected = value ? isSame(d, value) : false;
          const isToday = isSame(d, today);
          return (
            <button
              key={i}
              disabled={disabled}
              onClick={() => onChange(d)}
              className={cn(
                "mx-auto flex h-9 w-9 items-center justify-center rounded-full text-[13px] transition",
                disabled && "text-neutral-300 dark:text-white/20",
                !disabled && !selected && "text-neutral-800 hover:bg-black/5 dark:text-white/85 dark:hover:bg-white/10",
                !selected && isToday && !disabled && "font-semibold",
                selected && "bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ReminderPicker({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (iso: string | null) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const presets = useMemo(buildPresets, [open]);
  const current = value ? new Date(value) : null;
  const [customDate, setCustomDate] = useState<Date | null>(current);
  const [customTime, setCustomTime] = useState<string>(
    current
      ? `${String(current.getHours()).padStart(2, "0")}:${String(current.getMinutes()).padStart(2, "0")}`
      : "09:00",
  );

  const set = async (d: Date) => {
    await onChange(d.toISOString());
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    setOpen(false);
  };

  const clear = async () => {
    await onChange(null);
    setOpen(false);
  };

  const applyCustom = async () => {
    if (!customDate) return;
    const [h, m] = customTime.split(":").map((n) => parseInt(n, 10));
    const d = new Date(customDate);
    d.setHours(h || 0, m || 0, 0, 0);
    await set(d);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={value ? "Change reminder" : "Set reminder"}
        className={cn(
          "relative inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 active:scale-90 dark:hover:bg-white/10",
          !value && "text-neutral-700 dark:text-white/80",
        )}
        style={value ? { color: "var(--reminder-strong)" } : undefined}
      >
        <Bell aria-hidden="true" className={cn("h-5 w-5", value && "fill-current")} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[92vh] overflow-y-auto rounded-t-3xl border-t border-black/10 bg-background p-0 dark:border-white/10"
        >
          {/* grabber */}
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" />
          </div>

          <div className="px-5 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-neutral-900 dark:text-white">
                Remind me
              </h2>
              {value && (
                <button
                  onClick={clear}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
                >
                  <BellOff className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </div>

            {/* Quick chips */}
            <div className="grid grid-cols-2 gap-2">
              {presets.map((p) => (
                <button
                  key={p.key}
                  onClick={() => set(p.date)}
                  className="flex flex-col items-start gap-0.5 rounded-2xl border border-black/8 bg-white px-4 py-3 text-left transition active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.04]"
                >
                  <span className="text-[14px] font-medium text-neutral-900 dark:text-white">
                    {p.label}
                  </span>
                  <span className="text-[11px] text-neutral-500 dark:text-white/50">{p.sub}</span>
                </button>
              ))}
            </div>

            {/* Divider */}
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-black/8 dark:bg-white/10" />
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-400 dark:text-white/40">
                Pick a date
              </span>
              <div className="h-px flex-1 bg-black/8 dark:bg-white/10" />
            </div>

            <MiniCalendar value={customDate} onChange={setCustomDate} />

            {/* Time + apply */}
            <div className="mt-4 flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="time"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.currentTarget.value)}
                  className="h-12 w-full rounded-2xl border border-black/8 bg-white px-4 text-[14px] tabular-nums text-neutral-900 outline-none focus:border-black/40 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:focus:border-white/40"
                />
              </div>
              <button
                onClick={applyCustom}
                disabled={!customDate}
                className="inline-flex h-12 items-center gap-1.5 rounded-2xl bg-neutral-900 px-5 text-[14px] font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
              >
                <Check className="h-4 w-4" /> Set
              </button>
            </div>

            {value && (
              <div className="mt-3 rounded-2xl bg-black/5 px-4 py-3 text-[12px] text-neutral-700 dark:bg-white/[0.06] dark:text-white/70">
                Reminds{" "}
                {new Date(value).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

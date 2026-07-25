import { useMemo, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
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
  const dow = weekend.getDay(); // 0=Sun..6=Sat
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
  const [customDate, setCustomDate] = useState<Date | undefined>(current ?? undefined);
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={value ? "Change reminder" : "Set reminder"}
          className={cn(
            "relative inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 active:scale-90 dark:hover:bg-white/10",
            !value && "text-neutral-700 dark:text-white/80",
          )}
          style={value ? { color: "var(--reminder-strong)" } : undefined}
        >
          <Bell aria-hidden="true" className={cn("h-5 w-5", value && "fill-current")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-black/10 bg-background p-3 shadow-xl dark:border-white/10"
      >
        <div className="mb-2 flex items-center justify-between px-1">
          <div className="text-[13px] font-medium text-neutral-900 dark:text-white">Remind me</div>
          {value && (
            <button
              onClick={clear}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-neutral-600 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
            >
              <BellOff className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => set(p.date)}
              className="flex flex-col items-start gap-0.5 rounded-xl border border-black/10 bg-white px-3 py-2 text-left transition active:scale-[0.98] hover:border-black/25 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/25"
            >
              <span className="text-[13px] font-medium text-neutral-900 dark:text-white">{p.label}</span>
              <span className="text-[11px] text-neutral-500 dark:text-white/60">{p.sub}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
          <div className="mb-1 px-1 text-[11px] uppercase tracking-wide text-neutral-500 dark:text-white/50">
            Custom
          </div>
          <div className="pointer-events-auto rounded-xl border border-black/10 bg-white p-1 dark:border-white/10 dark:bg-white/5">
            <Calendar
              mode="single"
              selected={customDate}
              onSelect={setCustomDate}
              disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
              initialFocus
              className="pointer-events-auto"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.currentTarget.value)}
              className="h-10 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[13px] text-neutral-900 outline-none focus:border-black/40 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-white/40"
            />
            <button
              onClick={applyCustom}
              disabled={!customDate}
              className="h-10 rounded-xl bg-neutral-900 px-4 text-[13px] font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
            >
              Set
            </button>
          </div>
        </div>

        {value && (
          <div className="mt-2 flex items-center justify-between rounded-xl bg-black/5 px-3 py-2 text-[12px] text-neutral-700 dark:bg-white/10 dark:text-white/80">
            <span>
              Reminds{" "}
              {new Date(value).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

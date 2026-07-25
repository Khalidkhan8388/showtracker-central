import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, ChevronLeft, ChevronRight, Check, Trash2, Plus, Sparkles, Loader2, Zap } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { suggestSmartTimesFn } from "@/lib/ai.functions";
import { getActivityProfile, describeProfile } from "@/lib/activity";



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

function formatReminderRow(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type SmartSuggestion = { iso: string | null; id: string | null; label: string; reason: string };

type PickerProps = {
  values: string[];
  onAdd: (iso: string) => void | Promise<void>;
  onRemove: (iso: string) => void | Promise<void>;
  onClearAll?: () => void | Promise<void>;
  /** Note text used to power AI smart suggestions. Optional. */
  noteContext?: string;
  /** Called when the user picks a contextual reminder (e.g. "next-open"). */
  onAddContextual?: (id: string, title: string) => void | Promise<void>;
};

export function ReminderPicker({ values, onAdd, onRemove, onClearAll, noteContext, onAddContextual }: PickerProps) {

  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const presets = useMemo(buildPresets, [open, showAdd]);
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [customTime, setCustomTime] = useState<string>("09:00");

  const sorted = useMemo(
    () => [...values].sort((a, b) => new Date(a).getTime() - new Date(b).getTime()),
    [values],
  );
  const hasAny = sorted.length > 0;

  const add = async (d: Date) => {
    await onAdd(d.toISOString());
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    setShowAdd(false);
    setCustomDate(null);
    setCustomTime("09:00");
  };

  const applyCustom = async () => {
    if (!customDate) return;
    const [h, m] = customTime.split(":").map((n) => parseInt(n, 10));
    const d = new Date(customDate);
    d.setHours(h || 0, m || 0, 0, 0);
    await add(d);
  };

  // ----- Smart AI suggestions -----
  const [smart, setSmart] = useState<SmartSuggestion[] | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartError, setSmartError] = useState<string | null>(null);
  const [addedContext, setAddedContext] = useState<Set<string>>(new Set());
  const reqRef = useRef(0);

  const canSmart = (noteContext?.trim().length ?? 0) > 0;
  const shouldLoadSmart = open && (showAdd || !hasAny) && canSmart;

  useEffect(() => {
    if (!shouldLoadSmart) return;
    if (smart !== null || smartLoading) return;
    const id = ++reqRef.current;
    setSmartLoading(true);
    setSmartError(null);
    (async () => {
      try {
        const profile = getActivityProfile();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const res = await suggestSmartTimesFn({
          data: {
            text: (noteContext ?? "").slice(0, 6000),
            nowIso: new Date().toISOString(),
            timeZone: tz,
            profileSummary: describeProfile(profile),
            avoidWeekends: !profile.activeWeekends,
            existing: values,
          },
        });
        if (id !== reqRef.current) return;
        setSmart(res?.suggestions ?? []);
      } catch (e: any) {
        if (id !== reqRef.current) return;
        setSmartError(e?.message ?? "Failed to load suggestions");
        setSmart([]);
      } finally {
        if (id === reqRef.current) setSmartLoading(false);
      }
    })();
  }, [shouldLoadSmart, smart, smartLoading, noteContext, values]);

  // Reset AI results when the picker closes so it re-computes next time.
  useEffect(() => {
    if (!open) {
      setSmart(null);
      setSmartLoading(false);
      setSmartError(null);
      setAddedContext(new Set());
    }
  }, [open]);

  const smartVisible = smart?.filter((s) => {
    if (s.iso) {
      const t = new Date(s.iso).getTime();
      return !values.some((v) => Math.abs(new Date(v).getTime() - t) < 30 * 60 * 1000);
    }
    if (s.id) return !addedContext.has(s.id);
    return true;
  }) ?? [];


  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setShowAdd(!hasAny);
        }}
        aria-label={hasAny ? "Edit reminders" : "Set reminder"}
        className={cn(
          "relative inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 active:scale-90 dark:hover:bg-white/10",
          !hasAny && "text-neutral-700 dark:text-white/80",
        )}
        style={hasAny ? { color: "var(--reminder-strong)" } : undefined}
      >
        <Bell aria-hidden="true" className={cn("h-5 w-5", hasAny && "fill-current")} />
        {sorted.length > 1 && (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold text-white"
            style={{ background: "var(--reminder-strong)" }}
          >
            {sorted.length}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[92vh] overflow-y-auto rounded-t-3xl border-t border-black/10 bg-background p-0 dark:border-white/10"
        >
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" />
          </div>

          <div className="px-5 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-neutral-900 dark:text-white">
                Reminders
              </h2>
              {hasAny && onClearAll && (
                <button
                  onClick={async () => {
                    await onClearAll();
                    setShowAdd(false);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
                >
                  <BellOff className="h-3.5 w-3.5" /> Clear all
                </button>
              )}
            </div>

            {/* Existing reminders list */}
            {hasAny && (
              <ul className="mb-3 space-y-1.5">
                {sorted.map((iso) => {
                  const overdue = new Date(iso).getTime() < Date.now();
                  return (
                    <li
                      key={iso}
                      className="flex items-center justify-between rounded-2xl border border-black/8 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Bell
                          className="h-4 w-4 shrink-0"
                          style={{ color: "var(--reminder-strong)" }}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-[13.5px] font-medium text-neutral-900 dark:text-white">
                            {formatReminderRow(iso)}
                          </div>
                          {overdue && (
                            <div className="text-[11px] text-neutral-500 dark:text-white/50">
                              Overdue
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => onRemove(iso)}
                        aria-label="Remove reminder"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 active:opacity-60 dark:text-white/60 dark:hover:bg-white/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Add another */}
            {hasAny && !showAdd && (
              <button
                onClick={() => setShowAdd(true)}
                className="mb-1 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-black/15 px-4 py-3 text-[13px] font-medium text-neutral-700 hover:bg-black/5 dark:border-white/15 dark:text-white/80 dark:hover:bg-white/10"
              >
                <Plus className="h-4 w-4" /> Add another reminder
              </button>
            )}

            {(showAdd || !hasAny) && (
              <>
                {canSmart && (
                  <div className="mb-4">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500 dark:text-white/50">
                      <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--reminder-strong)" }} />
                      Smart suggestions
                    </div>
                    {smartLoading && (
                      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-black/10 px-4 py-3 text-[12px] text-neutral-500 dark:border-white/10 dark:text-white/50">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Analyzing your note and when you're usually free…
                      </div>
                    )}
                    {!smartLoading && smartError && (
                      <div className="rounded-2xl border border-dashed border-black/10 px-4 py-3 text-[12px] text-neutral-500 dark:border-white/10 dark:text-white/50">
                        Couldn't load smart suggestions.
                      </div>
                    )}
                    {!smartLoading && !smartError && smartVisible.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-black/10 px-4 py-3 text-[12px] text-neutral-500 dark:border-white/10 dark:text-white/50">
                        No smart suggestions for this note.
                      </div>
                    )}
                    {!smartLoading && smartVisible.length > 0 && (
                      <ul className="flex flex-col gap-1.5">
                        {smartVisible.map((s, i) => {
                          const isCtx = !s.iso && !!s.id;
                          const dateLabel = s.iso
                            ? new Date(s.iso).toLocaleString(undefined, {
                                weekday: "short", month: "short", day: "numeric",
                                hour: "numeric", minute: "2-digit",
                              })
                            : "When you next open the app";
                          return (
                            <li key={`${s.id ?? s.iso ?? i}`}>
                              <button
                                onClick={async () => {
                                  if (isCtx && s.id && onAddContextual) {
                                    await onAddContextual(s.id, s.label);
                                    setAddedContext((prev) => new Set(prev).add(s.id!));
                                  } else if (s.iso) {
                                    await add(new Date(s.iso));
                                  }
                                }}
                                className="group flex w-full items-center gap-3 rounded-2xl border border-black/8 bg-white px-3 py-2.5 text-left transition active:scale-[0.99] dark:border-white/10 dark:bg-white/[0.04]"
                              >
                                <span
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                                  style={{ background: "var(--reminder-bg)", color: "var(--reminder-strong)" }}
                                >
                                  {isCtx ? <Zap className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium text-neutral-900 dark:text-white">
                                    {s.label}
                                  </span>
                                  <span className="block truncate text-[11px] text-neutral-500 dark:text-white/50">
                                    {dateLabel}{s.reason ? ` · ${s.reason}` : ""}
                                  </span>
                                </span>
                                <Plus className="h-4 w-4 shrink-0 text-neutral-400 group-hover:text-neutral-700 dark:text-white/40 dark:group-hover:text-white/80" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}


                <div className="grid grid-cols-2 gap-2">
                  {presets.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => add(p.date)}
                      className="flex flex-col items-start gap-0.5 rounded-2xl border border-black/8 bg-white px-4 py-3 text-left transition active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.04]"
                    >
                      <span className="text-[14px] font-medium text-neutral-900 dark:text-white">
                        {p.label}
                      </span>
                      <span className="text-[11px] text-neutral-500 dark:text-white/50">
                        {p.sub}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-black/8 dark:bg-white/10" />
                  <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-400 dark:text-white/40">
                    Pick a date
                  </span>
                  <div className="h-px flex-1 bg-black/8 dark:bg-white/10" />
                </div>

                <MiniCalendar value={customDate} onChange={setCustomDate} />

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
                    <Check className="h-4 w-4" /> Add
                  </button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}


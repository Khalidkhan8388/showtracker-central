import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Pin } from "lucide-react";
import type { LocalNote } from "@/lib/local-db";
import { FeedNoteCard as NoteCard } from "@/components/FeedNoteCard";

type Kind = "note" | "image" | "instagram" | "youtube" | "web" | "voice" | "media";

const KIND_LABELS: Array<{ key: Kind; label: string }> = [
  { key: "note", label: "Notes" },
  { key: "image", label: "Images" },
  { key: "voice", label: "Voice" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "web", label: "Web" },
  { key: "media", label: "Movies & TV" },
];

export function kindOf(n: LocalNote): Kind {
  if ((n as any).media) return "media";
  if ((n as any).instagram) return "instagram";
  if ((n as any).youtube) return "youtube";
  if (n.duration_seconds != null) return "voice";
  if (n.transcript != null && n.transcript.trim() !== "") return "note";
  if (Array.isArray(n.image_paths) && n.image_paths.length > 0) return "image";
  if (n.source_url) return "web";
  return "note";
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  if (t.getTime() === today.getTime()) return "Today";
  if (t.getTime() === yest.getTime()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/**
 * Memories — inline section that lives under Collections on the home feed.
 * Pinned entries sit on top, then everything else grouped by day, with
 * type filter pills. Selection is owned by the parent so the bulk action
 * pill (pin / collect / delete) stays shared with the rest of home.
 */
export function MemoriesSection({
  notes,
  thumbs,
  selected,
  selectMode,
  onToggleSel,
}: {
  notes: LocalNote[];
  thumbs: Record<string, string>;
  selected: Set<string>;
  selectMode: boolean;
  onToggleSel: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [active, setActive] = useState<Kind | null>(null);

  const all = useMemo(
    () => notes.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [notes],
  );

  const counts = useMemo(() => {
    const m = new Map<Kind, number>();
    for (const n of all) {
      const k = kindOf(n);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [all]);

  const pinnedCount = all.filter((n) => n.pinned).length;
  const filtered =
    active === "pinned"
      ? all.filter((n) => n.pinned)
      : active
        ? all.filter((n) => kindOf(n) === active)
        : all;

  if (all.length === 0) return null;

  return (
    <section aria-label="Memories" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Memories
        </span>
        <span className="text-[11px] text-muted-foreground">
          {all.length} {all.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <FilterPill label="All" count={all.length} active={active === null} onClick={() => setActive(null)} />
        {pinnedCount > 0 && (
          <FilterPill
            label="Pinned"
            icon={<Pin aria-hidden="true" className="h-3 w-3" />}
            count={pinnedCount}
            active={active === "pinned"}
            onClick={() => setActive(active === "pinned" ? null : "pinned")}
          />
        )}
        {KIND_LABELS.filter((k) => (counts.get(k.key) ?? 0) > 0).map((k) => (
          <FilterPill
            key={k.key}
            label={k.label}
            count={counts.get(k.key) ?? 0}
            active={active === k.key}
            onClick={() => setActive(active === k.key ? null : k.key)}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 items-start gap-3">
        {filtered.map((n) => (
          <div key={n.id} className={n.pinned ? "col-span-2" : ""}>
            <NoteCard
              note={n as any}
              variant={n.pinned ? "hero" : "masonry"}
              thumbUrl={thumbs[n.id]}
              selected={selected.has(n.id)}
              selectMode={selectMode}
              hideYouTubeThumb={!n.pinned}
              onOpen={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
              onLongPress={() => onToggleSel(n.id)}
              onToggleSel={() => onToggleSel(n.id)}
            />
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-10 text-center text-[13px] text-muted-foreground">Nothing here yet.</p>
      )}
    </section>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
  icon,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium ring-1 transition active:scale-95 ${
        active
          ? "bg-primary text-primary-foreground ring-transparent"
          : "bg-card text-foreground ring-border/60"
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className={active ? "opacity-70" : "text-muted-foreground"}>{count}</span>
    </button>
  );
}


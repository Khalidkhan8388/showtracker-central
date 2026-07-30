import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Pin, ChevronRight } from "lucide-react";
import type { LocalNote } from "@/lib/local-db";
import { FeedNoteCard as NoteCard } from "@/components/FeedNoteCard";
import { haptic } from "@/lib/haptics";
import { SectionHeader } from "@/components/SectionLabel";

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

/**
 * Memories — inline section that lives under Collections on the home feed.
 * - A horizontal "Pinned" strip sits at the top so pinned items are glanceable
 *   without disrupting the grid rhythm.
 * - The main grid is newest-first and can be limited (e.g. home preview shows
 *   the most recent 6, with a "See all" gateway to the full archive).
 * - A "Pinned" filter pill still lets you jump to every pinned item.
 */
export function MemoriesSection({
  notes,
  thumbs,
  selected,
  selectMode,
  onToggleSel,
  limit,
  onSeeAll,
  expanded = false,
}: {
  notes: LocalNote[];
  thumbs: Record<string, string>;
  selected: Set<string>;
  selectMode: boolean;
  onToggleSel: (id: string) => void;
  limit?: number;
  onSeeAll?: () => void;
  expanded?: boolean;
}) {
  const navigate = useNavigate();
  const [active, setActive] = useState<Kind | "pinned" | null>(null);

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

  const pinned = useMemo(() => all.filter((n) => n.pinned), [all]);
  const pinnedCount = pinned.length;
  const unpinned = useMemo(() => all.filter((n) => !n.pinned), [all]);

  const gridSource =
    active === "pinned"
      ? pinned
      : active
        ? unpinned.filter((n) => kindOf(n) === active)
        : unpinned;

  const grid =
    limit && !expanded ? gridSource.slice(0, Math.max(0, limit - (active ? 0 : pinned.length > 0 ? 1 : 0))) : gridSource;

  const hasMore = limit && !expanded ? gridSource.length > grid.length : false;

  if (all.length === 0) return null;

  return (
    <section aria-label="Memories" className="flex flex-col gap-3">
      <button
        type="button"
        disabled={!hasMore}
        onClick={() => {
          void haptic.tap();
          onSeeAll?.();
        }}
        className="group flex items-baseline justify-between text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Memories
        </span>
        <span
          className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground transition-colors group-active:text-foreground"
        >
          {all.length} {all.length === 1 ? "entry" : "entries"}
          {hasMore && (
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground/10 text-foreground">
              <ChevronRight className="h-3 w-3" />
            </span>
          )}
        </span>
      </button>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <FilterPill
          label="All"
          count={all.length}
          active={active === null}
          onClick={() => {
            void haptic.tap();
            setActive(null);
          }}
        />
        {pinnedCount > 0 && (
          <FilterPill
            label="Pinned"
            icon={<Pin aria-hidden="true" className="h-3 w-3" />}
            count={pinnedCount}
            active={active === "pinned"}
            onClick={() => {
              void haptic.tap();
              setActive(active === "pinned" ? null : "pinned");
            }}
          />
        )}
        {KIND_LABELS.filter((k) => (counts.get(k.key) ?? 0) > 0).map((k) => (
          <FilterPill
            key={k.key}
            label={k.label}
            count={counts.get(k.key) ?? 0}
            active={active === k.key}
            onClick={() => {
              void haptic.tap();
              setActive(active === k.key ? null : k.key);
            }}
          />
        ))}
      </div>

      {active !== "pinned" && pinnedCount > 0 && !expanded && (
        <PinnedStrip
          pinned={pinned}
          thumbs={thumbs}
          selected={selected}
          selectMode={selectMode}
          onToggleSel={onToggleSel}
        />
      )}

      <div className="grid grid-cols-2 items-start gap-3">
        {grid.map((n) => (
          <div key={n.id}>
            <NoteCard
              note={n as any}
              variant="masonry"
              thumbUrl={thumbs[n.id]}
              selected={selected.has(n.id)}
              selectMode={selectMode}
              hideYouTubeThumb={!n.pinned}
              onOpen={() => {
                void haptic.tap();
                navigate({ to: "/notes/$id", params: { id: n.id } });
              }}
              onLongPress={() => {
                void haptic.select();
                onToggleSel(n.id);
              }}
              onToggleSel={() => onToggleSel(n.id)}
            />
          </div>
        ))}
      </div>

      {grid.length === 0 && (
        <p className="py-10 text-center text-[13px] text-muted-foreground">Nothing here yet.</p>
      )}
    </section>
  );
}

function PinnedStrip({
  pinned,
  thumbs,
  selected,
  selectMode,
  onToggleSel,
}: {
  pinned: LocalNote[];
  thumbs: Record<string, string>;
  selected: Set<string>;
  selectMode: boolean;
  onToggleSel: (id: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {pinned.map((n) => (
        <div key={n.id} className="w-32 shrink-0 snap-start">
          <NoteCard
            note={n as any}
            variant="masonry"
            thumbUrl={thumbs[n.id]}
            selected={selected.has(n.id)}
            selectMode={selectMode}
            hideYouTubeThumb={!n.pinned}
            onOpen={() => {
              void haptic.tap();
              navigate({ to: "/notes/$id", params: { id: n.id } });
            }}
            onLongPress={() => {
              void haptic.select();
              onToggleSel(n.id);
            }}
            onToggleSel={() => onToggleSel(n.id)}
          />
        </div>
      ))}
    </div>
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
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium ring-1 transition active:scale-95 press-bounce ${
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

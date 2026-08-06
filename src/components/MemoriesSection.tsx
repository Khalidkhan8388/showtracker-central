import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { LocalNote } from "@/lib/local-db";
import { FeedNoteCard as NoteCard } from "@/components/FeedNoteCard";
import { haptic } from "@/lib/haptics";

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

  const all = useMemo(
    () => notes.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [notes],
  );
  const grid = all;

  if (all.length === 0) return null;

  return (
    <section aria-label="Memories" className="flex flex-col gap-3">
      <div className="columns-2 gap-3">
        {grid.map((n, i) => (
          <div
            key={n.id}
            className={`break-inside-avoid ${n.pinned ? "[column-span:all]" : ""} ${i === grid.length - 1 ? "" : "mb-3"}`}
          >
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

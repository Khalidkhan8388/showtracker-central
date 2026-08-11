import { haptic } from "@/lib/haptics";
import { useScrolled } from "@/hooks/use-scrolled";
import { MediaTypePill, type MediaKind } from "@/components/MediaTypePill";

export type FilterChip = { key: string; label: string };

/**
 * Floating dock that sits directly above the bottom tab bar:
 * Movies ⇄ TV switch plus a scrollable row of extra filters.
 */
export function FilterDock({
  kind,
  onKindChange,
  movieCount,
  tvCount,
  filters,
  activeFilter,
  onFilterChange,
}: {
  kind: MediaKind;
  onKindChange: (k: MediaKind) => void;
  movieCount?: number;
  tvCount?: number;
  filters?: FilterChip[];
  activeFilter?: string;
  onFilterChange?: (key: string) => void;
}) {
  const shrink = useScrolled(24);

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-40 px-4 transition-all duration-300 ease-out ${
        shrink ? "bottom-[calc(max(env(safe-area-inset-bottom),0.75rem)+58px)]" : "bottom-[calc(max(env(safe-area-inset-bottom),0.75rem)+66px)]"
      }`}
    >
      <div
        className={`glass-pill pointer-events-auto mx-auto w-full max-w-md rounded-[26px] transition-all duration-300 ease-out ${
          shrink ? "scale-[0.96] p-1" : "p-1.5"
        }`}
        style={{ transformOrigin: "bottom center" }}
      >
        <MediaTypePill bare value={kind} onChange={onKindChange} movieCount={movieCount} tvCount={tvCount} />
        {filters && filters.length > 0 && !shrink && (
          <div className="no-scrollbar mt-1 flex gap-1.5 overflow-x-auto px-1 pb-1 pt-0.5">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  void haptic.tap();
                  onFilterChange?.(f.key);
                }}
                className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold press-bounce ${
                  activeFilter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-black/5 text-muted-foreground dark:bg-white/10"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

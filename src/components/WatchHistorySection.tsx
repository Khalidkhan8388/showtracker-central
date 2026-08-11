import { SectionLabel } from "@/components/SectionLabel";
import { WatchHistoryDeck, WatchHistoryStrip } from "@/components/TicketStub";
import { useWatchHistory, useWatchHistoryFor } from "@/lib/watch-history";

/** Recently watched stubs. Pass `tmdbIds` to scope it to one collection. */
export function WatchHistorySection({
  tmdbIds,
  limit = 12,
  label = "Recently watched",
  variant = "strip",
}: {
  tmdbIds?: number[];
  limit?: number;
  label?: string;
  variant?: "strip" | "deck";
}) {
  const scoped = useWatchHistoryFor(tmdbIds ?? [], limit);
  const global = useWatchHistory(limit);
  const entries = tmdbIds ? scoped : global;

  if (!entries || entries.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex w-full items-baseline justify-between">
        <SectionLabel>{label}</SectionLabel>
        <span className="text-[11px] text-muted-foreground">
          {entries.length} {entries.length === 1 ? "stub" : "stubs"}
        </span>
      </div>
      {variant === "deck" ? <WatchHistoryDeck entries={entries} /> : <WatchHistoryStrip entries={entries} />}
    </section>
  );
}


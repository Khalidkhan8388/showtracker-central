import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Film, Search as SearchIcon, CalendarClock } from "lucide-react";
import { format } from "date-fns";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { backfillMediaCollections } from "@/lib/collections";
import { MediaCard } from "@/components/MediaCard";
import { poster as tmdbPoster } from "@/lib/media";
import { SectionLabel } from "@/components/SectionLabel";
import { TabBar } from "@/components/TabBar";
import { MediaTypePill, type MediaKind } from "@/components/MediaTypePill";
import { EpisodeTracker } from "@/components/MediaStatsPanel";
import { haptic } from "@/lib/haptics";
import type { LocalNote, LocalMedia } from "@/lib/local-db";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [
      { title: "Your Library — Braintape" },
      { name: "description", content: "Every movie and show you track, with upcoming and unwatched episodes." },
      { property: "og:title", content: "Your Library — Braintape" },
      { property: "og:description", content: "Every movie and show you track, with upcoming and unwatched episodes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const navigate = useNavigate();
  const localNotes = useLocalNotes();
  const [kind, setKind] = useState<MediaKind>("movie");

  useEffect(() => {
    void backfillMediaCollections();
  }, []);

  const mediaNotes = useMemo(
    () => ((localNotes ?? []) as LocalNote[]).filter((n) => !!n.media && !n.deleted_at),
    [localNotes],
  );

  const movies = useMemo(() => mediaNotes.filter((n) => n.media?.type === "movie"), [mediaNotes]);
  const shows = useMemo(() => mediaNotes.filter((n) => n.media?.type === "tv"), [mediaNotes]);
  const items = kind === "movie" ? movies : shows;

  const upcomingMovies = useMemo(() => {
    const now = Date.now();
    return movies
      .filter((n) => {
        const d = n.media?.release_date ? new Date(n.media.release_date).getTime() : NaN;
        return Number.isFinite(d) && d > now;
      })
      .sort(
        (a, b) =>
          new Date(a.media!.release_date!).getTime() - new Date(b.media!.release_date!).getTime(),
      );
  }, [movies]);

  const unwatchedMovies = useMemo(
    () => movies.filter((n) => n.media?.watch_status !== "watched" && n.media?.watch_status !== "dropped"),
    [movies],
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-32">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background px-4 pb-3 pt-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-[26px] font-bold leading-none tracking-tight">Library</h1>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {mediaNotes.length} tracked
          </span>
        </div>
        <div className="mt-3">
          <MediaTypePill value={kind} onChange={setKind} movieCount={movies.length} tvCount={shows.length} />
        </div>
      </header>

      <section className="space-y-6 px-4 pt-4">
        {localNotes === null || localNotes === undefined ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl bg-card px-6 py-12 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Film className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[17px] font-semibold">
              No {kind === "movie" ? "movies" : "shows"} yet
            </p>
            <Link
              to="/search"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground press-bounce"
            >
              <SearchIcon className="h-3.5 w-3.5" /> Find something
            </Link>
          </div>
        ) : (
          <>
            {kind === "tv" ? (
              <EpisodeTracker members={shows.map((n) => ({ id: n.id, heading: n.heading, media: n.media }))} />
            ) : (
              <>
                {upcomingMovies.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <SectionLabel>Upcoming releases</SectionLabel>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {upcomingMovies.length}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {upcomingMovies.map((n) => {
                        const m = n.media as LocalMedia;
                        const p = tmdbPoster(m.poster_path, "w185");
                        return (
                          <li key={n.id}>
                            <Link
                              to="/notes/$id"
                              params={{ id: n.id }}
                              className="flex items-center gap-3 rounded-2xl bg-card p-2 ring-1 ring-border/60 press-bounce active:opacity-80"
                            >
                              {p ? (
                                <img src={p} alt={m.title} loading="lazy" className="h-16 w-11 rounded-lg object-cover" />
                              ) : (
                                <div className="h-16 w-11 rounded-lg bg-muted" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-semibold">{m.title}</p>
                                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <CalendarClock className="h-3 w-3" />
                                  {format(new Date(m.release_date!), "MMM d, yyyy")}
                                </p>
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {unwatchedMovies.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <SectionLabel>Not watched</SectionLabel>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {unwatchedMovies.length}
                      </span>
                    </div>
                    <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
                      {unwatchedMovies.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => {
                            void haptic.tap();
                            void navigate({ to: "/notes/$id", params: { id: n.id } });
                          }}
                          className="w-24 shrink-0 snap-start text-left active:opacity-80"
                        >
                          <div className="aspect-[2/3] w-full">
                            <MediaCard media={n.media as LocalMedia} variant="grid" pinned={n.pinned} />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>All {kind === "movie" ? "movies" : "shows"}</SectionLabel>
                <span className="text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      void haptic.tap();
                      void navigate({ to: "/notes/$id", params: { id: n.id } });
                    }}
                    className="text-left active:opacity-80"
                  >
                    <div className="aspect-[2/3] w-full">
                      <MediaCard media={n.media as LocalMedia} variant="grid" pinned={n.pinned} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <TabBar />
    </div>
  );
}

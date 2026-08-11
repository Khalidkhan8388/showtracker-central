import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Film, ChevronRight, Search as SearchIcon } from "lucide-react";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { useCollections, backfillMediaCollections } from "@/lib/collections";
import { MediaCard } from "@/components/MediaCard";
import { poster as tmdbPoster } from "@/lib/media";
import { WatchHistorySection } from "@/components/WatchHistorySection";
import { SectionHeader as UISectionHeader } from "@/components/SectionLabel";
import { haptic } from "@/lib/haptics";
import type { LocalNote, LocalMedia } from "@/lib/local-db";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Braintape — Movie & TV Tracker" },
      { name: "description", content: "Track the movies and shows you watch, episode by episode." },
      { property: "og:title", content: "Braintape — Movie & TV Tracker" },
      { property: "og:description", content: "Track the movies and shows you watch, episode by episode." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

function Home() {
  const localNotes = useLocalNotes();
  const navigate = useNavigate();
  const allCollections = useCollections();

  useEffect(() => {
    void backfillMediaCollections();
  }, []);

  const [collapsed, setCollapsed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), {
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const mediaNotes = useMemo(
    () => ((localNotes ?? []) as LocalNote[]).filter((n) => !!n.media),
    [localNotes],
  );

  const watching = useMemo(
    () => mediaNotes.filter((n) => n.media?.watch_status === "watching"),
    [mediaNotes],
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-28">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background">
        <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-2">
          <div className="min-w-0">
            <h1
              style={{
                transform: collapsed ? "scale(0.625)" : "scale(1)",
                transformOrigin: "left center",
                willChange: "transform",
              }}
              className="font-bold tracking-tight leading-none text-[32px] transition-transform duration-200 ease-out motion-reduce:transition-none"
            >
              Braintape
            </h1>
            {mediaNotes.length > 0 && (
              <p
                style={{
                  opacity: collapsed ? 0 : 1,
                  height: collapsed ? 0 : "1.25rem",
                  marginTop: collapsed ? 0 : "0.25rem",
                }}
                className="overflow-hidden text-[13px] text-muted-foreground transition-opacity duration-150 ease-out motion-reduce:transition-none"
              >
                {mediaNotes.length} {mediaNotes.length === 1 ? "title" : "titles"} tracked
              </p>
            )}
          </div>
          <Link
            to="/profile"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[14px] font-semibold press-bounce active:opacity-70"
            aria-label="Profile"
          >
            B
          </Link>
        </div>
      </header>

      <section className="px-4 pt-3">
        <div ref={sentinelRef} className="h-px w-full" />

        {localNotes === null || localNotes === undefined ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : mediaNotes.length === 0 ? (
          <div className="rounded-2xl bg-card px-6 py-12 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Film className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[17px] font-semibold text-foreground">Nothing tracked yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Search for a movie or show to start your library.
            </p>
            <Link
              to="/search"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground press-bounce active:opacity-70"
            >
              <SearchIcon className="h-3.5 w-3.5" /> Find something
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            <WatchHistorySection limit={7} />

            {watching.length > 0 && (
              <div className="-mx-4">
                <div className="px-5 pb-2">
                  <UISectionHeader label="Continue watching" />
                </div>
                <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
                  {watching.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        void haptic.tap();
                        void navigate({ to: "/notes/$id", params: { id: n.id } });
                      }}
                      className="w-28 shrink-0 snap-start text-left active:opacity-80"
                    >
                      <div className="aspect-[2/3] w-full">
                        <MediaCard media={n.media as LocalMedia} variant="grid" pinned={n.pinned} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <CollectionsRow notes={mediaNotes} collections={allCollections ?? []} />

            <div>
              <div className="mb-2 flex items-center justify-between">
                <UISectionHeader label="Library" />
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {mediaNotes.length}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {mediaNotes.map((n) => (
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
          </div>
        )}
      </section>

      <Link
        to="/search"
        aria-label="Search movies and TV"
        className="fixed bottom-8 left-1/2 z-40 -translate-x-1/2 inline-flex items-center gap-2 rounded-full glass-pill px-5 py-3 text-[14px] font-semibold text-neutral-900 press-bounce active:opacity-80 dark:text-white"
      >
        <SearchIcon className="h-4 w-4" />
        Add title
      </Link>
    </div>
  );
}

function CollectionsRow({
  notes,
  collections,
}: {
  notes: LocalNote[];
  collections: import("@/lib/local-db").LocalCollection[];
}) {
  const noteById = useMemo(() => {
    const m = new Map<string, LocalNote>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);

  if (collections.length === 0) return null;

  return (
    <div className="-mx-4">
      <div className="flex items-center justify-between px-5 pb-2">
        <UISectionHeader label="Collections" />
        <Link
          to="/collections"
          aria-label="Open collections"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground press-bounce active:opacity-70"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
        {collections.map((c) => {
          let posterUrl: string | null = null;
          for (const nid of c.note_ids ?? []) {
            const media = noteById.get(nid)?.media;
            if (media?.poster_path) {
              posterUrl = tmdbPoster(media.poster_path, "w342");
              break;
            }
          }
          return (
            <Link
              key={c.id}
              to="/collections/$id"
              params={{ id: c.id }}
              style={{ borderRadius: 15 }}
              className="relative flex aspect-[2/3] w-28 shrink-0 snap-start overflow-hidden bg-card ring-1 ring-border/60 active:opacity-80"
            >
              {posterUrl ? (
                <img
                  src={posterUrl}
                  alt={c.title}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-primary/10 to-transparent" />
              )}
              <div className="absolute inset-x-0 bottom-0 scrim-t p-2 pt-8">
                <p className="line-clamp-2 text-[12px] font-semibold leading-tight scrim-fg">
                  {c.title}
                </p>
                <p className="text-[10px] scrim-fg-70">
                  {(c.note_ids ?? []).length} {(c.note_ids ?? []).length === 1 ? "title" : "titles"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Check, Star } from "lucide-react";
import { tmdbTrendingFn, type TmdbSearchHit } from "@/lib/tmdb.functions";
import { addTmdbMedia } from "@/lib/notes.functions";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { poster as posterUrl } from "@/lib/media";
import { SectionLabel } from "@/components/SectionLabel";
import { TabBar } from "@/components/TabBar";
import { MediaTypePill, type MediaKind } from "@/components/MediaTypePill";
import { haptic } from "@/lib/haptics";
import type { LocalNote } from "@/lib/local-db";

export const Route = createFileRoute("/_authenticated/discover")({
  head: () => ({
    meta: [
      { title: "Discover Movies & Shows — Braintape" },
      { name: "description", content: "Browse trending, popular and upcoming movies and TV shows." },
      { property: "og:title", content: "Discover Movies & Shows — Braintape" },
      { property: "og:description", content: "Browse trending, popular and upcoming movies and TV shows." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DiscoverPage,
});

const MODES = [
  { key: "trending", label: "Trending" },
  { key: "popular", label: "Popular" },
  { key: "top_rated", label: "Top rated" },
  { key: "upcoming", label: "Upcoming" },
] as const;

type Mode = (typeof MODES)[number]["key"];

function DiscoverPage() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<MediaKind>("movie");
  const [mode, setMode] = useState<Mode>("trending");
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const localNotes = useLocalNotes();

  const savedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const n of (localNotes ?? []) as LocalNote[]) {
      if (n.media && !n.deleted_at) s.add(`${n.media.type}:${n.media.tmdb_id}`);
    }
    return s;
  }, [localNotes]);

  const { data, isPending } = useQuery({
    queryKey: ["tmdb-discover", kind, mode],
    queryFn: () => tmdbTrendingFn({ data: { type: kind, mode } }),
    staleTime: 1000 * 60 * 30,
  });

  async function add(hit: TmdbSearchHit) {
    const key = `${hit.type}:${hit.tmdb_id}`;
    if (savedKeys.has(key) || adding.has(key)) return;
    void haptic.tap();
    setAdding((p) => new Set(p).add(key));
    try {
      const r = await addTmdbMedia({ data: { type: hit.type, tmdb_id: hit.tmdb_id } });
      if (r?.noteId) void navigate({ to: "/notes/$id", params: { id: r.noteId } });
    } finally {
      setAdding((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-32">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background px-4 pb-2 pt-3">
        <h1 className="text-[26px] font-bold leading-none tracking-tight">Discover</h1>
        <div className="mt-3">
          <MediaTypePill value={kind} onChange={setKind} />
        </div>
        <div className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => {
                void haptic.tap();
                setMode(m.key);
              }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold press-bounce ${
                mode === m.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      <section className="px-4 pt-3">
        <SectionLabel>{kind === "movie" ? "Movies" : "TV shows"}</SectionLabel>
        {isPending ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (data ?? []).length === 0 ? (
          <p className="py-16 text-center text-[13px] text-muted-foreground">Nothing to show right now.</p>
        ) : (
          <div className="mt-2 grid grid-cols-3 gap-3">
            {(data ?? []).map((hit) => {
              const key = `${hit.type}:${hit.tmdb_id}`;
              const saved = savedKeys.has(key);
              const busy = adding.has(key);
              const p = posterUrl(hit.poster_path, "w342");
              return (
                <button
                  key={key}
                  onClick={() => void add(hit)}
                  className="text-left press-bounce active:opacity-80"
                >
                  <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[15px] bg-card ring-1 ring-border/60">
                    {p ? (
                      <img src={p} alt={hit.title} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-muted-foreground">
                        {hit.title}
                      </div>
                    )}
                    <span className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white">
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : saved ? (
                        <Check className="h-3 w-3" strokeWidth={3} />
                      ) : (
                        <Plus className="h-3 w-3" strokeWidth={3} />
                      )}
                    </span>
                    {typeof hit.vote_average === "number" && hit.vote_average > 0 && (
                      <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                        <Star className="h-2.5 w-2.5 fill-current" />
                        {hit.vote_average.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-tight">{hit.title}</p>
                  {hit.year && <p className="text-[10px] text-muted-foreground">{hit.year}</p>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <TabBar />
    </div>
  );
}

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Star, Check, Bookmark, BookmarkCheck } from "lucide-react";
import { AppShell, Poster } from "../components/AppShell";
import { tmdb, IMG } from "../lib/tmdb";
import { useLibrary } from "../lib/library";

export const Route = createFileRoute("/movie/$id")({
  head: () => ({ meta: [{ title: "Movie — Reel" }] }),
  component: MoviePage,
  errorComponent: ({ error }) => <AppShell><div className="p-6 text-sm text-destructive">{error.message}</div></AppShell>,
});

function MoviePage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { data, isLoading, error } = useQuery({
    queryKey: ["movie", id],
    queryFn: () => tmdb.movie(id),
  });
  const { state, setMovie } = useLibrary();
  const numId = Number(id);
  const saved = state.movies[numId];

  const toggle = (status: "watchlist" | "watched") => {
    if (saved?.status === status) { setMovie(null, numId); return; }
    if (!data) return;
    setMovie({
      id: numId,
      title: data.title,
      poster: data.poster_path ?? null,
      year: (data.release_date ?? "").slice(0, 4),
      status,
      addedAt: Date.now(),
      rating: saved?.rating,
      note: saved?.note,
    }, numId);
  };

  return (
    <AppShell>
      <TopBar onBack={() => router.history.back()} />
      {isLoading && <div className="px-5 py-8 text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="px-5 py-8 text-sm text-destructive">{(error as Error).message}</div>}
      {data && (
        <>
          <div className="px-5">
            <div className="flex gap-4">
              <Poster src={IMG(data.poster_path, "w342")} alt={data.title} className="h-48 w-32 shrink-0" />
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold leading-tight">{data.title}</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(data.release_date ?? "").slice(0, 4)} · {data.runtime ? `${data.runtime}m` : "—"}
                </p>
                <p className="mt-2 flex items-center gap-1 text-sm">
                  <Star className="h-4 w-4 fill-current text-yellow-500" />
                  <span className="font-medium">{data.vote_average?.toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">({data.vote_count?.toLocaleString()})</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {data.genres?.slice(0, 3).map((g: any) => (
                    <span key={g.id} className="rounded-full bg-muted px-2 py-0.5 text-xs">{g.name}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <ActionButton
                active={saved?.status === "watchlist"}
                onClick={() => toggle("watchlist")}
                activeIcon={<BookmarkCheck className="h-4 w-4" />}
                icon={<Bookmark className="h-4 w-4" />}
                label={saved?.status === "watchlist" ? "In watchlist" : "Watchlist"}
              />
              <ActionButton
                active={saved?.status === "watched"}
                onClick={() => toggle("watched")}
                activeIcon={<Check className="h-4 w-4" />}
                icon={<Check className="h-4 w-4" />}
                label={saved?.status === "watched" ? "Watched" : "Mark watched"}
              />
            </div>

            {data.overview && (
              <section className="mt-6">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Overview</h2>
                <p className="mt-2 text-sm leading-relaxed">{data.overview}</p>
              </section>
            )}

            {data.credits?.cast?.length > 0 && (
              <section className="mt-6 pb-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cast</h2>
                <div className="mt-3 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {data.credits.cast.slice(0, 15).map((c: any) => (
                    <Link key={c.id} to="/person/$id" params={{ id: String(c.id) }} className="w-20 shrink-0 text-center">
                      <Poster src={IMG(c.profile_path, "w200")} alt={c.name} className="mx-auto h-20 w-20 rounded-full" />
                      <div className="mt-1.5 line-clamp-2 text-xs font-medium">{c.name}</div>
                      <div className="line-clamp-1 text-[10px] text-muted-foreground">{c.character}</div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

export function TopBar({ onBack, title }: { onBack: () => void; title?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-5 pb-3">
      <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted" aria-label="Back">
        <ChevronLeft className="h-5 w-5" />
      </button>
      {title && <h1 className="truncate text-base font-semibold">{title}</h1>}
    </div>
  );
}

export function ActionButton({ active, onClick, icon, activeIcon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; activeIcon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
        active ? "bg-foreground text-background" : "border border-border bg-background hover:bg-muted"
      }`}
    >
      {active ? activeIcon : icon}
      <span>{label}</span>
    </button>
  );
}

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Star, Check, Bookmark, BookmarkCheck, Play, ChevronRight } from "lucide-react";
import { AppShell, Poster } from "../components/AppShell";
import { tmdb, IMG } from "../lib/tmdb";
import { useLibrary } from "../lib/library";
import { TopBar, ActionButton } from "./movie.$id";

export const Route = createFileRoute("/tv/$id")({
  head: () => ({ meta: [{ title: "TV Show — Reel" }] }),
  component: TvPage,
  errorComponent: ({ error }) => <AppShell><div className="p-6 text-sm text-destructive">{error.message}</div></AppShell>,
});

function TvPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const numId = Number(id);
  const { data, isLoading, error } = useQuery({
    queryKey: ["tv", id],
    queryFn: () => tmdb.tv(id),
  });
  const { state, setShow } = useLibrary();
  const saved = state.shows[numId];

  const setStatus = (status: "watchlist" | "watching" | "completed") => {
    if (saved?.status === status) { setShow(null, numId); return; }
    if (!data) return;
    setShow({
      id: numId,
      name: data.name,
      poster: data.poster_path ?? null,
      status,
      addedAt: saved?.addedAt ?? Date.now(),
      rating: saved?.rating,
      note: saved?.note,
      watchedEpisodes: saved?.watchedEpisodes ?? {},
    }, numId);
  };

  const seasons = (data?.seasons ?? []).filter((s: any) => s.season_number > 0);
  const totalEpisodes = seasons.reduce((n: number, s: any) => n + (s.episode_count ?? 0), 0);
  const watchedCount = saved
    ? Object.values(saved.watchedEpisodes).reduce((n, a) => n + a.length, 0)
    : 0;

  return (
    <AppShell>
      <TopBar onBack={() => router.history.back()} />
      {isLoading && <div className="px-5 py-8 text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="px-5 py-8 text-sm text-destructive">{(error as Error).message}</div>}
      {data && (
        <div className="px-5">
          <div className="flex gap-4">
            <Poster src={IMG(data.poster_path, "w342")} alt={data.name} className="h-48 w-32 shrink-0" />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold leading-tight">{data.name}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {(data.first_air_date ?? "").slice(0, 4)} · {data.number_of_seasons} season{data.number_of_seasons === 1 ? "" : "s"}
              </p>
              <p className="mt-2 flex items-center gap-1 text-sm">
                <Star className="h-4 w-4 fill-current text-yellow-500" />
                <span className="font-medium">{data.vote_average?.toFixed(1)}</span>
              </p>
              {totalEpisodes > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium">{watchedCount} / {totalEpisodes}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-foreground" style={{ width: `${totalEpisodes ? (watchedCount / totalEpisodes) * 100 : 0}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <ActionButton
              active={saved?.status === "watchlist"}
              onClick={() => setStatus("watchlist")}
              icon={<Bookmark className="h-4 w-4" />}
              activeIcon={<BookmarkCheck className="h-4 w-4" />}
              label="Watchlist"
            />
            <ActionButton
              active={saved?.status === "watching"}
              onClick={() => setStatus("watching")}
              icon={<Play className="h-4 w-4" />}
              activeIcon={<Play className="h-4 w-4" />}
              label="Watching"
            />
            <ActionButton
              active={saved?.status === "completed"}
              onClick={() => setStatus("completed")}
              icon={<Check className="h-4 w-4" />}
              activeIcon={<Check className="h-4 w-4" />}
              label="Done"
            />
          </div>

          {data.overview && (
            <section className="mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Overview</h2>
              <p className="mt-2 text-sm leading-relaxed">{data.overview}</p>
            </section>
          )}

          <section className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Seasons</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {seasons.map((s: any) => {
                const watched = (saved?.watchedEpisodes[String(s.season_number)] ?? []).length;
                const total = s.episode_count ?? 0;
                return (
                  <li key={s.id}>
                    <Link
                      to="/tv/$id/season/$season"
                      params={{ id, season: String(s.season_number) }}
                      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-2 pr-3 hover:bg-muted/40"
                    >
                      <Poster src={IMG(s.poster_path ?? data.poster_path, "w200")} alt={s.name} className="h-16 w-11 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {total} ep · {watched}/{total} watched
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-foreground" style={{ width: `${total ? (watched / total) * 100 : 0}%` }} />
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

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
      )}
    </AppShell>
  );
}

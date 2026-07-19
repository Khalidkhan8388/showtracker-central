import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { AppShell } from "../components/AppShell";
import { tmdb } from "../lib/tmdb";
import { useLibrary } from "../lib/library";
import { TopBar } from "./movie.$id";

export const Route = createFileRoute("/tv/$id/season/$season")({
  head: () => ({ meta: [{ title: "Episodes — Reel" }] }),
  component: SeasonPage,
  errorComponent: ({ error }) => <AppShell><div className="p-6 text-sm text-destructive">{error.message}</div></AppShell>,
});

function SeasonPage() {
  const { id, season } = Route.useParams();
  const router = useRouter();
  const numId = Number(id);
  const seasonNum = Number(season);

  const showQ = useQuery({ queryKey: ["tv", id], queryFn: () => tmdb.tv(id) });
  const seasonQ = useQuery({ queryKey: ["season", id, season], queryFn: () => tmdb.season(id, season) });
  const { state, toggleEpisode, markSeason } = useLibrary();
  const saved = state.shows[numId];
  const watched = new Set(saved?.watchedEpisodes[String(seasonNum)] ?? []);

  const episodes: any[] = seasonQ.data?.episodes ?? [];
  const allEpNums = episodes.map((e) => e.episode_number);
  const allWatched = allEpNums.length > 0 && allEpNums.every((n) => watched.has(n));

  const baseInfo = showQ.data && {
    name: showQ.data.name,
    poster: showQ.data.poster_path ?? null,
  };

  const onToggle = (epNum: number) => {
    if (!baseInfo) return;
    toggleEpisode(numId, baseInfo, seasonNum, epNum);
  };

  const toggleAll = () => {
    if (!baseInfo) return;
    markSeason(numId, baseInfo, seasonNum, allWatched ? [] : allEpNums);
  };

  return (
    <AppShell>
      <TopBar onBack={() => router.history.back()} title={showQ.data?.name} />
      <div className="px-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">{seasonQ.data?.name ?? `Season ${seasonNum}`}</h2>
            <p className="text-xs text-muted-foreground">
              {watched.size} / {episodes.length} watched
            </p>
          </div>
          {episodes.length > 0 && (
            <button
              onClick={toggleAll}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {allWatched ? "Unmark all" : "Mark all"}
            </button>
          )}
        </div>

        {seasonQ.isLoading && <div className="pt-6 text-sm text-muted-foreground">Loading episodes…</div>}

        <ul className="mt-4 flex flex-col gap-2 pb-4">
          {episodes.map((e) => {
            const isWatched = watched.has(e.episode_number);
            return (
              <li key={e.id}>
                <button
                  onClick={() => onToggle(e.episode_number)}
                  className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors ${
                    isWatched ? "border-foreground/20 bg-muted/60" : "border-border bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                    isWatched ? "border-foreground bg-foreground text-background" : "border-border"
                  }`}>
                    {isWatched && <Check className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-mono text-muted-foreground">E{e.episode_number}</span>
                      <span className="truncate text-sm font-medium">{e.name}</span>
                    </div>
                    {e.air_date && <div className="mt-0.5 text-[11px] text-muted-foreground">{e.air_date}</div>}
                    {e.overview && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{e.overview}</p>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </AppShell>
  );
}

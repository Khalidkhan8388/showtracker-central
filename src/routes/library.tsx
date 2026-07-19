import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useMemo } from "react";
import { AppShell, PageHeader, Poster } from "../components/AppShell";
import { useLibrary } from "../lib/library";
import { IMG } from "../lib/tmdb";

const schema = z.object({
  tab: fallback(z.string(), "tv").default("tv"),
  filter: fallback(z.string(), "all").default("all"),
});

export const Route = createFileRoute("/library")({
  head: () => ({ meta: [{ title: "Library — Reel" }] }),
  validateSearch: zodValidator(schema),
  component: LibraryPage,
});

const TABS = [
  { id: "tv", label: "TV" },
  { id: "movies", label: "Movies" },
  { id: "people", label: "People" },
] as const;

function LibraryPage() {
  const { tab, filter } = Route.useSearch();
  const navigate = useNavigate({ from: "/library" });
  const { state, hydrated } = useLibrary();

  const setTab = (t: string) => navigate({ search: { tab: t, filter: "all" }, replace: true });
  const setFilter = (f: string) => navigate({ search: (prev) => ({ ...prev, filter: f }), replace: true });

  const filters = tab === "tv"
    ? ["all", "watchlist", "watching", "completed"]
    : tab === "movies"
    ? ["all", "watchlist", "watched"]
    : ["all"];

  const tvItems = useMemo(() => {
    let items = Object.values(state.shows);
    if (filter !== "all") items = items.filter((s) => s.status === filter);
    return items.sort((a, b) => b.addedAt - a.addedAt);
  }, [state.shows, filter]);

  const movieItems = useMemo(() => {
    let items = Object.values(state.movies);
    if (filter !== "all") items = items.filter((m) => m.status === filter);
    return items.sort((a, b) => b.addedAt - a.addedAt);
  }, [state.movies, filter]);

  const peopleItems = useMemo(
    () => Object.values(state.people).sort((a, b) => b.followedAt - a.followedAt),
    [state.people],
  );

  return (
    <AppShell>
      <PageHeader title="Library" />

      <div className="px-5">
        <div className="flex gap-1 rounded-full bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-full py-1.5 text-sm font-medium transition-colors ${
                tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {filters.length > 1 && (
          <div className="mt-4 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs capitalize ${
                  filter === f ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 pt-4">
        {tab === "tv" && (
          <Grid empty={hydrated && tvItems.length === 0}>
            {tvItems.map((s) => {
              const watched = Object.values(s.watchedEpisodes).reduce((n, a) => n + a.length, 0);
              return (
                <Link key={s.id} to="/tv/$id" params={{ id: String(s.id) }} className="block">
                  <Poster src={IMG(s.poster, "w342")} alt={s.name} className="aspect-[2/3] w-full" />
                  <div className="mt-2 line-clamp-1 text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {s.status} · {watched} ep
                  </div>
                </Link>
              );
            })}
          </Grid>
        )}
        {tab === "movies" && (
          <Grid empty={hydrated && movieItems.length === 0}>
            {movieItems.map((m) => (
              <Link key={m.id} to="/movie/$id" params={{ id: String(m.id) }} className="block">
                <Poster src={IMG(m.poster, "w342")} alt={m.title} className="aspect-[2/3] w-full" />
                <div className="mt-2 line-clamp-1 text-sm font-medium">{m.title}</div>
                <div className="text-xs text-muted-foreground capitalize">{m.status} · {m.year}</div>
              </Link>
            ))}
          </Grid>
        )}
        {tab === "people" && (
          <Grid empty={hydrated && peopleItems.length === 0}>
            {peopleItems.map((p) => (
              <Link key={p.id} to="/person/$id" params={{ id: String(p.id) }} className="block text-center">
                <Poster src={IMG(p.photo, "w200")} alt={p.name} className="mx-auto aspect-square w-full rounded-full" />
                <div className="mt-2 line-clamp-2 text-sm font-medium">{p.name}</div>
              </Link>
            ))}
          </Grid>
        )}
      </div>
    </AppShell>
  );
}

function Grid({ children, empty }: { children: React.ReactNode; empty: boolean }) {
  if (empty) {
    return (
      <div className="mt-10 rounded-2xl border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        <Link to="/search" className="mt-3 inline-flex rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">
          Search to add
        </Link>
      </div>
    );
  }
  return <div className="grid grid-cols-3 gap-3">{children}</div>;
}

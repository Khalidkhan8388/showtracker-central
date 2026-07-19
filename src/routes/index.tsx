import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Tv, Film, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { AppShell, PageHeader, Poster } from "../components/AppShell";
import { useLibrary } from "../lib/library";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Home — Reel" }] }),
  component: Home,
});

function Home() {
  const { state, hydrated } = useLibrary();

  const stats = useMemo(() => {
    const movies = Object.values(state.movies);
    const shows = Object.values(state.shows);
    return {
      watching: shows.filter((s) => s.status === "watching").length,
      watchlist:
        movies.filter((m) => m.status === "watchlist").length +
        shows.filter((s) => s.status === "watchlist").length,
      watched: movies.filter((m) => m.status === "watched").length,
      completed: shows.filter((s) => s.status === "completed").length,
    };
  }, [state]);

  const watching = useMemo(
    () => Object.values(state.shows).filter((s) => s.status === "watching").slice(0, 10),
    [state.shows],
  );
  const recentMovies = useMemo(
    () => Object.values(state.movies).sort((a, b) => b.addedAt - a.addedAt).slice(0, 10),
    [state.movies],
  );

  return (
    <AppShell>
      <PageHeader
        title="Reel"
        subtitle={hydrated ? new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : " "}
      />

      <section className="px-5">
        <Link
          to="/search"
          className="flex items-center gap-3 rounded-2xl border border-border bg-muted/60 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
        >
          <Search className="h-4 w-4" />
          <span>Search movies, shows, actors…</span>
        </Link>
      </section>

      <section className="grid grid-cols-2 gap-3 px-5 pt-5">
        <StatCard label="Watching" value={stats.watching} icon={<Tv className="h-4 w-4" />} />
        <StatCard label="Watchlist" value={stats.watchlist} icon={<Film className="h-4 w-4" />} />
        <StatCard label="Movies watched" value={stats.watched} />
        <StatCard label="Shows completed" value={stats.completed} />
      </section>

      <SectionHeader title="Continue watching" href="/library" show={watching.length > 0} />
      {watching.length > 0 && (
        <HorizontalRow>
          {watching.map((s) => (
            <Link key={s.id} to="/tv/$id" params={{ id: String(s.id) }} className="w-28 shrink-0">
              <Poster src={s.poster} alt={s.name} className="aspect-[2/3] w-28" />
              <div className="mt-2 line-clamp-2 text-xs font-medium">{s.name}</div>
            </Link>
          ))}
        </HorizontalRow>
      )}

      <SectionHeader title="Recent movies" href="/library" show={recentMovies.length > 0} />
      {recentMovies.length > 0 && (
        <HorizontalRow>
          {recentMovies.map((m) => (
            <Link key={m.id} to="/movie/$id" params={{ id: String(m.id) }} className="w-28 shrink-0">
              <Poster src={m.poster} alt={m.title} className="aspect-[2/3] w-28" />
              <div className="mt-2 line-clamp-2 text-xs font-medium">{m.title}</div>
            </Link>
          ))}
        </HorizontalRow>
      )}

      {hydrated && watching.length === 0 && recentMovies.length === 0 && (
        <div className="mx-5 mt-8 rounded-2xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">Your library is empty.</p>
          <Link
            to="/search"
            className="mt-3 inline-flex items-center justify-center rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Start searching
          </Link>
        </div>
      )}
    </AppShell>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
    </div>
  );
}

function SectionHeader({ title, href, show }: { title: string; href: "/library"; show: boolean }) {
  if (!show) return null;
  return (
    <div className="mt-6 flex items-center justify-between px-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <Link to={href} className="flex items-center text-xs text-muted-foreground hover:text-foreground">
        See all <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function HorizontalRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

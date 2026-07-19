import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Search as SearchIcon, X } from "lucide-react";
import { AppShell, PageHeader, Poster } from "../components/AppShell";
import { tmdb, IMG, getKey, type MultiResult } from "../lib/tmdb";

const schema = z.object({ q: fallback(z.string(), "").default("") });

export const Route = createFileRoute("/search")({
  head: () => ({ meta: [{ title: "Search — Reel" }] }),
  validateSearch: zodValidator(schema),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/search" });
  const [input, setInput] = useState(q);
  const [debounced, setDebounced] = useState(q);
  const [hasKey, setHasKey] = useState(true);

  useEffect(() => { setHasKey(!!getKey()); }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    navigate({ search: { q: debounced }, replace: true });
  }, [debounced, navigate]);

  const { data, isFetching, error } = useQuery({
    queryKey: ["multi", debounced],
    queryFn: () => tmdb.multiSearch(debounced),
    enabled: debounced.length > 1 && hasKey,
  });

  const results = data?.results ?? [];
  const movies = results.filter((r) => r.media_type === "movie");
  const shows = results.filter((r) => r.media_type === "tv");
  const people = results.filter((r) => r.media_type === "person");

  return (
    <AppShell>
      <PageHeader title="Search" />
      <div className="px-5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Movies, shows, people…"
            className="w-full rounded-2xl border border-border bg-muted/60 py-3 pl-10 pr-10 text-sm outline-none focus:border-foreground/30 focus:bg-background"
          />
          {input && (
            <button onClick={() => setInput("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pt-6">
        {!hasKey && (
          <EmptyState
            title="Add your TMDB API key"
            body="Search needs a free TMDB key to pull posters and info from the internet."
            action={<Link to="/settings" className="inline-flex rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">Open Settings</Link>}
          />
        )}
        {hasKey && debounced.length <= 1 && (
          <p className="pt-8 text-center text-sm text-muted-foreground">Type at least 2 characters to search.</p>
        )}
        {hasKey && isFetching && <p className="pt-8 text-center text-sm text-muted-foreground">Searching…</p>}
        {error && <p className="pt-4 text-center text-sm text-destructive">{(error as Error).message}</p>}

        {hasKey && !isFetching && debounced.length > 1 && results.length === 0 && (
          <p className="pt-8 text-center text-sm text-muted-foreground">No results.</p>
        )}

        <ResultGroup title="Movies" items={movies} />
        <ResultGroup title="TV Shows" items={shows} />
        <ResultGroup title="People" items={people} />
      </div>
    </AppShell>
  );
}

function ResultGroup({ title, items }: { title: string; items: MultiResult[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-6">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <ul className="flex flex-col gap-3">
        {items.map((r) => {
          const isPerson = r.media_type === "person";
          const to = r.media_type === "movie" ? "/movie/$id" : r.media_type === "tv" ? "/tv/$id" : "/person/$id";
          const image = IMG(isPerson ? r.profile_path : r.poster_path, "w200");
          const name = r.title ?? r.name ?? "Untitled";
          const year = (r.release_date ?? r.first_air_date ?? "").slice(0, 4);
          return (
            <li key={`${r.media_type}-${r.id}`}>
              <Link to={to} params={{ id: String(r.id) }} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-2 pr-4 hover:bg-muted/40">
                <Poster src={image} alt={name} className={isPerson ? "h-16 w-16 shrink-0 rounded-full" : "h-20 w-14 shrink-0"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {isPerson ? r.known_for_department ?? "Person" : year || "—"}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-border p-6 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

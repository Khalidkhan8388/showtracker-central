import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { AppShell, Poster } from "../components/AppShell";
import { tmdb, IMG } from "../lib/tmdb";
import { useLibrary } from "../lib/library";
import { TopBar } from "./movie.$id";

export const Route = createFileRoute("/person/$id")({
  head: () => ({ meta: [{ title: "Person — Reel" }] }),
  component: PersonPage,
  errorComponent: ({ error }) => <AppShell><div className="p-6 text-sm text-destructive">{error.message}</div></AppShell>,
});

function PersonPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const numId = Number(id);
  const { data, isLoading, error } = useQuery({
    queryKey: ["person", id],
    queryFn: () => tmdb.person(id),
  });
  const { state, setPerson } = useLibrary();
  const following = !!state.people[numId];

  const toggleFollow = () => {
    if (following) { setPerson(null, numId); return; }
    if (!data) return;
    setPerson({ id: numId, name: data.name, photo: data.profile_path ?? null, followedAt: Date.now() }, numId);
  };

  const credits = (data?.combined_credits?.cast ?? [])
    .filter((c: any) => c.poster_path)
    .sort((a: any, b: any) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, 30);

  return (
    <AppShell>
      <TopBar onBack={() => router.history.back()} />
      {isLoading && <div className="px-5 py-8 text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="px-5 py-8 text-sm text-destructive">{(error as Error).message}</div>}
      {data && (
        <div className="px-5">
          <div className="flex flex-col items-center text-center">
            <Poster src={IMG(data.profile_path, "w342")} alt={data.name} className="h-32 w-32 rounded-full" />
            <h1 className="mt-4 text-xl font-bold">{data.name}</h1>
            <p className="text-xs text-muted-foreground">{data.known_for_department}{data.birthday ? ` · ${new Date().getFullYear() - new Date(data.birthday).getFullYear()} yrs` : ""}</p>
            <button
              onClick={toggleFollow}
              className={`mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium ${
                following ? "bg-foreground text-background" : "border border-border bg-background hover:bg-muted"
              }`}
            >
              <Heart className={`h-4 w-4 ${following ? "fill-current" : ""}`} />
              {following ? "Following" : "Follow"}
            </button>
          </div>

          {data.biography && (
            <section className="mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Biography</h2>
              <p className="mt-2 line-clamp-6 text-sm leading-relaxed">{data.biography}</p>
            </section>
          )}

          {credits.length > 0 && (
            <section className="mt-6 pb-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Known for</h2>
              <div className="mt-3 grid grid-cols-3 gap-3">
                {credits.map((c: any) => {
                  const to = c.media_type === "tv" ? "/tv/$id" : "/movie/$id";
                  return (
                    <Link key={`${c.media_type}-${c.id}-${c.credit_id}`} to={to} params={{ id: String(c.id) }}>
                      <Poster src={IMG(c.poster_path, "w200")} alt={c.title ?? c.name} className="aspect-[2/3] w-full" />
                      <div className="mt-1.5 line-clamp-2 text-xs font-medium">{c.title ?? c.name}</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, User, Calendar, MapPin, Film, Tv, Star } from "lucide-react";
import { fetchTmdbPersonFn, type TmdbPersonDetail } from "@/lib/tmdb.functions";
import { profile, poster } from "@/lib/media";

export const Route = createFileRoute("/_authenticated/cast/$personId")({
  head: () => ({ meta: [{ title: "Cast — Braintape" }] }),
  component: CastDetail,
});

function formatDate(date: string | null) {
  if (!date) return null;
  try {
    return new Date(date).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return date;
  }
}

function CastDetail() {
  const { personId } = Route.useParams();
  const navigate = useNavigate();
  const id = Number(personId);

  const { data: person, isLoading } = useQuery({
    queryKey: ["tmdb-person", id],
    queryFn: () => fetchTmdbPersonFn({ data: { person_id: id } }),
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24 * 7,
  });

  const profileUrl = person?.profile_path ? profile(person.profile_path, "h632") : null;

  return (
    <div className="min-h-screen pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/50 bg-background/90 px-4 py-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-sm font-medium text-foreground active:opacity-60"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
      </div>

      {isLoading ? (
        <div className="px-5 pt-6">
          <div className="flex gap-4">
            <div className="aspect-square w-32 shrink-0 animate-pulse rounded-2xl bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
          <div className="mt-6 h-24 animate-pulse rounded-2xl bg-muted" />
        </div>
      ) : !person ? (
        <div className="px-5 pt-12 text-center">
          <p className="text-sm text-muted-foreground">Could not load cast details.</p>
        </div>
      ) : (
        <div className="px-5 pt-6">
          {/* Profile header */}
          <div className="flex gap-4">
            <div className="aspect-square w-32 shrink-0 overflow-hidden rounded-2xl bg-muted ring-1 ring-black/5">
              {profileUrl ? (
                <img
                  src={profileUrl}
                  alt={person.name}
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <User className="h-10 w-10" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-[22px] font-bold leading-tight tracking-tight text-foreground">
                {person.name}
              </h1>
              {person.known_for_department && (
                <p className="mt-1 text-[13px] text-muted-foreground">{person.known_for_department}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {person.birthday && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {formatDate(person.birthday)}
                  </span>
                )}
                {person.deathday && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-muted-foreground">
                    Died {formatDate(person.deathday)}
                  </span>
                )}
                {person.place_of_birth && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {person.place_of_birth}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Biography */}
          {person.biography && (
            <section className="mt-6">
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Biography
              </h2>
              <p className="rounded-2xl bg-card px-4 py-3 text-[14px] leading-relaxed text-foreground shadow-sm">
                {person.biography}
              </p>
            </section>
          )}

          {/* Filmography */}
          {person.credits.length > 0 && (
            <section className="mt-6 -mx-5">
              <div className="mb-2 flex items-center justify-between px-6">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Filmography
                </h2>
                <span className="text-[11px] tabular-nums text-muted-foreground">{person.credits.length}</span>
              </div>
              <div className="flex gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {person.credits.map((c) => {
                  const img = poster(c.poster_path, "w342");
                  return (
                    <a
                      key={`${c.id}-${c.type}`}
                      href={`https://www.themoviedb.org/${c.type}/${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="group w-28 shrink-0 active:opacity-60"
                    >
                      <div className="aspect-[2/3] w-28 overflow-hidden rounded-2xl bg-muted ring-1 ring-black/5">
                        {img ? (
                          <img
                            src={img}
                            alt={c.title}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                            {c.type === "movie" ? <Film className="h-6 w-6" /> : <Tv className="h-6 w-6" />}
                          </div>
                        )}
                      </div>
                      <p className="mt-2 line-clamp-2 text-[12px] font-semibold leading-tight text-foreground">
                        {c.title}
                      </p>
                      {c.character && (
                        <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{c.character}</p>
                      )}
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        {c.release_date && <span>{c.release_date.slice(0, 4)}</span>}
                        {c.vote_average != null && c.vote_average > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-300">
                            <Star className="h-3 w-3 fill-current" />
                            {c.vote_average.toFixed(1)}
                          </span>
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

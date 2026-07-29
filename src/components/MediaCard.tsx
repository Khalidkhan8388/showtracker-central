import { Film, Tv, Star, Check } from "lucide-react";
import type { LocalMedia } from "@/lib/local-db";
import { poster, backdrop, WATCH_COLORS, WATCH_LABEL, totalEpisodes, watchedCount } from "@/lib/media";

type Variant = "grid" | "row" | "hero";

export function MediaCard({
  media,
  selectMode,
  selected,
  pinned,
  variant = "grid",
}: {
  media: LocalMedia;
  selectMode?: boolean;
  selected?: boolean;
  pinned?: boolean;
  variant?: Variant;
}) {
  const isTv = media.type === "tv";
  const year = media.release_date ? media.release_date.slice(0, 4) : null;
  const total = totalEpisodes(media);
  const done = watchedCount(media);

  if (variant === "hero") {
    return (
      <HeroMedia
        media={media}
        isTv={isTv}
        year={year}
        total={total}
        done={done}
        selectMode={selectMode}
        selected={selected}
        pinned={pinned}
      />
    );
  }

  const src = poster(media.poster_path, "w342");
  const isRow = variant === "row";

  return (
    <div
      className={`relative block h-full w-full overflow-hidden rounded-[15px] bg-neutral-900 text-white shadow-sm ring-1 ring-black/10 transition-transform duration-200 active:scale-[0.97] ${
        selected ? "ring-2 ring-foreground" : ""
      }`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-950">
          {isTv ? <Tv className="h-10 w-10 text-white/40" /> : <Film className="h-10 w-10 text-white/40" />}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 scrim-t" />

      <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
          {isTv ? <Tv className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
          {isTv ? "TV" : "Movie"}
        </span>
      </div>

      {selectMode ? (
        <div className="absolute right-2 top-2 z-10">
          {selected ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-[7px] bg-white text-black ring-2 ring-white">
              <Check className="h-3 w-3" strokeWidth={3} />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-[7px] bg-black/40 ring-2 ring-white/70" />
          )}
        </div>
      ) : (
        pinned && (
          <div className="absolute right-2 top-2 z-10">
            <div className="rounded-full bg-black/55 p-1 backdrop-blur-sm">
              <div className="h-1.5 w-1.5 rounded-full bg-white" />
            </div>
          </div>
        )
      )}

      <div className={`absolute inset-x-0 bottom-0 z-10 scrim-t p-2.5 pt-8 text-left ${isRow ? "text-[11px]" : "text-[12px]"}`}>
        {media.watch_status && (
          <span className={`mb-1 inline-flex self-start rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shadow-sm ${WATCH_COLORS[media.watch_status]}`}>
            {WATCH_LABEL[media.watch_status]}
          </span>
        )}
        <p className="line-clamp-2 text-left text-[13px] font-semibold leading-tight scrim-fg">{media.title}</p>

        <div className="mt-1 flex items-center gap-2 text-[10px] scrim-fg-80">
          {year && <span>{year}</span>}
          {media.vote_average != null && media.vote_average > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
              {media.vote_average.toFixed(1)}
            </span>
          )}
        </div>
        {isTv && total > 0 && (
          <div className="mt-1.5">
            <div className="flex items-center justify-between text-[10px] font-medium scrim-fg-80">
              <span>{done}/{total} ep</span>
              <span>{Math.round((done / total) * 100)}%</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full scrim-track">
              <div className="h-full rounded-full scrim-fill" style={{ width: `${Math.round((done / total) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

function HeroMedia({
  media,
  isTv,
  year,
  total,
  done,
  selectMode,
  selected,
  pinned,
}: {
  media: LocalMedia;
  isTv: boolean;
  year: string | null;
  total: number;
  done: number;
  selectMode?: boolean;
  selected?: boolean;
  pinned?: boolean;
}) {
  const posterSrc = poster(media.poster_path, "w342");
  const backSrc = backdrop(media.backdrop_path, "w780");
  const progressPct = isTv && total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      className={`relative block w-full overflow-hidden rounded-[20px] bg-neutral-900 shadow-sm ring-1 ring-black/10 transition-transform duration-200 active:scale-[0.985] scrim-fg ${
        selected ? "ring-2 ring-foreground" : ""
      }`}
    >
      {/* backdrop bg */}
      <div className="absolute inset-0">
        {backSrc ? (
          <img
            src={backSrc}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover opacity-70"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : posterSrc ? (
          <img
            src={posterSrc}
            alt=""
            aria-hidden
            className="h-full w-full scale-110 object-cover opacity-40 blur-2xl"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : null}
        <div className="absolute inset-0 scrim-t-strong" />
      </div>

      {/* top badges */}
      <div className="relative z-10 flex items-start justify-between p-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
            {isTv ? <Tv className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
            {isTv ? "TV" : "Movie"}
          </span>
          {media.watch_status && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${WATCH_COLORS[media.watch_status]}`}>
              {WATCH_LABEL[media.watch_status]}
            </span>
          )}
        </div>
        {selectMode ? (
          selected ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-[7px] bg-white text-black ring-2 ring-white">
              <Check className="h-3 w-3" strokeWidth={3} />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-[7px] bg-black/40 ring-2 ring-white/70" />
          )
        ) : pinned ? (
          <div className="rounded-full bg-black/55 p-1 backdrop-blur-sm">
            <div className="h-1.5 w-1.5 rounded-full bg-white" />
          </div>
        ) : null}
      </div>

      {/* body: poster + info */}
      <div className="relative z-10 flex gap-3 px-3 pb-3 pt-1">
        <div className="relative aspect-[2/3] w-[92px] shrink-0 overflow-hidden rounded-[12px] bg-neutral-800 shadow-lg ring-1 ring-white/10">
          {posterSrc ? (
            <img
              src={posterSrc}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              {isTv ? <Tv className="h-8 w-8 text-white/40" /> : <Film className="h-8 w-8 text-white/40" />}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="line-clamp-2 text-[17px] font-bold leading-tight scrim-fg">{media.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] scrim-fg-70">
            {year && <span>{year}</span>}
            {media.vote_average != null && media.vote_average > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                <span className="font-semibold scrim-fg">{media.vote_average.toFixed(1)}</span>
              </span>
            )}
            {isTv && total > 0 && (
              <span className="font-medium scrim-fg-80">{done}/{total} ep</span>
            )}
          </div>

          {media.overview && (
            <p className="mt-2 line-clamp-4 text-[12px] leading-snug scrim-fg-80">
              {media.overview}
            </p>
          )}

          {isTv && total > 0 && (
            <div className="mt-2.5">
              <div className="h-1 w-full overflow-hidden rounded-full scrim-track">
                <div
                  className="h-full rounded-full scrim-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

}

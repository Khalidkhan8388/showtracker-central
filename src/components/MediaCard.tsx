import { Film, Tv, Star, Check } from "lucide-react";
import type { LocalMedia } from "@/lib/local-db";
import { poster, WATCH_COLORS, WATCH_LABEL, totalEpisodes, watchedCount } from "@/lib/media";

type Variant = "grid" | "row";

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
  const src = poster(media.poster_path, "w342");
  const year = media.release_date ? media.release_date.slice(0, 4) : null;
  const isTv = media.type === "tv";
  const total = totalEpisodes(media);
  const done = watchedCount(media);
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
          alt={media.title}
          loading="lazy"
          decoding="async"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-950">
          {isTv ? <Tv className="h-10 w-10 text-white/40" /> : <Film className="h-10 w-10 text-white/40" />}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

      {/* top-left type + status */}
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
          {isTv ? <Tv className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
          {isTv ? "TV" : "Movie"}
        </span>
        {media.watch_status && (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${WATCH_COLORS[media.watch_status]}`}>
            {WATCH_LABEL[media.watch_status]}
          </span>
        )}
      </div>

      {/* top-right selection / pin */}
      {selectMode ? (
        <div className="absolute right-2 top-2 z-10">
          {selected ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-black ring-2 ring-white">
              <Check className="h-3 w-3" strokeWidth={3} />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full bg-black/40 ring-2 ring-white/70" />
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

      {/* bottom info */}
      <div className={`absolute inset-x-0 bottom-0 z-10 p-3 ${isRow ? "text-[11px]" : "text-[12px]"}`}>
        <p className="line-clamp-2 text-[13px] font-semibold leading-tight">{media.title}</p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-white/80">
          {year && <span>{year}</span>}
          {media.vote_average != null && media.vote_average > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
              {media.vote_average.toFixed(1)}
            </span>
          )}
          {isTv && total > 0 && (
            <span>
              {done}/{total} ep
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

import { memo, useState } from "react";
import { Play, CheckCircle2, Pin, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatYtDuration, youtubeThumb } from "@/lib/youtube";
import type { LocalYouTube } from "@/lib/local-db";
import { useTheme } from "@/lib/theme";

type Note = {
  id: string;
  heading: string | null;
  summary: string | null;
  created_at: string;
  pinned: boolean;
  tasks: Array<{ id: string; text: string; done: boolean }> | null;
  youtube?: LocalYouTube | null;
};

export type YouTubeCardVariant = "grid" | "row" | "hero" | "compact";

function ChannelBadge({ name }: { name: string | null }) {
  const initial = (name?.trim() ?? "?").slice(0, 1).toUpperCase();
  return (
    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[9px] font-bold text-white dark:bg-white dark:text-neutral-900">
      {initial}
    </div>
  );
}

function PlayGlyph({ small = false }: { small?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-[#FF0033] text-white shadow-lg ${
        small ? "h-7 w-7" : "h-10 w-10"
      }`}
    >
      <Play className={small ? "h-3 w-3 fill-white" : "h-4 w-4 fill-white"} strokeWidth={0} />
    </div>
  );
}

const QUALITIES: Array<"max" | "mq" | "hq"> = ["max", "mq", "hq"];

function YouTubeThumbImg({
  videoId,
  alt,
  className,
}: {
  videoId: string;
  alt?: string;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const url = youtubeThumb(videoId, QUALITIES[index]);
  return (
    <img
      src={url}
      alt={alt ?? ""}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => {
        if (index < QUALITIES.length - 1) setIndex((i) => i + 1);
      }}
    />
  );
}

export const YouTubeCard = memo(function YouTubeCard({
  note,
  variant,
  selectMode = false,
  selected = false,
}: {
  note: Note;
  variant: YouTubeCardVariant;
  selectMode?: boolean;
  selected?: boolean;
}) {
  const yt = note.youtube!;
  const { isDark } = useTheme();
  const thumb = yt.thumbnail_url ?? `https://i.ytimg.com/vi/${yt.video_id}/hqdefault.jpg`;
  const duration = formatYtDuration(yt.duration_seconds);
  const channel = yt.channel_name ?? "YouTube";
  const title = note.heading ?? yt.title ?? "YouTube video";

  const bg = isDark ? "#1c1c1e" : "#ffffff";
  const ring = selected ? "ring-2 ring-foreground" : "";
  const cardCls = `relative flex w-full overflow-hidden rounded-[15px] ${ring}`;

  const Overlay = () => (
    <>
      {selectMode && (
        <div className="absolute right-2 top-2 z-20">
          {selected ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground ring-2 ring-background">
              <Check className="h-3 w-3 text-background" strokeWidth={3} />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full bg-background ring-2 ring-background shadow-sm border border-muted-foreground/40" />
          )}
        </div>
      )}
      {note.pinned && !selectMode && (
        <div className="absolute right-2 top-2 z-20 text-foreground">
          <Pin className="h-3.5 w-3.5 fill-foreground" />
        </div>
      )}
    </>
  );

  const Thumb = ({ big = true }: { big?: boolean }) => (
    <div className="relative w-full overflow-hidden bg-black">
      <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
        <img
          src={thumb}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            const el = e.currentTarget;
            if (!el.src.includes("hqdefault")) el.src = `https://i.ytimg.com/vi/${yt.video_id}/hqdefault.jpg`;
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center">
          <PlayGlyph small={!big} />
        </div>
        {duration && (
          <div className="absolute bottom-1.5 right-1.5 rounded-md bg-black/85 px-1 py-0.5 text-[9px] font-semibold tabular-nums text-white">
            {duration}
          </div>
        )}
        <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md bg-black/70 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
          <span className="text-[#FF0033]">▶</span> YouTube
        </div>
      </div>
    </div>
  );

  if (variant === "compact") {
    return (
      <div className={cardCls} style={{ backgroundColor: bg }}>
        <Overlay />
        <Thumb big={false} />
        <div className="flex flex-col gap-0.5 p-2">
          <h3 className="text-[11.5px] font-semibold leading-snug line-clamp-2 text-foreground">
            {title}
          </h3>
          <div className="flex items-center gap-1">
            <ChannelBadge name={channel} />
            <span className="truncate text-[10px] text-muted-foreground">{channel}</span>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "row") {
    return (
      <div className={cardCls} style={{ backgroundColor: bg }}>
        <Overlay />
        <div className="flex items-stretch gap-2 p-2">
          <div className="relative shrink-0 overflow-hidden rounded-lg bg-black" style={{ width: "38%", maxWidth: 160 }}>
            <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
              <img src={thumb} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center">
                <PlayGlyph small />
              </div>
              {duration && (
                <div className="absolute bottom-1 right-1 rounded bg-black/85 px-1 py-0.5 text-[8px] font-semibold tabular-nums text-white">
                  {duration}
                </div>
              )}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-[#FF0033]">
              <span>▶</span> YouTube
            </div>
            <h3 className="text-[12.5px] font-semibold leading-snug line-clamp-3 text-foreground">{title}</h3>
            <div className="mt-auto flex items-center gap-1 pt-0.5">
              <ChannelBadge name={channel} />
              <span className="truncate text-[10px] text-muted-foreground">{channel}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // "grid" & "hero" — compact horizontal row (thumbnail left, meta right)
  const isHero = variant === "hero";
  return (
    <div className={cardCls} style={{ backgroundColor: bg }}>
      <Overlay />
      <div className="flex items-stretch gap-2.5 p-2.5">
        <div className="relative shrink-0 overflow-hidden rounded-lg bg-black" style={{ width: isHero ? "44%" : "36%", maxWidth: isHero ? 200 : 150 }}>
          <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
            <img
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
              onError={(e) => {
                const el = e.currentTarget;
                if (!el.src.includes("hqdefault")) el.src = `https://i.ytimg.com/vi/${yt.video_id}/hqdefault.jpg`;
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <PlayGlyph small />
            </div>
            {duration && (
              <div className="absolute bottom-1 right-1 rounded bg-black/85 px-1 py-0.5 text-[8px] font-semibold tabular-nums text-white">
                {duration}
              </div>
            )}
            <div className="absolute left-1 top-1 flex items-center gap-1 rounded-md bg-black/70 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
              <span className="text-[#FF0033]">▶</span> YouTube
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-[#FF0033]">
            <span>▶</span> YouTube
          </div>
          <h3 className={`font-semibold leading-snug text-foreground ${isHero ? "text-[13.5px] line-clamp-3" : "text-[12px] line-clamp-2"}`}>
            {title}
          </h3>
          <div className="flex items-center gap-1">
            <ChannelBadge name={channel} />
            <span className="truncate text-[10px] text-muted-foreground">{channel}</span>
          </div>
          {note.summary && isHero && (
            <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{note.summary}</p>
          )}
          <div className="mt-auto flex items-center gap-2 pt-0.5 text-[9px] text-muted-foreground">
            <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
            {yt.captions_available && <span className="rounded bg-muted px-1 py-0.5 font-medium">CC</span>}
            {note.tasks && note.tasks.length > 0 && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {note.tasks.filter((t) => t.done).length}/{note.tasks.length}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

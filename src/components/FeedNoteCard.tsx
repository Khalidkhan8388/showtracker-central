import { memo } from "react";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Pin, Link2, Mic, Image as ImageIcon, Check } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { MediaCard } from "@/components/MediaCard";
import { useTheme } from "@/lib/theme";
import { AnalyzingBadge, useLongPress, formatDur } from "@/components/NoteCard";
import type { LocalMedia } from "@/lib/local-db";

export type FeedNote = {
  id: string;
  status: "recording" | "uploaded" | "transcribing" | "processing" | "ready" | "failed";
  heading: string | null;
  summary: string | null;
  tasks: Array<{ id: string; text: string; done: boolean; pinned?: boolean; pending?: boolean }> | null;
  duration_seconds: number | null;
  created_at: string;
  pinned: boolean;
  image_paths: string[] | null;
  source_url: string | null;
  transcript: string | null;
  media?: LocalMedia | null;
};

export type FeedNoteVariant = "wide" | "square" | "hero" | "masonry";

function VoiceWaveform({ seed, bars = 36 }: { seed: string; bars?: number }) {
  // Deterministic pseudo-random heights from the note id so each card is unique but stable.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const heights: number[] = [];
  for (let i = 0; i < bars; i++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    const n = ((h >>> 0) % 1000) / 1000;
    // Envelope: emphasize center for a natural voice shape.
    const t = i / (bars - 1);
    const env = 0.55 + 0.45 * Math.sin(Math.PI * t);
    heights.push(Math.max(0.18, Math.min(1, n * env + 0.15)));
  }
  return (
    <div className="flex h-9 w-full items-center gap-[2px]">
      {heights.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-full bg-foreground/70"
          style={{ height: `${Math.round(v * 100)}%` }}
        />
      ))}
    </div>
  );
}

export const FeedNoteCard = memo(function FeedNoteCard({
  note,
  variant,
  fullWidth,
  thumbUrl,
  selected = false,
  selectMode = false,
  onOpen,
  onLongPress,
  onToggleSel,
}: {
  note: FeedNote;
  variant: FeedNoteVariant;
  fullWidth?: boolean;
  thumbUrl?: string;
  selected?: boolean;
  selectMode?: boolean;
  onOpen: () => void;
  onLongPress?: () => void;
  onToggleSel?: () => void;
}) {
  const lp = useLongPress(onLongPress ?? (() => {}));
  const handleClick = (e: React.MouseEvent) => {
    if (lp.wasLongPress()) {
      e.preventDefault();
      return;
    }
    if (selectMode) {
      e.preventDefault();
      onToggleSel?.();
      return;
    }
    onOpen();
  };

  // Media (movie / TV) short-circuit — dedicated card, no shared chrome.
  const media = (note as any).media as LocalMedia | null | undefined;
  if (media) {
    const isHeroV = variant === "hero";
    const sizing = isHeroV
      ? "w-full"
      : variant === "wide"
        ? "aspect-[16/9] w-full"
        : variant === "masonry"
          ? "aspect-[2/3] w-full"
          : fullWidth
            ? "aspect-square w-full"
            : "aspect-[2/3] w-40 shrink-0";
    const mediaVariant = isHeroV ? "hero" : variant === "masonry" ? "grid" : "row";
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        {...lp.handlers}
        className={`${sizing} cursor-pointer select-none`}
      >
        <MediaCard media={media} selectMode={selectMode} selected={selected} pinned={note.pinned} variant={mediaVariant} />
      </div>
    );
  }

  const imageCount = Array.isArray(note.image_paths) ? note.image_paths.length : 0;
  const hasImage = imageCount > 0 && !!thumbUrl;
  const isVoice = note.duration_seconds != null;
  const isText = !isVoice && note.transcript != null;
  const isLink = !!note.source_url && !isText;
  const linkHost = (() => {
    if (!note.source_url) return null;
    try { return new URL(note.source_url).hostname.replace(/^www\./, ""); } catch { return null; }
  })();

  const { isDark } = useTheme();

  const isHero = variant === "hero";
  const isMasonry = variant === "masonry";
  const isWideLike = variant === "wide" || isHero;
  const isSquareLike = variant === "square" || isMasonry;

  const isLinkTile = isLink && hasImage && !isWideLike;
  const isVoiceTile = isVoice && !hasImage && !isWideLike;
  const base = isText
    ? "relative block overflow-hidden rounded-[15px] p-4 transition-all " +
      (selected ? "ring-2 ring-foreground" : "")
    : isVoiceTile
      ? "relative block overflow-hidden rounded-[15px] p-4 transition-all " +
        (selected ? "ring-2 ring-foreground" : "")
      : isHero
        ? "relative block overflow-hidden rounded-[15px] border border-border/60 bg-card p-6 shadow-sm transition-all " +
          (selected ? "ring-2 ring-foreground" : "")
        : isLinkTile
          ? "relative block overflow-hidden rounded-[15px] transition-all " +
            (selected ? "ring-2 ring-foreground" : "")
          : "relative block overflow-hidden rounded-[15px] border border-border/60 p-3 transition-colors " +
            (selected
              ? "border-foreground bg-muted shadow-sm"
              : "bg-card hover:bg-muted/50");

  let sizing: string;
  if (isHero) {
    sizing = "";
  } else if (variant === "wide") {
    sizing = isText ? "p-5" : "p-4";
  } else if (isMasonry) {
    sizing = isLinkTile
      ? "flex w-full flex-col"
      : isVoiceTile
        ? "flex w-full flex-col gap-2 min-h-[9rem]"
        : hasImage && !isText
          ? "flex aspect-[4/5] w-full flex-col gap-2"
          : isText
            ? "flex w-full flex-col gap-2"
            : "flex w-full flex-col gap-3 min-h-[7rem]";
  } else if (fullWidth) {
    sizing = isLinkTile
      ? "flex w-full flex-col"
      : isVoiceTile
        ? "flex aspect-square w-full flex-col gap-2"
        : "flex aspect-square w-full flex-col gap-3";
  } else {
    sizing = isVoiceTile
      ? "flex aspect-square w-40 shrink-0 flex-col gap-2"
      : "flex aspect-square w-40 shrink-0 flex-col gap-3";
  }

  const textNoteStyle: React.CSSProperties | undefined = isText
    ? { backgroundColor: isDark ? "#1c1c1e" : "#ffffff" }
    : isVoiceTile
      ? { backgroundColor: isDark ? "#1c1c1e" : "#ffffff" }
      : isLinkTile
        ? { backgroundColor: isDark ? "#1c1c1e" : "#ffffff" }
        : undefined;

  const isProcessing = note.status !== "ready" && note.status !== "failed";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      {...lp.handlers}
      style={textNoteStyle}
      className={`${base} ${sizing} cursor-pointer select-none transition-transform duration-200 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${isProcessing ? "analyzing-shimmer" : ""}`}
    >
      {/* Image-forward tile: image fills the card as background */}
      {isSquareLike && hasImage && !isLink && !isText && (
        <>
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 scrim-t" />
          {imageCount > 1 && (
            <div className="absolute left-2 top-2 z-10 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              +{imageCount - 1}
            </div>
          )}
        </>
      )}

      {selectMode && (
        <div className="absolute right-2 top-2 z-10">
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
        <div className="absolute right-2 top-2 z-10 text-muted-foreground">
          <Pin className="h-3.5 w-3.5 fill-foreground text-foreground" />
        </div>
      )}

      {isVoiceTile ? (
        <>
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mic className="h-3 w-3" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">Voice</span>
            </div>
            {note.duration_seconds != null && (
              <span className="tabular-nums text-[10px] text-muted-foreground">
                {formatDur(note.duration_seconds)}
              </span>
            )}
          </div>
          <h3 className="relative z-10 mt-3 font-serif text-[15px] leading-snug font-medium tracking-tight break-words line-clamp-2 text-foreground pr-5">
            {note.heading ?? (note.status === "failed" ? "Failed" : <AnalyzingBadge />)}
          </h3>
          <div className="relative z-10 mt-auto flex flex-col gap-3">
            <VoiceWaveform seed={note.id} />
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
            </span>
          </div>
        </>
      ) : isLinkTile ? (

        <>
          <div className="relative w-full bg-white dark:bg-white/95">
            <img
              src={thumbUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="block h-auto max-h-72 w-full object-contain"
            />
            {linkHost && (
              <div className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
                {linkHost}
              </div>
            )}
          </div>
          <div className={`flex flex-col gap-2 p-4 ${isDark ? "text-white" : "text-neutral-900"}`}>
            <h3 className="text-[15px] font-semibold leading-snug break-words line-clamp-3 pr-5">
              {note.heading ?? (note.status === "failed" ? "Failed" : <AnalyzingBadge />)}
            </h3>
            {note.summary && (
              <p className={`text-[12.5px] leading-snug line-clamp-2 ${isDark ? "text-white/70" : "text-neutral-500"}`}>
                {note.summary}
              </p>
            )}
            <div className={`mt-1 flex items-center gap-2 text-[11px] ${isDark ? "text-white/60" : "text-neutral-500"}`}>
              <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
              {note.tasks && note.tasks.length > 0 && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {note.tasks.filter((t) => t.done).length}/{note.tasks.length}
                </span>
              )}
            </div>
          </div>
        </>
      ) : isWideLike ? (
        <div className="flex items-start gap-4">
          {!isLink && hasImage && (
            <img
              src={thumbUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className={
                isHero
                  ? "h-24 w-24 shrink-0 rounded-2xl object-cover ring-1 ring-border"
                  : "h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-border"
              }
            />
          )}
          <div className="min-w-0 flex-1">
            {isHero ? (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Latest
                </span>
                {isLink && linkHost && (
                  <span className="inline-block rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background">
                    {linkHost}
                  </span>
                )}
              </div>
            ) : (
              isLink && linkHost && (
                <div className="mb-1.5">
                  <span className="inline-block rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background">
                    {linkHost}
                  </span>
                </div>
              )
            )}
            <div className="flex items-center gap-2 pr-6">
              <h3
                className={
                  isHero
                    ? "font-serif text-[24px] font-normal leading-[1.15] tracking-tight text-foreground line-clamp-3"
                    : "truncate text-sm font-semibold"
                }
              >
                {note.heading ?? (note.status === "failed" ? "Failed to process" : <AnalyzingBadge />)}
              </h3>
            </div>
            {note.summary && (
              <p className={`${isHero ? "mt-2 text-[13px]" : "mt-1 text-xs"} line-clamp-2 text-muted-foreground`}>{note.summary}</p>
            )}
            <div className={`${isHero ? "mt-3" : "mt-2"} flex items-center gap-3 text-[11px] text-muted-foreground`}>
              <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
              {note.duration_seconds != null && <span>{formatDur(note.duration_seconds)}</span>}
              {note.tasks && note.tasks.length > 0 && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {note.tasks.filter((t) => t.done).length}/{note.tasks.length}
                </span>
              )}
              {imageCount > 0 && !isLink && (
                <span className="flex items-center gap-1"><ImageIcon className="h-3 w-3" />{imageCount}</span>
              )}
            </div>
          </div>
        </div>
      ) : isText ? (
        <>
          <div className="relative z-10">
            <h3 className="font-serif text-[16px] leading-snug font-medium tracking-tight break-words line-clamp-2 text-foreground">
              {note.heading ?? (note.status === "failed" ? "Failed" : <AnalyzingBadge />)}
            </h3>
          </div>
          {note.transcript && (
            <div className="relative z-10 overflow-hidden text-foreground/70 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" style={{ maxHeight: hasImage ? "9rem" : "12rem" }}>
              <Markdown className="!text-[12.5px] !leading-snug [&_ul]:!pl-4 [&_ol]:!pl-4 [&_h1]:!text-[14px] [&_h1]:!mt-0 [&_h1]:!mb-1 [&_h2]:!text-[13px] [&_h2]:!mt-1 [&_h2]:!mb-1 [&_h3]:!text-[12px] [&_h3]:!mt-1 [&_h3]:!mb-0.5 [&_p]:!my-1 [&_ul]:!my-1 [&_ol]:!my-1 [&_img]:!my-1.5 [&_img]:!rounded-lg [&_img]:!w-full [&_img]:!max-h-24 [&_img]:!object-cover [&_pre]:hidden [&_hr]:hidden">
                {note.transcript}
              </Markdown>
            </div>
          )}
        </>
      ) : (
        <>
          {isLink && linkHost && (
            <div className="relative z-10 flex items-center gap-1.5 text-muted-foreground">
              <Link2 className="h-3 w-3 shrink-0" />
              <span className="truncate text-[10px] font-medium uppercase tracking-wide">
                {linkHost}
              </span>
            </div>
          )}
          {isVoice && !hasImage && (
            <div className="relative z-10 flex items-center gap-1.5 text-muted-foreground">
              <Mic className="h-3 w-3 shrink-0" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Voice</span>
            </div>
          )}
          {!(hasImage && !isLink) && (
            <div className="relative z-10 flex items-start gap-1.5 pr-5">
              <h3 className="text-[13px] font-semibold leading-snug break-words line-clamp-3 text-foreground">
                {note.heading ?? (note.status === "failed" ? "Failed" : <AnalyzingBadge />)}
              </h3>
            </div>
          )}
          {!(hasImage && !isLink) && note.summary && (
            <p className="relative z-10 text-[11px] leading-snug text-muted-foreground line-clamp-2">
              {note.summary}
            </p>
          )}

          <div
            className={`relative z-10 mt-auto flex flex-col gap-1 text-[10px] ${
              hasImage && !isLink ? "scrim-fg-80" : "text-muted-foreground"
            }`}
          >
            {hasImage && !isLink && (
              <h3 className="text-[13px] font-semibold leading-tight break-words scrim-fg line-clamp-3 pr-5">
                {note.heading ?? (note.status === "failed" ? "Failed" : <AnalyzingBadge />)}
              </h3>
            )}

            {note.tasks && note.tasks.length > 0 && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {note.tasks.filter((t) => t.done).length}/{note.tasks.length} tasks
              </span>
            )}
            <div className="flex items-center gap-2">
              <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
              {note.duration_seconds != null && (
                <span className="tabular-nums">{formatDur(note.duration_seconds)}</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

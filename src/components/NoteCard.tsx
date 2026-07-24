import { memo, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Loader2, AlertCircle, Pin, Link2, Mic, Image as ImageIcon, Check } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { useTheme } from "@/lib/theme";

export type Note = {
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
  deleted_at?: string | null;
};

export function AnalyzingBadge({ label = "Analyzing", className = "" }: { label?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span>{label}</span>
      <span className="inline-flex gap-0.5">
        <span className="analyzing-dot inline-block h-1 w-1 rounded-full bg-current" />
        <span className="analyzing-dot inline-block h-1 w-1 rounded-full bg-current" />
        <span className="analyzing-dot inline-block h-1 w-1 rounded-full bg-current" />
      </span>
    </span>
  );
}

export function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggered = useRef(false);
  const start = () => {
    triggered.current = false;
    timer.current = setTimeout(() => {
      triggered.current = true;
      onLongPress();
    }, ms);
  };
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    handlers: {
      onPointerDown: start,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
    wasLongPress: () => triggered.current,
  };
}

export function StatusIcon({ status }: { status: Note["status"] }) {
  if (status === "ready") return <CheckCircle2 className="h-3.5 w-3.5 text-foreground" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
}

export function formatDur(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export const NoteCard = memo(function NoteCard({
  note,
  variant,
  fullWidth,
  thumbUrl,
  selected,
  selectMode,
  onOpen,
  onLongPress,
  onToggleSel,
}: {
  note: Note;
  variant: "wide" | "square" | "hero" | "masonry";
  fullWidth?: boolean;
  thumbUrl?: string;
  selected: boolean;
  selectMode: boolean;
  onOpen: () => void;
  onLongPress: () => void;
  onToggleSel: () => void;
}) {
  const lp = useLongPress(onLongPress);
  const handleClick = (e: React.MouseEvent) => {
    if (lp.wasLongPress()) {
      e.preventDefault();
      return;
    }
    if (selectMode) {
      e.preventDefault();
      onToggleSel();
      return;
    }
    onOpen();
  };

  const imageCount = Array.isArray(note.image_paths) ? note.image_paths.length : 0;
  const isVoice = note.duration_seconds != null;
  const isText = !isVoice && note.transcript != null;
  const isLink = !!note.source_url && !isText;
  // Body-embedded image: first ![](...) in transcript. Lets text notes render
  // an image hero (like image notes) even when image_paths is empty.
  const bodyImageMatch = !thumbUrl && note.transcript
    ? note.transcript.match(/!\[[^\]]*\]\(([^)\s]+)\)/)
    : null;
  const bodyImageUrl = bodyImageMatch?.[1];
  const effectiveThumb = thumbUrl || bodyImageUrl;
  const hasImage = !!effectiveThumb && (imageCount > 0 || !!bodyImageUrl);
  // Strip the leading image (and any adjacent images) from body preview so it
  // isn't duplicated once we render the hero thumbnail.
  const previewBody = bodyImageUrl && note.transcript
    ? note.transcript.replace(/!\[[^\]]*\]\([^)\s]+\)/g, "").trim()
    : note.transcript;
  const linkHost = (() => {
    if (!note.source_url) return null;
    try { return new URL(note.source_url).hostname.replace(/^www\./, ""); } catch { return null; }
  })();

  const { isDark } = useTheme();
  const mymindTintsLight = [
    "#FFF4E0", "#E8F1E4", "#E4EEF7", "#F3E8F0", "#F6EFE1", "#EAEBF6", "#FBE9E2",
  ];
  const mymindTintsDark = [
    "#2A241A", "#1E2A22", "#1B2530", "#2A1F27", "#2A2418", "#22222E", "#2C1F1A",
  ];
  const mymindTints = isDark ? mymindTintsDark : mymindTintsLight;
  const tintIdx = (() => {
    let h = 0;
    for (let i = 0; i < note.id.length; i++) h = (h * 31 + note.id.charCodeAt(i)) >>> 0;
    return h % mymindTints.length;
  })();

  const isHero = variant === "hero";
  const isMasonry = variant === "masonry";
  const isWideLike = variant === "wide" || isHero;
  const isSquareLike = variant === "square" || isMasonry;

  const useTint = false;
  const tintBg = useTint ? mymindTints[tintIdx] : undefined;

  const base = isText
    ? "relative block overflow-hidden rounded-[15px] p-4 transition-all " +
      (selected ? "ring-2 ring-foreground" : "")
    : isHero
      ? "relative block overflow-hidden rounded-[15px] border border-border/60 bg-card p-6 shadow-sm transition-all " +
        (selected ? "ring-2 ring-foreground" : "")
      : useTint
        ? "relative block overflow-hidden rounded-[15px] p-4 transition-all " +
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
    sizing = hasImage && !isLink
      ? "flex aspect-[4/5] w-full flex-col gap-2"
      : "flex w-full flex-col gap-3 min-h-[7rem]";
  } else if (fullWidth) {
    sizing = "flex aspect-square w-full flex-col gap-3";
  } else {
    sizing = "flex aspect-square w-40 shrink-0 flex-col gap-3";
  }

  const textNoteStyle: React.CSSProperties | undefined = isText
    ? { backgroundColor: isDark ? "#1c1c1e" : "#ffffff" }
    : tintBg
      ? { backgroundColor: tintBg }
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
      {isSquareLike && hasImage && !isLink && (
        <>
          <img
            src={effectiveThumb}
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
      {isWideLike ? (
        <div className="flex items-start gap-4">
          {!isLink && hasImage && (
            <img
              src={effectiveThumb}
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
          {hasImage && (
            <div className="relative z-10 -mx-1 overflow-hidden rounded-xl ring-1 ring-black/[0.06]">
              <img
                src={effectiveThumb}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-40 w-full object-cover"
              />
              {imageCount > 1 && (
                <div className="absolute right-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                  +{imageCount - 1}
                </div>
              )}
            </div>
          )}
          <div className="relative z-10 flex items-start gap-1.5 pr-5">
            <h3 className="font-serif text-[15px] leading-snug font-medium tracking-tight break-words line-clamp-2 text-foreground">
              {note.heading ?? (note.status === "failed" ? "Failed" : <AnalyzingBadge />)}
            </h3>
          </div>
          {previewBody && (
            <div className="relative z-10 overflow-hidden text-foreground/70 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" style={{ maxHeight: hasImage ? "6rem" : "16rem" }}>
              <Markdown className="!text-[12px] !leading-snug [&_h1]:!text-[14px] [&_h1]:!mt-0 [&_h1]:!mb-1 [&_h2]:!text-[13px] [&_h2]:!mt-1 [&_h2]:!mb-1 [&_h3]:!text-[12px] [&_h3]:!mt-1 [&_h3]:!mb-0.5 [&_p]:!my-1 [&_ul]:!my-1 [&_ol]:!my-1 [&_img]:!my-1 [&_img]:!rounded-lg [&_img]:!max-h-24 [&_img]:!w-auto [&_pre]:hidden [&_hr]:hidden">
                {previewBody}
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
              hasImage && !isLink ? "text-white/85" : "text-muted-foreground"
            }`}
          >
            {hasImage && !isLink && (
              <h3 className="text-[13px] font-semibold leading-tight break-words text-white drop-shadow line-clamp-3 pr-5">
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

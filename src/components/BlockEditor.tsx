import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

// Match either an image (!...) or a plain markdown link ([label](url)).
// Group 1 = "!" if image, empty for links; Group 2 = label; Group 3 = url.
export const MEDIA_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;

export type Block =
  | { kind: "text"; value: string }
  | { kind: "image"; src: string; raw: string; size: ImageSize; alt: string }
  | { kind: "link"; href: string; label: string; raw: string };

export type ImageSize = "small" | "medium" | "full" | number;

function parseImageLabel(label: string): { alt: string; size: ImageSize } {
  const parts = label.split("|");
  const alt = parts[0] ?? "";
  const rawSize = (parts[1] ?? "").trim().toLowerCase();
  let size: ImageSize = "full";
  if (rawSize === "small" || rawSize === "medium" || rawSize === "full") {
    size = rawSize as ImageSize;
  } else {
    const m = rawSize.match(/^(\d{1,3})%?$/);
    if (m) {
      size = Math.max(15, Math.min(100, parseInt(m[1]!, 10)));
    }
  }
  return { alt, size };
}

export function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let last = 0;
  const re = new RegExp(MEDIA_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const before = md.slice(last, m.index);
    blocks.push({ kind: "text", value: before });
    if (m[1] === "!") {
      const { alt, size } = parseImageLabel(m[2] ?? "");
      blocks.push({ kind: "image", src: m[3], raw: m[0], size, alt });
    } else {
      blocks.push({ kind: "link", href: m[3], label: m[2] || m[3], raw: m[0] });
    }
    last = m.index + m[0].length;
  }
  blocks.push({ kind: "text", value: md.slice(last) });
  return blocks;
}

export function serializeBlocks(blocks: Block[]): string {
  return blocks.map((b) => (b.kind === "text" ? b.value : b.raw)).join("");
}

export function faviconFor(href: string): string | null {
  try {
    const u = new URL(href);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
  } catch {
    return null;
  }
}

export function hostnameOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

function buildImageRaw(alt: string, size: ImageSize, src: string): string {
  const sizeStr = typeof size === "number" ? `${size}%` : size;
  const label = sizeStr === "full" ? alt : `${alt}|${sizeStr}`;
  return `![${label}](${src})`;
}

function widthFor(size: ImageSize): string {
  if (typeof size === "number") return `${size}%`;
  if (size === "small") return "40%";
  if (size === "medium") return "70%";
  return "100%";
}

export function BlockEditor({
  value,
  onChange,
  fullscreen,
  onRemoveImage,
  onRemoveLink,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  fullscreen?: boolean;
  onRemoveImage: (src: string) => void;
  onRemoveLink: (href: string) => void;
  placeholder?: string;
}) {
  const blocks = parseBlocks(value);
  const hasMedia = blocks.some((b) => b.kind !== "text");

  function updateTextBlock(idx: number, next: string) {
    const copy = blocks.slice();
    copy[idx] = { kind: "text", value: next };
    onChange(serializeBlocks(copy));
  }

  function updateImageSize(idx: number, size: ImageSize) {
    const copy = blocks.slice();
    const b = copy[idx];
    if (!b || b.kind !== "image") return;
    copy[idx] = { ...b, size, raw: buildImageRaw(b.alt, size, b.src) };
    onChange(serializeBlocks(copy));
  }

  function swapImages(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const copy = blocks.slice();
    const a = copy[fromIdx];
    const b = copy[toIdx];
    if (!a || !b || a.kind !== "image" || b.kind !== "image") return;
    // Auto-fit side-by-side if either is > 48%
    const shrink = (blk: Extract<Block, { kind: "image" }>) => {
      const w = typeof blk.size === "number" ? blk.size : blk.size === "small" ? 40 : blk.size === "medium" ? 70 : 100;
      if (w > 48) {
        const newSize: ImageSize = 48;
        return { ...blk, size: newSize, raw: buildImageRaw(blk.alt, newSize, blk.src) };
      }
      return blk;
    };
    copy[fromIdx] = shrink(b);
    copy[toIdx] = shrink(a);
    onChange(serializeBlocks(copy));
  }

  // Group consecutive image blocks (separated only by whitespace text) into rows
  const rendered: React.ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.kind === "image") {
      const group: { block: Extract<Block, { kind: "image" }>; idx: number }[] = [
        { block: b, idx: i },
      ];
      let j = i + 1;
      while (
        j + 1 < blocks.length &&
        blocks[j].kind === "text" &&
        !(blocks[j] as Extract<Block, { kind: "text" }>).value.trim() &&
        blocks[j + 1].kind === "image"
      ) {
        group.push({
          block: blocks[j + 1] as Extract<Block, { kind: "image" }>,
          idx: j + 1,
        });
        j += 2;
      }
      rendered.push(
        <div key={`row-${i}`} className="flex w-full flex-wrap items-start gap-2">
          {group.map(({ block, idx }) => (
            <ResizableImage
              key={`img-${idx}`}
              block={block}
              onResize={(size) => updateImageSize(idx, size)}
              onRemove={() => onRemoveImage(block.src)}
              onDropImage={(fromIdx) => swapImages(fromIdx, idx)}
              blockIndex={idx}
            />
          ))}
        </div>
      );
      i = j;
      continue;
    }
    if (b.kind === "link") {
      const loading = /^__linking_.*__$/.test(b.label);
      const favicon = faviconFor(b.href);
      const host = hostnameOf(b.href);
      rendered.push(
        <div
          key={`link-${i}`}
          className="group relative flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2"
        >
          {favicon ? (
            <img src={favicon} alt="" className="h-6 w-6 flex-shrink-0 rounded" />
          ) : (
            <div className="h-6 w-6 flex-shrink-0 rounded bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">
              {loading ? (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Fetching title…
                </span>
              ) : (
                b.label
              )}
            </div>
            <a
              href={b.href}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-xs text-muted-foreground hover:underline"
            >
              {host}
            </a>
          </div>
          <button
            type="button"
            onClick={() => onRemoveLink(b.href)}
            aria-label="Remove link"
            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-black/70 text-white shadow-lg"
          >
            <X className="h-3.5 w-3.5" strokeWidth={3} />
          </button>
        </div>
      );
      i += 1;
      continue;
    }
    const textIdx = i;
    rendered.push(
      <LineEditor
        key={`txt-${textIdx}`}
        value={b.value}
        onChange={(v) => updateTextBlock(textIdx, v)}
        placeholder={!hasMedia && textIdx === 0 ? placeholder ?? "" : ""}
      />
    );
    i += 1;
  }

  return (
    <div
      className={`w-full flex-1 space-y-2 overflow-y-auto bg-transparent px-1 ${
        fullscreen ? "min-h-0" : "min-h-[200px]"
      }`}
    >
      {rendered}
    </div>
  );
}

function ResizableImage({
  block,
  onResize,
  onRemove,
  onDropImage,
  blockIndex,
}: {
  block: Extract<Block, { kind: "image" }>;
  onResize: (size: ImageSize) => void;
  onRemove: () => void;
  onDropImage?: (fromIdx: number) => void;
  blockIndex?: number;
}) {
  const [dragOver, setDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ containerW: number } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const container = containerRef.current;
    if (!container) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { containerW: container.getBoundingClientRect().width };
    e.preventDefault();
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    const container = containerRef.current;
    if (!d || !container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.round(Math.max(15, Math.min(100, (x / d.containerW) * 100)));
    onResize(pct);
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    dragRef.current = null;
  }

  function clearHold() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }
  function onImgPointerDown() {
    clearHold();
    holdTimerRef.current = setTimeout(() => {
      setConfirmDelete(true);
      if (navigator.vibrate) navigator.vibrate(30);
    }, 500);
  }

  const currentWidth = widthFor(block.size);

  return (
    <div
      ref={containerRef}
      className={`group relative ${dragOver ? "ring-2 ring-primary rounded-xl" : ""}`}
      style={{ width: currentWidth, maxWidth: "100%" }}
      onDragOver={(e) => {
        if (onDropImage) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        const from = Number(e.dataTransfer.getData("text/block-index"));
        if (!Number.isNaN(from) && onDropImage) onDropImage(from);
      }}
    >
      <div className="relative w-full">
        <img
          src={block.src}
          alt={block.alt}
          className="h-auto w-full select-none rounded-xl"
          draggable={blockIndex !== undefined}
          onDragStart={(e) => {
            if (blockIndex !== undefined) {
              e.dataTransfer.setData("text/block-index", String(blockIndex));
              e.dataTransfer.effectAllowed = "move";
            }
          }}
          onPointerDown={onImgPointerDown}
          onPointerUp={clearHold}
          onPointerLeave={clearHold}
          onPointerCancel={clearHold}
        />
        <div
          role="slider"
          aria-label="Resize image"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute right-0 top-0 flex h-full w-4 -mr-2 cursor-ew-resize touch-none items-center justify-center"
          style={{ touchAction: "none" }}
        >
          <div className="h-12 w-1.5 rounded-full bg-black/70 shadow-lg ring-1 ring-white/30" />
        </div>
        {confirmDelete && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
            <div className="flex items-center gap-2 rounded-full bg-white p-1 shadow-xl">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  onRemove();
                }}
                className="rounded-full bg-red-500 px-3 py-1.5 text-sm font-semibold text-white"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function lineStyleFor(line: string): string {
  if (/^###\s/.test(line)) return "text-base font-semibold tracking-tight";
  if (/^##\s/.test(line)) return "text-lg font-semibold tracking-tight";
  if (/^#\s/.test(line)) return "text-2xl font-bold tracking-tight";
  if (/^>\s?/.test(line)) return "italic text-muted-foreground border-l-2 border-foreground/30 pl-3";
  if (/^\s*[-*]\s/.test(line)) return "text-[15px] text-foreground";
  return "text-[15px] text-foreground";
}

export function LineEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const lines = value.length === 0 ? [""] : value.split("\n");
  const refs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const focusPending = useRef<{ index: number; pos: number } | null>(null);

  useEffect(() => {
    refs.current.forEach((el) => {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
    const pending = focusPending.current;
    if (pending) {
      const el = refs.current[pending.index];
      if (el) {
        el.focus();
        const pos = Math.min(pending.pos, el.value.length);
        el.setSelectionRange(pos, pos);
      }
      focusPending.current = null;
    }
  }, [value]);

  function commit(nextLines: string[], focus?: { index: number; pos: number }) {
    if (focus) focusPending.current = focus;
    onChange(nextLines.join("\n"));
  }

  function updateLine(i: number, next: string) {
    const copy = lines.slice();
    copy[i] = next;
    commit(copy);
  }

  function onKey(i: number, e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const line = lines[i] ?? "";
      const before = line.slice(0, start);
      const after = line.slice(end);
      const copy = lines.slice();
      copy.splice(i, 1, before, after);
      commit(copy, { index: i + 1, pos: 0 });
    } else if (e.key === "Backspace" && start === 0 && end === 0 && i > 0) {
      e.preventDefault();
      const prev = lines[i - 1] ?? "";
      const cur = lines[i] ?? "";
      const copy = lines.slice();
      copy.splice(i - 1, 2, prev + cur);
      commit(copy, { index: i - 1, pos: prev.length });
    } else if (e.key === "ArrowUp" && i > 0) {
      const prev = refs.current[i - 1];
      if (prev) {
        e.preventDefault();
        prev.focus();
        const pos = Math.min(start, prev.value.length);
        prev.setSelectionRange(pos, pos);
      }
    } else if (e.key === "ArrowDown" && i < lines.length - 1) {
      const next = refs.current[i + 1];
      if (next) {
        e.preventDefault();
        next.focus();
        const pos = Math.min(start, next.value.length);
        next.setSelectionRange(pos, pos);
      }
    }
  }

  return (
    <div className="flex flex-col">
      {lines.map((line, i) => (
        <textarea
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={line}
          onChange={(e) => updateLine(i, e.target.value.replace(/\n/g, ""))}
          onKeyDown={(e) => onKey(i, e)}
          placeholder={i === 0 ? placeholder : ""}
          rows={1}
          className={`w-full resize-none appearance-none border-0 bg-transparent p-0 leading-relaxed shadow-none ring-0 placeholder:text-muted-foreground/50 outline-none focus:border-0 focus:outline-none focus:ring-0 ${lineStyleFor(line)}`}
        />
      ))}
    </div>
  );
}

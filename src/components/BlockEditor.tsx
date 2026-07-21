import { useEffect, useRef } from "react";
import { Loader2, X, Minus, Square, Maximize2 } from "lucide-react";

// Match either an image (!...) or a plain markdown link ([label](url)).
// Group 1 = "!" if image, empty for links; Group 2 = label; Group 3 = url.
export const MEDIA_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;

export type Block =
  | { kind: "text"; value: string }
  | { kind: "image"; src: string; raw: string; size: ImageSize; alt: string }
  | { kind: "link"; href: string; label: string; raw: string };

export type ImageSize = "small" | "medium" | "full";

function parseImageLabel(label: string): { alt: string; size: ImageSize } {
  const parts = label.split("|");
  const alt = parts[0] ?? "";
  const rawSize = (parts[1] ?? "").trim().toLowerCase();
  const size: ImageSize =
    rawSize === "small" || rawSize === "medium" || rawSize === "full"
      ? (rawSize as ImageSize)
      : "full";
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
  const label = size === "full" ? alt : `${alt}|${size}`;
  return `![${label}](${src})`;
}

const IMAGE_WIDTH: Record<ImageSize, string> = {
  small: "40%",
  medium: "70%",
  full: "100%",
};

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

  return (
    <div
      className={`w-full flex-1 space-y-2 overflow-y-auto bg-transparent px-1 ${
        fullscreen ? "min-h-0" : "min-h-[200px]"
      }`}
    >
      {blocks.map((b, i) => {
        if (b.kind === "image") {
          return (
            <div key={`img-${i}`} className="group relative">
              <img
                src={b.src}
                alt={b.alt}
                className="h-auto rounded-xl"
                style={{ width: IMAGE_WIDTH[b.size], maxWidth: "100%" }}
              />
              <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/70 p-0.5 text-white shadow-lg">
                <button
                  type="button"
                  onClick={() => updateImageSize(i, "small")}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${b.size === "small" ? "bg-white/25" : ""}`}
                  aria-label="Small"
                >
                  <Minus className="h-3 w-3" strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={() => updateImageSize(i, "medium")}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${b.size === "medium" ? "bg-white/25" : ""}`}
                  aria-label="Medium"
                >
                  <Square className="h-3 w-3" strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={() => updateImageSize(i, "full")}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${b.size === "full" ? "bg-white/25" : ""}`}
                  aria-label="Full width"
                >
                  <Maximize2 className="h-3 w-3" strokeWidth={3} />
                </button>
                <div className="mx-0.5 h-4 w-px bg-white/30" />
                <button
                  type="button"
                  onClick={() => onRemoveImage(b.src)}
                  aria-label="Remove image"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/25"
                >
                  <X className="h-3 w-3" strokeWidth={3} />
                </button>
              </div>
            </div>
          );
        }
        if (b.kind === "link") {
          const loading = /^__linking_.*__$/.test(b.label);
          const favicon = faviconFor(b.href);
          const host = hostnameOf(b.href);
          return (
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
        }
        return (
          <LineEditor
            key={`txt-${i}`}
            value={b.value}
            onChange={(v) => updateTextBlock(i, v)}
            placeholder={!hasMedia && i === 0 ? placeholder ?? "" : ""}
          />
        );
      })}
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

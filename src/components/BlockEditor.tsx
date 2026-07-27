import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X, Heading1, Heading2, Heading3, ListChecks, List, Quote, Minus, Code, Image as ImageIcon, Link as LinkIcon, Bold, Italic, Highlighter } from "lucide-react";
import { LocalImage } from "@/components/LocalImage";

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
  wikiIndex,
  onSlashInsert,
}: {
  value: string;
  onChange: (v: string) => void;
  fullscreen?: boolean;
  onRemoveImage: (src: string) => void;
  onRemoveLink: (href: string) => void;
  placeholder?: string;
  wikiIndex?: Map<string, string>;
  onSlashInsert?: (kind: "image" | "link") => void;
}) {

  const blocks = useMemo(() => parseBlocks(value), [value]);
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
        <div key={`link-${i}`} className="group relative inline-flex max-w-full items-center gap-1.5 rounded-full bg-yellow-400/20 pl-2 pr-1 py-1 align-middle">
          {favicon ? (
            <img src={favicon} alt="" className="h-3.5 w-3.5 flex-shrink-0 rounded-sm" />
          ) : (
            <div className="h-3.5 w-3.5 flex-shrink-0 rounded-sm bg-yellow-500/30" />
          )}
          <a
            href={b.href}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-xs font-medium text-yellow-700 no-underline"
          >
            {loading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Fetching…
              </span>
            ) : (
              b.label || host
            )}
          </a>
          <button
            type="button"
            onClick={() => onRemoveLink(b.href)}
            aria-label="Remove link"
            className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-yellow-700/70 text-white"
          >
            <X className="h-2.5 w-2.5" strokeWidth={3} />
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
        wikiIndex={wikiIndex}
        onSlashInsert={onSlashInsert}
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
        <LocalImage
          src={block.src}
          alt={block.alt}
          loading="lazy"
          decoding="async"
          className="h-auto w-full select-none rounded-xl"
          draggable={blockIndex !== undefined}
          onDragStart={(e: React.DragEvent<HTMLImageElement>) => {
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
  wikiIndex,
  onSlashInsert,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  wikiIndex?: Map<string, string>;
  onSlashInsert?: (kind: "image" | "link") => void;
}) {
  const lines = value.length === 0 ? [""] : value.split("\n");
  const refs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const focusPending = useRef<{ index: number; pos: number } | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  // `start` = index of the "/" character in the line; slash triggers anywhere.
  const [slash, setSlash] = useState<{ index: number; start: number; query: string; hi: number } | null>(null);

  // Only resize the textarea whose content actually changed since last render,
  // instead of looping every textarea on every keystroke (O(n) layout thrash).
  const prevLinesRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevLinesRef.current;
    for (let i = 0; i < lines.length; i++) {
      if (prev[i] === lines[i]) continue;
      const el = refs.current[i];
      if (!el) continue;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
    // Also resize any newly-mounted textareas that had no previous entry.
    if (lines.length !== prev.length) {
      for (let i = 0; i < lines.length; i++) {
        if (i < prev.length) continue;
        const el = refs.current[i];
        if (!el) continue;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }
    }
    prevLinesRef.current = lines;
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
  }, [value, focusedIdx]);

  function commit(nextLines: string[], focus?: { index: number; pos: number }) {
    if (focus) {
      focusPending.current = focus;
      setFocusedIdx(focus.index);
    }
    onChange(nextLines.join("\n"));
  }

  function detectSlash(line: string, caret: number, i: number) {
    // Walk back from caret to find a "/" preceded by start-of-line or whitespace.
    // Query is word chars between "/" and caret (no spaces).
    for (let p = caret - 1; p >= 0; p--) {
      const ch = line[p];
      if (ch === "/") {
        const before = p === 0 ? " " : line[p - 1];
        if (!/\s/.test(before) && before !== undefined && p !== 0) return null;
        const query = line.slice(p + 1, caret);
        if (!/^\w*$/.test(query)) return null;
        setSlash((cur) => ({ index: i, start: p, query: query.toLowerCase(), hi: cur && cur.index === i && cur.start === p ? cur.hi : 0 }));
        return;
      }
      if (/\s/.test(ch)) break;
    }
    setSlash((cur) => (cur && cur.index === i ? null : cur));
  }

  function updateLine(i: number, next: string, caret: number) {
    const copy = lines.slice();
    copy[i] = next;
    detectSlash(next, caret, i);
    commit(copy);
  }

  const SLASH_COMMANDS = useMemo(
    () => [
      { id: "h1", label: "Heading 1", block: true, keys: ["heading", "h1", "title"], icon: Heading1, apply: () => applyBlock("# ") },
      { id: "h2", label: "Heading 2", block: true, keys: ["heading", "h2"], icon: Heading2, apply: () => applyBlock("## ") },
      { id: "h3", label: "Heading 3", block: true, keys: ["heading", "h3"], icon: Heading3, apply: () => applyBlock("### ") },
      { id: "todo", label: "Checklist", block: true, keys: ["todo", "check", "task"], icon: ListChecks, apply: () => applyBlock("- [ ] ") },
      { id: "bullet", label: "Bullet list", block: true, keys: ["list", "bullet", "ul"], icon: List, apply: () => applyBlock("- ") },
      { id: "quote", label: "Quote", block: true, keys: ["quote", "blockquote"], icon: Quote, apply: () => applyBlock("> ") },
      { id: "divider", label: "Divider", block: true, keys: ["divider", "hr", "line", "separator"], icon: Minus, apply: () => applyBlock("---", true) },
      { id: "code", label: "Code", block: true, keys: ["code", "codeblock", "snippet"], icon: Code, apply: () => applyCode() },
      { id: "bold", label: "Bold", block: false, keys: ["bold", "strong", "b"], icon: Bold, apply: () => applyWrap("**", "**") },
      { id: "italic", label: "Italic", block: false, keys: ["italic", "em", "i"], icon: Italic, apply: () => applyWrap("*", "*") },
      { id: "highlight", label: "Highlight", block: false, keys: ["highlight", "mark", "yellow"], icon: Highlighter, apply: () => applyWrap("==", "==") },
      ...(onSlashInsert
        ? [
            { id: "image", label: "Image", block: false, keys: ["image", "photo", "picture"], icon: ImageIcon, apply: () => { removeSlashText(); onSlashInsert("image"); } },
            { id: "link", label: "Link", block: false, keys: ["link", "url", "web"], icon: LinkIcon, apply: () => { removeSlashText(); onSlashInsert("link"); } },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSlashInsert, slash?.index, slash?.start, lines.join("\n")],
  );

  const filteredSlash = slash
    ? SLASH_COMMANDS.filter((c) => !slash.query || c.label.toLowerCase().includes(slash.query) || c.keys.some((k) => k.includes(slash.query)))
    : [];

  // Remove the "/query" text and return the resulting line + caret at that pos.
  function stripSlash(): { copy: string[]; i: number; caret: number } | null {
    if (!slash) return null;
    const i = slash.index;
    const line = lines[i] ?? "";
    const before = line.slice(0, slash.start);
    const after = line.slice(slash.start + 1 + slash.query.length);
    const copy = lines.slice();
    copy[i] = before + after;
    return { copy, i, caret: before.length };
  }

  function removeSlashText() {
    const s = stripSlash();
    setSlash(null);
    if (!s) return;
    commit(s.copy, { index: s.i, pos: s.caret });
  }

  function applyBlock(prefix: string, addLineAfter = false) {
    const s = stripSlash();
    setSlash(null);
    if (!s) return;
    const line = s.copy[s.i] ?? "";
    // Prepend prefix at line start (block commands always apply to whole line).
    s.copy[s.i] = prefix + line;
    if (addLineAfter) s.copy.splice(s.i + 1, 0, "");
    const focusIdx = addLineAfter ? s.i + 1 : s.i;
    const focusPos = addLineAfter ? 0 : (s.copy[focusIdx] ?? "").length;
    commit(s.copy, { index: focusIdx, pos: focusPos });
  }

  function applyCode() {
    const s = stripSlash();
    setSlash(null);
    if (!s) return;
    const line = s.copy[s.i] ?? "";
    s.copy.splice(s.i, 1, "```" + line, "", "```");
    commit(s.copy, { index: s.i + 1, pos: 0 });
  }

  function applyWrap(open: string, close: string) {
    const s = stripSlash();
    setSlash(null);
    if (!s) return;
    const line = s.copy[s.i] ?? "";
    const insertAt = s.caret;
    s.copy[s.i] = line.slice(0, insertAt) + open + close + line.slice(insertAt);
    commit(s.copy, { index: s.i, pos: insertAt + open.length });
  }


  function onKey(i: number, e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (slash && slash.index === i && filteredSlash.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlash({ ...slash, hi: (slash.hi + 1) % filteredSlash.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlash({ ...slash, hi: (slash.hi - 1 + filteredSlash.length) % filteredSlash.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); filteredSlash[slash.hi]?.apply(); return; }
      if (e.key === "Escape") { e.preventDefault(); setSlash(null); return; }
    }
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
        setFocusedIdx(i - 1);
        focusPending.current = { index: i - 1, pos: Math.min(start, prev.value.length) };
      }
    } else if (e.key === "ArrowDown" && i < lines.length - 1) {
      const next = refs.current[i + 1];
      if (next) {
        e.preventDefault();
        setFocusedIdx(i + 1);
        focusPending.current = { index: i + 1, pos: Math.min(start, next.value.length) };
      }
    }
  }

  function renderPreview(line: string, i: number) {
    const nodes: React.ReactNode[] = [];
    const re = /\[\[([^\]\n]+?)\]\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) nodes.push(line.slice(last, m.index));
      const title = m[1].trim();
      const found = wikiIndex?.get(title.toLowerCase());
      nodes.push(
        <span
          key={`w-${i}-${k++}`}
          className={
            found
              ? "mx-0.5 inline-flex items-center rounded-full bg-yellow-400/25 px-2 py-0.5 text-[0.9em] font-medium text-yellow-700 ring-1 ring-yellow-500/40 shadow-[0_0_12px_rgba(250,204,21,0.55)]"
              : "mx-0.5 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[0.9em] font-medium text-muted-foreground ring-1 ring-border"
          }
        >
          {title}
        </span>,
      );
      last = m.index + m[0].length;
    }
    if (last < line.length) nodes.push(line.slice(last));
    if (nodes.length === 0) {
      return <span className="text-muted-foreground/50">{placeholder && i === 0 ? placeholder : "\u00A0"}</span>;
    }
    return <>{nodes}</>;
  }

  return (
    <div className="flex flex-col">
      {lines.map((line, i) => {
        const hasWiki = /\[\[([^\]\n]+?)\]\]/.test(line);
        const isFocused = focusedIdx === i;
        if (hasWiki && !isFocused) {
          return (
            <div
              key={i}
              onClick={(e) => {
                setFocusedIdx(i);
                // approximate caret at end
                focusPending.current = { index: i, pos: line.length };
                e.stopPropagation();
              }}
              className={`w-full cursor-text leading-relaxed ${lineStyleFor(line)}`}
            >
              {renderPreview(line, i)}
            </div>
          );
        }
        return (
          <div key={i} className="relative">
            <textarea
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={line}
              onChange={(e) => updateLine(i, e.target.value.replace(/\n/g, ""), e.target.selectionStart ?? e.target.value.length)}
              onKeyUp={(e) => {
                // Also refresh slash state on caret movement (arrows, click).
                const el = e.currentTarget;
                if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
                  detectSlash(el.value, el.selectionStart ?? 0, i);
                }
              }}
              onKeyDown={(e) => onKey(i, e)}
              onFocus={() => setFocusedIdx(i)}
              onBlur={() => {
                setFocusedIdx((cur) => (cur === i ? null : cur));
                // Delay so menu clicks can register before it unmounts.
                setTimeout(() => setSlash((s) => (s && s.index === i ? null : s)), 120);
              }}
              placeholder={i === 0 ? placeholder : ""}
              rows={1}
              className={`w-full resize-none appearance-none border-0 bg-transparent p-0 leading-relaxed shadow-none ring-0 placeholder:text-muted-foreground/50 outline-none focus:border-0 focus:outline-none focus:ring-0 ${lineStyleFor(line)}`}
            />
            {slash && slash.index === i && filteredSlash.length > 0 && (
              <div className="absolute left-0 top-full z-30 mt-1 w-56 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-0.5 shadow-2xl">
                {filteredSlash.map((c, k) => {
                  const Icon = c.icon;
                  const active = k === slash.hi;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); c.apply(); }}
                      onMouseEnter={() => setSlash((s) => (s ? { ...s, hi: k } : s))}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${active ? "bg-muted" : ""}`}
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium text-foreground">{c.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


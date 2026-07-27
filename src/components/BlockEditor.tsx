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

// ---------- Inline markdown ↔ HTML helpers ----------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wikiChipClass(found: boolean): string {
  return found
    ? "mx-0.5 inline-flex items-center rounded-full bg-yellow-400/25 px-2 py-0.5 text-[0.9em] font-medium text-yellow-700 ring-1 ring-yellow-500/40"
    : "mx-0.5 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[0.9em] font-medium text-muted-foreground ring-1 ring-border";
}

/** Render inline markdown to HTML. Keeps whole markdown line content, but
 *  visually hides the syntax markers by dropping them from the output. */
function inlineMdToHtml(md: string, wikiIndex?: Map<string, string>): string {
  if (!md) return "";
  let out = escapeHtml(md);
  // Order matters: highlight (==) → bold (**) → italic (*) → wiki [[...]]
  out = out.replace(/==([^=\n]+?)==/g, `<mark class="rounded-sm bg-yellow-300/60 px-0.5 text-foreground">$1</mark>`);
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, `<strong class="font-semibold">$1</strong>`);
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, `$1<em class="italic">$2</em>`);
  out = out.replace(/\[\[([^\]\n]+?)\]\]/g, (_m, raw: string) => {
    const title = raw.trim();
    const found = !!wikiIndex?.get(title.toLowerCase());
    return `<span class="${wikiChipClass(found)}">${escapeHtml(title)}</span>`;
  });
  return out;
}

/** Serialize a contenteditable line back to inline markdown. */
function htmlToInlineMd(el: HTMLElement): string {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent ?? "";
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const e = n as HTMLElement;
      const tag = e.tagName.toLowerCase();
      if (tag === "br") return; // ignore stray <br>
      const inner = htmlToInlineMd(e);
      if (tag === "strong" || tag === "b") out += `**${inner}**`;
      else if (tag === "em" || tag === "i") out += `*${inner}*`;
      else if (tag === "mark") out += `==${inner}==`;
      else if (tag === "span" && e.classList.contains("mx-0.5")) out += `[[${e.textContent ?? ""}]]`;
      else out += inner;
    }
  });
  return out;
}

/** Get caret offset within the visible text of `root`. */
function getVisibleCaret(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/** Place caret at a visible-text offset inside `root`. */
function setVisibleCaret(root: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  let remaining = offset;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, remaining));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }
  // Fallback: end of root
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
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
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const focusPending = useRef<{ index: number; pos: number } | null>(null);
  const slashDetectFrame = useRef<number | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [slash, setSlash] = useState<{ index: number; start: number; end: number; query: string; hi: number } | null>(null);

  // Sync DOM only when incoming markdown differs from what the DOM currently
  // serializes to. Prevents caret loss on our own edits.
  useEffect(() => {
    for (let i = 0; i < lines.length; i++) {
      const el = refs.current[i];
      if (!el) continue;
      const cur = htmlToInlineMd(el);
      if (cur !== lines[i]) {
        const wasFocused = document.activeElement === el;
        const caret = wasFocused ? getVisibleCaret(el) : null;
        el.innerHTML = inlineMdToHtml(lines[i] ?? "", wikiIndex);
        if (wasFocused) {
          const visibleLen = el.textContent?.length ?? 0;
          setVisibleCaret(el, Math.min(caret ?? visibleLen, visibleLen));
        }
      }
    }
    const pending = focusPending.current;
    if (pending) {
      const el = refs.current[pending.index];
      if (el) {
        el.focus();
        const visibleLen = el.textContent?.length ?? 0;
        setVisibleCaret(el, Math.min(pending.pos, visibleLen));
      }
      focusPending.current = null;
    }
    // Prune stale refs
    refs.current.length = lines.length;
  }, [value, focusedIdx]);

  useEffect(() => {
    return () => {
      if (slashDetectFrame.current !== null) {
        window.cancelAnimationFrame(slashDetectFrame.current);
      }
    };
  }, []);

  function commit(nextLines: string[], focus?: { index: number; pos: number }) {
    if (focus) {
      focusPending.current = focus;
      setFocusedIdx(focus.index);
    }
    onChange(nextLines.join("\n"));
  }

  /** Detect a `/query` token immediately before the caret in visible text. */
  function detectSlash(el: HTMLElement, i: number) {
    const caret = getVisibleCaret(el) ?? (el.textContent ?? "").length;
    const text = el.textContent ?? "";
    const safeCaret = Math.max(0, Math.min(caret, text.length));
    for (let p = safeCaret - 1; p >= 0; p--) {
      const ch = text[p];
      if (ch === "/") {
        const before = p === 0 ? " " : text[p - 1] ?? "";
        const isDoubleSlash = before === "/";
        if (p !== 0 && !/\s/.test(before) && !isDoubleSlash) continue;
        const rawQuery = text.slice(p + 1, safeCaret);
        if (rawQuery.length > 32) continue;
        const query = rawQuery.trim().toLowerCase();
        if (!/^[\p{L}\p{N}_-]*$/u.test(query)) continue;
        setSlash((cur) => ({
          index: i,
          start: p,
          end: safeCaret,
          query,
          hi: cur && cur.index === i && cur.start === p ? cur.hi : 0,
        }));
        return;
      }
    }
    setSlash((cur) => (cur && cur.index === i ? null : cur));
  }

  function scheduleSlashDetect(i: number, el: HTMLDivElement) {
    detectSlash(el, i);
    if (slashDetectFrame.current !== null) {
      window.cancelAnimationFrame(slashDetectFrame.current);
    }
    slashDetectFrame.current = window.requestAnimationFrame(() => {
      const liveEl = refs.current[i] ?? el;
      detectSlash(liveEl, i);
      slashDetectFrame.current = null;
    });
  }

  /** Delete the "/query" text from the DOM of the currently slashing line. */
  function stripSlashFromDom(): { el: HTMLDivElement; i: number } | null {
    if (!slash) return null;
    const el = refs.current[slash.index];
    if (!el) return null;
    // Walk to find the "/" text node and offset within it.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    let consumed = 0;
    const removeLen = Math.max(1, slash.end - slash.start);
    while (node) {
      const len = node.textContent?.length ?? 0;
      if (consumed + len > slash.start) {
        const localStart = slash.start - consumed;
        const localEnd = Math.min(len, localStart + removeLen);
        // Delete part inside this node
        const t = node.textContent ?? "";
        node.textContent = t.slice(0, localStart) + t.slice(localEnd);
        let leftover = removeLen - (localEnd - localStart);
        // If leftover, remove from following text nodes
        let next = walker.nextNode() as Text | null;
        while (leftover > 0 && next) {
          const nl = next.textContent?.length ?? 0;
          const take = Math.min(nl, leftover);
          next.textContent = (next.textContent ?? "").slice(take);
          leftover -= take;
          next = walker.nextNode() as Text | null;
        }
        return { el, i: slash.index };
      }
      consumed += len;
      node = walker.nextNode() as Text | null;
    }
    return { el, i: slash.index };
  }

  const SLASH_COMMANDS = useMemo(
    () => [
      { id: "h1", label: "Heading 1", keys: ["heading", "h1", "title"], icon: Heading1, apply: () => applyBlock("# ") },
      { id: "h2", label: "Heading 2", keys: ["heading", "h2"], icon: Heading2, apply: () => applyBlock("## ") },
      { id: "h3", label: "Heading 3", keys: ["heading", "h3"], icon: Heading3, apply: () => applyBlock("### ") },
      { id: "todo", label: "Checklist", keys: ["todo", "check", "task"], icon: ListChecks, apply: () => applyBlock("- [ ] ") },
      { id: "bullet", label: "Bullet list", keys: ["list", "bullet", "ul"], icon: List, apply: () => applyBlock("- ") },
      { id: "quote", label: "Quote", keys: ["quote", "blockquote"], icon: Quote, apply: () => applyBlock("> ") },
      { id: "divider", label: "Divider", keys: ["divider", "hr", "line", "separator"], icon: Minus, apply: () => applyBlock("---", true) },
      { id: "code", label: "Code", keys: ["code", "codeblock", "snippet"], icon: Code, apply: () => applyCode() },
      { id: "bold", label: "Bold", keys: ["bold", "strong", "b"], icon: Bold, apply: () => applyWrap("**", "**") },
      { id: "italic", label: "Italic", keys: ["italic", "em", "i"], icon: Italic, apply: () => applyWrap("*", "*") },
      { id: "highlight", label: "Highlight", keys: ["highlight", "mark", "yellow"], icon: Highlighter, apply: () => applyWrap("==", "==") },
      ...(onSlashInsert
        ? [
            { id: "image", label: "Image", keys: ["image", "photo", "picture"], icon: ImageIcon, apply: () => { const r = stripSlashFromDom(); setSlash(null); if (r) { const md = htmlToInlineMd(r.el); const copy = lines.slice(); copy[r.i] = md; commit(copy); } onSlashInsert("image"); } },
            { id: "link", label: "Link", keys: ["link", "url", "web"], icon: LinkIcon, apply: () => { const r = stripSlashFromDom(); setSlash(null); if (r) { const md = htmlToInlineMd(r.el); const copy = lines.slice(); copy[r.i] = md; commit(copy); } onSlashInsert("link"); } },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSlashInsert, slash?.index, slash?.start, slash?.end, lines.join("\n")],
  );

  const filteredSlash = slash
    ? SLASH_COMMANDS.filter((c) => !slash.query || c.label.toLowerCase().includes(slash.query) || c.keys.some((k) => k.includes(slash.query)))
    : [];

  function applyBlock(prefix: string, addLineAfter = false) {
    const r = stripSlashFromDom();
    setSlash(null);
    if (!r) return;
    const md = htmlToInlineMd(r.el);
    const copy = lines.slice();
    copy[r.i] = prefix + md;
    if (addLineAfter) copy.splice(r.i + 1, 0, "");
    const focusIdx = addLineAfter ? r.i + 1 : r.i;
    const focusPos = addLineAfter ? 0 : (copy[focusIdx] ?? "").length;
    commit(copy, { index: focusIdx, pos: focusPos });
  }

  function applyCode() {
    const r = stripSlashFromDom();
    setSlash(null);
    if (!r) return;
    const md = htmlToInlineMd(r.el);
    const copy = lines.slice();
    copy.splice(r.i, 1, "```" + md, "", "```");
    commit(copy, { index: r.i + 1, pos: 0 });
  }

  function applyWrap(open: string, close: string) {
    if (!slash) return;
    const idx = slash.index;
    const start = slash.start;
    const r = stripSlashFromDom();
    setSlash(null);
    if (!r) return;
    const md = htmlToInlineMd(r.el);
    // The stripped position in visible text ≈ position in md when no formatting
    // straddles it. Approximate by inserting at the same character offset.
    const insertAt = Math.min(start, md.length);
    const next = md.slice(0, insertAt) + open + close + md.slice(insertAt);
    const copy = lines.slice();
    copy[idx] = next;
    commit(copy, { index: idx, pos: insertAt + open.length });
  }

  function handleInput(i: number, el: HTMLDivElement) {
    const md = htmlToInlineMd(el);
    const copy = lines.slice();
    copy[i] = md;
    onChange(copy.join("\n"));
    // Update slash again on the next frame so mobile contenteditable has time
    // to move the caret after the newly typed `/`.
    scheduleSlashDetect(i, el);
  }

  function handleKey(i: number, e: React.KeyboardEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (slash && slash.index === i && filteredSlash.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlash({ ...slash, hi: (slash.hi + 1) % filteredSlash.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlash({ ...slash, hi: (slash.hi - 1 + filteredSlash.length) % filteredSlash.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); filteredSlash[slash.hi]?.apply(); return; }
      if (e.key === "Escape") { e.preventDefault(); setSlash(null); return; }
    }
    if (e.key === "/") {
      scheduleSlashDetect(i, el);
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const caret = getVisibleCaret(el) ?? 0;
      const md = htmlToInlineMd(el);
      // Approximate split at visible caret position within md string.
      const cut = Math.min(caret, md.length);
      const before = md.slice(0, cut);
      const after = md.slice(cut);
      const copy = lines.slice();
      copy.splice(i, 1, before, after);
      commit(copy, { index: i + 1, pos: 0 });
    } else if (e.key === "Backspace") {
      const caret = getVisibleCaret(el);
      if (caret === 0 && i > 0) {
        e.preventDefault();
        const prev = lines[i - 1] ?? "";
        const cur = htmlToInlineMd(el);
        const copy = lines.slice();
        copy.splice(i - 1, 2, prev + cur);
        commit(copy, { index: i - 1, pos: prev.length });
      }
    } else if (e.key === "ArrowUp" && i > 0) {
      e.preventDefault();
      setFocusedIdx(i - 1);
      focusPending.current = { index: i - 1, pos: getVisibleCaret(el) ?? 0 };
    } else if (e.key === "ArrowDown" && i < lines.length - 1) {
      e.preventDefault();
      setFocusedIdx(i + 1);
      focusPending.current = { index: i + 1, pos: getVisibleCaret(el) ?? 0 };
    }
  }

  return (
    <div className="flex flex-col">
      {lines.map((line, i) => (
        <div key={i} className="relative">
          <div
            ref={(el) => {
              refs.current[i] = el;
              if (el && el.innerHTML === "" && line) {
                el.innerHTML = inlineMdToHtml(line, wikiIndex);
              }
            }}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="false"
            data-placeholder={i === 0 ? placeholder ?? "" : ""}
            onInput={(e) => handleInput(i, e.currentTarget)}
            onKeyDown={(e) => handleKey(i, e)}
            onKeyUp={(e) => scheduleSlashDetect(i, e.currentTarget)}
            onMouseUp={(e) => detectSlash(e.currentTarget, i)}
            onFocus={(e) => {
              setFocusedIdx(i);
              scheduleSlashDetect(i, e.currentTarget);
            }}
            onBlur={() => {
              setFocusedIdx((cur) => (cur === i ? null : cur));
              setTimeout(() => setSlash((s) => (s && s.index === i ? null : s)), 220);
            }}
            className={`ce-line w-full whitespace-pre-wrap break-words leading-relaxed outline-none focus:outline-none ${lineStyleFor(line)}`}
          />
          {slash && slash.index === i && filteredSlash.length > 0 && (
            <div data-slash-menu className="absolute left-0 top-full z-[120] mt-1 w-56 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-0.5 shadow-2xl">
              {filteredSlash.map((c, k) => {
                const Icon = c.icon;
                const active = k === slash.hi;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); c.apply(); }}
                    onMouseDown={(e) => { e.preventDefault(); }}
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
      ))}
    </div>
  );
}



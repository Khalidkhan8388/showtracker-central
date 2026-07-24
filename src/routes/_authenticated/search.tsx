import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { addTmdbMedia, searchEverything } from "@/lib/notes.functions";
import { searchTmdbFn, type TmdbSearchHit } from "@/lib/tmdb.functions";
import { poster as posterUrl } from "@/lib/media";
import { useTheme } from "@/lib/theme";
import { getCachedPhotoUrl, getPhotoUrl, warmPhotoCache } from "@/lib/photo-cache";
import { MediaCard } from "@/components/MediaCard";
import type { LocalMedia } from "@/lib/local-db";

import {
  Search,
  ArrowLeft,
  Sparkles,
  Loader2,
  Circle,
  CheckCircle2,
  X,
  Clock,
  Mic,
  Image as ImageIcon,
  Link as LinkIcon,
  FileText,
  Plus,
  Check,
  Film,
  Tv,
  Star,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/search")({
  head: () => ({
    meta: [
      { title: "Search — Braintape" },
      { name: "description", content: "Search all your notes and tasks with AI or tags." },
    ],
  }),
  component: SearchPage,
});

type Note = {
  id: string;
  heading: string | null;
  summary: string | null;
  tags: string[] | null;
  tasks: Array<{ id: string; text: string; done: boolean }> | null;
  audio_path: string | null;
  image_paths: string[] | null;
  source_url: string | null;
  created_at: string;
};

const RECENTS_KEY = "braintape.search.recents";

function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]").slice(0, 6);
  } catch {
    return [];
  }
}

function pushRecent(q: string) {
  if (!q.trim()) return;
  const prev = loadRecents().filter((x) => x.toLowerCase() !== q.toLowerCase());
  localStorage.setItem(RECENTS_KEY, JSON.stringify([q, ...prev].slice(0, 6)));
}

function kindOf(n: Note): "voice" | "image" | "link" | "text" {
  if (n.audio_path) return "voice";
  if (n.source_url) return "link";
  if ((n.image_paths ?? []).length > 0) return "image";
  return "text";
}

function KindIcon({ kind, className }: { kind: ReturnType<typeof kindOf>; className?: string }) {
  const cls = className ?? "h-3 w-3";
  if (kind === "voice") return <Mic className={cls} />;
  if (kind === "image") return <ImageIcon className={cls} />;
  if (kind === "link") return <LinkIcon className={cls} />;
  return <FileText className={cls} />;
}

// Soft deterministic pastel for text/voice capture cards (light + dark palettes)
const CAPTURE_TINTS_LIGHT = [
  "#F4EFE6", "#EDE7DC", "#E8E4DA", "#F1EAD9", "#E9EDE4", "#EDE6E6", "#E4E7ED",
];
const CAPTURE_TINTS_DARK = [
  "#26221B", "#221E17", "#1F1C16", "#25201A", "#1D2320", "#241E1E", "#1B1F26",
];
function tintFor(id: string, dark: boolean) {
  const palette = dark ? CAPTURE_TINTS_DARK : CAPTURE_TINTS_LIGHT;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}


function hostOf(url: string | null | undefined) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function highlight(text: string, q: string) {
  if (!q.trim()) return text;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="rounded-[2px] bg-yellow-300/70 px-0.5 text-foreground">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function CaptureCard({
  note,
  thumb,
  q,
  onOpen,
}: {
  note: Note;
  thumb?: string;
  q: string;
  onOpen: () => void;
}) {
  const media = (note as any).media as LocalMedia | null | undefined;
  if (media) {
    return (
      <button
        onClick={onOpen}
        className="block w-full text-left transition-transform duration-200 ease-out active:scale-[0.97]"
      >
        <div className="aspect-[2/3] w-full">
          <MediaCard media={media} variant="grid" pinned={(note as any).pinned} />
        </div>
      </button>
    );
  }

  const kind = kindOf(note);
  const heading = note.heading || "Untitled";
  const host = hostOf(note.source_url);

  // Image-forward
  if (thumb) {
    return (
      <button
        onClick={onOpen}
        className="group relative block w-full overflow-hidden rounded-[15px] bg-muted text-left active:opacity-90 transition-transform duration-200 ease-out active:scale-[0.97]"
      >
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="block w-full object-cover"
          style={{ aspectRatio: "3 / 4" }}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 scrim-t p-3">
          {host && (
            <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-medium scrim-fg backdrop-blur-sm">
              <LinkIcon className="h-2.5 w-2.5" />
              {host}
            </div>
          )}
          <div className="line-clamp-2 text-[13px] font-semibold leading-tight scrim-fg">
            {highlight(heading, q)}
          </div>
        </div>

      </button>
    );
  }

  // Link without thumb
  if (kind === "link") {
    return (
      <button
        onClick={onOpen}
        className="block w-full overflow-hidden rounded-[15px] bg-[#1a1a1a] p-4 text-left active:opacity-80 transition-transform duration-200 ease-out active:scale-[0.97]"
      >
        <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80">
          <LinkIcon className="h-2.5 w-2.5" />
          {host || "link"}
        </div>
        <div className="line-clamp-3 text-[14px] font-semibold leading-snug text-white">
          {highlight(heading, q)}
        </div>
        {note.summary && (
          <div className="mt-1.5 line-clamp-3 text-[11px] leading-snug text-white/60">
            {highlight(note.summary, q)}
          </div>
        )}
      </button>
    );
  }

  // Text / voice tint card
  const { isDark } = useTheme();
  const bg = tintFor(note.id, isDark);

  return (
    <button
      onClick={onOpen}
      className="block w-full overflow-hidden rounded-[15px] p-4 text-left active:opacity-80 transition-transform duration-200 ease-out active:scale-[0.97]"
      style={{ backgroundColor: bg }}
    >
      <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium text-foreground/70">
        <KindIcon kind={kind} className="h-2.5 w-2.5" />
        {kind === "voice" ? "voice" : "note"}
      </div>
      <div className="line-clamp-2 text-[14px] font-semibold leading-snug text-foreground">
        {highlight(heading, q)}
      </div>
      {note.summary && (
        <div className="mt-1.5 line-clamp-5 text-[12px] leading-snug text-foreground/65">
          {highlight(note.summary, q)}
        </div>
      )}
      {(note.tags ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(note.tags ?? []).slice(0, 2).map((t) => (
            <span key={t} className="text-[10px] text-foreground/50">
              #{t}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function SearchPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const localNotes = useLocalNotes();
  const notes = useMemo<Note[]>(
    () => ((localNotes ?? []) as Note[]).filter((n) => n.heading !== "__custom__"),
    [localNotes],
  );
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState(false);
  const [aiIds, setAiIds] = useState<string[] | null>(null);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [kbOffset, setKbOffset] = useState(0);
  const [pillHeight, setPillHeight] = useState(140);
  const [tmdbHits, setTmdbHits] = useState<TmdbSearchHit[]>([]);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [tab, setTab] = useState<"memories" | "media">("memories");
  const [tmdbAdding, setTmdbAdding] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  // Track already-saved TMDB items so results show "Added" instead of a plus.
  const savedMediaKeys = useMemo(() => {
    const s = new Set<string>();
    for (const n of (localNotes ?? []) as any[]) {
      if (n?.media?.tmdb_id && n?.media?.type && !n.deleted_at) {
        s.add(`${n.media.type}:${n.media.tmdb_id}`);
      }
    }
    return s;
  }, [localNotes]);
  useEffect(() => {
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el || !root) return;
    // IntersectionObserver fires reliably during iOS momentum scrolling.
    const io = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { root, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Track on-screen keyboard via visualViewport so ONLY the search pill
  // rides up with the keyboard — the page itself stays put.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKbOffset(offset);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Measure the floating search pill so results always sit above it,
  // even when the results-count row appears/disappears.
  useEffect(() => {
    const el = pillRef.current;
    if (!el) return;
    const update = () => setPillHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const searchFn = searchEverything;

  useEffect(() => {
    setRecents(loadRecents());
  }, []);


  const signInFlightRef = useRef<Set<string>>(new Set());
  const signThumbsFor = useCallback((rows: Note[]) => {
    const paths: string[] = [];
    const toFetch: Array<{ id: string; path: string }> = [];
    for (const n of rows) {
      const p = Array.isArray(n.image_paths) ? n.image_paths[0] : null;
      if (!p) continue;
      paths.push(p);
      const cached = getCachedPhotoUrl(p);
      if (cached) {
        setThumbs((cur) => (cur[n.id] === cached ? cur : { ...cur, [n.id]: cached }));
        continue;
      }
      if (signInFlightRef.current.has(p)) continue;
      signInFlightRef.current.add(p);
      toFetch.push({ id: n.id, path: p });
    }
    if (paths.length) {
      void warmPhotoCache(paths).then(() => {
        setThumbs((cur) => {
          let next = cur;
          for (const n of rows) {
            const p = Array.isArray(n.image_paths) ? n.image_paths[0] : null;
            if (!p) continue;
            const u = getCachedPhotoUrl(p);
            if (u && next[n.id] !== u) {
              if (next === cur) next = { ...cur };
              next[n.id] = u;
            }
          }
          return next;
        });
      });
    }
    if (toFetch.length === 0) return;
    Promise.all(
      toFetch.map(async ({ id, path }) => ({ id, path, url: await getPhotoUrl(path) })),
    ).then((pairs) => {
      setThumbs((cur) => {
        const next = { ...cur };
        for (const { id, path, url } of pairs) {
          signInFlightRef.current.delete(path);
          if (url) next[id] = url;
        }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    signThumbsFor(notes);
  }, [notes, signThumbsFor]);


  useEffect(() => {
    setAiIds(null);
    setAiReasoning(null);
  }, [query]);

  // Debounced TMDB search — always run when the user has typed something.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setTmdbHits([]);
      setTmdbLoading(false);
      return;
    }
    setTmdbLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const hits = await searchTmdbFn({ data: { query: q } });
        if (!cancelled) setTmdbHits(hits);
      } catch {
        if (!cancelled) setTmdbHits([]);
      } finally {
        if (!cancelled) setTmdbLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const addMedia = useCallback(
    async (hit: TmdbSearchHit) => {
      const key = `${hit.type}:${hit.tmdb_id}`;
      if (tmdbAdding.has(key) || savedMediaKeys.has(key)) return;
      setTmdbAdding((s) => new Set(s).add(key));
      try {
        await addTmdbMedia({ data: { type: hit.type, tmdb_id: hit.tmdb_id } });
      } catch {
        // ignore; user can retry
      } finally {
        setTmdbAdding((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
      }
    },
    [tmdbAdding, savedMediaKeys],
  );




  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) for (const t of n.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40);
  }, [notes]);

  const filteredNotes = useMemo(() => {
    let list = notes;
    if (tab === "media") {
      list = list.filter((n) => !!(n as any).media);
    } else {
      list = list.filter((n) => !(n as any).media);
    }
    if (activeTag) list = list.filter((n) => (n.tags ?? []).includes(activeTag));
    const q = query.trim().toLowerCase();
    if (aiMode && aiIds) {
      const set = new Set(aiIds);
      const order = new Map(aiIds.map((id, i) => [id, i]));
      list = list.filter((n) => set.has(n.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else if (q) {
      list = list.filter((n) => {
        const hay = [n.heading ?? "", n.summary ?? "", ...(n.tags ?? [])].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    return list.slice(0, 60);
  }, [notes, activeTag, query, aiMode, aiIds, tab]);

  const matchingTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || aiMode || tab !== "memories") return [];
    const out: Array<{ noteId: string; taskId: string; text: string; done: boolean; noteHeading: string | null }> = [];
    for (const n of notes) {
      if (activeTag && !(n.tags ?? []).includes(activeTag)) continue;
      for (const t of n.tasks ?? []) {
        if (t.text.toLowerCase().includes(q)) {
          out.push({ noteId: n.id, taskId: t.id, text: t.text, done: t.done, noteHeading: n.heading });
        }
      }
    }
    return out.slice(0, 20);
  }, [notes, query, activeTag, aiMode, tab]);

  // Keep the top of the results visible above the keyboard while typing.
  useEffect(() => {
    if (!query.trim()) return;
    const root = scrollRef.current;
    if (!root) return;
    const id = requestAnimationFrame(() => {
      root.scrollTo({ top: root.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [query, filteredNotes.length, matchingTasks.length, kbOffset]);



  async function runAiSearch(q?: string) {
    const term = (q ?? query).trim();
    if (!term) return;
    pushRecent(term);
    setRecents(loadRecents());
    setAiLoading(true);
    setAiMode(true);
    try {
      const res = await searchFn({ data: { query: term, useAi: true } });
      setAiIds(res.noteIds);
      setAiReasoning(res.reasoning);
    } catch (e: any) {
      setAiIds([]);
      setAiReasoning(e?.message ?? "Search failed");
    } finally {
      setAiLoading(false);
    }
  }

  const idle = !query.trim() && !activeTag && !aiMode;
  const showTasks = matchingTasks.length > 0;

  return (
    <div className="relative mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-background">
      {/* Minimal top bar */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-xl">
        <div className={`flex items-center gap-3 px-4 transition-all duration-200 ${collapsed ? "pb-2 pt-2" : "pb-3 pt-4"}`}>
          <button
            onClick={() => navigate({ to: "/home" })}
            aria-label="Back"
            className="grid h-9 w-9 -ml-1.5 place-items-center rounded-full text-foreground active:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2} />
          </button>
          <h1 className={`font-medium tracking-tight text-foreground leading-none transition-all duration-200 ${collapsed ? "text-[17px]" : "text-[24px]"}`}>Search</h1>
        </div>
      </header>

      {/* Scroll body — content is bottom-anchored so results sit above the search pill */}
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col overflow-y-auto px-4 pt-1"
        style={{ paddingBottom: pillHeight + kbOffset + 40 }}
      >
        <div ref={sentinelRef} aria-hidden="true" className="h-2" />
        <div className="mt-auto">


        {/* AI reasoning bubble */}
        {aiMode && aiReasoning && !aiLoading && (
          <div className="mb-4 flex gap-2.5 rounded-2xl bg-primary/10 px-3.5 py-3">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="text-[13px] leading-snug text-foreground/80">{aiReasoning}</div>
          </div>
        )}











        {/* Section label */}
        <div className="mb-3 flex items-center justify-between px-1">

          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {aiMode
              ? "AI Matches"
              : activeTag
                ? `Tag · #${activeTag}`
                : query.trim()
                  ? "Results"
                  : "Captures"}
          </span>
          {(query.trim() || aiMode) && (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {filteredNotes.length + matchingTasks.length}
            </span>
          )}
        </div>

        {/* Tags row when idle */}
        {idle && allTags.length > 0 && (
          <div className="-mx-4 mb-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-1.5 px-4">
              {allTags.slice(0, 20).map(([t, count]) => (
                <button
                  key={t}
                  onClick={() => setActiveTag(t)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-[12px] text-foreground active:opacity-60"
                >
                  #{t}
                  <span className="text-muted-foreground">{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTag && (
          <div className="mb-3">
            <button
              onClick={() => setActiveTag(null)}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground active:opacity-70"
            >
              #{activeTag}
              <X className="h-3 w-3" strokeWidth={3} />
            </button>
          </div>
        )}

        {/* Task matches */}
        {showTasks && (
          <div className="mb-4 overflow-hidden rounded-2xl bg-card">
            {matchingTasks.map((t, i) => (
              <div key={`${t.noteId}::${t.taskId}`}>
                <Link
                  to="/notes/$id"
                  params={{ id: t.noteId }}
                  className="flex items-start gap-3 px-3.5 py-2.5 active:bg-muted"
                >
                  {t.done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-[14px] leading-snug ${
                        t.done ? "line-through text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {highlight(t.text, query)}
                    </div>
                  </div>
                </Link>
                {i < matchingTasks.length - 1 && <div className="ml-10 h-px bg-border" />}
              </div>
            ))}
          </div>
        )}

        {/* Masonry captures */}
        {aiLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-card px-4 py-14 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading your notes…
          </div>
        ) : filteredNotes.length === 0 && !showTasks ? (
          idle ? (
            <div className="mt-6 rounded-2xl bg-card px-5 py-10 text-center">
              <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="text-[14px] font-semibold text-foreground">Search everything</div>
              <div className="mx-auto mt-1 max-w-[240px] text-[12px] text-muted-foreground">
                Type below, tap a tag, or press{" "}
                <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">↵</span> to ask AI.
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-card px-4 py-10 text-center text-[13px] text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">Nothing here</div>
              {aiMode ? "Try rephrasing the question." : "Try Ask AI or a different tag."}
            </div>
          )
        ) : (
          <div className="columns-2 gap-3 [column-fill:_balance]">
            {filteredNotes.map((n) => (
              <div key={n.id} className="mb-3 break-inside-avoid">
                <CaptureCard
                  note={n}
                  thumb={thumbs[n.id]}
                  q={query}
                  onOpen={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
                />
              </div>
            ))}
          </div>
        )}

        {/* TMDB search results — Movies & TV tab only; hides items already in your library */}
        {tab === "media" && query.trim().length >= 2 && !aiMode && (() => {
          const visibleHits = tmdbHits.filter(
            (h) => !savedMediaKeys.has(`${h.type}:${h.tmdb_id}`),
          );
          if (!tmdbLoading && visibleHits.length === 0) return null;
          return (
            <section className="mt-5 mb-5">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Movies &amp; TV
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {tmdbLoading ? "…" : visibleHits.length}
                </span>
              </div>
              <div className="-mx-4 overflow-x-auto scrollbar-hide">
                <div className="flex gap-2.5 px-4 pb-1">
                  {tmdbLoading && visibleHits.length === 0
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <div
                          key={i}
                          className="w-[120px] shrink-0 animate-pulse overflow-hidden rounded-[15px] bg-muted"
                          style={{ aspectRatio: "2 / 3" }}
                        />
                      ))
                    : visibleHits.map((hit) => {
                        const key = `${hit.type}:${hit.tmdb_id}`;
                        const adding = tmdbAdding.has(key);
                        const poster = posterUrl(hit.poster_path, "w342");
                        return (
                          <div key={key} className="w-[120px] shrink-0">
                            <div
                              className="relative overflow-hidden bg-muted"
                              style={{ aspectRatio: "2 / 3", borderRadius: 15 }}
                            >
                              {poster ? (
                                <img
                                  src={poster}
                                  alt=""
                                  loading="lazy"
                                  className="absolute inset-0 h-full w-full object-cover"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                                  {hit.type === "tv" ? (
                                    <Tv className="h-6 w-6" />
                                  ) : (
                                    <Film className="h-6 w-6" />
                                  )}
                                </div>
                              )}
                              {hit.vote_average != null && hit.vote_average > 0 && (
                                <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
                                  <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                                  {hit.vote_average.toFixed(1)}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => addMedia(hit)}
                                disabled={adding}
                                aria-label={`Add ${hit.title}`}
                                className="absolute bottom-1.5 right-1.5 z-10 grid h-7 w-7 place-items-center rounded-full bg-white/95 text-neutral-900 shadow-lg backdrop-blur-md transition active:scale-95"
                              >
                                {adding ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5" strokeWidth={3} />
                                )}
                              </button>

                              <div className="absolute inset-x-0 bottom-0 scrim-t p-2 pt-8">
                                <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
                                  {hit.type === "tv" ? (
                                    <Tv className="h-2.5 w-2.5" />
                                  ) : (
                                    <Film className="h-2.5 w-2.5" />
                                  )}
                                  {hit.type === "tv" ? "TV" : "Movie"}
                                </span>
                                <p className="line-clamp-2 text-[12px] font-semibold leading-tight scrim-fg">
                                  {hit.title}
                                </p>
                                <p className="text-[10px] scrim-fg-70">
                                  {hit.year ?? "—"}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                </div>
              </div>
            </section>
          );
        })()}



        {/* Recents when idle */}
        {idle && recents.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Recent
              </span>
              <button
                onClick={() => {
                  localStorage.removeItem(RECENTS_KEY);
                  setRecents([]);
                }}
                className="text-[11px] text-primary active:opacity-60"
              >
                Clear
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recents.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setQuery(r);
                    inputRef.current?.focus();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[12px] text-foreground active:opacity-60"
                >
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>


      {/* Bottom-anchored search bar (above keyboard) — dark pill to match app UI */}
      <div
        ref={pillRef}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md will-change-transform"
        style={{ transform: kbOffset > 0 ? `translateY(-${kbOffset}px)` : undefined }}
      >
        <div className="pointer-events-auto px-5 pb-[max(env(safe-area-inset-bottom),40px)] pt-3">
          {/* Tab switcher: memories vs movies/TV — floats above search input */}
          <div className="mb-2 flex justify-center">
            <div className="pointer-events-auto inline-flex items-center rounded-full bg-white/90 p-1 shadow-[0_6px_20px_-8px_rgba(0,0,0,0.25)] ring-1 ring-black/10 backdrop-blur-xl dark:bg-[#1a1a1a]/90 dark:ring-white/10">
              {(["memories", "media"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-full px-4 py-1.5 text-[12px] font-semibold transition ${
                    tab === t
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  {t === "memories" ? "Memories" : "Movies & TV"}
                </button>
              ))}
            </div>
          </div>

          {(query.trim() || aiMode) && (
            <div className="mb-2 flex justify-center">
              <div className="inline-flex items-center gap-3 rounded-full bg-white/90 px-3 py-1 text-[11px] text-muted-foreground shadow-[0_6px_20px_-8px_rgba(0,0,0,0.25)] ring-1 ring-black/10 backdrop-blur-xl dark:bg-[#1a1a1a]/90 dark:ring-white/10">
                <span>
                  {aiMode
                    ? aiLoading
                      ? "Thinking…"
                      : `${filteredNotes.length} AI match${filteredNotes.length === 1 ? "" : "es"}`
                    : `${filteredNotes.length + matchingTasks.length} result${
                        filteredNotes.length + matchingTasks.length === 1 ? "" : "s"
                      }`}
                </span>
                {!aiMode && query.trim() && <span className="opacity-70">↵ Ask AI</span>}
              </div>
            </div>
          )}

          <div role="search" aria-label="Search captures" className="flex items-center gap-2 rounded-full bg-white/90 pl-5 pr-1.5 py-1.5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.25)] ring-1 ring-black/10 backdrop-blur-xl dark:bg-[#1a1a1a]/90 dark:ring-white/5 dark:shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45)]">
            <Search aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-neutral-600 dark:text-white/70" strokeWidth={2.25} />
            <label htmlFor="search-input" className="sr-only">Search captures, tasks, tags</label>
            <input
              id="search-input"
              ref={inputRef}
              autoFocus
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              name="braintape-search"
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore="true"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setAiMode(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") runAiSearch();
                if (e.key === "Escape") {
                  setQuery("");
                  setAiMode(false);
                }
              }}
              placeholder="Search captures, tasks, tags…"
              className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-neutral-900 placeholder:text-neutral-500 outline-none dark:text-white dark:placeholder:text-white/40"
            />

            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  setAiMode(false);
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/10 text-neutral-700 active:opacity-60 dark:bg-white/15 dark:text-white/90"
              >
                <X aria-hidden="true" className="h-3 w-3" strokeWidth={3} />
              </button>
            )}
            <div aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-black/10 dark:bg-white/10" />
            <button
              onClick={() => runAiSearch()}
              disabled={aiLoading || !query.trim()}
              aria-label="Ask AI"
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/5 text-neutral-900 disabled:opacity-40 active:opacity-70 dark:bg-white/10 dark:text-white"
            >
              {aiLoading ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Sparkles aria-hidden="true" className="h-4 w-4" />
                  {query.trim() && (
                    <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-yellow-400" />
                  )}
                </>
              )}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

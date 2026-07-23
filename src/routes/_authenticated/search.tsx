import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { searchEverything } from "@/lib/notes.functions";
import {
  Search,
  ChevronLeft,
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
  const cls = className ?? "h-4 w-4";
  if (kind === "voice") return <Mic className={cls} />;
  if (kind === "image") return <ImageIcon className={cls} />;
  if (kind === "link") return <LinkIcon className={cls} />;
  return <FileText className={cls} />;
}

function highlight(text: string, q: string) {
  if (!q.trim()) return text;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="rounded-[3px] bg-yellow-300/60 px-0.5 text-foreground">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function SearchPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState(false);
  const [aiIds, setAiIds] = useState<string[] | null>(null);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const searchFn = useServerFn(searchEverything);

  useEffect(() => {
    setRecents(loadRecents());
    supabase
      .from("voice_notes")
      .select("id, heading, summary, tags, tasks, audio_path, image_paths, source_url, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setNotes(((data ?? []) as Note[]).filter((n) => n.heading !== "__custom__"));
      });
  }, []);

  useEffect(() => {
    setAiIds(null);
    setAiReasoning(null);
  }, [query]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) for (const t of n.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40);
  }, [notes]);

  const filteredNotes = useMemo(() => {
    let list = notes;
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
  }, [notes, activeTag, query, aiMode, aiIds]);

  const matchingTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || aiMode) return [];
    const out: Array<{ noteId: string; taskId: string; text: string; done: boolean; noteHeading: string | null }> = [];
    for (const n of notes) {
      if (activeTag && !(n.tags ?? []).includes(activeTag)) continue;
      for (const t of n.tasks ?? []) {
        if (t.text.toLowerCase().includes(q)) {
          out.push({ noteId: n.id, taskId: t.id, text: t.text, done: t.done, noteHeading: n.heading });
        }
      }
    }
    return out.slice(0, 30);
  }, [notes, query, activeTag, aiMode]);

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
  const resultCount = filteredNotes.length + matchingTasks.length;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-xl">
        <div className="flex items-center justify-between px-2 pt-3 pb-1">
          <button
            onClick={() => navigate({ to: "/home" })}
            aria-label="Back"
            className="inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[17px] text-primary active:opacity-60"
          >
            <ChevronLeft className="h-6 w-6 -ml-1" strokeWidth={2.5} />
            <span>Home</span>
          </button>
          {query.trim() && (
            <button
              onClick={() => runAiSearch()}
              disabled={aiLoading}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[14px] font-semibold text-primary-foreground disabled:opacity-40 active:opacity-70"
            >
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Ask AI
            </button>
          )}
        </div>

        <div className="px-5 pt-1 pb-3">
          <h1 className="font-serif text-[40px] leading-[1.05] tracking-tight text-foreground">
            Search
          </h1>
        </div>

        <div className="px-4 pb-3">
          <div className="flex items-center gap-2.5 rounded-full bg-muted px-4 py-2.5 shadow-sm ring-1 ring-black/[0.03]">
            <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={2.5} />
            <input
              ref={inputRef}
              autoFocus
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
              placeholder="Search notes, tasks, tags…"
              className="w-full bg-transparent text-[17px] text-foreground placeholder:text-muted-foreground/70 outline-none"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  setAiMode(false);
                  inputRef.current?.focus();
                }}
                aria-label="Clear"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/40 text-background active:opacity-60"
              >
                <X className="h-3 w-3" strokeWidth={3} />
              </button>
            )}
          </div>
          {(query.trim() || aiMode) && (
            <div className="mt-2 flex items-center justify-between px-1.5 text-[12px] text-muted-foreground">
              <span>
                {aiMode
                  ? aiLoading
                    ? "Thinking…"
                    : `${filteredNotes.length} AI match${filteredNotes.length === 1 ? "" : "es"}`
                  : `${resultCount} result${resultCount === 1 ? "" : "s"}`}
              </span>
              {!aiMode && query.trim() && (
                <span className="opacity-70">↵ for AI search</span>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 px-4 pt-2 pb-28">
        {aiMode && aiReasoning && !aiLoading && (
          <div className="flex gap-2.5 rounded-[24px] bg-primary/10 px-4 py-3.5">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="text-[14px] leading-snug text-foreground/80">{aiReasoning}</div>
          </div>
        )}

        {idle && recents.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Recent
              </h2>
              <button
                onClick={() => {
                  localStorage.removeItem(RECENTS_KEY);
                  setRecents([]);
                }}
                className="text-[12px] text-primary active:opacity-60"
              >
                Clear
              </button>
            </div>
            <ul className="overflow-hidden rounded-[24px] bg-card shadow-sm">
              {recents.map((r, i) => (
                <li key={r}>
                  <button
                    onClick={() => {
                      setQuery(r);
                      inputRef.current?.focus();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-muted"
                  >
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-[15px] text-foreground">{r}</span>
                  </button>
                  {i < recents.length - 1 && <div className="ml-11 h-px bg-border" />}
                </li>
              ))}
            </ul>
          </section>
        )}

        {allTags.length > 0 && (
          <section>
            <h2 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Tags
            </h2>
            <div className="-mx-4 overflow-x-auto scrollbar-hide">
              <div className="flex gap-1.5 px-4">
                {activeTag && (
                  <button
                    onClick={() => setActiveTag(null)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground active:opacity-70"
                  >
                    #{activeTag}
                    <X className="h-3 w-3" strokeWidth={3} />
                  </button>
                )}
                {allTags
                  .filter(([t]) => t !== activeTag)
                  .map(([t, count]) => (
                    <button
                      key={t}
                      onClick={() => setActiveTag(t)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-[13px] text-foreground active:opacity-60"
                    >
                      #{t}
                      <span className="text-muted-foreground">{count}</span>
                    </button>
                  ))}
              </div>
            </div>
          </section>
        )}

        {matchingTasks.length > 0 && (
          <section>
            <h2 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Tasks · {matchingTasks.length}
            </h2>
            <ul className="overflow-hidden rounded-[24px] bg-card shadow-sm">
              {matchingTasks.map((t, i) => (
                <li key={`${t.noteId}::${t.taskId}`}>
                  <Link
                    to="/notes/$id"
                    params={{ id: t.noteId }}
                    className="flex items-start gap-3 px-4 py-3 active:bg-muted"
                  >
                    {t.done ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    ) : (
                      <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={`text-[16px] leading-tight ${t.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                        {highlight(t.text, query)}
                      </div>
                      {t.noteHeading && (
                        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">from {t.noteHeading}</div>
                      )}
                    </div>
                  </Link>
                  {i < matchingTasks.length - 1 && <div className="ml-12 h-px bg-border" />}
                </li>
              ))}
            </ul>
          </section>
        )}

        {!idle && (
          <section>
            <h2 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {aiMode ? "AI Results" : activeTag ? `#${activeTag}` : "Notes"} · {filteredNotes.length}
            </h2>
            {aiLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-[24px] bg-card px-4 py-10 text-[14px] text-muted-foreground shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Reading your notes…
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="rounded-[24px] bg-card px-4 py-10 text-center text-[14px] text-muted-foreground shadow-sm">
                <div className="mb-1 font-medium text-foreground">Nothing here</div>
                {aiMode ? "Try rephrasing the question." : "Try Ask AI or a different tag."}
              </div>
            ) : (
              <ul className="overflow-hidden rounded-[24px] bg-card shadow-sm">
                {filteredNotes.map((n, i) => {
                  const kind = kindOf(n);
                  return (
                    <li key={n.id}>
                      <Link
                        to="/notes/$id"
                        params={{ id: n.id }}
                        className="flex gap-3 px-4 py-3 active:bg-muted"
                      >
                        <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                          <KindIcon kind={kind} className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-1 text-[16px] font-semibold text-foreground">
                            {highlight(n.heading || "Untitled note", query)}
                          </div>
                          {n.summary && (
                            <div className="mt-0.5 line-clamp-2 text-[14px] text-muted-foreground">
                              {highlight(n.summary, query)}
                            </div>
                          )}
                          {(n.tags ?? []).length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {(n.tags ?? []).slice(0, 4).map((t) => (
                                <span
                                  key={t}
                                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                                    t === activeTag
                                      ? "bg-primary/15 text-primary"
                                      : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  #{t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </Link>
                      {i < filteredNotes.length - 1 && <div className="ml-14 h-px bg-border" />}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {idle && recents.length === 0 && (
          <div className="mt-4 rounded-[24px] bg-card px-5 py-8 text-center shadow-sm">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="text-[15px] font-semibold text-foreground">Search everything</div>
            <div className="mx-auto mt-1 max-w-[260px] text-[13px] text-muted-foreground">
              Type a keyword, tap a tag, or press <span className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">↵</span> to ask AI in plain language.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

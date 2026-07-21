import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { searchEverything } from "@/lib/notes.functions";
import { Search, ChevronLeft, Sparkles, Loader2, Circle, CheckCircle2, X } from "lucide-react";

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
  created_at: string;
};

function SearchPage() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState(false);
  const [aiIds, setAiIds] = useState<string[] | null>(null);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const searchFn = useServerFn(searchEverything);

  useEffect(() => {
    supabase
      .from("voice_notes")
      .select("id, heading, summary, tags, tasks, created_at")
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
    for (const n of notes) {
      for (const t of n.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40);
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
          out.push({
            noteId: n.id,
            taskId: t.id,
            text: t.text,
            done: t.done,
            noteHeading: n.heading,
          });
        }
      }
    }
    return out.slice(0, 30);
  }, [notes, query, activeTag, aiMode]);

  async function runAiSearch() {
    if (!query.trim()) return;
    setAiLoading(true);
    setAiMode(true);
    try {
      const res = await searchFn({ data: { query: query.trim(), useAi: true } });
      setAiIds(res.noteIds);
      setAiReasoning(res.reasoning);
    } catch (e: any) {
      setAiIds([]);
      setAiReasoning(e?.message ?? "Search failed");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      {/* iOS large-title style header */}
      <header className="sticky top-0 z-10 bg-background/85 backdrop-blur-xl">
        <div className="flex items-center justify-between px-2 pt-3 pb-1">
          <button
            onClick={() => navigate({ to: "/home" })}
            aria-label="Back"
            className="inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[17px] text-primary active:opacity-60"
          >
            <ChevronLeft className="h-6 w-6 -ml-1" strokeWidth={2.5} />
            <span>Home</span>
          </button>
          <button
            onClick={runAiSearch}
            disabled={!query.trim() || aiLoading}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[17px] font-semibold text-primary disabled:opacity-30 active:opacity-60"
          >
            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Ask AI
          </button>
        </div>
        <div className="px-4 pt-1 pb-2">
          <h1 className="text-[34px] font-bold tracking-tight text-foreground">Search</h1>
        </div>
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 rounded-xl bg-muted px-2.5 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setAiMode(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") runAiSearch();
              }}
              placeholder="Notes, tasks, tags"
              className="w-full bg-transparent text-[17px] text-foreground placeholder:text-muted-foreground outline-none"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  setAiMode(false);
                }}
                aria-label="Clear"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/40 text-background active:opacity-60"
              >
                <X className="h-3 w-3" strokeWidth={3} />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 px-4 pt-2 pb-28">
        {aiMode && aiReasoning && (
          <div className="rounded-2xl bg-card px-4 py-3 text-[13px] italic text-muted-foreground shadow-sm">
            {aiReasoning}
          </div>
        )}

        {allTags.length > 0 && (
          <section>
            <h2 className="mb-2 px-1 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">
              Tags
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {activeTag && (
                <button
                  onClick={() => setActiveTag(null)}
                  className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[13px] font-medium text-primary-foreground active:opacity-70"
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
                    className="rounded-full bg-muted px-3 py-1 text-[13px] text-foreground active:opacity-60"
                  >
                    #{t} <span className="text-muted-foreground">{count}</span>
                  </button>
                ))}
            </div>
          </section>
        )}

        {matchingTasks.length > 0 && (
          <section>
            <h2 className="mb-2 px-1 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">
              Tasks
            </h2>
            <ul className="overflow-hidden rounded-2xl bg-card shadow-sm">
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
                      <div className={`text-[17px] leading-tight ${t.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                        {t.text}
                      </div>
                      {t.noteHeading && (
                        <div className="mt-0.5 truncate text-[13px] text-muted-foreground">from {t.noteHeading}</div>
                      )}
                    </div>
                  </Link>
                  {i < matchingTasks.length - 1 && <div className="ml-12 h-px bg-border" />}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-2 px-1 text-[13px] font-normal uppercase tracking-wide text-muted-foreground">
            {aiMode ? "AI Results" : activeTag ? `#${activeTag}` : query ? "Notes" : "All Notes"}
          </h2>
          {filteredNotes.length === 0 ? (
            <div className="rounded-2xl bg-card px-4 py-10 text-center text-[15px] text-muted-foreground shadow-sm">
              No matches.{aiMode ? " Try a different question." : " Try Ask AI or a tag."}
            </div>
          ) : (
            <ul className="overflow-hidden rounded-2xl bg-card shadow-sm">
              {filteredNotes.map((n, i) => (
                <li key={n.id}>
                  <Link
                    to="/notes/$id"
                    params={{ id: n.id }}
                    className="block px-4 py-3 active:bg-muted"
                  >
                    <div className="text-[17px] font-semibold text-foreground line-clamp-1">
                      {n.heading || "Untitled note"}
                    </div>
                    {n.summary && (
                      <div className="mt-0.5 line-clamp-2 text-[15px] text-muted-foreground">{n.summary}</div>
                    )}
                    {(n.tags ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(n.tags ?? []).slice(0, 6).map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                  {i < filteredNotes.length - 1 && <div className="ml-4 h-px bg-border" />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { searchEverything } from "@/lib/notes.functions";
import { Search, ArrowLeft, Sparkles, Loader2, Circle, CheckCircle2 } from "lucide-react";

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

  // Reset AI results when query changes
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
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/80 px-4 pt-6 pb-3 backdrop-blur-xl">
        <button
          onClick={() => navigate({ to: "/home" })}
          aria-label="Back"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-2">
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
            placeholder="Search notes, tasks, tags…"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-5 px-5 py-4 pb-24">
        <button
          onClick={runAiSearch}
          disabled={!query.trim() || aiLoading}
          className="inline-flex items-center justify-center gap-2 self-start rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background disabled:opacity-40"
        >
          {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Ask AI to search
        </button>

        {aiMode && aiReasoning && (
          <p className="rounded-2xl bg-muted/50 px-4 py-2 text-xs italic text-muted-foreground">
            {aiReasoning}
          </p>
        )}

        {allTags.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tags
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {activeTag && (
                <button
                  onClick={() => setActiveTag(null)}
                  className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background"
                >
                  #{activeTag} ✕
                </button>
              )}
              {allTags
                .filter(([t]) => t !== activeTag)
                .map(([t, count]) => (
                  <button
                    key={t}
                    onClick={() => setActiveTag(t)}
                    className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-foreground hover:bg-muted"
                  >
                    #{t} <span className="text-muted-foreground">{count}</span>
                  </button>
                ))}
            </div>
          </section>
        )}

        {matchingTasks.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tasks
            </h2>
            <ul className="space-y-1.5">
              {matchingTasks.map((t) => (
                <li key={`${t.noteId}::${t.taskId}`}>
                  <Link
                    to="/notes/$id"
                    params={{ id: t.noteId }}
                    className="flex items-start gap-2 rounded-xl border border-border bg-background px-3 py-2"
                  >
                    {t.done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm ${t.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                        {t.text}
                      </div>
                      {t.noteHeading && (
                        <div className="truncate text-xs text-muted-foreground">from {t.noteHeading}</div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {aiMode ? "AI results" : activeTag ? `#${activeTag}` : query ? "Notes" : "All notes"}
          </h2>
          {filteredNotes.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No matches. {aiMode ? "Try a different question." : "Try Ask AI or a tag."}
            </p>
          ) : (
            <ul className="space-y-2">
              {filteredNotes.map((n) => (
                <li key={n.id}>
                  <Link
                    to="/notes/$id"
                    params={{ id: n.id }}
                    className="block rounded-2xl border border-border bg-background p-3 hover:bg-muted/30"
                  >
                    <div className="text-sm font-semibold text-foreground line-clamp-1">
                      {n.heading || "Untitled note"}
                    </div>
                    {n.summary && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.summary}</div>
                    )}
                    {(n.tags ?? []).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {(n.tags ?? []).slice(0, 6).map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

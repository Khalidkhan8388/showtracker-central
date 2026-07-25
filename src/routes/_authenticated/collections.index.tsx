import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, FolderPlus, Plus, X, Trash2, ChevronRight, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { useCollections, createCollection, deleteCollection, backfillMediaCollections, pruneEmptyCollections } from "@/lib/collections";
import { useLocalNotes } from "@/hooks/use-local-notes";

export const Route = createFileRoute("/_authenticated/collections/")({
  head: () => ({
    meta: [
      { title: "Collections — Braintape" },
      { name: "description", content: "Group your notes into collections." },
    ],
  }),
  component: CollectionsPage,
});

function CollectionsPage() {
  const collections = useCollections();
  const notes = useLocalNotes();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  // Auto-file any movie/TV notes into Movies / TV Shows on mount so newly
  // added media always shows up here even if the initial file step raced.
  // Also prune collections that have ended up empty (all members deleted
  // or never added) so the list only shows collections with real content.
  useEffect(() => {
    (async () => {
      await backfillMediaCollections();
      if (notes) {
        const alive = new Set(notes.filter((n) => !n.deleted_at).map((n) => n.id));
        await pruneEmptyCollections(alive);
      }
    })();
  }, [notes]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setCreating(false);
      return;
    }
    const row = await createCollection(t);
    setTitle("");
    setCreating(false);
    navigate({ to: "/collections/$id", params: { id: row.id } });
  }

  function countFor(ids: string[] | undefined): number {
    const list = ids ?? [];
    if (!notes) return list.length;
    const alive = new Set(notes.map((n) => n.id));
    return list.filter((i) => alive.has(i)).length;
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to="/home"
              aria-label="Back"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:opacity-70"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-[22px] font-bold tracking-tight">Collections</h1>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            aria-label="New collection"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground active:opacity-80"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </header>

      <section className="flex-1 px-4 pb-24 pt-4">
        {creating && (
          <form
            onSubmit={submit}
            className="mb-4 flex items-center gap-2 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-border/60"
          >
            <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setTitle("");
                  setCreating(false);
                }
              }}
              placeholder="Collection name"
              maxLength={80}
              className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => {
                setTitle("");
                setCreating(false);
              }}
              aria-label="Cancel"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        )}

        {collections === undefined ? null : collections.length === 0 && !creating ? (
          <div className="rounded-2xl bg-card px-6 py-12 text-center shadow-sm ring-1 ring-border/60">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FolderPlus className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[17px] font-semibold text-foreground">No collections yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Group notes, tasks, and links into collections.
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground active:opacity-80"
            >
              <Plus className="h-4 w-4" />
              New collection
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {collections.map((c) => (
              <li key={c.id}>
                <Link
                  to="/collections/$id"
                  params={{ id: c.id }}
                  className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-border/60 active:opacity-80"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                    <Folder className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-foreground">{c.title}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {countFor(c.note_ids)} {countFor(c.note_ids) === 1 ? "memory" : "memories"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (confirm(`Delete "${c.title}"? Memories inside won't be deleted.`)) {
                        void deleteCollection(c.id);
                      }
                    }}
                    aria-label="Delete collection"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

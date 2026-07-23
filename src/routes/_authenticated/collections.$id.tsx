import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Trash2, Plus, X, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { useCollection, removeNotesFromCollection, addNotesToCollection, renameCollection, deleteCollection } from "@/lib/collections";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/collections/$id")({
  head: () => ({
    meta: [
      { title: "Collection — Braintape" },
      { name: "description", content: "Memories in this collection." },
    ],
  }),
  component: CollectionDetail,
});

function CollectionDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const collection = useCollection(id);
  const notes = useLocalNotes();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");

  const memberIds = useMemo(() => new Set(collection?.note_ids ?? []), [collection]);
  const members = useMemo(
    () => (notes ?? []).filter((n) => memberIds.has(n.id) && !n.deleted_at),
    [notes, memberIds],
  );
  const candidates = useMemo(
    () => (notes ?? []).filter((n) => !memberIds.has(n.id) && !n.deleted_at && n.heading !== "__custom__"),
    [notes, memberIds],
  );

  if (collection === null) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="text-[15px] text-muted-foreground">Collection not found.</p>
        <Link to="/collections" className="rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground">
          Back to collections
        </Link>
      </div>
    );
  }
  if (collection === undefined) return null;

  function togglePick(nid: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(nid)) next.delete(nid);
      else next.add(nid);
      return next;
    });
  }

  async function confirmAdd() {
    if (picked.size === 0) {
      setPicking(false);
      return;
    }
    await addNotesToCollection(id, Array.from(picked));
    setPicked(new Set());
    setPicking(false);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background">
        <div className="flex items-center gap-2 px-4 py-3">
          <Link
            to="/collections"
            aria-label="Back"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:opacity-70"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          {editingTitle ? (
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (title.trim()) await renameCollection(id, title);
                setEditingTitle(false);
              }}
            >
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={async () => {
                  if (title.trim()) await renameCollection(id, title);
                  setEditingTitle(false);
                }}
                className="flex-1 bg-transparent text-[22px] font-bold tracking-tight outline-none"
                maxLength={80}
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setTitle(collection.title);
                setEditingTitle(true);
              }}
              className="flex-1 truncate text-left text-[22px] font-bold tracking-tight"
            >
              {collection.title}
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              if (confirm(`Delete "${collection.title}"? Memories inside won't be deleted.`)) {
                await deleteCollection(id);
                navigate({ to: "/collections" });
              }
            }}
            aria-label="Delete collection"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <section className="flex-1 px-4 pb-24 pt-4">
        {picking ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] text-muted-foreground">
                Select memories to add ({picked.size})
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPicked(new Set());
                    setPicking(false);
                  }}
                  className="rounded-full px-3 py-1.5 text-[13px] font-medium text-muted-foreground active:opacity-70"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAdd}
                  className="rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground active:opacity-80"
                >
                  Add
                </button>
              </div>
            </div>
            {candidates.length === 0 ? (
              <p className="rounded-2xl bg-card px-4 py-8 text-center text-[13px] text-muted-foreground ring-1 ring-border/60">
                No other memories to add.
              </p>
            ) : (
              <ul className="space-y-2">
                {candidates.map((n) => {
                  const sel = picked.has(n.id);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => togglePick(n.id)}
                        className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left shadow-sm ring-1 transition-colors ${
                          sel ? "bg-primary/10 ring-primary/40" : "bg-card ring-border/60"
                        }`}
                      >
                        <div
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            sel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                          }`}
                        >
                          {sel && <Check className="h-3 w-3" strokeWidth={3} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold text-foreground">
                            {n.heading ?? "Untitled"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-3 text-[14px] font-semibold text-muted-foreground active:opacity-70"
            >
              <Plus className="h-4 w-4" />
              Add memories
            </button>
            {members.length === 0 ? (
              <p className="rounded-2xl bg-card px-4 py-8 text-center text-[13px] text-muted-foreground ring-1 ring-border/60">
                This collection is empty.
              </p>
            ) : (
              <ul className="space-y-2">
                {members.map((n) => (
                  <li key={n.id}>
                    <div className="flex items-center gap-2">
                      <Link
                        to="/notes/$id"
                        params={{ id: n.id }}
                        className="flex flex-1 items-center gap-3 overflow-hidden rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-border/60 active:opacity-80"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold text-foreground">
                            {n.heading ?? "Untitled"}
                          </p>
                          <p className="truncate text-[12px] text-muted-foreground">
                            {n.summary ?? formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </Link>
                      <button
                        type="button"
                        onClick={() => void removeNotesFromCollection(id, [n.id])}
                        aria-label="Remove from collection"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, Plus, Search, FolderPlus, Loader2, Layers } from "lucide-react";
import { toast } from "sonner";
import { useLocalCollections } from "@/hooks/use-local-collections";
import { createCollection } from "@/lib/collections.functions";

export const Route = createFileRoute("/_authenticated/collections")({
  head: () => ({
    meta: [
      { title: "Collections — Braintape" },
      { name: "description", content: "Group your notes, links, and captures into collections." },
    ],
  }),
  component: CollectionsPage,
});

function CollectionsPage() {
  const collections = useLocalCollections();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    if (!collections) return undefined;
    const q = query.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [collections, query]);

  async function submitCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const col = await createCollection({ name });
      setCreating(false);
      setNewName("");
      navigate({ to: "/collections/$id", params: { id: col.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-md bg-background pb-32">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-background/95 px-2 py-2 backdrop-blur-xl">
        <Link
          to="/home"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:opacity-60"
          aria-label="Back"
        >
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[17px] font-semibold">Collections</h1>
      </header>

      <div className="px-4 pt-4">
        <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search collections"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <section className="px-4 pt-5">
        {filtered === undefined ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-8 rounded-3xl bg-card px-6 py-12 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-primary/10">
              <Layers className="h-5 w-5 text-primary" />
            </div>
            <p className="text-[16px] font-semibold text-foreground">
              {query ? "No matches" : "No collections yet"}
            </p>
            <p className="mx-auto mt-1 max-w-[260px] text-[13px] text-muted-foreground">
              {query
                ? "Try a different name."
                : "Group notes, links, and photos into named collections."}
            </p>
            {!query && (
              <button
                onClick={() => setCreating(true)}
                className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground active:opacity-80"
              >
                <FolderPlus className="h-4 w-4" />
                Create collection
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl bg-card">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link
                  to="/collections/$id"
                  params={{ id: c.id }}
                  className="flex w-full items-center gap-3 px-4 py-3.5 active:bg-muted/50"
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-[16px] font-semibold text-foreground">
                    {c.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-foreground">
                      {c.name}
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      {c.count} {c.count === 1 ? "item" : "items"}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Floating create button */}
      <button
        onClick={() => setCreating(true)}
        aria-label="New collection"
        className="fixed bottom-10 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95"
      >
        <Plus className="h-6 w-6" />
      </button>

      {creating && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={() => !busy && setCreating(false)}
        >
          <div
            className="w-full max-w-md rounded-t-[28px] bg-background p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[17px] font-semibold">New collection</h3>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="Collection name"
              className="mt-4 w-full rounded-2xl bg-muted px-4 py-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <div className="mt-4 flex gap-2">
              <button
                disabled={busy}
                onClick={() => setCreating(false)}
                className="flex-1 rounded-full bg-muted px-4 py-3 text-[15px] font-medium active:opacity-70"
              >
                Cancel
              </button>
              <button
                disabled={busy || !newName.trim()}
                onClick={submitCreate}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-[15px] font-semibold text-primary-foreground active:opacity-80 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

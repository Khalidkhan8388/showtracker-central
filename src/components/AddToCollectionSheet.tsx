import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X, Check, Loader2, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { useLocalCollections } from "@/hooks/use-local-collections";
import { addNotesToCollection, createCollection } from "@/lib/collections.functions";
import { db } from "@/lib/local-db";

type Props = {
  open: boolean;
  onClose: () => void;
  noteIds: string[];
  /** Called after a successful add so callers can clear selection. */
  onAdded?: (collectionId: string) => void;
};

export function AddToCollectionSheet({ open, onClose, noteIds, onAdded }: Props) {
  const collections = useLocalCollections();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [alreadyIn, setAlreadyIn] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setNewName("");
      setBusy(null);
      setAlreadyIn(new Set());
      return;
    }
    // If a single note is targeted, mark collections it's already in.
    if (noteIds.length !== 1) {
      setAlreadyIn(new Set());
      return;
    }
    (async () => {
      const rows = await db.collectionEntries.where("note_id").equals(noteIds[0]).toArray();
      setAlreadyIn(new Set(rows.map((r) => r.collection_id)));
    })();
  }, [open, noteIds]);

  if (!open) return null;

  async function addTo(collectionId: string) {
    if (!noteIds.length) return;
    setBusy(collectionId);
    try {
      await addNotesToCollection(collectionId, noteIds);
      toast.success(
        noteIds.length === 1 ? "Added to collection" : `Added ${noteIds.length} to collection`,
      );
      onAdded?.(collectionId);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    setBusy("__new__");
    try {
      const col = await createCollection({ name });
      if (noteIds.length) await addNotesToCollection(col.id, noteIds);
      toast.success(`Created "${col.name}"`);
      onAdded?.(col.id);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-t-[28px] bg-background pb-[max(env(safe-area-inset-bottom),16px)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <div>
            <h3 className="text-[17px] font-semibold text-foreground">Add to collection</h3>
            <p className="text-[12px] text-muted-foreground">
              {noteIds.length} {noteIds.length === 1 ? "entry" : "entries"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full text-foreground active:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-3 pb-2">
          {creating ? (
            <div className="mx-2 mb-3 rounded-2xl bg-card p-3 ring-1 ring-border/60">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createAndAdd();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
                placeholder="Collection name"
                className="w-full bg-transparent px-2 py-2 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              <div className="mt-1 flex justify-end gap-2">
                <button
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                  }}
                  className="rounded-full px-4 py-2 text-[13px] font-medium text-muted-foreground active:opacity-70"
                >
                  Cancel
                </button>
                <button
                  onClick={createAndAdd}
                  disabled={!newName.trim() || busy === "__new__"}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground active:opacity-80 disabled:opacity-40"
                >
                  {busy === "__new__" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Create
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-2xl bg-primary/10 px-4 py-3 text-left text-primary active:opacity-70"
            >
              <FolderPlus className="h-5 w-5" />
              <span className="text-[15px] font-semibold">Create new collection</span>
            </button>
          )}

          {collections === undefined ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : collections.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">
              No collections yet. Create one above.
            </p>
          ) : (
            <ul className="px-2">
              {collections.map((c) => {
                const already = alreadyIn.has(c.id);
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => addTo(c.id)}
                      disabled={busy !== null}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left active:bg-muted disabled:opacity-60"
                    >
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-[15px] font-semibold text-foreground">
                        {c.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold text-foreground">
                          {c.name}
                        </div>
                        <div className="text-[12px] text-muted-foreground">
                          {c.count} {c.count === 1 ? "item" : "items"}
                          {already ? " · already added" : ""}
                        </div>
                      </div>
                      {busy === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : already ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <Plus className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

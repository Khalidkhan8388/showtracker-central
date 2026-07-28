import { useState } from "react";
import { Folder, FolderPlus, Plus, X } from "lucide-react";

export function AddToCollectionSheet({
  collections,
  onClose,
  onPick,
  onCreate,
}: {
  collections: Array<{ id: string; title: string; note_ids: string[] }>;
  onClose: () => void;
  onPick: (collectionId: string) => void | Promise<void>;
  onCreate: (title: string) => void | Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-background p-4 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-foreground">Add to collection</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {creating ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const t = title.trim();
              if (!t) return;
              await onCreate(t);
              setTitle("");
              setCreating(false);
            }}
            className="mb-2 flex items-center gap-2 rounded-2xl bg-card px-4 py-3 ring-1 ring-border/60"
          >
            <FolderPlus className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New collection name"
              maxLength={80}
              className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              className="rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground"
            >
              Create
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mb-2 flex w-full items-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-3 text-left text-[14px] font-semibold text-muted-foreground active:opacity-70"
          >
            <Plus className="h-4 w-4" />
            New collection
          </button>
        )}

        <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
          {collections.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void onPick(c.id)}
                className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left ring-1 ring-border/60 active:opacity-80"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
                  <Folder className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-foreground">{c.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {(c.note_ids ?? []).length} {(c.note_ids ?? []).length === 1 ? "memory" : "memories"}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

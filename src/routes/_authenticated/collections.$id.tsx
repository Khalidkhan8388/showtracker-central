import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  ChevronLeft,
  Grid2X2,
  List,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
  Mic,
  Link2,
  FileText,
  Image as ImageIcon,
  Check,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useLocalCollection, useCollectionNoteIds } from "@/hooks/use-local-collections";
import { useLocalNotes } from "@/hooks/use-local-notes";
import {
  removeNotesFromCollection,
  updateCollection,
  deleteCollection,
  addNotesToCollection,
} from "@/lib/collections.functions";
import { getCachedPhotoUrl, getPhotoUrl, warmPhotoCache } from "@/lib/photo-cache";
import type { LocalNote } from "@/lib/local-db";

export const Route = createFileRoute("/_authenticated/collections/$id")({
  head: () => ({
    meta: [
      { title: "Collection — Braintape" },
      { name: "description", content: "Entries grouped in this collection." },
    ],
  }),
  component: CollectionDetail,
});

function CollectionDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const collection = useLocalCollection(id);
  const noteIds = useCollectionNoteIds(id);
  const allNotes = useLocalNotes();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const entries = useMemo<LocalNote[]>(() => {
    if (!noteIds || !allNotes) return [];
    const order = new Map(noteIds.map((nid, i) => [nid, i]));
    return (allNotes as LocalNote[])
      .filter((n) => order.has(n.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [noteIds, allNotes]);

  const signInFlightRef = useRef<Set<string>>(new Set());
  const signThumbsFor = useCallback((rows: LocalNote[]) => {
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
    if (paths.length) void warmPhotoCache(paths);
    if (!toFetch.length) return;
    Promise.all(
      toFetch.map(async ({ id: nid, path }) => ({ id: nid, path, url: await getPhotoUrl(path) })),
    ).then((pairs) => {
      setThumbs((cur) => {
        const next = { ...cur };
        for (const { id: nid, path, url } of pairs) {
          signInFlightRef.current.delete(path);
          if (url) next[nid] = url;
        }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    signThumbsFor(entries);
  }, [entries, signThumbsFor]);

  if (collection === undefined || noteIds === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (collection === null) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-background p-6 text-center">
        <p className="text-[17px] font-semibold">Collection not found</p>
        <Link to="/collections" className="mt-3 text-[13px] text-primary">Back to collections</Link>
      </div>
    );
  }

  const view = collection.view_mode;

  async function toggleView() {
    await updateCollection(id, { view_mode: view === "grid" ? "list" : "grid" });
  }

  async function onRemove(noteId: string) {
    await removeNotesFromCollection(id, [noteId]);
    toast.success("Removed from collection");
  }

  async function onDeleteCollection() {
    if (!confirm(`Delete "${collection!.name}"? Notes will stay in your library.`)) return;
    await deleteCollection(id);
    toast.success("Collection deleted");
    navigate({ to: "/collections" });
  }

  async function submitRename() {
    const name = renameVal.trim();
    if (!name) return;
    await updateCollection(id, { name });
    setRenameOpen(false);
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-md bg-background pb-32">
      <header className="sticky top-0 z-20 flex items-center gap-1 border-b border-border/60 bg-background/95 px-2 py-2 backdrop-blur-xl">
        <Link
          to="/collections"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:opacity-60"
          aria-label="Back"
        >
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="flex-1 truncate text-[17px] font-semibold">{collection.name}</h1>
        <button
          onClick={toggleView}
          aria-label={view === "grid" ? "List view" : "Grid view"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:bg-muted"
        >
          {view === "grid" ? <List className="h-5 w-5" /> : <Grid2X2 className="h-5 w-5" />}
        </button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="More"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:bg-muted"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)}>
          <div
            className="absolute right-3 top-14 w-52 overflow-hidden rounded-2xl bg-card shadow-lg ring-1 ring-border/60"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setMenuOpen(false);
                setRenameVal(collection.name);
                setRenameOpen(true);
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] active:bg-muted"
            >
              <Pencil className="h-4 w-4" />
              Rename
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                void onDeleteCollection();
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] text-destructive active:bg-muted"
            >
              <Trash2 className="h-4 w-4" />
              Delete collection
            </button>
          </div>
        </div>
      )}

      <div className="px-4 pt-3">
        <p className="text-[12px] text-muted-foreground">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </p>
      </div>

      <section className="px-4 pt-4">
        {entries.length === 0 ? (
          <div className="mt-6 rounded-3xl bg-card px-6 py-12 text-center">
            <p className="text-[16px] font-semibold text-foreground">Nothing here yet</p>
            <p className="mx-auto mt-1 max-w-[260px] text-[13px] text-muted-foreground">
              Add notes, voice memos, links, and photos to this collection.
            </p>
            <button
              onClick={() => setPickerOpen(true)}
              className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground active:opacity-80"
            >
              <Plus className="h-4 w-4" />
              Add captures
            </button>
          </div>
        ) : view === "grid" ? (
          <div className="columns-2 gap-3 [column-fill:_balance]">
            {entries.map((n) => (
              <div key={n.id} className="mb-3 break-inside-avoid">
                <EntryCard
                  note={n}
                  thumb={thumbs[n.id]}
                  onOpen={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
                  onRemove={() => onRemove(n.id)}
                />
              </div>
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl bg-card">
            {entries.map((n) => (
              <li key={n.id}>
                <div className="flex items-start gap-3 px-4 py-3">
                  <button
                    onClick={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
                    className="flex flex-1 items-start gap-3 text-left active:opacity-70"
                  >
                    <KindThumb note={n} thumb={thumbs[n.id]} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-foreground">
                        {n.heading || "Untitled"}
                      </div>
                      {n.summary && (
                        <div className="line-clamp-2 text-[12px] text-muted-foreground">
                          {n.summary}
                        </div>
                      )}
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => onRemove(n.id)}
                    aria-label="Remove from collection"
                    className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground active:bg-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {entries.length > 0 && (
        <button
          onClick={() => setPickerOpen(true)}
          aria-label="Add captures"
          className="fixed bottom-10 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {pickerOpen && (
        <NotePicker
          existingIds={new Set(noteIds)}
          onClose={() => setPickerOpen(false)}
          onPick={async (picked) => {
            if (!picked.length) return setPickerOpen(false);
            await addNotesToCollection(id, picked);
            toast.success(`Added ${picked.length}`);
            setPickerOpen(false);
          }}
        />
      )}

      {renameOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setRenameOpen(false)}>
          <div
            className="w-full max-w-md rounded-t-[28px] bg-background p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[17px] font-semibold">Rename collection</h3>
            <input
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitRename();
                if (e.key === "Escape") setRenameOpen(false);
              }}
              className="mt-4 w-full rounded-2xl bg-muted px-4 py-3 text-[15px] text-foreground outline-none"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setRenameOpen(false)}
                className="flex-1 rounded-full bg-muted px-4 py-3 text-[15px] font-medium active:opacity-70"
              >
                Cancel
              </button>
              <button
                onClick={submitRename}
                disabled={!renameVal.trim()}
                className="flex-1 rounded-full bg-primary px-4 py-3 text-[15px] font-semibold text-primary-foreground active:opacity-80 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KindThumb({ note, thumb }: { note: LocalNote; thumb?: string }) {
  if (thumb) {
    return <img src={thumb} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />;
  }
  const isVoice = note.duration_seconds != null;
  const isLink = !!note.source_url;
  const Icon = isVoice ? Mic : isLink ? Link2 : FileText;
  return (
    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
      <Icon className="h-5 w-5" />
    </div>
  );
}

function EntryCard({
  note,
  thumb,
  onOpen,
  onRemove,
}: {
  note: LocalNote;
  thumb?: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const isVoice = note.duration_seconds != null;
  const isLink = !!note.source_url;
  const host = (() => {
    if (!note.source_url) return null;
    try { return new URL(note.source_url).hostname.replace(/^www\./, ""); } catch { return null; }
  })();

  return (
    <div className="group relative overflow-hidden rounded-[15px] bg-card ring-1 ring-border/60">
      <button
        onClick={onOpen}
        className="block w-full text-left active:opacity-80"
      >
        {thumb && !isLink ? (
          <div className="relative">
            <img src={thumb} alt="" className="block w-full object-cover" style={{ aspectRatio: "3 / 4" }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
              <div className="line-clamp-2 text-[13px] font-semibold text-white">
                {note.heading || "Untitled"}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4">
            {isLink && host && (
              <div className="mb-1.5 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <Link2 className="h-3 w-3" />
                {host}
              </div>
            )}
            {isVoice && !host && (
              <div className="mb-1.5 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <Mic className="h-3 w-3" /> voice
              </div>
            )}
            <div className="line-clamp-3 text-[14px] font-semibold text-foreground">
              {note.heading || "Untitled"}
            </div>
            {note.summary && (
              <div className="mt-1 line-clamp-3 text-[12px] text-muted-foreground">
                {note.summary}
              </div>
            )}
          </div>
        )}
      </button>
      <button
        onClick={onRemove}
        aria-label="Remove"
        className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur active:opacity-100 group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function NotePicker({
  existingIds,
  onClose,
  onPick,
}: {
  existingIds: Set<string>;
  onClose: () => void;
  onPick: (ids: string[]) => void;
}) {
  const notes = useLocalNotes();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const list = (notes ?? []).filter(
      (n) => n.heading !== "__custom__" && !existingIds.has(n.id),
    );
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((n) => {
      const hay = [n.heading ?? "", n.summary ?? "", ...(n.tags ?? [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [notes, existingIds, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border/60 px-2 py-2">
        <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full active:bg-muted">
          <X className="h-5 w-5" />
        </button>
        <h2 className="flex-1 text-[16px] font-semibold">Add captures</h2>
        <button
          onClick={() => onPick(Array.from(selected))}
          disabled={selected.size === 0}
          className="rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground active:opacity-80 disabled:opacity-40"
        >
          Add {selected.size || ""}
        </button>
      </header>
      <div className="px-4 py-3">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search captures"
          className="w-full rounded-full bg-muted px-4 py-2 text-[14px] text-foreground outline-none"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-8">
        {filtered.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-muted-foreground">
            {notes === undefined ? "Loading…" : "Nothing left to add."}
          </p>
        ) : (
          <ul>
            {filtered.map((n) => {
              const isSel = selected.has(n.id);
              const Icon = n.duration_seconds != null ? Mic : n.source_url ? Link2 : (n.image_paths?.length ?? 0) > 0 ? ImageIcon : FileText;
              return (
                <li key={n.id}>
                  <button
                    onClick={() => toggle(n.id)}
                    className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left active:bg-muted"
                  >
                    <div className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${isSel ? "bg-foreground text-background" : "ring-1 ring-muted-foreground/40"}`}>
                      {isSel && <Check className="h-3 w-3" strokeWidth={3} />}
                    </div>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-foreground">
                        {n.heading || "Untitled"}
                      </div>
                      {n.summary && (
                        <div className="line-clamp-1 text-[12px] text-muted-foreground">{n.summary}</div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

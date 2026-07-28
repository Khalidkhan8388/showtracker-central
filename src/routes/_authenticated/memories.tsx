import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, FolderPlus, Pin, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getCachedPhotoUrl, getPhotoUrl, warmPhotoCache } from "@/lib/photo-cache";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { FeedNoteCard as NoteCard } from "@/components/FeedNoteCard";
import type { LocalNote } from "@/lib/local-db";
import { patchLocalNote, deleteLocalNotes, resync, clearPendingDelete } from "@/lib/sync-engine";
import { deleteNotes, pinNote } from "@/lib/notes.functions";
import { AddToCollectionSheet } from "@/components/AddToCollectionSheet";
import { useCollections, addNotesToCollection, createCollection } from "@/lib/collections";

export const Route = createFileRoute("/_authenticated/memories")({
  head: () => ({
    meta: [
      { title: "Memories — Braintape" },
      { name: "description", content: "Every memory you've saved, grouped by day and filterable by type." },
      { property: "og:title", content: "Memories — Braintape" },
      { property: "og:description", content: "Every memory you've saved, grouped by day and filterable by type." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MemoriesPage,
});

type Kind = "note" | "image" | "instagram" | "youtube" | "web" | "voice" | "media";

const KIND_LABELS: Array<{ key: Kind; label: string }> = [
  { key: "note", label: "Notes" },
  { key: "image", label: "Images" },
  { key: "voice", label: "Voice" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "web", label: "Web" },
  { key: "media", label: "Movies & TV" },
];

function kindOf(n: LocalNote): Kind {
  if (n.media) return "media";
  if (n.instagram) return "instagram";
  if (n.youtube) return "youtube";
  if (n.duration_seconds != null) return "voice";
  // Text notes stay "notes" even when they carry attached images.
  if (n.transcript != null && n.transcript.trim() !== "") return "note";
  if (Array.isArray(n.image_paths) && n.image_paths.length > 0) return "image";
  if (n.source_url) return "web";
  return "note";
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  if (t.getTime() === today.getTime()) return "Today";
  if (t.getTime() === yest.getTime()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function MemoriesPage() {
  const notes = useLocalNotes();
  const navigate = useNavigate();
  const [active, setActive] = useState<Kind | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAddToCollection, setShowAddToCollection] = useState(false);
  const allCollections = useCollections();
  const selectMode = selected.size > 0;

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await deleteLocalNotes(ids);
    setSelected(new Set());
    try {
      await deleteNotes({ data: { noteIds: ids } });
      await clearPendingDelete(ids);
    } catch {
      void resync();
    }
  }

  async function togglePinSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0 || !notes) return;
    const nextPinned = notes.some((n) => selected.has(n.id) && !n.pinned);
    await Promise.all(ids.map((id) => patchLocalNote(id, { pinned: nextPinned })));
    setSelected(new Set());
    try {
      await Promise.all(ids.map((noteId) => pinNote({ data: { noteId, pinned: nextPinned } })));
    } catch {
      void resync();
    }
  }



  const all = useMemo(
    () =>
      (notes ?? [])
        .filter((n) => !n.deleted_at)
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [notes],
  );

  useEffect(() => {
    const rows = all.filter((n) => Array.isArray(n.image_paths) && n.image_paths.length > 0);
    if (rows.length === 0) return;
    const paths = rows.map((n) => n.image_paths[0]).filter(Boolean) as string[];
    let cancelled = false;
    const apply = (pairs: Array<[string, string | undefined]>) => {
      if (cancelled) return;
      setThumbs((cur) => {
        let next = cur;
        for (const [id, url] of pairs) {
          if (url && next[id] !== url) {
            if (next === cur) next = { ...cur };
            next[id] = url;
          }
        }
        return next;
      });
    };
    apply(rows.map((n) => [n.id, getCachedPhotoUrl(n.image_paths[0])]));
    void warmPhotoCache(paths).then(() =>
      apply(rows.map((n) => [n.id, getCachedPhotoUrl(n.image_paths[0])])),
    );
    void Promise.all(
      rows.map(async (n) => [n.id, await getPhotoUrl(n.image_paths[0])] as [string, string]),
    ).then(apply);
    return () => {
      cancelled = true;
    };
  }, [all]);

  const counts = useMemo(() => {
    const m = new Map<Kind, number>();
    for (const n of all) {
      const k = kindOf(n);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [all]);

  const filtered = active ? all.filter((n) => kindOf(n) === active) : all;

  const groups = useMemo(() => {
    const out: Array<{ label: string; items: LocalNote[] }> = [];
    for (const n of filtered) {
      const label = dayLabel(n.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [filtered]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background">
        <div className="flex items-center gap-2 px-4 py-3">
          <Link
            to="/home"
            aria-label="Back"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:opacity-70"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-[22px] font-bold tracking-tight">Memories</h1>
        </div>
      </header>

      <section className="flex-1 px-4 pb-24 pt-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[34px] font-bold leading-none tracking-tight">{all.length}</span>
          <span className="text-[13px] text-muted-foreground">
            {all.length === 1 ? "entry saved" : "entries saved"}
          </span>
        </div>

        <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterPill label="All" count={all.length} active={active === null} onClick={() => setActive(null)} />
          {KIND_LABELS.filter((k) => (counts.get(k.key) ?? 0) > 0).map((k) => (
            <FilterPill
              key={k.key}
              label={k.label}
              count={counts.get(k.key) ?? 0}
              active={active === k.key}
              onClick={() => setActive(active === k.key ? null : k.key)}
            />
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.label} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-semibold text-foreground">{g.label}</span>
                <span className="text-[11px] text-muted-foreground">{g.items.length}</span>
              </div>
              <div className="columns-2 gap-3 [column-fill:_balance]">
                {g.items.map((n) => (
                  <div key={n.id} className="mb-3 break-inside-avoid">
                    <NoteCard
                      note={n}
                      variant="masonry"
                      thumbUrl={thumbs[n.id]}
                      selected={selected.has(n.id)}
                      selectMode={selectMode}
                      onOpen={() => navigate({ to: "/notes/$id", params: { id: n.id } })}
                      onLongPress={() => toggleSel(n.id)}
                      onToggleSel={() => toggleSel(n.id)}
                    />

                  </div>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && (
            <p className="py-16 text-center text-[13px] text-muted-foreground">Nothing here yet.</p>
          )}
        </div>
      </section>

      {selectMode && (
        <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-center px-5">
          <div className="pointer-events-auto inline-flex items-center gap-0 rounded-full bg-white/90 p-1 shadow-lg ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150 dark:bg-neutral-900/90 dark:ring-white/10">
            <button
              onClick={() => setSelected(new Set())}
              aria-label="Cancel selection"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-900 hover:bg-black/5 active:scale-90 active:opacity-70 dark:text-white dark:hover:bg-white/10"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
            <span className="px-1 text-xs font-semibold text-neutral-900 dark:text-white">{selected.size}</span>
            <button
              onClick={togglePinSelected}
              aria-label="Pin selected"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-black/5 active:scale-90 active:opacity-70 dark:text-white dark:hover:bg-white/10"
            >
              <Pin aria-hidden="true" className="h-3.5 w-3.5" />
              Pin
            </button>
            <div className="mx-1 h-4 w-px bg-black/10 dark:bg-white/10" />
            <button
              onClick={confirmDelete}
              className="inline-flex items-center gap-1.5 rounded-full bg-destructive/90 px-3 py-2 text-xs font-semibold text-destructive-foreground shadow-sm active:scale-90 active:opacity-90"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>

  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium ring-1 transition active:scale-95 ${
        active
          ? "bg-primary text-primary-foreground ring-transparent"
          : "bg-card text-foreground ring-border/60"
      }`}
    >
      <span>{label}</span>
      <span className={active ? "opacity-70" : "text-muted-foreground"}>{count}</span>
    </button>
  );
}

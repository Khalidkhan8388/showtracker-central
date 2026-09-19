import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, RotateCcw, Trash2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useLocalDeletedNotes } from "@/hooks/use-local-notes";
import { hardDeleteLocalNotes, restoreLocalNotes } from "@/lib/sync-engine";
import { purgeExpiredNotes, purgeNotes, restoreNotes } from "@/lib/notes.functions";
import { NoteCard, type Note } from "@/components/NoteCard";
import { getCachedPhotoUrl, getPhotoUrl, warmPhotoCache } from "@/lib/photo-cache";

export const Route = createFileRoute("/_authenticated/profile_/trash")({
  head: () => ({
    meta: [
      { title: "Recently Deleted — Braintape" },
      { name: "description", content: "Restore or permanently remove notes deleted in the last 30 days." },
    ],
  }),
  component: TrashPage,
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return 0;
  const remaining = THIRTY_DAYS_MS - (Date.now() - new Date(deletedAt).getTime());
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

function TrashPage() {
  const deleted = useLocalDeletedNotes();
  const restoreFn = restoreNotes;
  const purgeFn = purgeNotes;
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    void purgeExpiredNotes().catch(() => {});
  }, []);

  const items = useMemo(() => (deleted ?? []) as Note[], [deleted]);
  const selectMode = selected.size > 0;

  const signInFlightRef = useRef<Set<string>>(new Set());
  const signThumbsFor = useCallback((rows: Note[]) => {
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
    if (toFetch.length === 0) return;
    Promise.all(
      toFetch.map(async ({ id, path }) => ({ id, path, url: await getPhotoUrl(path) })),
    ).then((pairs) => {
      setThumbs((cur) => {
        const next = { ...cur };
        for (const { id, path, url } of pairs) {
          signInFlightRef.current.delete(path);
          if (url) next[id] = url;
        }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    if (items.length) signThumbsFor(items);
  }, [items, signThumbsFor]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function restoreSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await restoreLocalNotes(ids);
      await restoreFn({ data: { noteIds: ids } });
      setSelected(new Set());
      toast.success(`Restored ${ids.length}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function purgeSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} note${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await hardDeleteLocalNotes(ids);
      await purgeFn({ data: { noteIds: ids } });
      setSelected(new Set());
      toast.success("Deleted forever");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function purgeAll() {
    if (items.length === 0) return;
    if (!confirm(`Permanently delete all ${items.length} notes? This cannot be undone.`)) return;
    const ids = items.map((n) => n.id);
    setBusy(true);
    try {
      await hardDeleteLocalNotes(ids);
      await purgeFn({ data: { noteIds: ids } });
      setSelected(new Set());
      toast.success("Deleted forever");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-32">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-background/95 px-2 py-2 backdrop-blur-xl">
        <Link
          to="/profile"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:opacity-60"
          aria-label="Back"
        >
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[17px] font-semibold">Recently Deleted</h1>
      </header>

      <div className="px-4 pt-3 text-[13px] text-muted-foreground">
        Notes here are permanently removed after 30 days. Long-press to select.
      </div>

      <section className="flex-1 px-4 pt-3">
        {deleted === undefined ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="mt-8 rounded-2xl bg-card p-8 text-center">
            <Trash2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <div className="text-[15px] font-medium">Nothing here</div>
            <div className="mt-1 text-[13px] text-muted-foreground">Deleted notes will appear here for 30 days.</div>
          </div>
        ) : (
          <div className="columns-2 gap-3 [column-fill:_balance]">
            {items.map((n) => {
              const remaining = daysLeft(n.deleted_at ?? null);
              return (
                <div key={n.id} className="mb-3 break-inside-avoid">
                  <div className="relative">
                    <NoteCard
                      note={n}
                      variant="masonry"
                      thumbUrl={thumbs[n.id]}
                      selected={selected.has(n.id)}
                      selectMode={selectMode}
                      onOpen={() => toggle(n.id)}
                      onLongPress={() => toggle(n.id)}
                      onToggleSel={() => toggle(n.id)}
                    />
                    <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                      {remaining}d left
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Bottom pill — always visible with counts + actions */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-5">
        {selectMode ? (
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/90 px-2 py-2 text-neutral-900 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150 dark:bg-neutral-900/90 dark:text-white dark:ring-white/10">
            <button
              onClick={() => setSelected(new Set())}
              aria-label="Cancel"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full active:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
            <span className="px-1 text-[13px] font-semibold tabular-nums">{selected.size}</span>
            <button
              disabled={busy}
              onClick={restoreSelected}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground/10 px-3 py-1.5 text-[13px] font-semibold active:opacity-70 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restore
            </button>
            <button
              disabled={busy}
              onClick={purgeSelected}
              className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-[13px] font-semibold text-destructive-foreground active:opacity-70 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        ) : (
          items.length > 0 && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-neutral-900 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl backdrop-saturate-150 dark:bg-neutral-900/90 dark:text-white dark:ring-white/10">
              <button
                onClick={() => setSelected(new Set(items.map((n) => n.id)))}
                className="inline-flex items-center gap-1.5 rounded-full bg-foreground/10 px-3 py-1.5 text-[13px] font-semibold active:opacity-70"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore all
              </button>
              <button
                disabled={busy}
                onClick={purgeAll}
                className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-[13px] font-semibold text-destructive-foreground active:opacity-70 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete all
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

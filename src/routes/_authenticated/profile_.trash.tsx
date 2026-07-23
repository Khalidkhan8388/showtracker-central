import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, RotateCcw, Trash2, Loader2, Image as ImageIcon, Mic, Link2, FileText } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useLocalDeletedNotes } from "@/hooks/use-local-notes";
import { hardDeleteLocalNotes, restoreLocalNotes } from "@/lib/sync-engine";
import { purgeExpiredNotes, purgeNotes, restoreNotes } from "@/lib/notes.functions";
import type { LocalNote } from "@/lib/local-db";

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

function kindOf(n: LocalNote): { icon: React.ReactNode; label: string } {
  if (n.source_url) return { icon: <Link2 className="h-4 w-4" />, label: "Link" };
  if (n.audio_path) return { icon: <Mic className="h-4 w-4" />, label: "Voice" };
  if (n.image_paths.length > 0) return { icon: <ImageIcon className="h-4 w-4" />, label: "Photo" };
  return { icon: <FileText className="h-4 w-4" />, label: "Note" };
}

function TrashPage() {
  const deleted = useLocalDeletedNotes();
  const purgeExpiredFn = useServerFn(purgeExpiredNotes);
  const restoreFn = useServerFn(restoreNotes);
  const purgeFn = useServerFn(purgeNotes);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Purge >30-day notes on load so the trash view reflects reality.
  useEffect(() => {
    void purgeExpiredFn({}).catch(() => {});
  }, [purgeExpiredFn]);

  const items = useMemo(() => deleted ?? [], [deleted]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function restoreOne(id: string) {
    setBusy(true);
    try {
      await restoreLocalNotes([id]);
      await restoreFn({ data: { noteIds: [id] } });
      toast.success("Restored");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function purgeOne(id: string) {
    if (!confirm("Permanently delete this note? This cannot be undone.")) return;
    setBusy(true);
    try {
      await hardDeleteLocalNotes([id]);
      await purgeFn({ data: { noteIds: [id] } });
      toast.success("Deleted forever");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="mx-auto min-h-screen w-full max-w-md bg-background pb-40">
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

      <div className="px-4 pt-4 text-[13px] text-muted-foreground">
        Notes here are permanently removed after 30 days.
      </div>

      {deleted === undefined ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="mx-4 mt-8 rounded-2xl bg-card p-8 text-center">
          <Trash2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <div className="text-[15px] font-medium">Nothing here</div>
          <div className="mt-1 text-[13px] text-muted-foreground">Deleted notes will appear here for 30 days.</div>
        </div>
      ) : (
        <div className="mt-4 space-y-2 px-4">
          {items.map((n) => {
            const isSelected = selected.has(n.id);
            const remaining = daysLeft(n.deleted_at);
            const kind = kindOf(n);
            const title = n.heading?.trim() || "Untitled";
            return (
              <div
                key={n.id}
                className={`rounded-2xl bg-card p-3 transition-colors ${isSelected ? "ring-2 ring-primary" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggle(n.id)}
                    aria-label={isSelected ? "Deselect" : "Select"}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      isSelected ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`}
                  >
                    {isSelected && <span className="h-2 w-2 rounded-full bg-primary-foreground" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {kind.icon}
                      <span>{kind.label}</span>
                      <span>·</span>
                      <span>{remaining} day{remaining === 1 ? "" : "s"} left</span>
                    </div>
                    <div className="mt-0.5 truncate text-[15px] font-medium">{title}</div>
                    {n.summary && (
                      <div className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{n.summary}</div>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => restoreOne(n.id)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-muted px-3 py-2 text-[13px] font-medium active:opacity-70 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restore
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => purgeOne(n.id)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive active:opacity-70 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-30 mx-auto flex w-fit items-center gap-2 rounded-full bg-foreground/95 px-3 py-2 text-background shadow-2xl backdrop-blur-xl">
          <span className="px-2 text-[13px] font-medium">{selected.size} selected</span>
          <button
            disabled={busy}
            onClick={restoreSelected}
            className="flex items-center gap-1.5 rounded-full bg-background/10 px-3 py-1.5 text-[13px] font-medium active:opacity-70 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restore
          </button>
          <button
            disabled={busy}
            onClick={purgeSelected}
            className="flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-[13px] font-medium text-destructive-foreground active:opacity-70 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="rounded-full px-2 py-1.5 text-[13px] active:opacity-70"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Trash2, Sun, Moon, Monitor, Loader2, ChevronRight, Download, Upload } from "lucide-react";
import { deleteAccount } from "@/lib/notes.functions";
import { downloadExport, importFromFile, type ImportMode } from "@/lib/backup";
import { useTheme } from "@/lib/theme";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Braintape" },
      { name: "description", content: "Appearance and preferences for your local second brain." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { mode, setMode, sizeScale, setSizeScale } = useTheme();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [hideMedia, setHideMedia] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("hide-media-on-home") === "1";
  });
  function toggleHideMedia(next: boolean) {
    setHideMedia(next);
    localStorage.setItem("hide-media-on-home", next ? "1" : "0");
    window.dispatchEvent(new Event("braintape:pref-changed"));
  }


  async function confirmDelete() {
    setDeleting(true);
    try {
      await deleteAccount();
      toast.success("All data wiped");
      // full reload to clear any in-memory caches (object URLs, memoized queries)
      if (typeof window !== "undefined") window.location.assign("/home");
      else navigate({ to: "/home" });
    } catch (e) {
      setDeleting(false);
      toast.error(e instanceof Error ? e.message : "Failed to wipe data");
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await downloadExport();
      toast.success("Backup downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function pickImport(mode: ImportMode) {
    setImportMode(mode);
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !importMode) return;
    setImporting(true);
    try {
      const summary = await importFromFile(file, importMode);
      toast.success(`Imported ${summary.notes} notes, ${summary.photos + summary.audios} files`);
      if (typeof window !== "undefined") window.location.assign("/home");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      setImportMode(null);
    }
  }


  return (
    <div className="mx-auto min-h-screen w-full max-w-md bg-background pb-16">
      <PageHeader title="Profile" backTo="/home" />

      {/* Identity */}
      <section className="px-4 pt-6">
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground"
          >
            B
          </div>

          <div className="min-w-0">
            <div className="truncate text-[20px] font-semibold leading-tight">Local device</div>
            <div className="truncate text-[13px] text-muted-foreground">
              Everything you capture is stored on this device only.
            </div>
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="px-4 pt-8">
        <SectionTitle>Appearance</SectionTitle>
        <div className="rounded-2xl bg-card p-1">
          <div className="grid grid-cols-3 gap-1">
            <ModeChip active={mode === "light"} onClick={() => setMode("light")} icon={<Sun className="h-4 w-4" />} label="Light" />
            <ModeChip active={mode === "dark"} onClick={() => setMode("dark")} icon={<Moon className="h-4 w-4" />} label="Dark" />
            <ModeChip active={mode === "system"} onClick={() => setMode("system")} icon={<Monitor className="h-4 w-4" />} label="System" />
          </div>
        </div>
      </section>




      {/* Component size */}
      <section className="px-4 pt-6">
        <SectionTitle>Component size</SectionTitle>
        <button
          type="button"
          onClick={() => setSizeScale(sizeScale === "small" ? "default" : "small")}
          className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3.5 text-left active:bg-muted/50"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[15px]">Compact size</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              Scales the entire app down to a smaller size.
            </div>
          </div>
          <span
            role="switch"
            aria-checked={sizeScale === "small"}
            className={`relative inline-block h-7 w-12 shrink-0 rounded-full transition-colors ${sizeScale === "small" ? "bg-primary" : "bg-muted"}`}
          >
            <span
              className="absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-card shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out"
              style={{ transform: sizeScale === "small" ? "translateX(20px)" : "translateX(0)" }}
            />
          </span>
        </button>
      </section>

      {/* Home preferences */}
      <section className="px-4 pt-8">
        <SectionTitle>Home page</SectionTitle>




        <button
          type="button"
          onClick={() => toggleHideMedia(!hideMedia)}
          className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3.5 text-left active:bg-muted/50"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[15px]">Hide movies & TV shows</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              Only show them in Search and Collections.
            </div>
          </div>
          <span
            role="switch"
            aria-checked={hideMedia}
            className={`relative inline-block h-7 w-12 shrink-0 rounded-full transition-colors ${hideMedia ? "bg-primary" : "bg-muted"}`}
          >
            <span
              className="absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-card shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out"
              style={{ transform: hideMedia ? "translateX(20px)" : "translateX(0)" }}
            />
          </span>
        </button>

      </section>

      {/* Data */}
      <section className="px-4 pt-8">
        <SectionTitle>Data</SectionTitle>

        <div className="overflow-hidden rounded-2xl bg-card divide-y divide-border/60">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/50 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="h-5 w-5 animate-spin text-foreground/70" /> : <Download className="h-5 w-5 text-foreground/70" />}
            <span className="flex-1 text-[15px]">{exporting ? "Exporting…" : "Export backup"}</span>
          </button>
          <button
            onClick={() => pickImport("merge")}
            disabled={importing}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/50 disabled:opacity-60"
          >
            {importing ? <Loader2 className="h-5 w-5 animate-spin text-foreground/70" /> : <Upload className="h-5 w-5 text-foreground/70" />}
            <span className="flex-1 text-[15px]">{importing ? "Importing…" : "Import (merge)"}</span>
          </button>
          <button
            onClick={() => pickImport("replace")}
            disabled={importing}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-destructive active:bg-muted/50 disabled:opacity-60"
          >
            <Upload className="h-5 w-5" />
            <span className="flex-1 text-[15px]">Import & replace all</span>
          </button>
          <Link
            to={"/profile/trash" as any}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/50"
          >
            <Trash2 className="h-5 w-5 text-foreground/70" />
            <span className="flex-1 text-[15px]">Recently Deleted</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleImportFile}
        />
        <p className="mt-2 px-1 text-[12px] text-muted-foreground">
          Backup includes every note, photo, and voice clip on this device. Deleted notes stay recoverable for 30 days.
        </p>
      </section>

      {/* Danger zone */}
      <section className="px-4 pt-8">
        <SectionTitle>Danger zone</SectionTitle>
        <div className="overflow-hidden rounded-2xl bg-card">
          <button
            onClick={() => setConfirmOpen(true)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-destructive active:bg-muted/50"
          >
            <Trash2 className="h-5 w-5" />
            <span className="flex-1 text-[15px]">Wipe all data</span>
          </button>
        </div>
        <p className="mt-2 px-1 text-[12px] text-muted-foreground">
          This permanently removes every note, task, photo, and voice clip from this device.
        </p>
      </section>

      {/* Delete confirmation */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4" onClick={() => !deleting && setConfirmOpen(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[17px] font-semibold">Wipe all data?</h3>
            <p className="mt-2 text-[14px] text-muted-foreground">
              This permanently removes every note, task, photo, and voice clip from this device. This cannot be undone.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                disabled={deleting}
                onClick={() => setConfirmOpen(false)}
                className="flex-1 rounded-full bg-muted px-4 py-3 text-[15px] font-medium press-bounce active:opacity-70"
              >
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={confirmDelete}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-destructive px-4 py-3 text-[15px] font-medium text-destructive-foreground active:opacity-80"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {deleting ? "Wiping…" : "Wipe"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 px-1 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

function ModeChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-xl py-3 text-[12px] transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-foreground/70 active:bg-muted/50"
      }`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  );
}

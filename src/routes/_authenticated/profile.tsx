import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Trash2,
  Sun,
  Moon,
  Monitor,
  Check,
  Loader2,
  ChevronRight,
  Download,
  Upload,
  Cloud,
  CloudOff,
  RefreshCw,
} from "lucide-react";
import { deleteAccount } from "@/lib/notes.functions";
import { downloadExport, importFromFile, type ImportMode } from "@/lib/backup";
import { ACCENTS, SIZE_SCALES, useTheme } from "@/lib/theme";
import {
  connectDrive,
  disconnect as disconnectDriveFn,
  fetchStatus,
  getInterval,
  getLastSyncAt,
  INTERVAL_LABEL,
  setInterval_,
  syncNow,
  type IntervalKey,
} from "@/lib/drive-sync";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Braintape" },
      { name: "description", content: "Appearance, backups, and Google Drive sync for your local second brain." },
    ],
  }),
  component: ProfilePage,
});

const INTERVAL_ORDER: IntervalKey[] = ["off", "10m", "1d", "5d", "10d"];

function ProfilePage() {
  const { mode, setMode, accent, setAccentId, sizeScale, setSizeScale } = useTheme();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Drive sync state
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [driveRemote, setDriveRemote] = useState<{ modifiedTime: string | null; size: number | null } | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [interval, setIntervalState] = useState<IntervalKey>("off");
  const [lastSyncAt, setLastSync] = useState<number>(0);
  const [intervalOpen, setIntervalOpen] = useState(false);

  useEffect(() => {
    setIntervalState(getInterval());
    setLastSync(getLastSyncAt());
    refreshStatus();
  }, []);

  async function refreshStatus() {
    try {
      const s = await fetchStatus();
      setDriveConnected(s.connected);
      setDriveRemote(s.connected ? s.remote : null);
    } catch (e) {
      console.warn(e);
      setDriveConnected(false);
    }
  }

  async function handleConnect() {
    setConnectingDrive(true);
    try {
      const res = await connectDrive();
      if (!res.ok) throw new Error(res.error || "Failed to connect");
      toast.success("Google Drive connected");
      await refreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connect failed");
    } finally {
      setConnectingDrive(false);
    }
  }

  async function handleDisconnect() {
    setConnectingDrive(true);
    try {
      await disconnectDriveFn();
      toast.success("Disconnected");
      setDriveConnected(false);
      setDriveRemote(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setConnectingDrive(false);
    }
  }

  async function handleSyncNow(force?: "upload" | "download") {
    setSyncing(true);
    try {
      const r = await syncNow(force ? { force } : undefined);
      setLastSync(r.at);
      await refreshStatus();
      if (r.direction === "upload") toast.success("Uploaded to Drive");
      else if (r.direction === "download") toast.success("Downloaded from Drive");
      else toast.success("Already up to date");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  function pickInterval(v: IntervalKey) {
    setInterval_(v);
    setIntervalState(v);
    setIntervalOpen(false);
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await deleteAccount();
      toast.success("All data wiped");
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
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-background/95 px-2 py-2 backdrop-blur-xl">
        <Link
          to="/home"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:opacity-60"
          aria-label="Back"
        >
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[17px] font-semibold">Profile</h1>
      </header>

      {/* Identity */}
      <section className="px-4 pt-6">
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-semibold"
            style={{ background: accent.primary, color: accent.foreground }}
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

      {/* Accent */}
      <section className="px-4 pt-6">
        <SectionTitle>Accent color</SectionTitle>
        <div className="rounded-2xl bg-card p-4">
          <div className="flex flex-wrap gap-3">
            {ACCENTS.map((a) => {
              const selected = a.id === accent.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setAccentId(a.id)}
                  aria-label={a.name}
                  className="relative h-10 w-10 rounded-full transition-transform active:scale-95"
                  style={{
                    background: a.primary,
                    boxShadow: selected ? `0 0 0 2px var(--background), 0 0 0 4px ${a.primary}` : "none",
                  }}
                >
                  {selected && <Check className="absolute inset-0 m-auto h-5 w-5" style={{ color: a.foreground }} />}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">{accent.name}</p>
        </div>
      </section>

      {/* Component size */}
      <section className="px-4 pt-6">
        <SectionTitle>Component size</SectionTitle>
        <div className="rounded-2xl bg-card p-1">
          <div className="grid grid-cols-2 gap-1">
            {SIZE_SCALES.map((s) => {
              const selected = s.id === sizeScale;
              return (
                <button
                  key={s.id}
                  onClick={() => setSizeScale(s.id)}
                  className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-medium transition-colors ${
                    selected ? "bg-primary text-primary-foreground" : "text-muted-foreground active:bg-muted/50"
                  }`}
                >
                  <span style={{ fontSize: `${13 * s.value}px` }} className="font-semibold">Aa</span>
                  <span>{s.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="mt-2 px-1 text-[12px] text-muted-foreground">
          Scales the entire app to your preferred size.
        </p>
      </section>

      {/* Google Drive sync */}
      <section className="px-4 pt-8">
        <SectionTitle>Google Drive sync</SectionTitle>
        <div className="overflow-hidden rounded-2xl bg-card divide-y divide-border/60">
          {/* Connection row */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            {driveConnected ? (
              <Cloud className="h-5 w-5 text-foreground/70" />
            ) : (
              <CloudOff className="h-5 w-5 text-foreground/70" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[15px]">
                {driveConnected === null ? "Checking…" : driveConnected ? "Connected" : "Not connected"}
              </div>
              {driveConnected && driveRemote?.modifiedTime && (
                <div className="truncate text-[12px] text-muted-foreground">
                  Cloud backup · {new Date(driveRemote.modifiedTime).toLocaleString()}
                </div>
              )}
            </div>
            {driveConnected ? (
              <button
                disabled={connectingDrive}
                onClick={handleDisconnect}
                className="rounded-full bg-muted px-3 py-1.5 text-[13px] font-medium active:opacity-70 disabled:opacity-60"
              >
                {connectingDrive ? "…" : "Disconnect"}
              </button>
            ) : (
              <button
                disabled={connectingDrive}
                onClick={handleConnect}
                className="rounded-full bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground active:opacity-80 disabled:opacity-60"
              >
                {connectingDrive ? "…" : "Connect"}
              </button>
            )}
          </div>

          {/* Sync now */}
          <button
            onClick={() => handleSyncNow()}
            disabled={!driveConnected || syncing}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/50 disabled:opacity-60"
          >
            {syncing ? (
              <Loader2 className="h-5 w-5 animate-spin text-foreground/70" />
            ) : (
              <RefreshCw className="h-5 w-5 text-foreground/70" />
            )}
            <span className="flex-1 text-[15px]">{syncing ? "Syncing…" : "Sync now"}</span>
            {lastSyncAt > 0 && !syncing && (
              <span className="text-[12px] text-muted-foreground">
                {new Date(lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </button>

          {/* Auto-sync interval */}
          <button
            onClick={() => setIntervalOpen(true)}
            disabled={!driveConnected}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/50 disabled:opacity-60"
          >
            <RefreshCw className="h-5 w-5 text-foreground/70" />
            <span className="flex-1 text-[15px]">Auto-sync</span>
            <span className="text-[13px] text-muted-foreground">{INTERVAL_LABEL[interval]}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>

          {/* Force upload / download */}
          <button
            onClick={() => handleSyncNow("upload")}
            disabled={!driveConnected || syncing}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/50 disabled:opacity-60"
          >
            <Upload className="h-5 w-5 text-foreground/70" />
            <span className="flex-1 text-[15px]">Upload this device to Drive</span>
          </button>
          <button
            onClick={() => handleSyncNow("download")}
            disabled={!driveConnected || syncing || !driveRemote}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-destructive active:bg-muted/50 disabled:opacity-60"
          >
            <Download className="h-5 w-5" />
            <span className="flex-1 text-[15px]">Download & replace this device</span>
          </button>
        </div>
        <p className="mt-2 px-1 text-[12px] text-muted-foreground">
          A single backup file is kept in your Drive's hidden app folder. Auto-sync runs only while Braintape is open. Newest side wins.
        </p>
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

      {/* Interval sheet */}
      {intervalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4"
          onClick={() => setIntervalOpen(false)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-3xl bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border/60 px-5 py-3 text-[13px] font-medium text-muted-foreground">
              Auto-sync interval
            </div>
            <div className="divide-y divide-border/60">
              {INTERVAL_ORDER.map((k) => (
                <button
                  key={k}
                  onClick={() => pickInterval(k)}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left active:bg-muted/50"
                >
                  <span className="flex-1 text-[15px]">{INTERVAL_LABEL[k]}</span>
                  {interval === k && <Check className="h-5 w-5 text-primary" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
                className="flex-1 rounded-full bg-muted px-4 py-3 text-[15px] font-medium active:opacity-70"
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

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Trash2, Sun, Moon, Monitor, Loader2, ChevronRight, Download, Upload, Cloud, CloudOff, RefreshCw, KeyRound, ArrowUp, ArrowDown, X } from "lucide-react";
import {
  PROVIDERS,
  listKeys,
  addKey,
  removeKey,
  toggleKey,
  moveKey,
  maskKey,
  testKey,
  type AiKey,
  type AiProvider,
} from "@/lib/ai-keys";
import { deleteAccount } from "@/lib/notes.functions";
import { downloadExport, importFromFile, type ImportMode } from "@/lib/backup";
import {
  connectGoogle,
  disconnectGoogle,
  isConnected as driveConnected,
  connectedEmail,
  autoSyncEnabled,
  setAutoSync,
  lastBackupAt,
  restoreFromDrive,
} from "@/lib/google-drive";
import { backupNowManual, getSyncState } from "@/lib/gdrive-sync";
import { useTheme } from "@/lib/theme";
import { toast } from "sonner";

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
              className="absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform"
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
              className="absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform"
              style={{ transform: hideMedia ? "translateX(20px)" : "translateX(0)" }}
            />
          </span>
        </button>

      </section>

      <GoogleSyncSection />



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

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function GoogleSyncSection() {
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [last, setLast] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [busy, setBusy] = useState<null | "connect" | "backup" | "restore">(null);

  useEffect(() => {
    const read = () => {
      setConnected(driveConnected());
      setEmail(connectedEmail());
      setAuto(autoSyncEnabled());
      setLast(lastBackupAt());
      setStatus(getSyncState().state);
    };
    read();
    window.addEventListener("braintape:gdrive-changed", read);
    const t = setInterval(read, 15_000);
    return () => {
      window.removeEventListener("braintape:gdrive-changed", read);
      clearInterval(t);
    };
  }, []);

  async function handleConnect() {
    setBusy("connect");
    try {
      const mail = await connectGoogle();
      toast.success(mail ? `Connected as ${mail}` : "Google connected");
      await backupNowManual();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't connect to Google");
    } finally {
      setBusy(null);
    }
  }

  async function handleBackup() {
    setBusy("backup");
    try {
      await backupNowManual();
      toast.success("Backed up to Google Drive");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    setBusy("restore");
    try {
      const s = await restoreFromDrive("merge");
      toast.success(`Restored ${s.notes} notes and ${s.photos + s.audios} files`);
      if (typeof window !== "undefined") window.location.assign("/home");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(null);
    }
  }

  const statusLabel =
    status === "syncing"
      ? "Backing up…"
      : status === "offline"
        ? "Offline — will back up later"
        : status === "error"
          ? "Last backup failed"
          : `Backed up ${relTime(last)}`;

  return (
    <section className="px-4 pt-8">
      <SectionTitle>Google Drive</SectionTitle>

      {!connected ? (
        <>
          <button
            onClick={handleConnect}
            disabled={busy === "connect"}
            className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3.5 text-left active:bg-muted/50 disabled:opacity-60"
          >
            {busy === "connect" ? (
              <Loader2 className="h-5 w-5 animate-spin text-foreground/70" />
            ) : (
              <Cloud className="h-5 w-5 text-foreground/70" />
            )}
            <span className="flex-1 text-[15px]">Connect Google account</span>
          </button>
          <p className="mt-2 px-1 text-[12px] text-muted-foreground">
            Keeps a private copy of every note, photo, voice note and PDF in your own Google Drive.
            It stays hidden from your Drive files and only Braintape can read it.
          </p>
        </>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl bg-card divide-y divide-border/60">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <Cloud className="h-5 w-5 text-foreground/70" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px]">{email ?? "Google account"}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {statusLabel}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setAutoSync(!auto);
                setAuto(!auto);
              }}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[15px]">Automatic backup</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  Saves a few seconds after you change anything.
                </div>
              </div>
              <span
                role="switch"
                aria-checked={auto}
                className={`relative inline-block h-7 w-12 shrink-0 rounded-full transition-colors ${auto ? "bg-primary" : "bg-muted"}`}
              >
                <span
                  className="absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform"
                  style={{ transform: auto ? "translateX(20px)" : "translateX(0)" }}
                />
              </span>
            </button>

            <button
              onClick={handleBackup}
              disabled={busy !== null}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/50 disabled:opacity-60"
            >
              {busy === "backup" ? (
                <Loader2 className="h-5 w-5 animate-spin text-foreground/70" />
              ) : (
                <Upload className="h-5 w-5 text-foreground/70" />
              )}
              <span className="flex-1 text-[15px]">Back up now</span>
            </button>

            <button
              onClick={handleRestore}
              disabled={busy !== null}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/50 disabled:opacity-60"
            >
              {busy === "restore" ? (
                <Loader2 className="h-5 w-5 animate-spin text-foreground/70" />
              ) : (
                <RefreshCw className="h-5 w-5 text-foreground/70" />
              )}
              <span className="flex-1 text-[15px]">Restore from Google Drive</span>
            </button>

            <button
              onClick={() => {
                disconnectGoogle();
                toast.success("Google disconnected");
              }}
              disabled={busy !== null}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-destructive active:bg-muted/50 disabled:opacity-60"
            >
              <CloudOff className="h-5 w-5" />
              <span className="flex-1 text-[15px]">Disconnect</span>
            </button>
          </div>
          <p className="mt-2 px-1 text-[12px] text-muted-foreground">
            Your backup lives in a hidden Braintape folder in your Drive — notes, photos, voice notes
            and PDFs included. Restoring keeps whichever copy of a note is newer.
          </p>
        </>
      )}
    </section>
  );
}

function AiKeysSection() {
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<AiProvider>("gemini");
  const [value, setValue] = useState("");
  const [model, setModel] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    const read = () => setKeys(listKeys());
    read();
    window.addEventListener("braintape:ai-keys-changed", read);
    return () => window.removeEventListener("braintape:ai-keys-changed", read);
  }, []);

  function submit() {
    if (!value.trim()) return;
    setKeys(addKey(provider, value, model));
    setValue("");
    setModel("");
    setAdding(false);
    toast.success("Key saved on this device");
  }

  async function handleTest(k: AiKey) {
    setTestingId(k.id);
    try {
      await testKey(k);
      toast.success(`${PROVIDERS[k.provider].label} is working`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTestingId(null);
    }
  }

  return (
    <section className="px-4 pt-8">
      <SectionTitle>AI keys</SectionTitle>

      <div className="overflow-hidden rounded-2xl bg-card divide-y divide-border/60">
        {keys.map((k, i) => (
          <div key={k.id} className="flex items-center gap-2 px-3 py-3">
            <div className="flex flex-col">
              <button
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => setKeys(moveKey(k.id, -1))}
                className="text-muted-foreground disabled:opacity-25 active:opacity-60"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                aria-label="Move down"
                disabled={i === keys.length - 1}
                onClick={() => setKeys(moveKey(k.id, 1))}
                className="text-muted-foreground disabled:opacity-25 active:opacity-60"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px]">
                {i + 1}. {PROVIDERS[k.provider].label}
                {!k.enabled && <span className="text-muted-foreground"> · off</span>}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {maskKey(k.key)} · {k.model || PROVIDERS[k.provider].defaultModel}
              </div>
            </div>

            <button
              onClick={() => handleTest(k)}
              disabled={testingId === k.id}
              className="rounded-full bg-muted px-3 py-1.5 text-[12px] active:opacity-70"
            >
              {testingId === k.id ? "…" : "Test"}
            </button>
            <button
              aria-label={k.enabled ? "Turn off" : "Turn on"}
              onClick={() => setKeys(toggleKey(k.id))}
              className="rounded-full bg-muted px-3 py-1.5 text-[12px] active:opacity-70"
            >
              {k.enabled ? "On" : "Off"}
            </button>
            <button
              aria-label="Remove key"
              onClick={() => setKeys(removeKey(k.id))}
              className="text-destructive active:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}

        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/50"
          >
            <KeyRound className="h-5 w-5 text-foreground/70" />
            <span className="flex-1 text-[15px]">Add AI key</span>
          </button>
        ) : (
          <div className="space-y-2 px-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(PROVIDERS) as AiProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`rounded-xl px-3 py-2 text-[13px] ${provider === p ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80"}`}
                >
                  {PROVIDERS[p].label}
                </button>
              ))}
            </div>
            <p className="px-1 text-[12px] text-muted-foreground">{PROVIDERS[provider].hint}</p>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste your key"
              autoComplete="off"
              className="w-full rounded-xl bg-muted px-3 py-2.5 font-mono text-[13px] outline-none"
            />
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={`Model (default ${PROVIDERS[provider].defaultModel})`}
              className="w-full rounded-xl bg-muted px-3 py-2.5 font-mono text-[13px] outline-none"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setAdding(false)}
                className="flex-1 rounded-full bg-muted px-4 py-2.5 text-[14px] active:opacity-70"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                className="flex-1 rounded-full bg-primary px-4 py-2.5 text-[14px] font-medium text-primary-foreground active:opacity-80"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="mt-2 px-1 text-[12px] text-muted-foreground">
        Ask uses these in order — if the first one is out of quota it moves to the next
        automatically. Keys stay on this device. With no keys, the built-in AI is used.
      </p>
    </section>
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

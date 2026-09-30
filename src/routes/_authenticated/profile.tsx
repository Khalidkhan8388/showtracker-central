import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Trash2,
  Sun,
  Moon,
  Monitor,
  Loader2,
  ChevronRight,
  Download,
  Upload,
  KeyRound,
  ArrowUp,
  ArrowDown,
  X,
  ExternalLink,
  HelpCircle,
} from "lucide-react";
import {
  PROVIDERS,
  listKeys,
  addKey,
  removeKey,
  toggleKey,
  moveKey,
  maskKey,
  testKey,
  detectProvider,
  type AiKey,
  type AiProvider,
} from "@/lib/ai-keys";
import { deleteAccount } from "@/lib/notes.functions";
import { downloadExport, importFromFile, type ImportMode } from "@/lib/backup";
import { useTheme } from "@/lib/theme";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Braintape" },
      { name: "description", content: "Appearance, preferences, and AI keys for your local second brain." },
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
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground">
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
          className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3.5 text-left active:bg-muted/50"
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

      {/* AI Keys Section */}
      <AiKeysSection />

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

function AiKeysSection() {
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [provider, setProvider] = useState<AiProvider>("groq");
  const [model, setModel] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const read = () => setKeys(listKeys());
    read();
    window.addEventListener("braintape:ai-keys-changed", read);
    return () => window.removeEventListener("braintape:ai-keys-changed", read);
  }, []);

  function onPasteOrType(val: string) {
    setValue(val);
    const detected = detectProvider(val);
    setProvider(detected);
  }

  function submit() {
    if (!value.trim()) return;
    setKeys(addKey(provider, value, model));
    setValue("");
    setModel("");
    setAdding(false);
    toast.success(`${PROVIDERS[provider].label} key saved`);
  }

  async function handleTest(k: AiKey) {
    setTestingId(k.id);
    try {
      await testKey(k);
      toast.success(`${PROVIDERS[k.provider].label} is working!`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTestingId(null);
    }
  }

  return (
    <section className="px-4 pt-8">
      <div className="flex items-center justify-between mb-2">
        <SectionTitle>AI Keys & Fallback</SectionTitle>
        <button
          type="button"
          onClick={() => setShowGuide(!showGuide)}
          className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          <span>{showGuide ? "Hide free guide" : "Get free keys"}</span>
        </button>
      </div>

      {showGuide && (
        <div className="mb-3 space-y-2 rounded-2xl bg-muted/60 p-3.5 text-[12px]">
          <p className="font-medium text-foreground">How to get free API keys:</p>
          <div className="space-y-1.5 text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>1. <strong>Groq</strong> (Free Whisper audio + fast Llama text)</span>
              <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-primary hover:underline">
                console.groq.com <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span>2. <strong>Gemini</strong> (Free high-quota vision & PDFs)</span>
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-primary hover:underline">
                aistudio.google.com <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}

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
          <div className="space-y-2.5 px-4 py-4">
            <div>
              <input
                value={value}
                onChange={(e) => onPasteOrType(e.target.value)}
                placeholder="Paste any key (Groq, Gemini, OpenAI...)"
                autoComplete="off"
                className="w-full rounded-xl bg-muted px-3 py-2.5 font-mono text-[13px] outline-none"
              />
              {value && (
                <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
                  <span>Detected: <strong>{PROVIDERS[provider].label}</strong></span>
                  <span>Model: {model || PROVIDERS[provider].defaultModel}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {(Object.keys(PROVIDERS) as AiProvider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`rounded-xl px-2.5 py-1.5 text-[12px] transition-colors ${
                    provider === p ? "bg-primary text-primary-foreground font-medium" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {PROVIDERS[p].label.split(" ")[0]}
                </button>
              ))}
            </div>

            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={`Custom model override (optional, default: ${PROVIDERS[provider].defaultModel})`}
              className="w-full rounded-xl bg-muted px-3 py-2 font-mono text-[12px] outline-none"
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
                disabled={!value.trim()}
                className="flex-1 rounded-full bg-primary px-4 py-2.5 text-[14px] font-medium text-primary-foreground disabled:opacity-50 active:opacity-80"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="mt-2 px-1 text-[12px] text-muted-foreground">
        Keys stay strictly on this device. If one key runs out of quota, Braintape automatically falls back to the next enabled key.
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
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-medium transition-colors ${
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "../components/AppShell";
import { useLibrary } from "../lib/library";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Reel" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [key, setKey] = useState("");
  const { state, replaceAll } = useLibrary();

  useEffect(() => {
    setKey(typeof window !== "undefined" ? window.localStorage.getItem("tmdb_key") ?? "" : "");
  }, []);

  const saveKey = () => {
    window.localStorage.setItem("tmdb_key", key.trim());
    toast.success("API key saved");
  };

  const clearKey = () => {
    window.localStorage.removeItem("tmdb_key");
    setKey("");
    toast.success("API key removed");
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reel-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      replaceAll(parsed);
      toast.success("Library imported");
    } catch (e) {
      toast.error("Import failed: invalid file");
    }
  };

  return (
    <AppShell>
      <PageHeader title="Settings" />

      <div className="px-5">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">TMDB API Key</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Free from{" "}
            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" className="underline">
              themoviedb.org
            </a>. Use the v3 API key (not the read-access token). Stored only in your browser.
          </p>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your TMDB v3 API key"
            className="mt-3 w-full rounded-xl border border-border bg-muted/60 px-4 py-3 text-sm outline-none focus:border-foreground/30 focus:bg-background"
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={saveKey}
              className="flex-1 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background"
            >
              Save key
            </button>
            {key && (
              <button
                onClick={clearKey}
                className="rounded-full border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted"
              >
                Remove
              </button>
            )}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your data</h2>
          <p className="mt-2 text-sm text-muted-foreground">Everything is stored locally in this browser. Export to move between devices.</p>
          <div className="mt-3 flex flex-col gap-2">
            <button
              onClick={exportData}
              className="rounded-full border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted"
            >
              Export library (.json)
            </button>
            <label className="cursor-pointer rounded-full border border-border bg-background px-4 py-2.5 text-center text-sm font-medium hover:bg-muted">
              Import library
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])}
              />
            </label>
          </div>
        </section>

        <section className="mt-8 pb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">About</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Reel v1 — Personal Film & TV tracker. Music, reels, and tasks coming later.
          </p>
        </section>
      </div>
    </AppShell>
  );
}

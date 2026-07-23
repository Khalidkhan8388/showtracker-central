import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, LogOut, Trash2, Sun, Moon, Monitor, Check, User as UserIcon, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { deleteAccount } from "@/lib/account.functions";
import { ACCENTS, SIZE_SCALES, useTheme } from "@/lib/theme";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Braintape" },
      { name: "description", content: "Your account, appearance, and app preferences." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { mode, setMode, accent, setAccentId, sizeScale, setSizeScale } = useTheme();
  const [email, setEmail] = useState<string>("");
  const [uid, setUid] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const delFn = useServerFn(deleteAccount);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      setUid(data.user?.id ?? "");
    });
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" as any });
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await delFn({});
      await supabase.auth.signOut();
      toast.success("Account deleted");
      navigate({ to: "/auth" as any });
    } catch (e) {
      setDeleting(false);
      toast.error(e instanceof Error ? e.message : "Failed to delete account");
    }
  }

  const name = email ? email.split("@")[0] : "You";
  const initial = (name[0] || "?").toUpperCase();

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
            {initial}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[20px] font-semibold leading-tight">{name}</div>
            <div className="truncate text-[13px] text-muted-foreground">{email || "—"}</div>
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
                  {selected && (
                    <Check
                      className="absolute inset-0 m-auto h-5 w-5"
                      style={{ color: a.foreground }}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">{accent.name}</p>
        </div>
      </section>

      {/* Account */}
      <section className="px-4 pt-8">
        <SectionTitle>Account</SectionTitle>
        <div className="overflow-hidden rounded-2xl bg-card">
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/50"
          >
            <LogOut className="h-5 w-5 text-foreground/70" />
            <span className="flex-1 text-[15px]">Sign out</span>
          </button>
          <div className="h-px bg-border/60" />
          <button
            onClick={() => setConfirmOpen(true)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-destructive active:bg-muted/50"
          >
            <Trash2 className="h-5 w-5" />
            <span className="flex-1 text-[15px]">Delete account</span>
          </button>
        </div>
        <p className="mt-2 px-1 text-[12px] text-muted-foreground">
          Deleting your account permanently removes your notes, tasks, and files.
        </p>
      </section>

      {/* Meta */}
      {uid && (
        <section className="px-4 pt-8 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <UserIcon className="h-3 w-3" />
            <span className="truncate">{uid}</span>
          </div>
        </section>
      )}

      {/* Delete confirmation */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4" onClick={() => !deleting && setConfirmOpen(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[17px] font-semibold">Delete your account?</h3>
            <p className="mt-2 text-[14px] text-muted-foreground">
              This permanently removes your notes, tasks, and files. This action cannot be undone.
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
                {deleting ? "Deleting…" : "Delete"}
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

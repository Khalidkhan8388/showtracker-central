import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Mic } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Braintape" },
      { name: "description", content: "Sign in to your voice-first second brain." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/home" });
    });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/home` },
        });
        if (error) throw error;
        toast.success("Account created");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await router.invalidate();
      navigate({ to: "/home" });
    } catch (err: any) {
      toast.error(err?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-foreground text-background shadow-sm">
            <Mic className="h-7 w-7" />
          </div>
          <h1 className="text-[28px] font-bold tracking-tight">Braintape</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Speak. We'll remember for you.
          </p>
        </div>

        <form onSubmit={onSubmit} className="overflow-hidden rounded-2xl bg-card shadow-sm">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full bg-transparent px-4 py-3.5 text-[17px] outline-none placeholder:text-muted-foreground"
          />
          <div className="ml-4 h-px bg-border" />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-transparent px-4 py-3.5 text-[17px] outline-none placeholder:text-muted-foreground"
          />
        </form>

        <button
          type="submit"
          onClick={onSubmit as any}
          disabled={busy}
          className="mt-4 w-full rounded-2xl bg-primary py-3.5 text-[17px] font-semibold text-primary-foreground shadow-sm active:opacity-80 disabled:opacity-40"
        >
          {busy ? "Please wait…" : mode === "signup" ? "Create Account" : "Sign In"}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-5 w-full text-center text-[15px] text-primary active:opacity-60"
        >
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

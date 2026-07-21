import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveWebLink } from "@/lib/notes.functions";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

const SearchSchema = z.object({
  url: z.string().optional(),
  text: z.string().optional(),
  title: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/share")({
  head: () => ({ meta: [{ title: "Save link — Braintape" }] }),
  validateSearch: (s) => SearchSchema.parse(s),
  component: SharePage,
});

function SharePage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const saveFn = useServerFn(saveWebLink);
  const ranRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const raw = (search.url || search.text || "").trim();
    const match = raw.match(/https?:\/\/[^\s]+/i);
    const url = match ? match[0] : raw;
    if (!url) {
      setError("No link was shared.");
      return;
    }
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    (async () => {
      try {
        await saveFn({ data: { url: normalized } });
        toast.success("Link saved");
        navigate({ to: "/home" });
      } catch (err: any) {
        setError(err?.message ?? "Failed to save link");
      }
    })();
  }, [search, saveFn, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      {error ? (
        <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-sm">
          <p className="text-[15px] text-destructive">{error}</p>
          <button
            onClick={() => navigate({ to: "/home" })}
            className="mt-4 w-full rounded-xl bg-primary py-3 text-[17px] font-semibold text-primary-foreground active:opacity-80"
          >
            Go Home
          </button>
        </div>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-[15px] text-muted-foreground">Saving your link…</p>
        </>
      )}
    </div>
  );
}

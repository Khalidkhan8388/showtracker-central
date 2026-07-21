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
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      {error ? (
        <>
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => navigate({ to: "/home" })}
            className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background"
          >
            Go home
          </button>
        </>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Saving your link…</p>
        </>
      )}
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { createMediaNote, saveTextNote, saveWebLink } from "@/lib/notes.functions";
import { drainSharedItems, type SharedItem } from "@/lib/share-inbox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

const SearchSchema = z.object({
  url: z.string().optional(),
  text: z.string().optional(),
  title: z.string().optional(),
  pending: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/share")({
  head: () => ({ meta: [{ title: "Save to Braintape" }] }),
  validateSearch: (s) => SearchSchema.parse(s),
  component: SharePage,
});

const URL_RE = /https?:\/\/[^\s]+/i;

async function processItem(item: {
  url?: string;
  text?: string;
  title?: string;
  files?: SharedItem["files"];
}): Promise<number> {
  let saved = 0;

  const files = item.files ?? [];
  const images: Blob[] = [];
  let audio: { blob: Blob; mime: string } | null = null;
  for (const f of files) {
    const blob = new Blob([f.buf], { type: f.type || "application/octet-stream" });
    if (f.type.startsWith("image/")) images.push(blob);
    else if (f.type.startsWith("audio/") || f.type.startsWith("video/")) {
      // First audio/video wins; extras become images if any, else ignored.
      if (!audio) audio = { blob, mime: f.type };
    }
  }
  if (images.length > 0 || audio) {
    await createMediaNote({
      audioBlob: audio?.blob ?? null,
      audioMime: audio?.mime ?? null,
      durationSeconds: null,
      imageBlobs: images,
    });
    saved++;
  }

  const raw = `${item.url ?? ""} ${item.text ?? ""}`.trim();
  const match = raw.match(URL_RE);
  if (match) {
    const normalized = /^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`;
    await saveWebLink({ data: { url: normalized } });
    saved++;
  } else if ((item.text ?? "").trim() && !audio && images.length === 0) {
    const heading = (item.title ?? "").trim() || (item.text ?? "").trim().slice(0, 80);
    await saveTextNote({ data: { heading, body: (item.text ?? "").trim() } });
    saved++;
  }

  return saved;
}

function SharePage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const ranRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        let total = 0;

        // 1) POST/multipart shares live in the SW inbox — drain first.
        if (search.pending) {
          const items = await drainSharedItems();
          for (const it of items) total += await processItem(it);
        }

        // 2) GET share fallback (older Androids / desktop) also carries data.
        const hasGetPayload = search.url || search.text || search.title;
        if (!search.pending && hasGetPayload) {
          total += await processItem({
            url: search.url,
            text: search.text,
            title: search.title,
          });
        }

        if (total === 0) {
          setError("Nothing to save — the share didn't include text, a link, an image, or audio.");
          return;
        }
        toast.success(total === 1 ? "Saved" : `Saved ${total} items`);
        navigate({ to: "/home" });
      } catch (err: any) {
        setError(err?.message ?? "Failed to save shared content");
      }
    })();
  }, [search, navigate]);

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
          <p className="text-[15px] text-muted-foreground">Saving to Braintape…</p>
        </>
      )}
    </div>
  );
}

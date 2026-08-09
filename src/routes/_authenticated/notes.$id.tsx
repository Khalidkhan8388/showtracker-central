import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Film } from "lucide-react";
import { deleteNote } from "@/lib/notes.functions";
import { BackButton } from "@/components/BackButton";
import { MediaDetail } from "@/components/MediaDetail";
import { useLocalNote } from "@/hooks/use-local-notes";
import { deleteLocalNotes, clearPendingDelete } from "@/lib/sync-engine";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/notes/$id")({
  head: () => ({
    meta: [
      { title: "Title — Braintape" },
      { name: "description", content: "Movie and TV show details, episodes and watch status." },
      { property: "og:title", content: "Title — Braintape" },
      { property: "og:description", content: "Movie and TV show details, episodes and watch status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MediaDetailRoute,
});

function MediaDetailRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const note = useLocalNote(id);

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else void navigate({ to: "/home" });
  }

  const media = note?.media ?? null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-24">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background px-4 py-3">
        <BackButton onClick={goBack} />
      </header>

      {note === undefined ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !media ? (
        <div className="px-5 pt-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Film className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-[17px] font-semibold text-foreground">Not available</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            This entry isn't a movie or TV show.
          </p>
          <button
            onClick={() => navigate({ to: "/home" })}
            className="mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground press-bounce active:opacity-70"
          >
            Back to library
          </button>
        </div>
      ) : (
        <div className="px-5">
          <MediaDetail
            noteId={id}
            media={media}
            onDelete={async () => {
              await deleteLocalNotes([id]);
              goBack();
              try {
                await deleteNote({ data: { noteId: id } });
                await clearPendingDelete([id]);
              } catch (e: any) {
                toast.error(e?.message ?? "Delete will retry when back online");
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, FolderPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/collections")({
  head: () => ({
    meta: [
      { title: "Collections — Braintape" },
      { name: "description", content: "Group your notes, tasks, and media into collections." },
    ],
  }),
  component: CollectionsPage,
});

function CollectionsPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background">
        <div className="flex items-center gap-2 px-4 py-3">
          <Link
            to="/home"
            aria-label="Back"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground active:opacity-70"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-[22px] font-bold tracking-tight">Collections</h1>
        </div>
      </header>

      <section className="flex-1 px-4 pb-24 pt-6">
        <div className="rounded-2xl bg-card px-6 py-12 text-center shadow-sm ring-1 ring-border/60">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FolderPlus className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-[17px] font-semibold text-foreground">No collections yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Group notes, tasks, and links into collections. Coming soon.
          </p>
        </div>
      </section>
    </div>
  );
}

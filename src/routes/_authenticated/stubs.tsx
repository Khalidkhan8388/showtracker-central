import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Loader2, Ticket } from "lucide-react";
import { useLocalNotes } from "@/hooks/use-local-notes";
import { MediaStats } from "@/components/MediaStatsPanel";
import { TabBar } from "@/components/TabBar";
import type { LocalNote } from "@/lib/local-db";

export const Route = createFileRoute("/_authenticated/stubs")({
  head: () => ({
    meta: [
      { title: "Ticket Stubs & Stats — Braintape" },
      { name: "description", content: "Your shelf, ticket stubs and combined movie and TV watch stats." },
      { property: "og:title", content: "Ticket Stubs & Stats — Braintape" },
      { property: "og:description", content: "Your shelf, ticket stubs and combined movie and TV watch stats." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StubsPage,
});

function StubsPage() {
  const localNotes = useLocalNotes();

  const members = useMemo(
    () =>
      ((localNotes ?? []) as LocalNote[])
        .filter((n) => !!n.media && !n.deleted_at)
        .map((n) => ({ id: n.id, heading: n.heading, media: n.media })),
    [localNotes],
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background pb-32">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background px-4 pb-3 pt-3">
        <h1 className="text-[26px] font-bold leading-none tracking-tight">Stubs</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Shelf, ticket stubs and combined stats for movies and TV.
        </p>
      </header>

      <section className="px-4 pt-4">
        {localNotes === null || localNotes === undefined ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <div className="rounded-2xl bg-card px-6 py-12 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Ticket className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[17px] font-semibold">No stubs yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Mark something watched and it lands here.
            </p>
          </div>
        ) : (
          <MediaStats members={members} />
        )}
      </section>

      <TabBar />
    </div>
  );
}

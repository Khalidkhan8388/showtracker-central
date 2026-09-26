import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2, MessagesSquare } from "lucide-react";
import { createThread, deleteThread, loadThreads, type AskThread } from "@/lib/ask-threads";

export const Route = createFileRoute("/_authenticated/ask/")({
  head: () => ({
    meta: [
      { title: "Ask your notes — Braintape" },
      { name: "description", content: "Ask questions and get answers from everything you've saved in Braintape." },
      { property: "og:title", content: "Ask your notes — Braintape" },
      { property: "og:description", content: "Ask questions and get answers from everything you've saved in Braintape." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AskList,
});

function AskList() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<AskThread[]>([]);

  useEffect(() => {
    const sync = () => setThreads(loadThreads());
    sync();
    window.addEventListener("braintape-ask-threads", sync);
    return () => window.removeEventListener("braintape-ask-threads", sync);
  }, []);

  const startNew = () => {
    const t = createThread();
    navigate({ to: "/ask/$threadId", params: { threadId: t.id } });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pb-10 pt-[max(env(safe-area-inset-top),16px)]">
      <header className="flex items-center gap-2 py-2">
        <Link to="/home" aria-label="Back" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="flex-1 text-lg font-semibold">Ask your notes</h1>
        <button onClick={startNew} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground active:scale-95">
          <Plus className="h-4 w-4" /> New chat
        </button>
      </header>

      {threads.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <MessagesSquare className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Ask anything about your notes, PDFs, links and shows.</p>
          <button onClick={startNew} className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">Start a chat</button>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {threads.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <Link to="/ask/$threadId" params={{ threadId: t.id }} className="min-w-0 flex-1 py-3">
                <div className="truncate text-sm font-medium">{t.title}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(t.updatedAt).toLocaleString()} · {t.messages.length} messages
                </div>
              </Link>
              <button onClick={() => deleteThread(t.id)} aria-label="Delete chat" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

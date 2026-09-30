import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowLeft, Plus, Brain } from "lucide-react";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { createThread, getThread, pickCards, saveThreadMessages } from "@/lib/ask-threads";
import { db } from "@/lib/local-db";
import { activeKeyChain } from "@/lib/ai-keys";

export const Route = createFileRoute("/_authenticated/ask/$threadId")({
  head: () => ({
    meta: [
      { title: "Chat — Ask your notes · Braintape" },
      { name: "description", content: "A conversation with your Braintape second brain." },
      { property: "og:title", content: "Chat — Ask your notes · Braintape" },
      { property: "og:description", content: "A conversation with your Braintape second brain." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AskThreadPage,
});

function AskThreadPage() {
  const { threadId } = Route.useParams();
  const [initial, setInitial] = useState<UIMessage[] | null>(null);
  useEffect(() => {
    setInitial(getThread(threadId)?.messages ?? []);
  }, [threadId]);
  if (!initial) return null;
  return <ChatWindow key={threadId} threadId={threadId} initial={initial} />;
}

const SUGGESTIONS = ["What did I save this week?", "Which shows am I watching?", "What tasks are still open?"];

function ChatWindow({ threadId, initial }: { threadId: string; initial: UIMessage[] }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { messages, sendMessage, status, stop, error } = useChat({
    id: threadId,
    messages: initial,
    transport: new DefaultChatTransport({ api: "/api/ask" }),
  });

  useEffect(() => {
    if (status === "ready" && messages.length) saveThreadMessages(threadId, messages);
  }, [messages, status, threadId]);

  useEffect(() => {
    if (status === "ready") taRef.current?.focus();
  }, [status]);

    const ask = async (q: string) => {
    const question = q.trim();
    if (!question || status === "submitted" || status === "streaming") return;
    setText("");
    const notes = await db.notes.orderBy("created_at").reverse().toArray();
    const cards = pickCards(notes, question);
    sendMessage({ text: question }, { body: { cards, keys: activeKeyChain() } });
  };

  const onLinkClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    const m = href?.match(/^\/notes\/([^/?#]+)/);
    if (m) {
      e.preventDefault();
      navigate({ to: "/notes/$id", params: { id: m[1] } });
    }
  };

  const newChat = () => {
    const t = createThread();
    navigate({ to: "/ask/$threadId", params: { threadId: t.id } });
  };

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col px-3 pt-[max(env(safe-area-inset-top),12px)]">
      <header className="flex items-center gap-2 py-2">
        <Link to="/ask" aria-label="All chats" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="flex-1 truncate text-base font-semibold">Ask your notes</h1>
        <button onClick={newChat} aria-label="New chat" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted">
          <Plus className="h-5 w-5" />
        </button>
      </header>

      <Conversation className="min-h-0">
        <ConversationContent onClick={onLinkClick}>
          {messages.length === 0 ? (
            <ConversationEmptyState icon={<Brain className="h-10 w-10" />} title="Ask your second brain" description="Answers come only from what you've saved.">
              <div className="flex flex-col items-center gap-3">
                <Brain className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Answers come only from what you've saved.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => ask(s)} className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent className="group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground">
                  {m.parts.map((p, i) =>
                    p.type === "text" ? (
                      m.role === "assistant" ? (
                        <MessageResponse key={i}>{p.text}</MessageResponse>
                      ) : (
                        <span key={i} className="whitespace-pre-wrap">{p.text}</span>
                      )
                    ) : null,
                  )}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && <Shimmer className="text-sm">Searching your notes…</Shimmer>}
          {error && <p className="text-sm text-destructive">{error.message || "Something went wrong. Please try again."}</p>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
        <PromptInput onSubmit={(msg) => ask(msg.text ?? text)}>
          <PromptInputTextarea
            ref={taRef}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask about your notes…"
          />
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit status={status} onStop={stop} disabled={!text.trim() && status === "ready"} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

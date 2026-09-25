import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CardSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  date: z.string(),
  text: z.string(),
});

const BodySchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.any()).max(200),
  cards: z.array(CardSchema).max(80).default([]),
});

const SYSTEM = `You are Braintape, the user's second brain. Answer questions using ONLY the saved cards below (notes, voice notes, PDFs, web links, YouTube videos, movies/TV, tasks).
- Be conversational, direct and concise. Lead with the answer.
- Whenever you use a card, cite it inline as a Markdown link exactly like [Card title](/notes/CARD_ID).
- If the cards don't contain the answer, say so plainly and suggest what the user could save. Never invent facts that aren't in the cards.
- Use today's date to reason about "recent", "upcoming", "last week" etc.`;

export const Route = createFileRoute("/api/ask")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch {
          return new Response("Invalid request", { status: 400 });
        }
        const { streamText, convertToModelMessages } = await import("ai");
        const { createGatewayProvider, CHAT_MODEL, RESPONSES_OPTIONS } = await import("@/lib/ai-gateway.server");
        const { provider } = createGatewayProvider(request.headers.get("X-Lovable-AIG-Run-ID") ?? undefined);

        const cardsText = body.cards.length
          ? body.cards
              .map((c) => `### ${c.title}\nid: ${c.id} · type: ${c.kind} · saved: ${c.date}\n${c.text}`)
              .join("\n\n")
          : "(The user has no saved cards yet.)";

        const result = streamText({
          model: provider.responses(CHAT_MODEL),
          system: `${SYSTEM}\n\nToday is ${new Date().toDateString()}.\n\nSAVED CARDS:\n\n${cardsText}`,
          messages: await convertToModelMessages(body.messages),
          abortSignal: request.signal,
          providerOptions: RESPONSES_OPTIONS as any,
        });
        return result.toUIMessageStreamResponse({
          originalMessages: body.messages,
          sendReasoning: true,
          onError: (err: any) => {
            const msg = String(err?.message ?? err);
            if (/402|credit/i.test(msg)) return "You're out of AI credits. Add more in Settings → Plans & credits.";
            if (/429|rate/i.test(msg)) return "Too many requests right now — try again in a moment.";
            return "Something went wrong while answering. Please try again.";
          },
        });
      },
    },
  },
});

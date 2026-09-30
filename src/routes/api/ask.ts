import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CardSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  date: z.string(),
  text: z.string(),
});

const KeysSchema = z
  .array(z.object({ provider: z.string(), key: z.string(), model: z.string().optional() }))
  .optional()
  .default([]);

const BodySchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.any()).max(200),
  cards: z.array(CardSchema).max(80).default([]),
  keys: KeysSchema,
});

const SYSTEM = `You are Braintape, the user's second brain. Answer questions using ONLY the saved cards below (notes, voice notes, PDFs, web links, YouTube videos, movies/TV, tasks).
- Be conversational, direct and concise. Lead with the answer.
- Whenever you use a card, cite it inline as a Markdown link exactly like [Card title](/notes/CARD_ID).
- If the cards don't contain the answer, say so plainly and suggest what the user could save. Never invent facts that aren't in the cards.
- Use today's date to reason about "recent", "upcoming", "last week" etc.`;

const BASE_URLS: Record<string, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  openai: "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
};

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

        const cardsText = body.cards.length
          ? body.cards
              .map((c) => `### ${c.title}\nid: ${c.id} · type: ${c.kind} · saved: ${c.date}\n${c.text}`)
              .join("\n\n")
          : "(The user has no saved cards yet.)";

        const validKeys = (body.keys ?? []).filter((k) => k.key?.trim() && k.provider in BASE_URLS);

        if (validKeys.length > 0) {
          const { createOpenAI } = await import("@ai-sdk/openai");
          for (const k of validKeys) {
            try {
              const client = createOpenAI({
                baseURL: BASE_URLS[k.provider],
                apiKey: k.key,
              });
              const modelName = k.model?.trim() || DEFAULT_MODELS[k.provider] || "gpt-4o-mini";
              const result = streamText({
                model: client.chat(modelName),
                system: `${SYSTEM}\n\nToday is ${new Date().toDateString()}.\n\nSAVED CARDS:\n\n${cardsText}`,
                messages: await convertToModelMessages(body.messages),
                abortSignal: request.signal,
              });
              return result.toUIMessageStreamResponse({
                originalMessages: body.messages,
                sendReasoning: true,
                onError: (err: any) => String(err?.message ?? err),
              });
            } catch {}
          }
        }

        // Fallback to Lovable Gateway if no user keys configured or all failed
        const { createGatewayProvider, CHAT_MODEL, RESPONSES_OPTIONS } = await import("@/lib/ai-gateway.server");
        const { provider } = createGatewayProvider(request.headers.get("X-Lovable-AIG-Run-ID") ?? undefined);

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
            if (/402|credit/i.test(msg)) return "You're out of AI credits. Add a free Groq or Gemini key in Profile.";
            if (/429|rate/i.test(msg)) return "Too many requests right now — try again in a moment.";
            return "Something went wrong while answering. Please try again.";
          },
        });
      },
    },
  },
});

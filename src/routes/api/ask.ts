import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CardSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  date: z.string(),
  text: z.string(),
});

const KeySchema = z.object({
  provider: z.enum(["gemini", "groq", "openai", "openrouter"]),
  key: z.string().min(8),
  model: z.string().min(1),
});

const BodySchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.any()).max(200),
  cards: z.array(CardSchema).max(80).default([]),
  keys: z.array(KeySchema).max(10).default([]),
});

const BASE_URLS: Record<string, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};


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
        const { streamText, convertToModelMessages, generateText } = await import("ai");
        const { createOpenAI } = await import("@ai-sdk/openai");

        const cardsText = body.cards.length
          ? body.cards
              .map((c) => `### ${c.title}\nid: ${c.id} · type: ${c.kind} · saved: ${c.date}\n${c.text}`)
              .join("\n\n")
          : "(The user has no saved cards yet.)";

        const system = `${SYSTEM}\n\nToday is ${new Date().toDateString()}.\n\nSAVED CARDS:\n\n${cardsText}`;
        const messages = await convertToModelMessages(body.messages);

        // 1) Try the user's own keys, in their chosen order.
        const failures: string[] = [];
        for (const k of body.keys) {
          try {
            const p = createOpenAI({ baseURL: BASE_URLS[k.provider], apiKey: k.key });
            const model = p.chat(k.model);
            // Cheap probe so a dead/quota-exhausted key fails before streaming starts.
            await generateText({ model, prompt: "hi", maxOutputTokens: 1 });
            const result = streamText({ model, system, messages, abortSignal: request.signal });
            return result.toUIMessageStreamResponse({
              originalMessages: body.messages,
              headers: { "X-Braintape-Provider": `${k.provider}:${k.model}` },
              onError: () => "Something went wrong while answering. Please try again.",
            });
          } catch (e: any) {
            failures.push(`${k.provider}: ${String(e?.message ?? e).slice(0, 80)}`);
          }
        }

        // 2) Fall back to the built-in AI.
        const { createGatewayProvider, CHAT_MODEL, RESPONSES_OPTIONS } = await import("@/lib/ai-gateway.server");
        const { provider } = createGatewayProvider(request.headers.get("X-Lovable-AIG-Run-ID") ?? undefined);

        const result = streamText({
          model: provider.responses(CHAT_MODEL),
          system,
          messages,
          abortSignal: request.signal,
          providerOptions: RESPONSES_OPTIONS as any,
        });
        return result.toUIMessageStreamResponse({
          originalMessages: body.messages,
          sendReasoning: true,
          headers: { "X-Braintape-Provider": "built-in" },
          onError: (err: any) => {
            const msg = String(err?.message ?? err);
            const tail = failures.length ? ` Your own keys also failed — ${failures.join("; ")}.` : "";
            if (/402|credit/i.test(msg))
              return `You're out of built-in AI credits. Add your own AI key in Profile.${tail}`;
            if (/429|rate/i.test(msg)) return `Too many requests right now — try again in a moment.${tail}`;
            return `Something went wrong while answering. Please try again.${tail}`;
          },
        });

      },
    },
  },
});

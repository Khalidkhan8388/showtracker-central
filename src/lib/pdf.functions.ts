import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  base64: z.string().min(1),
  filename: z.string().min(1).max(300),
});

const PDF_PROMPT = `You read a PDF document and turn it into a saved note.
Reply in EXACTLY this layout, using these section markers on their own lines, nothing before the first marker:

===HEADING===
A short title (max ~8 words), title case.
===SUMMARY===
3-5 sentences summarising what the document is and its most important content.
===KEY_POINTS===
- 3 to 8 short bullets with the key facts, figures, decisions or dates.
===TASKS===
- Concrete to-dos the reader must act on (deadlines, payments, signatures). Leave this section empty if none.
===TRANSCRIPT===
The COMPLETE text of the document as Markdown, verbatim, in reading order. Do not summarise or skip anything.
Preserve the original formatting: headings as #/##/###, bullet and numbered lists, **bold** and *italic*, tables as Markdown tables, and paragraph breaks. Put a line "---" between pages.`;

function section(text: string, name: string): string {
  const re = new RegExp(`===${name}===\\s*([\\s\\S]*?)(?=\\n===[A-Z_]+===|$)`);
  return (text.match(re)?.[1] ?? "").trim();
}

function bullets(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 0);
}

export const analyzePdfFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const { streamText } = await import("ai");
    const { createGatewayProvider, CHAT_MODEL, RESPONSES_OPTIONS } = await import("./ai-gateway.server");
    const { provider } = createGatewayProvider();
    const result = streamText({
      model: provider.responses(CHAT_MODEL),
      providerOptions: RESPONSES_OPTIONS as any,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PDF_PROMPT },
            { type: "file", data: data.base64, mediaType: "application/pdf", filename: data.filename },
          ],
        },
      ],
    });
    const text = await result.text;
    if (!text.trim()) throw new Error("The AI couldn't read this PDF.");
    const heading = section(text, "HEADING").split("\n")[0]?.replace(/^#+\s*/, "").trim();
    const transcript = section(text, "TRANSCRIPT");
    return {
      heading: (heading || data.filename.replace(/\.pdf$/i, "")).slice(0, 120),
      summary: section(text, "SUMMARY").slice(0, 3000),
      key_points: bullets(section(text, "KEY_POINTS")).slice(0, 8),
      tasks: bullets(section(text, "TASKS")).slice(0, 10),
      transcript,
      pages: transcript ? transcript.split(/\n-{3,}\n/).length : null,
    };
  });

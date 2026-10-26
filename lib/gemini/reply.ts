/**
 * Gemini reply writer (prompt §3.2 Step 8): turns FACTS into 1–4 short sentences ending with the next
 * question. The engine validates the text (amounts, dates, carriers, rule IDs must be in FACTS) and
 * falls back to the fixed-wording template otherwise.
 */
import "server-only";
import { z } from "zod";
import type { Facts } from "@/lib/conversation/facts";
import { chatModel, generateJson } from "@/lib/gemini";
import { ThinkingLevel } from "@google/genai";
import { EXPLAIN_SYSTEM_PROMPT } from "@/lib/prompts";

const RULES = `
Reply rules for this conversation:
- Use ONLY the FACTS JSON. 1–4 short sentences (voice mode: 1–2). Plain English, friendly, no jargon.
- Say what changed (changeSummary, cascadeNotes), any fixed or new rules (with their ID), and the recommendation only if it is in FACTS.
- If answerToQuestion is set, include it; if sellerQuestion is set but answerToQuestion is null, answer it in one sentence using only FACTS or general shipping knowledge, without numbers.
- Money as £1,234.00, dates as Weekday DD-MM-YYYY, transit in "working days", say "estimated delivery".
- Never invent a number, date, carrier or rule. Never say a booking is confirmed or ready unless FACTS say so.
- If FACTS.recommendation is null, do not mention carriers, recommendations, prices or the status at all.
- A status change may only be described as FACTS.statusChange says (e.g. "RED → AMBER" means it improved from RED to AMBER). If FACTS.statusChange is null, never say the status changed, stayed or remains anything.
- Don't start with "I have updated" every time — vary it, e.g. "Got it —", "Thanks —", "Done:".
- ALWAYS end with nextQuestion.text, copied word for word.
Return JSON: {"reply": "..."}`;

const Out = z.object({ reply: z.string().min(1).max(1200) });

export async function geminiReply(facts: Facts): Promise<string | null> {
  const raw = await generateJson({
    system: EXPLAIN_SYSTEM_PROMPT + "\n" + RULES,
    prompt: `FACTS:\n${JSON.stringify(facts)}`,
    schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
    temperature: 0.3,
    model: chatModel(),
    thinking: { thinkingLevel: ThinkingLevel.MINIMAL },
  });
  const p = Out.safeParse(raw);
  return p.success ? p.data.reply.trim() : null;
}

/** R-06 second opinion for one product the seller doesn't know about (true = restricted). */
export async function geminiR06(item: { sku: string | null; description: string | null; hsCode: string | null }): Promise<boolean | null> {
  const { R06_SYSTEM_PROMPT } = await import("@/lib/prompts");
  const raw = await generateJson({
    system: R06_SYSTEM_PROMPT,
    prompt: `Item (JSON): ${JSON.stringify({ key: "item", ...item })}\nReturn {"verdicts":[{"key":"item","restricted":true|false,"reason":"..."}]}.`,
    schema: { type: "object", properties: { verdicts: { type: "array", items: { type: "object", properties: { key: { type: "string" }, restricted: { type: "boolean" }, reason: { type: "string" } }, required: ["key", "restricted", "reason"] } } }, required: ["verdicts"] },
    temperature: 0,
    model: chatModel(),
    thinking: { thinkingLevel: ThinkingLevel.MINIMAL },
  });
  const v = (raw as { verdicts?: { restricted?: unknown }[] } | null)?.verdicts?.[0]?.restricted;
  return typeof v === "boolean" ? v : null;
}

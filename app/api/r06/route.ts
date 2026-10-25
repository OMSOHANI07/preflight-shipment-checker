/**
 * POST /api/r06 — Gemini second opinion for items detectDangerousGoods() marks "possible".
 * One batched call per file (RULEBOOK E-8). Gemini only answers restricted true/false;
 * the rule engine decides what that means. On any failure: { verdicts: [], source: "unavailable" }
 * and the engine shows Advisory A-09 instead.
 */
import { generateJson } from "@/lib/gemini";
import { R06_SYSTEM_PROMPT } from "@/lib/prompts";
import { R06RequestSchema, R06ResponseSchema } from "@/lib/schema";

export const maxDuration = 30;

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, restricted: { type: "boolean" }, reason: { type: "string" } },
        required: ["key", "restricted", "reason"],
      },
    },
  },
  required: ["verdicts"],
};

export async function POST(req: Request) {
  const body = R06RequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!body.data.items.length) return Response.json({ verdicts: [], source: "ai" });

  const prompt = `Items to review (JSON):\n${JSON.stringify(body.data.items)}\n\nReturn {"verdicts":[{"key","restricted","reason"}]} with one entry per item, copying each "key" exactly.`;
  const raw = await generateJson({ system: R06_SYSTEM_PROMPT, prompt, schema: RESPONSE_JSON_SCHEMA });
  const parsed = R06ResponseSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ verdicts: [], source: "unavailable" });

  const keys = new Set(body.data.items.map((i) => i.key));
  const verdicts = parsed.data.verdicts.filter((v) => keys.has(v.key));
  return Response.json({ verdicts, source: "ai" });
}

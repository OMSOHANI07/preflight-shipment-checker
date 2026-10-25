/**
 * POST /api/explain — turns BookingResult facts into plain English with Gemini
 * (RECOMMENDATION_RULES §6, §9). Output is Zod-validated and checked so every £ amount
 * and date already exists in the input; anything else falls back to deterministic text.
 */
import { z } from "zod";
import { formatDDMMYYYY, type BookingResult } from "@/lib/calculations";
import { explanationKey, fallbackExplanation, numbersAreGrounded } from "@/lib/explain";
import { generateJson } from "@/lib/gemini";
import { EXPLAIN_SYSTEM_PROMPT, EXPLAIN_TASK } from "@/lib/prompts";
import { BookingSchema, ExplanationSchema, ItemSchema, type Explanation } from "@/lib/schema";

export const maxDuration = 60;

const ResultShape = z.custom<BookingResult>(
  (v) => typeof v === "object" && v !== null && "recommendation" in v && "issues" in v && "ruleResults" in v,
);
const RequestSchema = z.object({
  bookings: z.array(z.object({ booking: BookingSchema, items: z.array(ItemSchema).max(200), result: ResultShape })).max(40),
});

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    reason: { type: "string" },
    tradeoff: { type: ["string", "null"] },
    exclusions: { type: "array", items: { type: "string" } },
    caveat: { type: ["string", "null"] },
    confirmation: { type: "string" },
    issueSummaries: {
      type: "array",
      items: { type: "object", properties: { code: { type: "string" }, summary: { type: "string" } }, required: ["code", "summary"] },
    },
  },
  required: ["headline", "reason", "tradeoff", "exclusions", "caveat", "confirmation", "issueSummaries"],
};

const cache = new Map<string, Explanation>();
const remember = (k: string, v: Explanation) => {
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  cache.set(k, v);
};

type Entry = z.infer<typeof RequestSchema>["bookings"][number];

async function explainOne({ booking, items, result }: Entry): Promise<{ key: string; explanation: Explanation }> {
  const key = explanationKey(booking, result);
  const hit = cache.get(key);
  if (hit) return { key, explanation: hit };

  const draft = fallbackExplanation(booking, items, result);
  const rec = result.recommendation;
  const payload = {
    booking: {
      bookingId: booking.bookingId, sellerName: booking.sellerName, originCity: booking.originCity,
      destinationCity: booking.destinationCity, destinationCountry: booking.destinationCountry, destinationType: booking.destinationType,
      pallets: booking.pallets, totalGrossWeightKg: booking.totalGrossWeightKg, readyToShipDate: formatDDMMYYYY(booking.readyToShipDate),
      sellerPriority: booking.sellerPriority,
    },
    status: result.status,
    checkedAgainst: formatDDMMYYYY(result.checkedAgainstDate),
    recommendation: {
      label: rec.label, fallbackReason: rec.fallbackReason, reasonFacts: rec.reasonFacts,
      options: rec.allOptions.map((e) => ({
        carrier: `${e.carrier.carrier} ${e.carrier.service}`, eligible: e.eligible, ineligibleReasons: e.ineligibleReasons,
      })),
    },
    issues: result.issues.map((i) => ({ code: i.code, severity: i.severity, whatIsWrong: i.whatIsWrong })),
    draft,
  };
  const facts = JSON.stringify(payload);
  const raw = await generateJson({ system: EXPLAIN_SYSTEM_PROMPT, prompt: `${EXPLAIN_TASK}\n\nInput JSON:\n${facts}`, schema: RESPONSE_JSON_SCHEMA });
  const parsed = ExplanationSchema.safeParse(raw);

  let explanation: Explanation = { ...draft, source: "fallback" };
  if (parsed.success) {
    const ai = parsed.data;
    const texts = [ai.headline, ai.reason, ai.tradeoff ?? "", ai.caveat ?? "", ai.confirmation, ...ai.exclusions, ...ai.issueSummaries.map((s) => s.summary)];
    const sameIssues = ai.issueSummaries.length === result.issues.length && ai.issueSummaries.every((s, i) => s.code === result.issues[i].code);
    if (texts.every((t) => numbersAreGrounded(t, facts))) {
      explanation = { ...ai, issueSummaries: sameIssues ? ai.issueSummaries : draft.issueSummaries, source: "ai" };
    }
  }
  // Only cache AI text: a fallback should be retried next time Gemini is reachable.
  if (explanation.source === "ai") remember(key, explanation);
  return { key, explanation };
}

export async function POST(req: Request) {
  const body = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const out: { key: string; explanation: Explanation }[] = new Array(body.data.bookings.length);
  let next = 0;
  const worker = async () => {
    while (next < body.data.bookings.length) {
      const i = next++;
      out[i] = await explainOne(body.data.bookings[i]);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return Response.json({ explanations: out });
}

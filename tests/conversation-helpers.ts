/** Test helpers: drive runTurn() with a mocked Gemini that returns a fixed extraction per turn. */
import { createState, runTurn, type TurnDeps } from "@/lib/conversation";
import { ExtractionSchema, type ConversationState, type Extraction, type Mode, type TurnResponse } from "@/lib/conversation/types";

export const NOW = new Date("2026-10-26T10:00:00Z"); // Monday 26-10-2026 (UK)
export const ex = (x: Record<string, unknown>): Extraction => ExtractionSchema.parse(x);

/** A scripted turn: what the seller types and what "Gemini" extracts from it (null → no AI, use the fallback). */
export type Script = [message: string, extraction: Extraction | null][];

export async function play(script: Script, opts: { mode?: Mode; state?: ConversationState; deps?: Partial<TurnDeps> } = {}) {
  let state = opts.state ?? createState(NOW, "test-conv");
  const turns: TurnResponse[] = [];
  for (const [message, extraction] of script) {
    const r = await runTurn(state, message, opts.mode ?? "chat", {
      extract: async () => extraction,
      confirm: async () => ({ reference: "PF-TEST-000001", saved: false }),
      ...opts.deps,
    }, NOW);
    turns.push(r);
    state = r.state;
  }
  return { state, turns, last: turns[turns.length - 1] };
}

/** QUESTIONS.md §7.1 — the vague seller, as Gemini would extract each message. */
export const VAGUE_SELLER: Script = [
  ["Need to send 3 pallets of mugs to Frankfurt next week, cheapest option.", ex({ intent: "provide", booking: { pallets: 3, destinationCity: "Frankfurt", readyToShipDate: "next week", sellerPriority: "cheapest" }, items: [{ ref: "new", description: "Ceramic coffee mug, 350 ml" }] })],
  ["Northfield Goods, Manchester.", ex({ booking: { sellerName: "Northfield Goods", originCity: "Manchester" } })],
  ["Thursday", ex({ booking: { readyToShipDate: "Thursday" } })],
  ["yes, an Amazon warehouse", ex({ booking: { destinationType: "Amazon warehouse" }, yesNo: true })],
  ["no deadline", ex({ yesNo: false })],
  ["MUG-01", ex({ items: [{ ref: "pending", sku: "MUG-01" }] })],
  ["1080, 12 a box", ex({ items: [{ ref: "pending", quantity: "1080", unitsPerCarton: "12" }] })],
  ["yep", ex({ intent: "confirm", yesNo: true })],
  ["£5, half a kilo", ex({ items: [{ ref: "pending", unitPrice: "£5", unitWeightKg: "half a kilo" }] })],
  ["691200, made in UK", ex({ items: [{ ref: "pending", hsCodeRaw: "691200", countryOfOrigin: "UK" }] })],
  ["no", ex({ yesNo: false })],
  ["yes", ex({ intent: "confirm", yesNo: true })],
  ["yes", ex({ intent: "confirm", yesNo: true })],
  ["620", ex({ booking: { totalGrossWeightKg: "620" } })],
  ["not yet", ex({ booking: { deliveryAppointmentBooked: "not yet" }, yesNo: false })],
];

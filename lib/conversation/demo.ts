/**
 * QUESTIONS.md §7.1 / §7.2 as (message → what Gemini extracts). Used by the scripted tests and by
 * GEMINI_MOCK=1 (Playwright runs the real UI against these instead of calling Gemini).
 */
export const DEMO_SCRIPT: [message: string, extraction: Record<string, unknown>][] = [
  ["Need to send 3 pallets of mugs to Frankfurt next week, cheapest option.", { intent: "provide", booking: { pallets: 3, destinationCity: "Frankfurt", readyToShipDate: "next week", sellerPriority: "cheapest" }, items: [{ ref: "new", description: "Ceramic coffee mug, 350 ml" }] }],
  ["Northfield Goods, Manchester.", { booking: { sellerName: "Northfield Goods", originCity: "Manchester" } }],
  ["Thursday", { booking: { readyToShipDate: "Thursday" } }],
  ["yes, an Amazon warehouse", { booking: { destinationType: "Amazon warehouse" }, yesNo: true }],
  ["no deadline", { yesNo: false }],
  ["MUG-01", { items: [{ ref: "pending", sku: "MUG-01" }] }],
  ["1080, 12 a box", { items: [{ ref: "pending", quantity: "1080", unitsPerCarton: "12" }] }],
  ["yep", { intent: "confirm", yesNo: true }],
  ["£5, half a kilo", { items: [{ ref: "pending", unitPrice: "£5", unitWeightKg: "half a kilo" }] }],
  ["691200, made in UK", { items: [{ ref: "pending", hsCodeRaw: "691200", countryOfOrigin: "UK" }] }],
  ["no", { yesNo: false }],
  ["yes", { intent: "confirm", yesNo: true }],
  ["yes", { intent: "confirm", yesNo: true }],
  ["620", { booking: { totalGrossWeightKg: "620" } }],
  ["not yet", { booking: { deliveryAppointmentBooked: "not yet" }, yesNo: false }],
];

/** Extra mock answers for the review / mid-way change part of the demo. */
export const DEMO_EXTRA: [message: string, extraction: Record<string, unknown>][] = [
  ["Carry on without one", { booking: { deliveryAppointmentBooked: "no" }, yesNo: false }],
  ["No budget limit", { prefs: { maxBudgetGbp: "no" } }],
  ["Actually the total weight is 1,600 kg.", { intent: "change", booking: { totalGrossWeightKg: "1,600 kg" } }],
  ["add a pallet then", { intent: "change", palletDelta: 1 }],
  ["confirm", { intent: "confirm", yesNo: true }],
  ["Confirm anyway", { intent: "confirm", yesNo: true }],
];

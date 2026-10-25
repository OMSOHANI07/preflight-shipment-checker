/**
 * Deterministic text built ONLY from BookingResult facts (RULEBOOK §11, RECOMMENDATION_RULES §6).
 * Used as the fallback whenever Gemini is slow, down or returns anything invalid,
 * and as the draft Gemini rewrites. Shared by the browser, the API routes and the PDF.
 */
import {
  formatDDMMYYYY, gbp, isBefore, kg, weekdayName,
  type Booking, type BookingResult, type CarrierEval, type Item,
} from "@/lib/calculations";
import type { ExplanationText } from "@/lib/schema";

export const longDate = (iso: string | null) => (iso ? `${weekdayName(iso)} ${formatDDMMYYYY(iso)}` : "—");
const plural = (n: number | null | undefined, one: string, many = one + "s") => `${n ?? "?"} ${n === 1 ? one : many}`;
const carrierName = (e: CarrierEval) => `${e.carrier.carrier} ${e.carrier.service}`;

/** "ceramic coffee mug, 350 ml" / "2 products" — plain description of the goods. */
export function goodsPhrase(items: Item[]) {
  if (items.length === 1 && items[0].description) return items[0].description.charAt(0).toLowerCase() + items[0].description.slice(1);
  return items.length ? `${items.length} different products` : "goods";
}

export function fallbackExplanation(b: Booking, items: Item[], r: BookingResult): ExplanationText {
  const rec = r.recommendation;
  const blocked = r.status === "RED" || r.status === "INCOMPLETE";
  const best = rec.recommended;
  if (!best) {
    return {
      headline: "No carrier fits",
      reason: rec.fallbackReason ?? "No carrier on this route can take this shipment as entered.",
      tradeoff: null,
      exclusions: rec.allOptions.filter((e) => !e.eligible).map((e) => `${carrierName(e)}: ${e.ineligibleReasons.join("; ") || "not available"}.`),
      caveat: rec.allOptions.length ? `Minimum pallets needed: ${rec.allOptions.map((e) => `${e.carrier.carrier} ${e.minPalletsForThisCarrier ?? "?"}`).join(", ")}.` : null,
      confirmation: confirmationDraft(b, items, r),
      issueSummaries: r.issues.map((i) => ({ code: i.code, summary: i.whatIsWrong })),
    };
  }
  const c = best.carrier;
  const p = rec.priority ?? "Balanced";
  const reason =
    p === "Cheapest" ? `It's the lowest price on this route for ${plural(b.pallets, "pallet")}.`
    : p === "Fastest" ? `It's the quickest option: ${c.transitDays} working days.`
    : p === "Most reliable" ? `It has the best on-time record on this route: ${c.onTimePct}% of shipments arrive on the promised day.`
    : `It's the best all-round balance of cost (${gbp(best.cost)}), speed (${c.transitDays} working days) and reliability (${c.onTimePct}% on time).`;
  const runner = rec.reasonFacts.find((f) => f.startsWith("Runner-up"));
  const exclusions = rec.allOptions.filter((e) => !e.eligible).map((e) => `${carrierName(e)} can't be used: ${e.ineligibleReasons.join("; ")}.`);
  const caveats: string[] = [];
  if (blocked) caveats.push("Recommended once the issues above are fixed.");
  if (rec.fallbackReason) caveats.push(rec.fallbackReason);
  if (b.readyToShipDate && isBefore(b.readyToShipDate, r.checkedAgainstDate)) caveats.push(`The ready date ${formatDDMMYYYY(b.readyToShipDate)} is in the past, so estimates assume collection from today.`);
  if (!rec.priority) caveats.push("No seller priority was given, so we used Balanced.");
  return {
    headline: `${carrierName(best)} — ${gbp(best.cost)}, arriving ${longDate(best.etaDate)}`,
    reason,
    tradeoff: runner ?? null,
    exclusions,
    caveat: caveats.length ? caveats.join(" ") : null,
    confirmation: confirmationDraft(b, items, r),
    issueSummaries: r.issues.map((i) => ({ code: i.code, summary: i.whatIsWrong })),
  };
}

/** RULEBOOK §11.5 — plain-English confirmation paragraph. */
export function confirmationDraft(b: Booking, items: Item[], r: BookingResult): string {
  const best = r.recommendation.recommended;
  const cartons = r.totals.sumItemCartons ?? b.cartons;
  const what = `${plural(b.pallets, "pallet")} (${plural(cartons, "carton")} of ${goodsPhrase(items)}, ${gbp(b.totalDeclaredValue)})`;
  const where = `the ${b.destinationCity ?? "destination"} ${b.destinationType === "Business address" ? "business address" : "warehouse"}`;
  if (!best) {
    return `Your ${what} can't be booked yet: no carrier on the route to ${b.destinationCity ?? "the destination"} can take ${kg(r.totals.weightPerPalletKg)} per pallet. Spread the load over more pallets and check again.`;
  }
  const lead = r.status === "RED" || r.status === "INCOMPLETE" ? "Once the issues above are fixed, your" : "Your";
  return `${lead} ${what} will be collected from ${b.originCity ?? "the origin"} on ${longDate(best.collectionDate)} by ${carrierName(best)} and should arrive at ${where} on ${longDate(best.etaDate)} (estimated delivery). Freight: ${gbp(best.cost)}.`;
}

/** RULEBOOK §11.6 — what happens next. */
export function nextSteps(b: Booking, r: BookingResult): string[] {
  const best = r.recommendation.recommended;
  const n = r.totals.sumItemCartons ?? b.cartons;
  const steps: string[] = [];
  const reds = r.issues.filter((i) => i.severity === "Red" || i.severity === "Data").length;
  if (reds) steps.push(`Fix the ${plural(reds, "blocking issue")} above, then upload the file again.`);
  if (r.status === "AMBER") steps.push("Review the warnings and tick “I understand these warnings” before confirming.");
  steps.push(b.destinationType === "Warehouse"
    ? `Book or confirm the delivery appointment at the ${b.destinationCity ?? ""} warehouse for ${best ? `${longDate(best.etaDate)} or later` : "on or after the estimated delivery date"}.`
    : `Tell the receiver to expect the pallets${best ? ` on ${longDate(best.etaDate)}` : ""} and confirm they can unload them.`);
  steps.push("Complete the commercial invoice (checklist below) and attach it to the shipment.");
  steps.push(`Label every carton “1 of ${n ?? "N"}” … “${n ?? "N"} of ${n ?? "N"}”.`);
  steps.push(`Have the pallets wrapped and ready for collection${best ? ` on ${longDate(best.collectionDate)}` : ""}.`);
  steps.push("Share the estimated delivery date with the receiver.");
  return steps;
}

export interface ChecklistRow { element: string; status: "have" | "partial" | "to add"; detail: string }

/** RULEBOOK §7.1 — the 15 commercial-invoice elements from the gov.uk guide (A-08). */
export function invoiceChecklist(b: Booking, items: Item[], r: BookingResult): ChecklistRow[] {
  const best = r.recommendation.recommended;
  const n = r.totals.sumItemCartons ?? b.cartons;
  const invNo = `INV-${b.bookingId || "BOOKING"}-${formatDDMMYYYY(r.checkedAgainstDate).replace(/-/g, "")}`;
  const hsOk = r.ruleResults["R-01"] === "pass";
  const originOk = r.ruleResults["R-09"] === "pass";
  return [
    { element: "Invoice number and date of issue", status: "partial", detail: `Draft number ${invNo}; add the issue date.` },
    { element: "Seller and buyer: full name, address, contact", status: "partial", detail: `Seller: ${b.sellerName ?? "—"}. Add full addresses and the buyer's details.` },
    { element: "Consignee (final recipient) if different from the buyer", status: "to add", detail: `Deliver to the ${b.destinationCity ?? ""} ${b.destinationType?.toLowerCase() ?? "site"}; name the consignee if it isn't the buyer.` },
    { element: "Related paperwork (purchase order, proforma, contract)", status: "to add", detail: "Add the PO or contract number and date." },
    { element: "Unit price, payment method, currency, discounts", status: "partial", detail: `Unit prices in ${b.currency ?? "GBP"} are on file. Add payment method and any discounts or extra charges.` },
    { element: "Quantity, gross and net weight, packages", status: "have", detail: `${r.totals.sumUnits ?? "—"} units; gross ${kg(b.totalGrossWeightKg)}; net ${kg(r.totals.sumNetWeightKg)}; ${plural(n, "carton")} on ${plural(b.pallets, "pallet")}.` },
    { element: "HS code and plain-English description", status: hsOk ? "have" : "partial", detail: hsOk ? items.map((i) => `${i.sku ?? "item"}: ${String(i.hsCodeRaw)}`).join("; ") : "Fix the HS code issue (R-01) first." },
    { element: "Incoterms agreed with the buyer", status: "to add", detail: "Incoterms: to be agreed (e.g. DAP)." },
    { element: "Package marks and numbers", status: "have", detail: `Cartons marked 1 of ${n ?? "N"} … ${n ?? "N"} of ${n ?? "N"}.` },
    { element: "Country of origin of the goods", status: originOk ? "have" : "partial", detail: originOk ? [...new Set(items.map((i) => i.countryOfOrigin))].join(", ") : "Add the missing country of origin (R-09)." },
    { element: "Transport details (means and route)", status: best ? "have" : "partial", detail: `Road freight, ${b.originCity ?? "—"} → ${b.destinationCity ?? "—"}${best ? `, ${carrierName(best)}` : ""}.` },
    { element: "Total value of the goods", status: r.ruleResults["R-02"] === "pass" ? "have" : "partial", detail: `Items total ${gbp(r.totals.sumItemValue)}; declared ${gbp(b.totalDeclaredValue)}.` },
    { element: "Additional charges (freight, insurance, certification)", status: "partial", detail: `Freight ${best ? gbp(best.cost) : "—"}; add insurance if any.` },
    { element: "Additional language versions", status: "to add", detail: "English is usually fine; check with the buyer." },
    { element: "Certification (Chamber of Commerce / embassy)", status: "to add", detail: "Check whether the destination market needs it." },
  ];
}

/** Stable short hash of the facts an explanation depends on (cache key). */
export function explanationKey(b: Booking, r: BookingResult): string {
  const s = JSON.stringify([b, r.status, r.issues.map((i) => [i.code, i.whatIsWrong]), r.recommendation.reasonFacts, r.recommendation.label, r.checkedAgainstDate]);
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = (Math.imul(h2, 31) + s.charCodeAt(i)) | 0;
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** Every £ amount and DD-MM-YYYY date in `text` must already appear in `facts` (guardrail G-1). */
export function numbersAreGrounded(text: string, facts: string): boolean {
  const tokens = text.match(/£[\d,]+(?:\.\d{2})?|\b\d{2}-\d{2}-\d{4}\b/g) ?? [];
  return tokens.every((t) => facts.includes(t));
}

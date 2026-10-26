/**
 * Chooses what to ask next — pure, deterministic, never Gemini (QUESTIONS.md §2, §4, §5, §9).
 * Priority: re-ask an unreadable value → pending confirmations (derived values, stated-vs-derived
 * conflicts) → R-06 safety check → a newly failing rule → next missing field (G1 → G7) → optional
 * questions once → review. Voice asks exactly one field per turn.
 */
import {
  CARRIERS, ITEM_ORIGIN_COUNTRIES, ORIGIN_CITIES, PRIORITIES, deriveBookingTotals, gbp, isNum, itemExactCartons, kg, minPalletsFor,
  round, type BookingResult, type Issue,
} from "@/lib/calculations";
import questionsJson from "./questions.json";
import { readDate, readHs, readMoney, readNumber } from "./readback";
import { dgVerdict, productName, type Invalid } from "./state";
import type { ConvItem, ConversationState, Mode, NextQuestion, PendingConfirm } from "./types";

interface QDef { id: string; group: string; field: string; chat: string; voice?: string; options?: string[]; askOnce?: boolean }
export const QUESTIONS: QDef[] = (questionsJson as { questions: QDef[] }).questions;
const Q = (id: string) => QUESTIONS.find((q) => q.id === id)!;
export const NEVER_ASK = (questionsJson as { neverAsk: string[] }).neverAsk;

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);
const asked = (s: ConversationState, key: string) => s.askedOnce.includes(key);
const declined = (s: ConversationState, field: string, i?: number) => s.declined.includes(`${field}:${i ?? ""}`);

function q(id: string, mode: Mode, extra: Partial<NextQuestion> & { vars?: Record<string, string> } = {}): NextQuestion {
  const d = Q(id);
  const vars = extra.vars ?? {};
  const text = extra.text ?? fill(d.chat, vars);
  const voiceText = extra.voiceText ?? fill(d.voice ?? d.chat, vars);
  return { id, kind: "ask", field: d.field, options: d.options ?? [], ...extra, text: mode === "voice" ? voiceText : text, voiceText };
}

export interface NextContext {
  invalid: Invalid[];
  conflicts: PendingConfirm[];
  ambiguous: { text: string; options: string[] } | null;
  /** issue keys from diffResults().newlyFailing, e.g. "R-05", "R-03 [MUG-01]" */
  newlyFailing: string[];
  result: BookingResult | null;
  notes: string[];
}

/* ------------------------------------------------------------------ rule clarifications (§5) */

export function ruleQuestion(s: ConversationState, r: BookingResult, issue: Issue, mode: Mode): NextQuestion | null {
  const b = s.booking;
  const it = issue.itemIndex != null ? s.items[issue.itemIndex] : undefined;
  const product = productName(it);
  const base = { kind: "rule" as const, itemIndex: issue.itemIndex };
  const say = (text: string, voice: string, field: string, options: string[]): NextQuestion =>
    ({ ...base, id: issue.code, field, text: mode === "voice" ? voice : text, voiceText: voice, options });
  switch (issue.code) {
    case "R-01": {
      const d = String(it?.hsCodeRaw ?? "").replace(/\D/g, "");
      if (!d) return null; // blank HS was already handled when we asked (Q-15)
      return say(`The HS code for ${product} is ${d} — only ${d.length} digits. Do you have the full code (at least 6 digits)?`,
        `The HS code is only ${d.length} digits. Do you have the full code?`, "item.hsCodeRaw", ["I don't know"]);
    }
    case "R-02": {
      const n = issue.numbers ?? {};
      return say(`Your declared value is ${gbp(Number(n.declared))}, but the products add up to ${gbp(Number(n.computed))} (${n.diffPct}% different). Which is right — the total, or one of the prices or quantities?`,
        `The products add up to ${readMoney(Number(n.computed))}, not ${readMoney(Number(n.declared))}. Which is right?`, "totalDeclaredValue", [`Use ${gbp(Number(n.computed))}`]);
    }
    case "R-03": {
      if (!it || !isNum(it.unitsPerCarton) || !isNum(it.cartons) || !isNum(it.quantity)) return null;
      const packed = it.unitsPerCarton * it.cartons;
      const exact = itemExactCartons(it);
      const opts = [exact != null ? `${exact} cartons` : null, `${readNumber(packed)} units`].filter(Boolean) as string[];
      return say(`${it.unitsPerCarton} per carton × ${it.cartons} cartons is ${readNumber(packed)}, but you said ${readNumber(it.quantity)} units of ${product}. Which is right?`,
        `${it.unitsPerCarton} per carton times ${it.cartons} cartons is ${readNumber(packed)}, not ${readNumber(it.quantity)}. Which is right?`, "item.cartons", opts);
    }
    case "R-04": {
      const t = r.totals.sumItemCartons;
      return say(`The products add up to ${t} cartons, but the shipment total is ${b.cartons}. Is a product missing, or should the total be ${t}?`,
        `The products add up to ${t} cartons, not ${b.cartons}. Should the total be ${t}?`, "cartons", [`Make it ${t}`, "A product is missing"]);
    }
    case "R-05": {
      const n = issue.numbers ?? {};
      const c = CARRIERS.find((x) => x.id === n.carrier);
      if (!c) return null;
      const minP = minPalletsFor(c, b.totalGrossWeightKg)!;
      const keepCost = c.pricePerPallet * minP;
      const alt = r.recommendation.allOptions.filter((e) => e.fitsWeight && e.carrier.id !== c.id).sort((a, z) => (a.cost ?? 0) - (z.cost ?? 0))[0];
      const opts = [`Use ${minP} pallets`, ...(alt ? [`Switch to ${alt.carrier.carrier}`] : [])];
      const altText = alt ? `, or switch to ${alt.carrier.carrier} ${alt.carrier.service} on ${b.pallets} pallets (${gbp(alt.cost)})` : "";
      return say(`${readNumber(b.totalGrossWeightKg!)} kg on ${b.pallets} pallets is ${kg(r.totals.weightPerPalletKg)} per pallet — ${c.carrier} only takes ${c.maxKgPerPallet} kg. Would you rather use ${minP} pallets and keep ${c.carrier} (${gbp(keepCost)})${altText}?`,
        `That's ${kg(r.totals.weightPerPalletKg)} per pallet — too heavy for ${c.carrier}. Use ${minP} pallets${alt ? `, or switch to ${alt.carrier.carrier}` : ""}?`, "pallets", opts);
    }
    case "R-06":
      return say(`${product} looks like ${String(issue.numbers?.categories ?? "restricted goods").replace(/,/g, " / ").replace("lithium", "a lithium battery").replace("aerosol", "an aerosol").replace("flammable", "a flammable liquid")}, which can't be shipped on this service. Shall I remove it, or is the description wrong?`,
        `${product} can't go on this service. Shall I remove it, or is the description wrong?`, "item.description", [`Remove ${product}`, "Description is wrong"]);
    case "R-07": {
      const n = issue.numbers ?? {};
      return say(`The products alone weigh ${kg(Number(n.net))}, but the total gross weight is ${kg(Number(n.gross))}. Could you re-check the weight?`,
        `The goods alone weigh ${kg(Number(n.net))}, more than the total. Could you re-check the weight?`, "totalGrossWeightKg", [`It's ${Math.ceil(round(Number(n.net) + 15 * (b.pallets ?? 1), 0))} kg`]);
    }
    case "R-08": {
      const eta = r.recommendation.recommended?.etaDate ?? null;
      return say(`It's going to a warehouse without a booked slot. Do you want to book one first (I'd aim for ${eta ? readDate(eta) : "the estimated delivery date"} or later), or carry on?`,
        "There's no delivery slot at the warehouse. Book one first, or carry on?", "deliveryAppointmentBooked", ["Slot is booked now", "Carry on without one"]);
    }
    case "R-09":
      return say(`Where was ${product} made? Customs needs the country of manufacture.`, "Which country was it made in?", "item.countryOfOrigin", [...ITEM_ORIGIN_COUNTRIES]);
    case "R-10":
      return say(`${readDate(b.readyToShipDate)} has already passed. When will the goods really be ready?`, "That date has passed. When will they really be ready?", "readyToShipDate", ["Tomorrow", "Next Monday"]);
    case "V-04": {
      const inferred = b.destinationCity ? { Berlin: "Germany", Frankfurt: "Germany", Hamburg: "Germany", Paris: "France", Lyon: "France", Amsterdam: "Netherlands", Rotterdam: "Netherlands" }[b.destinationCity] : null;
      return say(`${b.destinationCity} isn't in ${b.destinationCountry}. Did you mean ${b.destinationCity} in ${inferred}, or a different city?`,
        `${b.destinationCity} isn't in ${b.destinationCountry}. Did you mean ${inferred}?`, "destinationCountry", [inferred ? `${b.destinationCity}, ${inferred}` : "", "A different city"].filter(Boolean));
    }
    default:
      return null;
  }
}

/** Rules worth interrupting for, ignoring blanks we haven't asked about yet (R-01/R-09 on a fresh item). */
function interruptingIssue(s: ConversationState, ctx: NextContext): Issue | null {
  const r = ctx.result;
  if (!r || !ctx.newlyFailing.length) return null;
  const sev = { Red: 0, Data: 1, Amber: 2, Advisory: 3 } as const;
  const issues = r.issues
    .filter((i) => ctx.newlyFailing.some((k) => k === i.code || k.startsWith(`${i.code} `)))
    .filter((i) => i.code.startsWith("R-") || i.code === "V-04")
    .filter((i) => !(i.code === "R-01" && i.itemIndex != null && s.items[i.itemIndex]?.hsCodeRaw == null))
    .filter((i) => !(i.code === "R-09" && i.itemIndex != null && !asked(s, `Q-16:${i.itemIndex}`)))
    .sort((a, b) => sev[a.severity] - sev[b.severity] || a.code.localeCompare(b.code));
  return issues[0] ?? null;
}

/* ------------------------------------------------------------------ item loop (G3) */

function itemQuestion(s: ConversationState, i: number, mode: Mode): NextQuestion | null {
  const it = s.items[i];
  const product = productName(it);
  const vars = { product, n: String(s.nextAutoSku) };
  const item = (id: string, field: string, extra: Partial<NextQuestion> = {}) => ({ ...q(id, mode, { vars, ...extra }), field: `item.${field}`, itemIndex: i });
  const chat = mode === "chat";

  if (!it.description) return item("Q-08", "description", s.items.length > 1 ? { text: "What's the next product? A short plain description, e.g. 'Ceramic cereal bowl, 15 cm'." } : {});
  if (dgVerdict(it) === "possible" && !(i in s.dgAnswers)) return { ...q("Q-08s", mode, { vars }), kind: "dg", field: "dg", itemIndex: i, options: ["No", "Yes", "I don't know"] };
  if (!it.sku) return item("Q-09", "sku", { options: ["No code"] });
  if (it.quantity == null && it.unitsPerCarton == null && chat)
    return item("Q-10", "quantity", { text: `How many units of ${product} are there in total, and how many are packed in each carton?` });
  // cartons: derive and confirm
  if (it.cartons == null && isNum(it.quantity) && isNum(it.unitsPerCarton)) {
    const exact = itemExactCartons(it);
    if (exact != null && !declined(s, "item.cartons", i)) {
      const reason = `That's ${readNumber(it.quantity)} ÷ ${it.unitsPerCarton} = ${exact} cartons of ${product} — correct?`;
      return { ...item("Q-12", "cartons", { text: reason, voiceText: `So ${exact} cartons — right?`, options: ["Yes", "No"] }), kind: "confirm", confirm: { field: "item.cartons", itemIndex: i, value: exact, kind: "derive", reason } };
    }
    if (exact == null) {
      const full = Math.floor(it.quantity / it.unitsPerCarton), rest = it.quantity % it.unitsPerCarton;
      return item("Q-12", "cartons", { text: `${readNumber(it.quantity)} doesn't split evenly into cartons of ${it.unitsPerCarton} (${full} full cartons and ${rest} left over). How many cartons are there, and are any part-filled?`, voiceText: `${readNumber(it.quantity)} doesn't split evenly into cartons of ${it.unitsPerCarton}. How many cartons are there?` });
    }
  }
  if (it.quantity == null && isNum(it.cartons) && isNum(it.unitsPerCarton) && !declined(s, "item.quantity", i)) {
    const v = it.cartons * it.unitsPerCarton;
    const reason = `${it.cartons} cartons × ${it.unitsPerCarton} per carton is ${readNumber(v)} units of ${product} — correct?`;
    return { ...item("Q-10", "quantity", { text: reason, voiceText: `So ${readNumber(v)} units — right?`, options: ["Yes", "No"] }), kind: "confirm", confirm: { field: "item.quantity", itemIndex: i, value: v, kind: "derive", reason } };
  }
  if (it.unitsPerCarton == null && isNum(it.quantity) && isNum(it.cartons) && it.quantity % it.cartons === 0 && !declined(s, "item.unitsPerCarton", i)) {
    const v = it.quantity / it.cartons;
    const reason = `${readNumber(it.quantity)} units in ${it.cartons} cartons is ${v} per carton — correct?`;
    return { ...item("Q-11", "unitsPerCarton", { text: reason, voiceText: `So ${v} in each carton — right?`, options: ["Yes", "No"] }), kind: "confirm", confirm: { field: "item.unitsPerCarton", itemIndex: i, value: v, kind: "derive", reason } };
  }
  if (it.quantity == null) return item("Q-10", "quantity");
  if (it.unitsPerCarton == null) return item("Q-11", "unitsPerCarton");
  if (it.cartons == null) return item("Q-12", "cartons", { text: `How many cartons of ${product}?`, voiceText: "How many cartons?" });
  if (it.unitPrice == null && it.unitWeightKg == null && chat)
    return item("Q-13", "unitPrice", { text: `What's the price of one ${product} in pounds, and how much does one weigh? (kg or grams)` });
  if (it.unitPrice == null) return item("Q-13", "unitPrice");
  if (it.unitWeightKg == null) return item("Q-14", "unitWeightKg");
  const needHs = it.hsCodeRaw == null && !asked(s, `Q-15:${i}`), needOrigin = it.countryOfOrigin == null && !asked(s, `Q-16:${i}`);
  if (needHs && needOrigin && chat)
    return item("Q-15", "hsCodeRaw", { text: `Do you know the HS code for ${product}? It's at least 6 digits (ceramic tableware is usually 6912…). And where was it made — UK, China, India, Vietnam, Turkey or Germany? (Where it was made, not where it ships from.)`, options: ["I don't know the HS code"] });
  if (needHs) return item("Q-15", "hsCodeRaw", { options: ["I don't know"] });
  if (needOrigin) return item("Q-16", "countryOfOrigin", { text: `Where was ${product} made? (Not where it ships from.) UK, China, India, Vietnam, Turkey or Germany?`, options: [...ITEM_ORIGIN_COUNTRIES] });
  return null;
}

function itemSummary(it: ConvItem) {
  const value = isNum(it.quantity) && isNum(it.unitPrice) ? round(it.quantity * it.unitPrice, 2) : null;
  const net = isNum(it.quantity) && isNum(it.unitWeightKg) ? round(it.quantity * it.unitWeightKg, 3) : null;
  return `So: ${it.cartons} cartons × ${it.unitsPerCarton} ${productName(it)} = ${readNumber(it.quantity!)} units at ${readMoney(it.unitPrice)} = ${readMoney(value)}; ${net != null ? `${readNumber(net)} kg` : "—"} net.`;
}

/* ------------------------------------------------------------------ main */

export function pickNextQuestion(s: ConversationState, ctx: NextContext): NextQuestion {
  const mode = s.mode;
  const b = s.booking;

  if (s.confirmed) return { id: "Q-32", kind: "done", field: "done", text: "Anything else you'd like to change?", voiceText: "Anything else?", options: [] };

  // 1. re-ask what we couldn't read
  if (ctx.ambiguous) return { id: "ambiguous", kind: "reask", field: s.pending?.field ?? "item", text: ctx.ambiguous.text, voiceText: ctx.ambiguous.text, options: ctx.ambiguous.options };
  const bad = ctx.invalid[0];
  if (bad) {
    const tries = (s.failures[bad.field] ?? 0) + 1;
    const opts = bad.options ?? (bad.field === "sellerPriority" ? [...PRIORITIES] : []);
    return { id: `reask:${bad.field}`, kind: "reask", field: bad.field, itemIndex: bad.itemIndex, text: bad.reason, voiceText: tries >= 2 && opts.length ? `${bad.reason} The options are ${opts.slice(0, 7).join(", ")}.` : bad.reason, options: tries >= 2 || opts.length <= 7 ? opts : [] };
  }

  // 2. confirmations waiting (stated-vs-derived conflicts first)
  const conflict = ctx.conflicts[0];
  if (conflict) return { id: "confirm", kind: "confirm", field: conflict.field, itemIndex: conflict.itemIndex, text: conflict.reason, voiceText: conflict.reason, options: [`Yes, make it ${conflict.field === "totalDeclaredValue" ? gbp(conflict.value) : conflict.value}`, "No, keep it"], confirm: conflict };

  // 3. R-06 safety check for a "possible" product
  for (let i = 0; i < s.items.length; i++) {
    const it = s.items[i];
    if (it.description && dgVerdict(it) === "possible" && !(i in s.dgAnswers))
      return { ...q("Q-08s", mode, { vars: { product: productName(it) } }), kind: "dg", field: "dg", itemIndex: i, options: ["No", "Yes", "I don't know"] };
  }

  // 4. a rule that just started failing
  const issue = interruptingIssue(s, ctx);
  if (issue && ctx.result) { const rq = ruleQuestion(s, ctx.result, issue, mode); if (rq) return rq; }

  // 5. missing fields in order
  // G1
  if (!b.sellerName && !b.originCity && mode === "chat")
    return { ...q("Q-01", mode, { text: "Which business is sending the goods, and are they being collected from London, Manchester, Birmingham or Leeds?" }), options: [...ORIGIN_CITIES] };
  if (!b.sellerName) return q("Q-01", mode);
  if (!b.originCity) return q("Q-02", mode);
  if (!b.destinationCity) return q("Q-03", mode, b.destinationCountry ? { text: `Which city in ${b.destinationCountry}? We deliver to ${({ Germany: "Berlin, Frankfurt or Hamburg", France: "Paris or Lyon", Netherlands: "Amsterdam or Rotterdam" } as Record<string, string>)[b.destinationCountry]}.` } : {});
  if (!b.destinationType) return q("Q-04", mode);
  // G2
  if (!b.readyToShipDate) return q("Q-05", mode, { text: "When will the goods be packed and ready for collection? (DD-MM-YYYY, or e.g. 'next Thursday')" });
  if (!b.sellerPriority) {
    if ((s.failures.sellerPriority ?? 0) >= 2) return q("Q-06", mode); // route applies the Balanced fallback
    return q("Q-06", mode, { text: "What matters most for this shipment: cheapest, fastest, most reliable (best on-time record), or a balance of all three?" });
  }
  if (ctx.notes.includes("ask-deadline-date")) return { ...q("Q-07", mode), text: "What date does it need to arrive by?", voiceText: "What date does it need to arrive by?", field: "prefs.requiredDeliveryDate", options: [] };
  if (!s.prefs.requiredDeliveryDate && !asked(s, "Q-07") && !asked(s, "requiredDeliveryDate")) return { ...q("Q-07", mode), kind: "optional", options: ["No deadline"] };
  // G3
  if (!s.items.length) return { ...q("Q-08", mode), field: "item.description", itemIndex: 0 };
  for (let i = 0; i < s.items.length; i++) {
    const iq = itemQuestion(s, i, mode);
    if (iq) return iq;
  }
  if (s.itemLoopOpen) {
    const last = s.items.length - 1;
    const summary = itemSummary(s.items[last]);
    return { ...q("Q-18", mode), kind: "more-items", text: mode === "voice" ? `That makes ${readNumber(s.items[last].quantity!)} ${productName(s.items[last])}. Any other products?` : `${summary} Is there any other product in this shipment?`, field: "loop.moreItems", options: ["No, that's all", "Yes, add another"] };
  }
  // G4
  const t = deriveBookingTotals(s.items);
  if (b.cartons == null) {
    if (t.cartons != null && !declined(s, "cartons")) {
      const reason = `So the shipment has ${t.cartons} cartons in total — correct?`;
      return { ...q("Q-19", mode, { vars: { sumCartons: String(t.cartons) } }), kind: "confirm", text: mode === "voice" ? `${t.cartons} cartons in total — right?` : reason, options: ["Yes", "No"], confirm: { field: "cartons", value: t.cartons, kind: "derive", reason } };
    }
    return { ...q("Q-19", mode), text: "How many cartons are there in total?", voiceText: "How many cartons in total?", options: [] };
  }
  if (b.totalDeclaredValue == null) {
    if (t.totalDeclaredValue != null && !declined(s, "totalDeclaredValue")) {
      const v = gbp(t.totalDeclaredValue);
      const reason = `The goods add up to ${v}. Is that the value on your invoice?`;
      return { ...q("Q-20", mode, { vars: { sumValue: v } }), kind: "confirm", text: mode === "voice" ? `That's ${v} in total — is that what's on your invoice?` : reason, options: ["Yes", "No"], confirm: { field: "totalDeclaredValue", value: t.totalDeclaredValue, kind: "derive", reason } };
    }
    return { ...q("Q-20", mode), text: "What's the total declared value on your invoice, in pounds?", voiceText: "What's the total value on your invoice?", options: [] };
  }
  if (b.pallets == null) return q("Q-21", mode, { text: "How many pallets will it be on? (Carriers take up to 400 kg (C), 500 kg (A) or 750 kg (B) per pallet.)" });
  if (b.totalGrossWeightKg == null) {
    const net = t.minGrossWeightKg;
    if (ctx.notes.includes("gross-unknown") && net != null)
      return q("Q-22", mode, { text: `No worries — the goods weigh ${readNumber(net)} kg; with cartons and ${b.pallets} pallets it's usually at least ${readNumber(round(net + 15 * b.pallets, 1))} kg. Can you weigh the loaded pallets, or give your best estimate?` });
    return q("Q-22", mode, { vars: { net: net != null ? readNumber(net) : "?" }, text: `What's the total gross weight in kg — goods plus cartons and pallets?${net != null ? ` The goods alone are about ${readNumber(net)} kg, so it should be more than that.` : ""}`, options: ["I don't know"] });
  }
  // G5
  if (b.deliveryAppointmentBooked == null)
    return q("Q-23", mode, { text: b.destinationType === "Business address" ? "Have you arranged a delivery time with the receiver?" : "Have you booked a delivery appointment (time slot) at the warehouse?", options: ["Yes", "Not yet"] });
  if (ctx.notes.includes("ask-appointment-date") || (b.deliveryAppointmentBooked && !s.prefs.appointmentDate && !asked(s, "Q-24")))
    return { ...q("Q-24", mode), kind: "optional", options: ["I don't know yet"] };
  // G6 (at most two, each once)
  if ((b.sellerPriority === "Cheapest" || b.sellerPriority === "Balanced") && s.prefs.maxBudgetGbp == null && !asked(s, "Q-25") && !asked(s, "maxBudgetGbp"))
    return { ...q("Q-25", mode), kind: "optional", voiceText: "Is there a maximum you'd like to spend on freight?", options: ["No budget limit"] };
  if (b.sellerPriority === "Balanced" && s.prefs.highValueOrFragile == null && !asked(s, "Q-26"))
    return { ...q("Q-26", mode), kind: "optional", voiceText: "Are the goods especially valuable or fragile?", options: ["Yes", "No"] };
  // G7 review
  return reviewQuestion(s, ctx.result, mode);
}

export function reviewQuestion(s: ConversationState, r: BookingResult | null, mode: Mode): NextQuestion {
  if (!r) return { id: "Q-29", kind: "review", field: "review", text: "Here's your booking. Would you like to fix anything, or confirm?", voiceText: "Shall I read the summary, or do you want to confirm?", options: ["Confirm", "Change something"] };
  const blocking = r.issues.filter((i) => i.severity === "Red" || i.severity === "Data");
  if (blocking.length) {
    const first = blocking.find((i) => i.code.startsWith("R-")) ?? blocking[0];
    const rq = ruleQuestion(s, r, first, mode);
    const list = blocking.map((i) => `${i.code} ${i.title.toLowerCase()}`).join("; ");
    const text = `There ${blocking.length === 1 ? "is 1 issue" : `are ${blocking.length} issues`} that must be fixed before this can go: ${list}. ${rq ? rq.text : "Which would you like to fix first?"}`;
    return { id: "Q-30", kind: "blocked", field: rq?.field ?? "review", itemIndex: rq?.itemIndex, text: mode === "voice" ? `There ${blocking.length === 1 ? "is one issue" : `are ${blocking.length} issues`} to fix first. ${rq?.voiceText ?? ""}`.trim() : text, voiceText: rq?.voiceText ?? "Which would you like to fix first?", options: rq?.options ?? [] };
  }
  const amber = r.issues.filter((i) => i.severity === "Amber");
  if (amber.length) {
    const list = amber.map((i) => `${i.code} ${i.title.toLowerCase()}`).join("; ");
    return { id: "Q-31", kind: "review", field: "review", text: `There ${amber.length === 1 ? "is 1 warning" : `are ${amber.length} warnings`}: ${list}. You can still book — do you want to fix ${amber.length === 1 ? "it" : "them"}, or confirm anyway?`, voiceText: `There ${amber.length === 1 ? "is one warning" : `are ${amber.length} warnings`}. Fix ${amber.length === 1 ? "it" : "them"}, or confirm anyway?`, options: ["Confirm anyway", "Fix the warnings"] };
  }
  return { id: "Q-29", kind: "review", field: "review", text: "Here's your booking — everything checks out. Would you like to change anything, or confirm?", voiceText: "Everything checks out. Shall I confirm it?", options: ["Confirm", "Change something"] };
}

export { readHs };

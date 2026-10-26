/** Unit tests for the conversation modules (prompt §8.1) and chat ↔ Excel parity (§8.3). No network. */
import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import * as C from "@/lib/calculations";
import {
  applyExtraction, buildFacts, createState, fallbackExtract, pickNextQuestion, readDate, readHs, readMoney, readNumber,
  resolveItemRef, spokenDigits, startOver, templateReply, toRunInputs, undo, validateReply,
} from "@/lib/conversation";
import { money, unitWeightKg, wholeNumber } from "@/lib/conversation/normalise";
import { forSpeech } from "@/lib/conversation/readback";
import { parseWorkbook } from "@/lib/parseExcel";
import type { ConversationState, NextQuestion } from "@/lib/conversation/types";
import { NOW, VAGUE_SELLER, ex, play } from "./conversation-helpers";

const today = "2026-10-26";
const ctx = (..._: [ConversationState?]) => ({ invalid: [], conflicts: [], ambiguous: null, newlyFailing: [], result: null, notes: [] });
const apply = (s: ConversationState, x: Record<string, unknown>) => applyExtraction(s, ex(x), today);

describe("state.ts", () => {
  it("new state: BK-CHAT id (UK time), United Kingdom + GBP as defaults", () => {
    const s = createState(NOW);
    expect(s.booking.bookingId).toBe("BK-CHAT-20261026-100000");
    expect([s.booking.originCountry, s.booking.currency]).toEqual(["United Kingdom", "GBP"]);
    expect(s.booking.provenance).toMatchObject({ originCountry: "default", currency: "default" });
  });
  it("values from the seller are 'stated'; city infers the country as 'derived'", () => {
    const { state } = apply(createState(NOW), { booking: { destinationCity: "frankfurt am main", pallets: "three" } });
    expect([state.booking.destinationCity, state.booking.destinationCountry, state.booking.pallets]).toEqual(["Frankfurt", "Germany", 3]);
    expect(state.booking.provenance).toMatchObject({ destinationCity: "stated", destinationCountry: "derived", pallets: "stated" });
  });
  it("invalid values are not stored and come back as a re-ask with options", () => {
    const r = apply(createState(NOW), { booking: { originCity: "Bristol", totalDeclaredValue: "€5,000" }, items: [{ ref: "new", description: "Mug", countryOfOrigin: "Japan" }] });
    expect(r.state.booking.originCity).toBeNull();
    expect(r.invalid.map((i) => i.field)).toEqual(["originCity", "totalDeclaredValue", "item.countryOfOrigin"]);
    expect(r.invalid[0].options).toEqual(["London", "Manchester", "Birmingham", "Leeds"]);
    expect(r.invalid[1].reason).toBe("All prices need to be in GBP — what's the price in pounds?");
  });
  it("units: 500 g → 0.5 kg, 'half a kilo' → 0.5, 1.6 tonnes → 1,600 kg", () => {
    const { state } = apply(createState(NOW), { booking: { totalGrossWeightKg: "1.6 tonnes" }, items: [{ ref: "new", description: "Mug", unitWeightKg: "500 g" }, { ref: "new", description: "Bowl", unitWeightKg: "half a kilo" }] });
    expect(state.booking.totalGrossWeightKg).toBe(1600);
    expect(state.items.map((i) => i.unitWeightKg)).toEqual([0.5, 0.5]);
  });
  it("several products in one message → several items (F2)", () => {
    const { state } = apply(createState(NOW), { items: [{ ref: "new", description: "Ceramic mug", quantity: 100 }, { ref: "new", description: "Cereal bowl", quantity: 50 }] });
    expect(state.items.map((i) => [i.description, i.quantity])).toEqual([["Ceramic mug", 100], ["Cereal bowl", 50]]);
  });
  it("item references: SKU, description words, position; ambiguity asks", () => {
    let s = apply(createState(NOW), { items: [{ ref: "new", description: "Ceramic coffee mug", sku: "MUG-01" }, { ref: "new", description: "Ceramic cereal bowl", sku: "BOWL-02" }] }).state;
    expect(resolveItemRef(s, "mug-01")).toBe(0);
    expect(resolveItemRef(s, "the bowls")).toBe(1);
    expect(resolveItemRef(s, "the second one")).toBe(1);
    expect(resolveItemRef(s, "the ceramic ones")).toEqual({ ambiguous: [0, 1] });
    const r = apply(s, { intent: "change", items: [{ ref: "ceramic", quantity: 10 }] });
    expect(r.ambiguous?.text).toBe("Which product — Ceramic coffee mug or Ceramic cereal bowl?");
    s = r.state;
    expect(s.items.every((i) => i.quantity == null)).toBe(true);
  });
  it("cascade: unit price change updates a derived declared value; a stated one is asked", () => {
    const base = (prov: "derived" | "stated") => {
      const s = apply(createState(NOW), { items: [{ ref: "new", description: "Mug", sku: "M", quantity: 10, unitPrice: 5, unitsPerCarton: 10, cartons: 1, unitWeightKg: 1 }], booking: { cartons: 1, totalDeclaredValue: 50 } }).state;
      s.booking.provenance = { ...s.booking.provenance, totalDeclaredValue: prov };
      return s;
    };
    const d = apply(base("derived"), { intent: "change", items: [{ ref: "mug", unitPrice: 6 }] });
    expect(d.state.booking.totalDeclaredValue).toBe(60);
    expect(d.cascade[0]).toBe("Declared value £50.00 → £60.00 (sum of the products)");
    const st = apply(base("stated"), { intent: "change", items: [{ ref: "mug", unitPrice: 6 }] });
    expect(st.state.booking.totalDeclaredValue).toBe(50);
    expect(st.conflicts[0]).toMatchObject({ field: "totalDeclaredValue", value: 60, kind: "conflict" });
  });
  it("derive-and-confirm: proposed cartons are stored as 'derived' only after yes; 'no' asks instead", async () => {
    const s0 = apply(createState(NOW), { items: [{ ref: "new", description: "Mug", sku: "M", quantity: 1080, unitsPerCarton: 12 }] }).state;
    const q = pickNextQuestion({ ...s0, booking: { ...s0.booking, sellerName: "A", originCity: "Leeds", destinationCity: "Paris", destinationCountry: "France", destinationType: "Warehouse", readyToShipDate: "2026-12-15", sellerPriority: "Cheapest" }, askedOnce: ["Q-07"] }, ctx(s0));
    expect(q.text).toBe("That's 1,080 ÷ 12 = 90 cartons of Mug — correct?");
    expect(q.confirm).toMatchObject({ field: "item.cartons", value: 90 });
    const yes = applyExtraction({ ...s0, pendingConfirm: q.confirm! }, ex({ yesNo: true }), today).state;
    expect([yes.items[0].cartons, yes.items[0].prov.cartons]).toEqual([90, "derived"]);
    const no = applyExtraction({ ...s0, pendingConfirm: q.confirm! }, ex({ yesNo: false }), today).state;
    expect(no.items[0].cartons).toBeNull();
    expect(no.declined).toContain("item.cartons:0");
  });
  it("remove the last product → no items, the loop asks for products again (V-06)", () => {
    const s = apply(createState(NOW), { items: [{ ref: "new", description: "Mug" }] }).state;
    const r = apply(s, { intent: "change", removeItems: ["mug"] });
    expect(r.state.items).toHaveLength(0);
    expect(r.changes[0]).toMatchObject({ field: "removed product", from: "Mug" });
  });
  it("palletDelta: +1, and never below 1", () => {
    let s = apply(createState(NOW), { booking: { pallets: 1 } }).state;
    s = apply(s, { intent: "change", palletDelta: 1 }).state;
    expect(s.booking.pallets).toBe(2);
    s = apply(s, { intent: "change", palletDelta: -5 }).state;
    expect(s.booking.pallets).toBe(1);
  });
  it("undo (several times) and start over", () => {
    let s = createState(NOW);
    s = apply(s, { booking: { pallets: 3 } }).state;
    s = apply(s, { booking: { pallets: 4 } }).state;
    s = apply(s, { booking: { pallets: 5 } }).state;
    s = undo(s).state; expect(s.booking.pallets).toBe(4);
    s = undo(s).state; expect(s.booking.pallets).toBe(3);
    expect(apply(s, { intent: "undo" }).state.booking.pallets).toBeNull();
    const fresh = startOver(s, NOW);
    expect([fresh.id, fresh.booking.pallets, fresh.items.length]).toEqual([s.id, null, 0]);
  });
  it("any change after confirmation voids it (H6)", () => {
    const s = { ...apply(createState(NOW), { booking: { pallets: 3 } }).state, confirmed: { at: "x", reference: "PF-1" } };
    const r = apply(s, { intent: "change", palletDelta: 1 });
    expect(r.state.confirmed).toBeNull();
    expect(r.notes).toContain("confirmation-voided");
  });
  it("a chosen carrier maps to the route's carrier ID", () => {
    const s = apply(createState(NOW), { booking: { destinationCity: "Lyon" }, chosenCarrier: "go with carrier b" }).state;
    expect(toRunInputs(s).booking.chosenCarrierId).toBe("B-FR");
  });
});

describe("nextQuestion.ts", () => {
  const ask = (s: ConversationState): NextQuestion => pickNextQuestion(s, ctx(s));
  it("starts with seller + collection city (chat groups them); voice asks one", () => {
    expect(ask(createState(NOW)).text).toMatch(/Which business is sending the goods, and are they being collected from/);
    expect(ask({ ...createState(NOW), mode: "voice" }).text).toBe("What's your business name?");
  });
  it("skips filled fields and never asks origin country, currency or booking ID", () => {
    const s = apply(createState(NOW), { booking: { sellerName: "A", originCity: "Leeds", destinationCity: "Paris" } }).state;
    const q = ask(s);
    expect(q.field).toBe("destinationType");
    expect(q.text).not.toMatch(/country|currency|booking id/i);
  });
  it("asks for the city when only the country is known", () => {
    const s = apply(createState(NOW), { booking: { sellerName: "A", originCity: "Leeds", destinationCountry: "Holland" } }).state;
    expect(ask(s).text).toBe("Which city in Netherlands? We deliver to Amsterdam or Rotterdam.");
  });
  it("optional questions are asked once (Q-07)", () => {
    const s = apply(createState(NOW), { booking: { sellerName: "A", originCity: "Leeds", destinationCity: "Paris", destinationType: "shop", readyToShipDate: "15-12-2026", sellerPriority: "fast" } }).state;
    expect(ask(s).id).toBe("Q-07");
    expect(ask({ ...s, askedOnce: ["Q-07"] }).id).toBe("Q-08");
  });
  it("rule clarification comes before the next missing field", () => {
    const s = apply(createState(NOW), { booking: { sellerName: "A", originCity: "Leeds", destinationCity: "Paris", destinationCountry: "Germany" } }).state;
    const { booking, items } = toRunInputs(s);
    const r = C.runAll(booking, items, { now: NOW });
    const q = pickNextQuestion(s, { ...ctx(s), newlyFailing: ["V-04"], result: r });
    expect(q.text).toBe("Paris isn't in Germany. Did you mean Paris in France, or a different city?");
  });
  it("review when everything is filled", async () => {
    const { last } = await play([...VAGUE_SELLER, ["Carry on", ex({ booking: { deliveryAppointmentBooked: "no" } })], ["no", ex({ prefs: { maxBudgetGbp: "no" } })]]);
    expect(last.reply).toMatch(/There is 1 warning: R-08 no delivery appointment at the warehouse\. You can still book/);
    expect(last.quickReplies).toEqual(["Confirm anyway", "Fix the warnings", "Change something"]);
  });
});

describe("fallback.ts", () => {
  const p = (field: string, extra: Record<string, unknown> = {}) => ({ questionId: "Q", field, ...extra });
  it("reads the pending field for each type", () => {
    expect(fallbackExtract("Manchester", p("originCity")).booking.originCity).toBe("Manchester");
    expect(fallbackExtract("next Thursday", p("readyToShipDate")).booking.readyToShipDate).toBe("next Thursday");
    expect(fallbackExtract("620 kg", p("totalGrossWeightKg")).booking.totalGrossWeightKg).toBe("620 kg");
    expect(fallbackExtract("not yet", p("deliveryAppointmentBooked")).booking.deliveryAppointmentBooked).toBe(false);
    expect(fallbackExtract("£5.50", p("item.unitPrice", { itemIndex: 0 })).items[0]).toMatchObject({ ref: 0, unitPrice: "£5.50" });
    expect(fallbackExtract("1,020 units", p("item.cartons", { itemIndex: 0 })).items[0]).toMatchObject({ quantity: "1,020" });
  });
  it("keywords: undo, start over, confirm, add a pallet, carrier, remove", () => {
    expect(fallbackExtract("undo", null).intent).toBe("undo");
    expect(fallbackExtract("start over", null).intent).toBe("start_over");
    expect(fallbackExtract("confirm", null).intent).toBe("confirm");
    expect(fallbackExtract("add a pallet", null).palletDelta).toBe(1);
    expect(fallbackExtract("Switch to Carrier B", null).chosenCarrier).toBe("Carrier B");
    expect(fallbackExtract("Remove the power banks", null).removeItems).toEqual(["power banks"]);
  });
});

describe("normalise.ts", () => {
  it("whole numbers with a unit word after them", () => {
    expect(["12 a box", "1,080 units", "90 cartons", "12 per carton", "12"].map((v) => wholeNumber(v))).toEqual([12, 1080, 90, 12, 12].map((value) => ({ ok: true, value })));
    expect(wholeNumber("some").ok).toBe(false);
    expect(wholeNumber("twelve a box")).toEqual({ ok: true, value: 12 });
    expect(unitWeightKg("half a kilo each")).toEqual({ ok: true, value: 0.5 });
    expect(unitWeightKg("500 g each")).toEqual({ ok: true, value: 0.5 });
    expect(money("£5 each")).toEqual({ ok: true, value: 5 });
  });
});

describe("readback.ts", () => {
  it("numbers, dates with weekday, HS in pairs, money", () => {
    expect([readNumber(1080), readDate("2026-11-05"), readHs("691200"), readMoney(5.5)]).toEqual(["1,080", "Thursday 05-11-2026", "69-12-00", "£5.50"]);
  });
  it("text for speech", () => {
    expect(forSpeech("£5,400.00 or £5.50")).toBe("£5,400 or £5.50");
    expect(forSpeech("Ready Thursday 05-11-2026, HS 69-12-00, 620 kg → 1,600 kg")).toBe("Ready Thursday 5 November, HS 6 9 1 2 0 0, 620 kilos to 1,600 kilos");
  });
  it("spoken HS codes", () => {
    expect(spokenDigits("six nine one two oh oh")).toBe("691200");
    expect(spokenDigits("six nine one two double zero")).toBe("691200");
    expect(spokenDigits("69 12 00")).toBe("691200");
    expect(spokenDigits("ceramic mugs")).toBeNull();
  });
});

describe("reply validator", () => {
  const facts = buildFacts({ changes: [{ field: "pallets", from: "3", to: "4" }], cascade: [], readbacks: [], delta: null, result: null,
    next: { id: "Q-22", kind: "ask", field: "totalGrossWeightKg", text: "What's the total gross weight in kg?", voiceText: "", options: [] },
    answer: null, sellerQuestion: null, notes: [], mode: "chat", showRecommendation: false });
  it("accepts the template reply", () => expect(validateReply(templateReply(facts), facts).ok).toBe(true));
  it("rejects a £ amount, date, carrier or rule not in FACTS, or a missing next question", () => {
    expect(validateReply("Updated pallets to 4, that's £720.00. What's the total gross weight in kg?", facts)).toEqual({ ok: false, problem: "amount £720.00" });
    expect(validateReply("Arrives 12-11-2026. What's the total gross weight in kg?", facts).ok).toBe(false);
    expect(validateReply("Carrier C is better. What's the total gross weight in kg?", facts).ok).toBe(false);
    expect(validateReply("R-05 is fixed. What's the total gross weight in kg?", facts).ok).toBe(false);
    expect(validateReply("Updated pallets to 4.", facts)).toEqual({ ok: false, problem: "next question missing" });
  });
});

describe("parity: chat gives the same results as Excel (§8.3)", () => {
  const file = path.resolve(__dirname, "fixtures/edge-cases.xlsx");
  const parsed = parseWorkbook(new Uint8Array(fs.readFileSync(file)), "edge-cases.xlsx");
  const excel = C.runFile(parsed.bookings, parsed.items, { now: NOW });
  for (const id of ["EC-01", "EC-17", "EC-19", "EC-69"]) {
    it(`${id}: status, rule results, issue codes, carrier, cost and ETA match`, async () => {
      const i = parsed.bookings.findIndex((b) => b.bookingId === id);
      const row = parsed.bookingRows[i].values;
      const items = parsed.itemRows.filter((r) => C.bookingKey(r.values["Booking ID"]) === C.bookingKey(id)).map((r) => r.values);
      const v = (k: string) => (row[k] == null ? null : String(row[k]));
      const { state } = await play([[`booking ${id}`, ex({
        booking: { sellerName: v("Seller name"), originCity: v("Origin city"), destinationCity: v("Destination city"), destinationCountry: v("Destination country"), destinationType: v("Destination type"),
          readyToShipDate: v("Ready to ship date"), sellerPriority: v("Seller priority"), pallets: v("Pallets"), cartons: v("Cartons"), totalDeclaredValue: v("Total declared value"),
          totalGrossWeightKg: v("Total gross weight (kg)"), deliveryAppointmentBooked: v("Delivery appointment booked") },
        items: items.map((it) => ({ ref: "new", sku: it.SKU, description: it.Description, hsCodeRaw: it["HS code"] == null ? null : String(it["HS code"]), quantity: it["Quantity (units)"], unitPrice: it["Unit price"],
          unitsPerCarton: it["Units per carton"], cartons: it.Cartons, unitWeightKg: it["Unit weight (kg)"], countryOfOrigin: it["Country of origin"] ?? null })),
      })]]);
      const chat = state.lastResult!;
      const xl = excel.results[i];
      const pick = (r: C.BookingResult) => ({
        status: r.status, ruleResults: r.ruleResults, codes: r.issues.map((x) => x.code).sort(),
        carrier: r.recommendation.recommended?.carrier.id ?? null, cost: r.recommendation.recommended?.cost ?? null, eta: r.recommendation.recommended?.etaDate ?? null,
      });
      expect(pick(chat)).toEqual(pick(xl));
    });
  }
});

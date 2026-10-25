/**
 * Vitest tests for calculations.ts  —  run: npx vitest run
 * "Today" is pinned to 25-10-2026 (UK) so R-10 and ETAs are stable.
 */
import { describe, it, expect } from "vitest";
import * as C from "@/lib/calculations";

const now = new Date("2026-10-25T10:00:00Z");
const base: C.Booking = {
  bookingId: "BK-001", sellerName: "Northfield Goods", originCity: "Manchester", originCountry: "United Kingdom",
  destinationCity: "Frankfurt", destinationCountry: "Germany", destinationType: "Warehouse", readyToShipDate: "2026-11-05",
  sellerPriority: "Cheapest", pallets: 3, cartons: 90, totalDeclaredValue: 5400, currency: "GBP",
  totalGrossWeightKg: 620, deliveryAppointmentBooked: true,
};
const mug: C.Item = {
  bookingId: "BK-001", sku: "MUG-01", description: "Ceramic coffee mug, 350 ml", hsCodeRaw: 691200, quantity: 1080,
  unitPrice: 5, unitsPerCarton: 12, cartons: 90, unitWeightKg: 0.5, countryOfOrigin: "United Kingdom",
};
const run = (b: Partial<C.Booking> = {}, items: C.Item[] = [mug]) => C.runAll({ ...base, ...b }, items, { now });
const codes = (r: C.BookingResult) => r.issues.filter((i) => i.severity !== "Advisory").map((i) => i.code);

describe("template example BK-001", () => {
  it("is green and recommends Carrier A for Cheapest", () => {
    const r = run();
    expect(r.status).toBe("GREEN");
    expect(r.recommendation.recommended?.carrier.id).toBe("A-DE");
    expect(r.recommendation.recommended?.cost).toBe(540);
    expect(r.recommendation.recommended?.etaDate).toBe("2026-11-12"); // Thu 05-11 + 5 working days
  });
  it("priority mapping", () => {
    expect(run({ sellerPriority: "Fastest" }).recommendation.recommended?.carrier.id).toBe("C-DE");
    expect(run({ sellerPriority: "Most reliable" }).recommendation.recommended?.carrier.id).toBe("C-DE");
    expect(run({ sellerPriority: "Balanced" }).recommendation.recommended?.carrier.id).toBe("B-DE");
  });
});

describe("official rules", () => {
  it("R-01 blank / short / 5-digit numeric", () => {
    expect(codes(run({}, [{ ...mug, hsCodeRaw: null }]))).toContain("R-01");
    expect(codes(run({}, [{ ...mug, hsCodeRaw: "6912" }]))).toContain("R-01");
    const r = run({}, [{ ...mug, hsCodeRaw: 90111 }]);
    expect(r.issues.find((i) => i.code === "R-01")?.howToFix[0]).toMatch(/leading zero/);
    expect(codes(run({}, [{ ...mug, hsCodeRaw: "6912.00" }]))).not.toContain("R-01");
  });
  it("R-02 1% tolerance", () => {
    expect(codes(run({ totalDeclaredValue: 5454 }))).not.toContain("R-02"); // +1.0%
    expect(codes(run({ totalDeclaredValue: 5455 }))).toContain("R-02"); // +1.02%
    expect(codes(run({ totalDeclaredValue: 5346 }))).not.toContain("R-02"); // −1.0%
    expect(codes(run({ totalDeclaredValue: 5345 }))).toContain("R-02");
  });
  it("R-03 / R-04 cartons", () => {
    expect(codes(run({ cartons: 85 }, [{ ...mug, cartons: 85 }]))).toEqual(["R-03"]);
    expect(codes(run({ cartons: 84 }))).toEqual(["R-04"]);
  });
  it("R-05 overweight pallets → priority pick flagged, eligible carrier recommended", () => {
    const r = run({ totalGrossWeightKg: 1600 });
    expect(codes(r)).toContain("R-05");
    expect(r.recommendation.recommended?.carrier.id).toBe("B-DE");
    expect(r.recommendation.label).toBe("Recommended once fixed");
    const fixed = run({ totalGrossWeightKg: 1600, pallets: 4 });
    expect(codes(fixed)).not.toContain("R-05");
  });
  it("R-05 boundary: exactly at max passes", () => {
    expect(codes(run({ totalGrossWeightKg: 1500 }))).not.toContain("R-05"); // 500 kg/pallet on A
  });
  it("R-06 definite / negated / possible", () => {
    expect(codes(run({}, [{ ...mug, description: "Lithium-ion power bank 10000mAh" }]))).toContain("R-06");
    expect(codes(run({}, [{ ...mug, description: "Deodorant body spray 150ml" }]))).toContain("R-06");
    expect(codes(run({}, [{ ...mug, description: "Nail polish remover (acetone) 100ml" }]))).toContain("R-06");
    expect(codes(run({}, [{ ...mug, description: "Non-flammable cleaning wipes" }]))).not.toContain("R-06");
    const possible = run({}, [{ ...mug, description: "Bluetooth speaker" }]);
    expect(codes(possible)).not.toContain("R-06");
    expect(possible.issues.some((i) => i.code === "A-09")).toBe(true);
    const confirmed = C.runAll(base, [{ ...mug, description: "Bluetooth speaker" }], { now, geminiR06Verdicts: { 0: true } });
    expect(codes(confirmed)).toContain("R-06");
  });
  it("R-07 gross < net is Amber", () => {
    const r = run({ totalGrossWeightKg: 500 });
    expect(codes(r)).toEqual(["R-07"]);
    expect(r.status).toBe("AMBER");
    expect(r.canConfirm).toBe(true);
    expect(r.needsAmberAcknowledgement).toBe(true);
  });
  it("R-08 / R-09 / R-10", () => {
    expect(codes(run({ deliveryAppointmentBooked: false }))).toEqual(["R-08"]);
    expect(codes(run({ destinationType: "Business address", deliveryAppointmentBooked: false }))).toEqual([]);
    expect(codes(run({}, [{ ...mug, countryOfOrigin: null }]))).toEqual(["R-09"]);
    expect(codes(run({ readyToShipDate: "2026-10-24" }))).toEqual(["R-10"]);
    expect(codes(run({ readyToShipDate: "2026-10-25" }))).toEqual([]); // today passes
  });
});

describe("status & data", () => {
  it("missing pallets → INCOMPLETE, cannot confirm", () => {
    const r = run({ pallets: null });
    expect(r.status).toBe("INCOMPLETE");
    expect(r.canConfirm).toBe(false);
    expect(r.ruleResults["R-05"]).toBe("not_evaluable");
  });
  it("orphan items reported at file level", () => {
    const f = C.runFile([base], [mug, { ...mug, bookingId: "BK-999" }], { now });
    expect(f.fileIssues[0].code).toBe("V-11");
  });
  it("runFile applies R-06 AI verdicts per booking, not to the same item index in every booking", () => {
    const speaker = { ...mug, bookingId: "BK-002", sku: "SPK-01", description: "Bluetooth speaker" };
    const f = C.runFile([base, { ...base, bookingId: "BK-002" }], [mug, speaker], {
      now, geminiR06VerdictsByBooking: { "BK-002": { 0: true } },
    });
    expect(f.results[0].status).toBe("GREEN"); // the mug in BK-001 is untouched
    expect(f.results[1].status).toBe("RED");
    expect(codes(f.results[1])).toContain("R-06");
  });
});

describe("mid-way change", () => {
  it("add a pallet fixes R-05 and changes the recommendation", () => {
    const b1 = { ...base, totalGrossWeightKg: 1600 }, b2 = { ...b1, pallets: 4 };
    const r1 = C.runAll(b1, [mug], { now }), r2 = C.runAll(b2, [mug], { now });
    const d = C.diffResults(b1, [mug], r1, b2, [mug], r2);
    expect(d.fieldChanges).toEqual([{ field: "Pallets", from: 3, to: 4 }]);
    expect(d.nowPassing).toContain("R-05");
    expect(d.statusChange).toEqual({ from: "RED", to: "GREEN" });
    expect(d.recommendationChange).toEqual({ from: "B-DE", to: "A-DE" });
  });
});

describe("parsers", () => {
  it("numbers", () => {
    expect(C.parseNumber("one thousand and eighty")).toBe(1080);
    expect(C.parseNumber("1,080")).toBe(1080);
    expect(C.parseNumber("£5.00")).toBe(5);
    expect(C.parseNumber("620 kilos")).toBe(620);
    expect(C.parseNumber("five pounds fifty")).toBe(5.5);
    expect(C.parseNumber("a dozen")).toBe(12);
  });
  it("dates", () => {
    expect(C.parseDate("05-11-2026")).toBe("2026-11-05");
    expect(C.parseDate(46331)).toBe("2026-11-05");
    expect(C.parseDate("31-02-2026")).toBeNull();
    expect(C.parseSpokenDate("5th of November", "2026-10-25")).toBe("2026-11-05");
    expect(C.parseSpokenDate("tomorrow", "2026-10-25")).toBe("2026-10-26");
  });
  it("enums", () => {
    expect(C.normalisePriority("as cheap as possible")).toBe("Cheapest");
    expect(C.normalisePriority("it can't be late")).toBe("Most reliable");
    expect(C.normalisePriority("don't mind")).toBe("Balanced");
    expect(C.normaliseDestinationType("Amazon FC")).toBe("Warehouse");
    expect(C.normaliseCountry("Holland")).toBe("Netherlands");
    expect(C.normaliseYesNo("not yet")).toBe(false);
  });
});

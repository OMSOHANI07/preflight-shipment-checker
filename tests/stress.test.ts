/** Runs the generated stress workbook end to end: parse → runFile() → expected statuses and failing rules. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as C from "@/lib/calculations";
import { parseWorkbook } from "@/lib/parseExcel";
import { STRESS_BOOKINGS } from "../scripts/stress-data";

const now = new Date("2026-10-26T10:00:00Z");
const file = fs.readFileSync(path.resolve(__dirname, "../public/samples/stress-test.xlsx"));
const parsed = parseWorkbook(new Uint8Array(file), "stress-test.xlsx");
const run = C.runFile(parsed.bookings, parsed.items, { now });
const byId = new Map(run.results.map((r) => [r.bookingId, r]));
const failing = (r: C.BookingResult) => (Object.keys(r.ruleResults) as C.RuleId[]).filter((id) => r.ruleResults[id] === "fail");

describe("stress-test workbook", () => {
  it("skips the grey example row and reads every booking", () => {
    expect(parsed.fatal).toBeNull();
    expect(parsed.usedExampleAsDemo).toBe(false);
    expect(parsed.bookings.map((b) => b.bookingId)).toEqual(STRESS_BOOKINGS.map((s) => s.row["Booking ID"]));
  });

  for (const s of STRESS_BOOKINGS) {
    const id = s.row["Booking ID"] as string;
    it(`${id}: ${s.note}`, () => {
      const r = byId.get(id)!;
      expect(r.status).toBe(s.expectStatus);
      expect(failing(r)).toEqual(s.expectFails);
    });
  }

  it("BK-T06 recommends Carrier B once fixed", () => {
    const r = byId.get("BK-T06")!;
    expect(r.recommendation.label).toBe("Recommended once fixed");
    expect(r.recommendation.recommended?.carrier.id).toBe("B-DE");
  });
  it("BK-T15 has no carrier that fits", () => {
    expect(byId.get("BK-T15")!.recommendation.label).toBe("No carrier fits");
  });
  it("BK-T12 flags the 5-digit numeric HS code as a possible lost leading zero", () => {
    const r01 = byId.get("BK-T12")!.issues.find((i) => i.code === "R-01")!;
    expect(r01.howToFix[0]).toMatch(/leading zero/);
  });
  it("BK-T13 is incomplete because pallets are missing", () => {
    const r = byId.get("BK-T13")!;
    expect(r.canConfirm).toBe(false);
    expect(r.ruleResults["R-05"]).toBe("not_evaluable");
  });
  it("BK-T16 Bluetooth speaker: A-09 without AI, R-06 when AI confirms", () => {
    const r = byId.get("BK-T16")!;
    expect(r.issues.some((i) => i.code === "A-09")).toBe(true);
    const b = parsed.bookings.find((x) => x.bookingId === "BK-T16")!;
    const its = parsed.items.filter((x) => x.bookingId === "BK-T16");
    expect(C.runAll(b, its, { now, geminiR06Verdicts: { 0: true } }).status).toBe("RED");
  });
  it("BK-T03 reads a real Excel date cell", () => {
    expect(parsed.bookings.find((b) => b.bookingId === "BK-T03")!.readyToShipDate).toBe("2027-01-13");
  });
  it("reports the orphan item at file level (V-11)", () => {
    expect(run.fileIssues.map((i) => i.code)).toEqual(["V-11"]);
    expect(run.fileIssues[0].whatIsWrong).toContain("BK-T99");
  });
});

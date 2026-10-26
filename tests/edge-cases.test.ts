/**
 * Edge-case suite: parses tests/fixtures/edge-cases.xlsx with the app's real parser, runs runFile() with
 * today = 26-10-2026 and checks every row of the workbook's own "Expected results" sheet
 * (status, flags — only tips A-03/04/05/07/09/10 compared — and carrier result).
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { compareEdgeFile } from "../scripts/edge-compare";

const { rows, summary, parsed } = compareEdgeFile(path.resolve(__dirname, "fixtures/edge-cases.xlsx"), new Date("2026-10-26T10:00:00Z"));

describe("Edge_Case_Test_Data.xlsx", () => {
  it("summary: 76 bookings — Red 21, Incomplete 15, Amber 7, Green 33 — plus one V-11 (EC-99)", () => {
    expect(summary.engineSummary).toMatchObject({ total: 76, red: 21, incomplete: 15, amber: 7, green: 33 });
    expect(summary.fileIssues).toHaveLength(1);
    expect(summary.fileIssues[0]).toMatch(/^V-11: .*EC-99/);
  });
  it("grey example row BK-001 is skipped", () => {
    expect(parsed.bookings.some((b) => b.bookingId === "BK-001")).toBe(false);
    expect(parsed.notices.some((n) => /grey example/.test(n.message))).toBe(true);
  });
  it("the expected-results sheet has every case", () => expect(rows).toHaveLength(77));
  for (const r of rows) {
    it(`${r.booking_id} — ${r.edge_case}: expected ${r.expected_status} ${r.expected_flags}`, () => {
      expect({ status: r.actual_status, flags: r.actual_flags, carrier: r.actual_carrier })
        .toEqual({ status: r.expected_status, flags: r.expected_flags, carrier: r.status_ok && r.carrier_ok ? r.actual_carrier : r.expected_carrier });
    });
  }
});

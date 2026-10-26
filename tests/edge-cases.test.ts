/** Runs the 75-booking edge-case workbook and checks every row of its own "Expected results" sheet. */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const out = path.join(root, "reports/edge/results.json");

describe("Edge_Case_Test_Data.xlsx", () => {
  execFileSync("npx", ["tsx", "scripts/run-edge-cases.ts"], { cwd: root, stdio: "ignore" });
  const { summary, rows } = JSON.parse(fs.readFileSync(out, "utf8")) as {
    summary: { engineSummary: Record<string, number>; fileIssues: string[] };
    rows: { booking_id: string; status_ok: boolean; flags_ok: boolean; carrier_ok: boolean; expected_status: string; actual_status: string }[];
  };
  it("summary matches the file's Read me: 76 bookings — Red 21, Incomplete 15, Amber 7, Green 33, 1 orphan", () => {
    expect(summary.engineSummary).toMatchObject({ total: 76, red: 21, incomplete: 15, amber: 7, green: 33 });
    expect(summary.fileIssues).toHaveLength(1);
  });
  for (const r of rows) {
    it(`${r.booking_id}: status, flags and carrier match the expected results`, () => {
      expect({ status: r.status_ok, flags: r.flags_ok, carrier: r.carrier_ok }).toEqual({ status: true, flags: true, carrier: true });
    });
  }
});

/**
 * Runs the edge-case workbook through the app's own parser + rule engine and compares every booking
 * with its "Expected results" sheet → reports/edge/results.json.   Run: npx tsx scripts/run-edge-cases.ts
 * "Today" is pinned to 26-10-2026 (UK), the date the expected results assume.
 */
import fs from "node:fs";
import { compareEdgeFile } from "./edge-compare";

const { rows, summary } = compareEdgeFile("tests/fixtures/edge-cases.xlsx", new Date("2026-10-26T12:00:00Z"));
fs.mkdirSync("reports/edge", { recursive: true });
fs.writeFileSync("reports/edge/results.json", JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
for (const r of rows.filter((x) => !(x.status_ok && x.flags_ok && x.carrier_ok)))
  console.log(`\n✗ ${r.booking_id} [${r.edge_case}]` +
    (r.status_ok ? "" : `\n   status  exp ${r.expected_status} | got ${r.actual_status}`) +
    (r.flags_ok ? "" : `\n   flags   exp ${r.expected_flags} | got ${r.actual_flags}`) +
    (r.carrier_ok ? "" : `\n   carrier exp ${r.expected_carrier}\n           got ${r.actual_carrier}`));

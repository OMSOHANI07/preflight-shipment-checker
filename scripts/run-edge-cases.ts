/**
 * Runs data/edge/Edge_Case_Test_Data.xlsx through the app's own parser + rule engine and
 * compares every booking with the workbook's "Expected results" sheet.
 *   Run: npx tsx scripts/run-edge-cases.ts            → reports/edge/results.json
 * "Today" is pinned to 26-10-2026 (UK), the date the expected results assume.
 */
import fs from "node:fs";
import * as XLSX from "xlsx";
import * as C from "@/lib/calculations";
import { confirmationDraft } from "@/lib/explain";
import { parseWorkbook } from "@/lib/parseExcel";

const FILE = "data/edge/Edge_Case_Test_Data.xlsx";
const NOW = new Date("2026-10-26T12:00:00Z");
const LISTED_TIPS = new Set(["A-03", "A-04", "A-05", "A-07", "A-09", "A-10"]); // per the file's Read me

const buf = new Uint8Array(fs.readFileSync(FILE));
const parsed = parseWorkbook(buf, "Edge_Case_Test_Data.xlsx");
const run = C.runFile(parsed.bookings, parsed.items, { now: NOW });

// Expected results sheet
const wb = XLSX.read(buf, { type: "array" });
const exp = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Expected results"], { range: 1, defval: null });
const col = (r: Record<string, unknown>, start: string) => String(r[Object.keys(r).find((k) => k.startsWith(start))!] ?? "").trim();

const fmtCarrier = (r: C.BookingResult) => {
  const rec = r.recommendation, best = rec.recommended;
  if (!best) return rec.label;
  return `${rec.label}: ${best.carrier.carrier} ${best.carrier.service} ${best.cost != null ? C.gbp(best.cost) : "—"}, ETA ${best.etaDate ? C.formatDDMMYYYY(best.etaDate) : "—"}`;
};
const flagsOf = (r: C.BookingResult) =>
  [...new Set(r.issues.filter((i) => i.severity !== "Advisory" || LISTED_TIPS.has(i.code)).map((i) => i.code))].sort();
const parseFlags = (s: string) => (s === "—" || !s ? [] : s.split(/[,\s]+/).filter(Boolean).sort());

const rows = exp.map((e) => {
  const id = col(e, "Booking ID");
  const expectedStatus = col(e, "Expected status");
  const expectedFlags = parseFlags(col(e, "Expected flags"));
  const expectedCarrier = col(e, "Expected carrier");
  const base = { booking_id: id, category: col(e, "Category"), edge_case: col(e, "Edge case"), what: col(e, "What it tests"), expected_status: expectedStatus, expected_flags: expectedFlags.join(", ") || "—", expected_carrier: expectedCarrier };

  if (expectedStatus === "SKIPPED") {
    const skipped = !parsed.bookings.some((b) => b.bookingId === id) && parsed.notices.some((n) => /grey example/.test(n.message));
    return { ...base, actual_status: skipped ? "SKIPPED" : "CHECKED", actual_flags: "—", actual_carrier: "—", status_ok: skipped, flags_ok: true, carrier_ok: true, issues: [] as string[], confirmation: "" };
  }
  if (expectedStatus === "FILE") {
    const fi = run.fileIssues.filter((i) => i.whatIsWrong.includes(id));
    return { ...base, actual_status: fi.length ? "FILE" : "—", actual_flags: fi.map((i) => i.code).join(", ") || "—", actual_carrier: "—", status_ok: fi.length > 0, flags_ok: fi.some((i) => i.code === "V-11"), carrier_ok: true, issues: fi.map((i) => `${i.code}: ${i.whatIsWrong}`), confirmation: "" };
  }
  // A duplicated ID appears twice: compare the first, note both
  const idx = parsed.bookings.findIndex((b) => b.bookingId === id);
  if (idx < 0) return { ...base, actual_status: "MISSING", actual_flags: "—", actual_carrier: "—", status_ok: false, flags_ok: false, carrier_ok: false, issues: ["Booking not found on the Bookings sheet after parsing"], confirmation: "" };
  const r = run.results[idx];
  const b = parsed.bookings[idx];
  const items = parsed.items.filter((it) => C.bookingKey(it.bookingId) === C.bookingKey(b.bookingId));
  const flags = flagsOf(r);
  const carrier = fmtCarrier(r);
  return {
    ...base,
    actual_status: r.status, actual_flags: flags.join(", ") || "—", actual_carrier: carrier,
    status_ok: r.status === expectedStatus,
    flags_ok: JSON.stringify(flags) === JSON.stringify(expectedFlags),
    carrier_ok: carrier === expectedCarrier,
    issues: r.issues.filter((i) => i.severity !== "Advisory").map((i) => `${i.code}${i.sku ? ` [${i.sku}]` : ""}: ${i.whatIsWrong}`),
    confirmation: confirmationDraft(b, items, r),
  };
});

fs.mkdirSync("reports/edge", { recursive: true });
const summary = {
  file: FILE, checkedAgainst: "26-10-2026", parserNotices: parsed.notices.map((n) => n.message),
  bookingsParsed: parsed.bookings.length, itemsParsed: parsed.items.length,
  engineSummary: run.summary, fileIssues: run.fileIssues.map((i) => `${i.code}: ${i.whatIsWrong}`),
  cases: rows.length,
  allMatch: rows.filter((r) => r.status_ok && r.flags_ok && r.carrier_ok).length,
};
fs.writeFileSync("reports/edge/results.json", JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
for (const r of rows.filter((x) => !(x.status_ok && x.flags_ok && x.carrier_ok)))
  console.log(`\n✗ ${r.booking_id} [${r.edge_case}]` +
    (r.status_ok ? "" : `\n   status  exp ${r.expected_status} | got ${r.actual_status}`) +
    (r.flags_ok ? "" : `\n   flags   exp ${r.expected_flags} | got ${r.actual_flags}`) +
    (r.carrier_ok ? "" : `\n   carrier exp ${r.expected_carrier}\n           got ${r.actual_carrier}`));

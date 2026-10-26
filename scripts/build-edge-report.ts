/**
 * Builds the self-contained edge-case report: reports/edge/Edge_Case_Test_Report.html
 * (no network needed; dark/light toggle). Inputs: reports/edge/{results,ai}.json and the
 * Playwright edge runs. Run after scripts/run-edge-cases.ts and scripts/edge-ai-check.ts.
 */
import fs from "node:fs";

const read = <T,>(p: string): T | null => (fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as T) : null);
const results = read<{ summary: Record<string, unknown>; rows: Record<string, unknown>[] }>("reports/edge/results.json")!;
const ai = read<Record<string, unknown>>("reports/edge/ai.json");

interface PwSuite { suites?: PwSuite[]; specs?: { title: string; tests: { results: { status: string; duration: number }[] }[] }[] }
const pwCases = (file: string) => {
  const j = read<{ suites: PwSuite[]; stats: { startTime: string } }>(file);
  if (!j) return null;
  const out: { name: string; status: string; ms: number }[] = [];
  const walk = (s: PwSuite) => { for (const sp of s.specs ?? []) for (const t of sp.tests) { const r = t.results.at(-1); out.push({ name: sp.title.replace(/^\[Edge\]\s*/, ""), status: r?.status ?? "failed", ms: Math.round(r?.duration ?? 0) }); } (s.suites ?? []).forEach(walk); };
  j.suites.forEach(walk);
  return { at: j.stats.startTime, cases: out };
};

// What the engine produced on the first run, before the fixes (from the first comparison).
const BEFORE: Record<string, { got: string; cause: string; fix: string; area: string; kind?: "followup"; now?: string }> = {
  "EC-13": { area: "Money", got: "GREEN + tip A-07 (items valued at £330.00)", cause: "Unit price was rounded to whole pence before multiplying: £0.333 became £0.33.", fix: "Line value = round_to_pence(quantity × unit price)." },
  "EC-29": { area: "Restricted goods", got: "RED — R-06 (matched 'perfume')", cause: "'Perfume-free' wasn't recognised as a negation.", fix: "Any '<word>-free' is a negation (perfume-free, propellant-free…)." },
  "EC-30": { area: "Restricted goods", got: "RED — R-06 (matched 'lithium')", cause: "Lithium grease is a lubricant, but 'lithium' alone counted as a battery.", fix: "Lithium grease / lithium soap are excluded before matching." },
  "EC-31": { area: "Restricted goods", got: "RED — R-06 (matched 'lipo' in the SKU)", cause: "A keyword inside the SKU code 'LIPO-BALM-01' was treated as definite.", fix: "Keywords found only in the SKU are 'possible' (AI or seller confirms)." },
  "EC-35": { area: "Weights", got: "AMBER — R-07 only", cause: "Nothing warned that the goods alone (540 kg/pallet) exceed Carrier A's 500 kg limit.", fix: "New tip A-10 when an understated gross weight hides an overweight pallet." },
  "EC-46": { area: "Dates", got: "INCOMPLETE — V-02 (date unreadable)", cause: "'15-12-2026 09:30' — the time made the date unreadable.", fix: "A trailing time is ignored; the date is used." },
  "EC-50": { area: "Money", got: "RED + wrong tip A-07", cause: "A negative item total gave a negative percentage, which looked 'within 1%'.", fix: "The percentage uses the absolute item total." },
  "EC-53": { area: "Numbers", got: "RED — R-02 (unit price read as 500)", cause: "Decimal comma '5,00' was read as a thousands separator.", fix: "One comma followed by 1–2 digits is a decimal point; '1,080' is unchanged." },
  "EC-54": { area: "Numbers", got: "RED — R-03 + V-08", cause: "1080.0000000001 (spreadsheet formula noise) wasn't a whole number.", fix: "Floating-point noise is removed when reading numbers." },
  // Follow-ups: results already matched, but the messages were vague or the layout weak.
  "EC-07": { kind: "followup", area: "HS code", got: "RED — R-01: 'contains characters that are not digits'", now: "RED — R-01: 'Excel turned it into scientific notation, so the real digits are lost' + re-enter as Text", cause: "The message didn't say Excel had converted the code.", fix: "Scientific-notation HS codes get their own explanation." },
  "EC-08": { kind: "followup", area: "HS code", got: "GREEN — no warning (file lists it as a known gap)", now: "GREEN + tip A-11: 'no product is classified as all zeros'", cause: "'000000' passes the 6-digit rule but isn't a real code.", fix: "New tip A-11 for all-zero HS codes (status unchanged, per the rulebook)." },
  "EC-44": { kind: "followup", area: "Dates", got: "INCOMPLETE — 'blank or could not be read'", now: "INCOMPLETE — 'looks like month-first (US) order… Did you mean 15-12-2026?'", cause: "The seller wasn't told why the date failed.", fix: "Unreadable dates are quoted back with the likely day-first date." },
  "EC-45": { kind: "followup", area: "Dates", got: "INCOMPLETE — 'blank or could not be read'", now: "INCOMPLETE — '31-02-2027 isn't a real date: February doesn't have 31 days'", cause: "Same vague message for an impossible date.", fix: "Impossible dates name the month that's too short." },
  "EC-75": { kind: "followup", area: "Layout", got: "GREEN — 300-character description stretched the table and the confirmation", now: "GREEN — description wraps at ~26 rem; confirmation shortens it with '…'", cause: "No limit on very long text.", fix: "Long cells wrap; the confirmation shortens descriptions over 70 characters." },
  "EC-63": { area: "IDs", got: "INCOMPLETE — V-06, and a false orphan (V-11)", cause: "Items sheet ID ' ec-63 ' didn't match 'EC-63'.", fix: "Booking IDs match ignoring case and surrounding spaces." },
};

const data = {
  generatedAt: new Date().toISOString(),
  summary: results.summary,
  rows: results.rows.map((r) => ({ ...r, before: BEFORE[r.booking_id as string] ?? null })),
  ai,
  browserLocal: pwCases("reports/edge/playwright-edge-local.json"),
  browserProd: pwCases("reports/edge/playwright-edge-production.json"),
  unitTests: (() => { const v = read<{ numTotalTests: number; numPassedTests: number }>("reports/edge/vitest.json"); return v ? { total: v.numTotalTests, passed: v.numPassedTests } : null; })(),
  readme: { red: 21, incomplete: 15, amber: 7, green: 33, total: 76, fileIssues: 1 },
};

const tpl = fs.readFileSync("reports/edge/template.html", "utf8");
const html = tpl.replace("/*__DATA__*/null", JSON.stringify(data).replace(/</g, "\\u003c"));
fs.writeFileSync("reports/edge/Edge_Case_Test_Report.html", html);
console.log(`Wrote reports/edge/Edge_Case_Test_Report.html (${Math.round(html.length / 1024)} KB)`);

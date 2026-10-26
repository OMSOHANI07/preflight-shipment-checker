/**
 * Turns the raw test outputs into the datasets behind the V1 test report.
 *   inputs : reports/vitest.json, reports/playwright-{local,production,resilience}.json, reports/metrics.json
 *   outputs: reports/data/{suites,cases,coverage,bookings,bugs,metrics}.json
 * Run: npx tsx scripts/build-report-data.ts
 */
import fs from "node:fs";
import * as C from "@/lib/calculations";
import { parseWorkbook } from "@/lib/parseExcel";
import { STRESS_BOOKINGS } from "./stress-data";

const read = <T,>(p: string) => JSON.parse(fs.readFileSync(p, "utf8")) as T;
fs.mkdirSync("reports/data", { recursive: true });
const write = (name: string, rows: unknown[]) => fs.writeFileSync(`reports/data/${name}.json`, JSON.stringify(rows, null, 1));

/* ---------- cases ---------- */
type Status = "passed" | "failed" | "skipped";
interface CaseRow { case_id: string; suite_id: string; area: string; group: string; name: string; status: Status; duration_ms: number }
const cases: CaseRow[] = [];

const AREA_BY_GROUP: [RegExp, string][] = [
  [/^R-\d\d|official rules|^template example/i, "Official rules"],
  [/^V-|status & data/i, "Input checks"],
  [/^A-0/i, "Tips"],
  [/^Status/i, "Status & confirm"],
  [/^Carrier recommendation/i, "Carrier choice"],
  [/^Parsing|^parsers/i, "Parsing"],
  [/^Explanations/i, "Explanations"],
  [/mid-way/i, "Mid-way change"],
  [/^parseWorkbook/i, "Excel files"],
  [/^stress-test workbook/i, "Stress workbook"],
  [/^\[Page\]/, "Pages"], [/^\[Upload\]/, "Upload"], [/^\[Results\]/, "Results"], [/^\[Booking\]/, "Booking card"],
  [/^\[Export\]/, "PDF & sharing"], [/^\[Quality\]/, "Accessibility & layout"], [/^\[API\]/, "API rules"],
  [/^\[AI\]/, "AI guardrails"], [/^\[Security\]/, "Security"], [/^\[Resilience\]/, "Resilience"],
];
const areaFor = (group: string) => AREA_BY_GROUP.find(([re]) => re.test(group))?.[1] ?? "Other";

// Vitest
const vt = read<{ testResults: { name: string; assertionResults: { ancestorTitles: string[]; title: string; status: string; duration: number }[] }[] }>("reports/vitest.json");
let n = 0;
for (const file of vt.testResults) for (const a of file.assertionResults) {
  const group = a.ancestorTitles[0] ?? file.name.split("/").pop()!;
  cases.push({ case_id: `U-${String(++n).padStart(3, "0")}`, suite_id: "unit", area: areaFor(group), group, name: a.title,
    status: a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : "skipped", duration_ms: Math.round(a.duration ?? 0) });
}

// Playwright (three runs)
interface PwSuite { title: string; suites?: PwSuite[]; specs?: { title: string; tests: { results: { status: string; duration: number }[]; status?: string }[] }[] }
function walkPw(s: PwSuite, suiteId: string, prefix: string, out: CaseRow[], parents: string[] = []) {
  for (const spec of s.specs ?? []) for (const t of spec.tests) {
    const r = t.results[t.results.length - 1];
    const group = (spec.title.match(/^\[[^\]]+\]/)?.[0] ?? parents[parents.length - 1] ?? "[Smoke]");
    out.push({ case_id: `${prefix}-${String(out.filter((c) => c.suite_id === suiteId).length + 1).padStart(3, "0")}`, suite_id: suiteId,
      area: spec.title.startsWith("[") ? areaFor(group) : "Smoke test", group: group.replace(/[[\]]/g, ""), name: spec.title.replace(/^\[[^\]]+\]\s*/, ""),
      status: r?.status === "passed" ? "passed" : r?.status === "skipped" ? "skipped" : "failed", duration_ms: Math.round(r?.duration ?? 0) });
  }
  for (const c of s.suites ?? []) walkPw(c, suiteId, prefix, out, [...parents, c.title]);
}
const pwRuns = [
  { id: "local", file: "reports/playwright-local.json", prefix: "L" },
  { id: "production", file: "reports/playwright-production.json", prefix: "P" },
  { id: "resilience", file: "reports/playwright-resilience.json", prefix: "R" },
] as const;
const pwStats: Record<string, { startTime: string; duration: number }> = {};
for (const run of pwRuns) {
  const j = read<{ suites: PwSuite[]; stats: { startTime: string; duration: number } }>(run.file);
  pwStats[run.id] = j.stats;
  for (const s of j.suites) walkPw(s, run.id, run.prefix, cases);
}
write("cases", cases);

/* ---------- suites ---------- */
const SUITES = [
  { suite_id: "unit", name: "Rule engine & parser", where: "Vitest · Node", detail: "Every rule, boundary, input check, tip, carrier outcome and Excel edge case" },
  { suite_id: "local", name: "Local build", where: "Playwright · Chromium", detail: "Real browser + API against a production build with Neon and Gemini" },
  { suite_id: "production", name: "Production", where: "Playwright · live URL", detail: "Same suite against the public Vercel deployment, logged out" },
  { suite_id: "resilience", name: "No database, no AI", where: "Playwright · Chromium", detail: "Neon unreachable and Gemini key removed — the app must still work" },
];
const vtDur = Math.round(vt.testResults.reduce((s, f) => s + f.assertionResults.reduce((x, a) => x + (a.duration ?? 0), 0), 0)) / 1000;
write("suites", SUITES.map((s, i) => {
  const rows = cases.filter((c) => c.suite_id === s.suite_id);
  return { ...s, order: i + 1, total: rows.length, passed: rows.filter((c) => c.status === "passed").length,
    failed: rows.filter((c) => c.status === "failed").length, skipped: rows.filter((c) => c.status === "skipped").length,
    duration_s: s.suite_id === "unit" ? Math.round(vtDur * 10) / 10 : Math.round(pwStats[s.suite_id].duration / 100) / 10,
    ran_at: s.suite_id === "unit" ? new Date().toISOString() : pwStats[s.suite_id].startTime };
}));

/* ---------- coverage (official rules, input checks, tips) ---------- */
const V_TITLES: Record<string, string> = {
  "V-01": "Booking ID present and unique", "V-02": "Required booking fields present", "V-03": "Value in the allowed list", "V-04": "City matches country",
  "V-05": "Booking numbers sensible", "V-06": "Booking has items", "V-07": "Required item fields present", "V-08": "Item numbers sensible",
  "V-09": "Country of origin allowed", "V-10": "SKU not repeated", "V-11": "Item belongs to a real booking",
};
const A_TITLES: Record<string, string> = {
  "A-01": "Plain-English description", "A-02": "Non-UK origin may pay duty", "A-03": "Gross includes packaging", "A-04": "Tell a business address",
  "A-05": "Weekend ready date", "A-06": "Full commodity code", "A-07": "Declared value close, not exact", "A-08": "Commercial invoice checklist", "A-09": "Confirm possible restricted item",
};
const stressFor = (code: string) => STRESS_BOOKINGS.filter((s) => s.expectFails.includes(code as C.RuleId)).map((s) => s.row["Booking ID"] as string);
const mentions = (code: string) => cases.filter((c) => `${c.group} ${c.name}`.includes(code));
const coverage = [
  ...(Object.keys(C.RULES) as C.RuleId[]).map((id) => ({ code: id, title: C.RULES[id].text, tier: "Official rule", severity: C.RULES[id].severity })),
  ...Object.entries(V_TITLES).map(([code, title]) => ({ code, title, tier: "Input check", severity: "Data" })),
  ...Object.entries(A_TITLES).map(([code, title]) => ({ code, title, tier: "Tip", severity: "Advisory" })),
].map((r) => {
  const m = mentions(r.code);
  const bookings = stressFor(r.code);
  return { ...r, tests: m.length, passed: m.filter((c) => c.status === "passed").length, sample_bookings: bookings.join(", ") || "—",
    result: m.length && m.every((c) => c.status !== "failed") ? "Verified" : m.length ? "Failing" : "Not covered" };
});
write("coverage", coverage);

/* ---------- bookings: the sample file, as production shows it ---------- */
const metrics = read<{ explain: { sources: Record<string, string> }; r06: { verdicts: { key: string; restricted: boolean; reason: string }[] }; pages: { path: string; ms: number }[]; engine: { bookings: number; items: number; fileKb: number; parseMs: number; checkMs: number }; collectedAt: string; baseUrl: string }>("reports/metrics.json");
const sample = parseWorkbook(new Uint8Array(fs.readFileSync("public/samples/stress-test.xlsx")), "stress-test.xlsx");
const noAi = C.runFile(sample.bookings, sample.items);
const byBooking: Record<string, Record<number, boolean>> = {};
for (const v of metrics.r06.verdicts ?? []) { const [id, idx] = v.key.split("::"); (byBooking[id] ??= {})[Number(idx)] = v.restricted; }
const withAi = C.runFile(sample.bookings, sample.items, { geminiR06VerdictsByBooking: byBooking });
const failing = (r: C.BookingResult) => (Object.keys(r.ruleResults) as C.RuleId[]).filter((id) => r.ruleResults[id] === "fail");
write("bookings", STRESS_BOOKINGS.map((s, i) => {
  const id = s.row["Booking ID"] as string;
  const a = noAi.results[i], b = withAi.results[i];
  const best = b.recommendation.recommended;
  const rulesOk = JSON.stringify(failing(a)) === JSON.stringify(s.expectFails) && a.status === s.expectStatus;
  return {
    booking_id: id, scenario: s.note, expected_status: s.expectStatus, expected_rules: s.expectFails.join(" ") || "none",
    status: b.status, failing_rules: failing(b).join(" ") || "none", carrier: best ? `${best.carrier.carrier} ${best.carrier.service}` : "No carrier fits",
    label: b.recommendation.label, cost: best?.cost ?? null, explained_by: metrics.explain.sources[id] === "ai" ? "AI" : "Rule engine",
    ai_changed: a.status !== b.status ? `AI R-06 check: ${a.status} → ${b.status}` : "", verdict: rulesOk ? "Match" : "Mismatch",
  };
}));

/* ---------- bugs found and fixed while testing ---------- */
write("bugs", [
  { bug_id: "B-01", title: "AI restricted-goods answers leaked across bookings", area: "Rule engine", severity: "High", found_by: "Code review of runFile()", fix: "Verdicts are now scoped per booking (geminiR06VerdictsByBooking) with a test.", status: "Fixed" },
  { bug_id: "B-02", title: "Every AI explanation timed out", area: "AI", severity: "High", found_by: "Server logs on the first live run", fix: "Thinking set to low and issue text kept from the engine: about 3 s per booking instead of 12 s.", status: "Fixed" },
  { bug_id: "B-03", title: "AI text arrived but never showed", area: "Results page", severity: "High", found_by: "Browser check: 'built straight from the rule engine' after AI replied", fix: "Saving the upload no longer cancels the screen update for explanations in flight.", status: "Fixed" },
  { bug_id: "B-04", title: "Shared results page crashed on incomplete saved rows", area: "Sharing", severity: "High", found_by: "Server error during the API save test", fix: "Data tables tolerate missing raw cells; the test now requires HTTP 200.", status: "Fixed" },
  { bug_id: "B-05", title: "Page scrolled sideways on phones (1,520 px wide)", area: "Layout", severity: "Medium", found_by: "Phone-width test at 375 px", fix: "Screen-reader labels contained inside the table scroller; hidden tooltips take no space; shorter sub-nav button.", status: "Fixed" },
  { bug_id: "B-06", title: "Text below WCAG AA contrast (63 elements)", area: "Accessibility", severity: "Medium", found_by: "axe scan, light and dark", fix: "Removed opacity dimming, dark-section status colours, deeper button blue.", status: "Fixed" },
  { bug_id: "B-07", title: "Data tables couldn't be scrolled with the keyboard", area: "Accessibility", severity: "Medium", found_by: "axe: scrollable-region-focusable", fix: "Table scrollers are focusable, labelled regions.", status: "Fixed" },
  { bug_id: "B-08", title: "\"? pallets\" and \"Freight: —\" in confirmations", area: "Explanations", severity: "Medium", found_by: "Reading AI output for the Incomplete booking", fix: "Says the cost comes once the pallet count is added; tests for missing pallets and destination.", status: "Fixed" },
  { bug_id: "B-09", title: "PDF dropped dashes, bullets and quotes", area: "PDF", severity: "Low", found_by: "Text extracted from a generated PDF", fix: "Characters the PDF font can't draw are swapped for plain ones.", status: "Fixed" },
  { bug_id: "B-10", title: "Deep link to a booking didn't scroll to it", area: "Sharing", severity: "Low", found_by: "Opening /results/…#BK-T12", fix: "Scroll retried after the card expands.", status: "Fixed" },
]);

/* ---------- speed and AI ---------- */
const explainSources = Object.values(metrics.explain.sources);
write("metrics", [
  { metric_id: "home_ms", label: "Home page response", value: metrics.pages[1].ms, unit: "ms", group: "Speed", note: "Warm request to the live URL" },
  { metric_id: "sample_ms", label: "Sample file download", value: metrics.pages[2].ms, unit: "ms", group: "Speed", note: "16-booking workbook" },
  { metric_id: "engine_bookings", label: "Bookings in load test", value: metrics.engine.bookings, unit: "bookings", group: "Load", note: `${metrics.engine.items} item rows, ${metrics.engine.fileKb} KB file` },
  { metric_id: "parse_ms", label: "Read 1,000-booking file", value: metrics.engine.parseMs, unit: "ms", group: "Load", note: "SheetJS parse + normalise" },
  { metric_id: "check_ms", label: "Check 1,000 bookings", value: metrics.engine.checkMs, unit: "ms", group: "Load", note: "All 10 rules + carrier choice" },
  { metric_id: "ai_explained", label: "Bookings explained by AI", value: explainSources.filter((s) => s === "ai").length, unit: `of ${explainSources.length}`, group: "AI", note: "Production, one user at a time" },
  { metric_id: "r06_ms", label: "AI restricted-goods check", value: (metrics as unknown as { r06: { ms: number } }).r06.ms, unit: "ms", group: "AI", note: "One batched call per file" },
  { metric_id: "ai_timebox_s", label: "AI time limit per call", value: 8, unit: "s", group: "AI", note: "Then the rule engine's own text is shown" },
]);

console.log(`cases ${cases.length} · suites ${SUITES.length} · coverage ${coverage.length} · bookings ${STRESS_BOOKINGS.length}`);
console.log(JSON.stringify(Object.fromEntries(SUITES.map((s) => [s.suite_id, cases.filter((c) => c.suite_id === s.suite_id).reduce((o, c) => ({ ...o, [c.status]: (o[c.status as keyof typeof o] ?? 0) + 1 }), {} as Record<string, number>)]))));
console.log("not covered:", coverage.filter((c) => c.result !== "Verified").map((c) => c.code).join(" ") || "none");

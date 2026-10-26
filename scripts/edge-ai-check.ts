/**
 * What the AI does with the edge-case file on a running site: R-06 second opinions for the
 * "possible" items and explanations for the security cases. → reports/edge/ai.json
 * Run: npx tsx scripts/edge-ai-check.ts [baseUrl]
 */
import fs from "node:fs";
import * as C from "@/lib/calculations";
import { parseWorkbook } from "@/lib/parseExcel";

const BASE = process.argv[2] ?? "https://preflight-shipment-checker-omega.vercel.app";
const p = parseWorkbook(new Uint8Array(fs.readFileSync("data/edge/Edge_Case_Test_Data.xlsx")), "Edge_Case_Test_Data.xlsx");
const run = C.runFile(p.bookings, p.items);
const itemsOf = (id: string) => p.items.filter((x) => C.bookingKey(x.bookingId) === C.bookingKey(id));
const post = async (path: string, body: unknown) => { const t = Date.now(); const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { ms: Date.now() - t, json: await r.json() }; };

async function main() {
  const possible = p.bookings.flatMap((b) => itemsOf(b.bookingId).map((it, i) => ({ b, it, i, dg: C.detectDangerousGoods(it) }))).filter((x) => x.dg.verdict === "possible");
  const r06 = await post("/api/r06", { items: possible.map((x) => ({ key: `${x.b.bookingId}::${x.i}`, sku: x.it.sku, description: x.it.description, hsCode: C.normaliseHs(x.it.hsCodeRaw).digits, matched: x.dg.matched })) });
  const ids = ["EC-01", "EC-72", "EC-73", "EC-74", "EC-35", "EC-21", "EC-48"];
  const ex = await post("/api/explain", { bookings: ids.map((id) => { const i = p.bookings.findIndex((b) => b.bookingId === id); return { booking: p.bookings[i], items: itemsOf(id), result: run.results[i] }; }) });
  const out = {
    baseUrl: BASE, at: new Date().toISOString(),
    r06: { ms: r06.ms, source: r06.json.source, items: possible.map((x) => ({ key: `${x.b.bookingId}::${x.i}`, description: x.it.description, matched: x.dg.matched })), verdicts: r06.json.verdicts },
    explain: { ms: ex.ms, results: ex.json.explanations.map((e: { explanation: Record<string, unknown> }, k: number) => ({ booking_id: ids[k], source: e.explanation.source, headline: e.explanation.headline, reason: e.explanation.reason, caveat: e.explanation.caveat, confirmation: e.explanation.confirmation })) },
  };
  fs.writeFileSync("reports/edge/ai.json", JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ r06: { ms: out.r06.ms, source: out.r06.source, verdicts: out.r06.verdicts }, explain: out.explain.results.map((r: Record<string, unknown>) => `${r.booking_id} ${r.source}: ${String(r.confirmation).slice(0, 110)}`) }, null, 1));
}
main();

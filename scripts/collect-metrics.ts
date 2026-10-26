/**
 * Collects performance and AI numbers for the V1 test report → reports/metrics.json.
 * Run: npx tsx scripts/collect-metrics.ts [baseUrl]
 */
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import * as XLSX from "xlsx";
import { detectDangerousGoods, normaliseHs, runFile } from "@/lib/calculations";
import { parseWorkbook } from "@/lib/parseExcel";

const BASE = process.argv[2] ?? "https://preflight-shipment-checker-omega.vercel.app";
const sample = parseWorkbook(new Uint8Array(fs.readFileSync("public/samples/stress-test.xlsx")), "stress-test.xlsx");
const run = runFile(sample.bookings, sample.items);

async function timed<T>(fn: () => Promise<T>) { const t = performance.now(); const v = await fn(); return { v, ms: Math.round(performance.now() - t) }; }

async function main() {
  // 1. Page loads (cold-ish and warm)
  const pages: { path: string; ms: number; status: number }[] = [];
  for (const path of ["/", "/", "/samples/stress-test.xlsx"]) {
    const { v, ms } = await timed(() => fetch(BASE + path, { cache: "no-store" }));
    pages.push({ path, ms, status: v.status });
  }

  // 2. Explanations: the browser sends chunks of 6 bookings
  const views = sample.bookings.map((b, i) => ({ booking: b, items: sample.items.filter((x) => x.bookingId === b.bookingId), result: run.results[i] }));
  const chunks: { size: number; ms: number }[] = [];
  const sources: Record<string, string> = {};
  for (let i = 0; i < views.length; i += 6) {
    const chunk = views.slice(i, i + 6);
    const { v, ms } = await timed(() => fetch(`${BASE}/api/explain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookings: chunk }) }).then((r) => r.json()));
    chunks.push({ size: chunk.length, ms });
    (v.explanations as { explanation: { source: string } }[]).forEach((e, k) => (sources[chunk[k].booking.bookingId] = e.explanation.source));
  }

  // 3. R-06 second opinion on the sample's "possible" items
  const possible = views.flatMap((v) => v.items.map((it, i) => ({ v, it, i, dg: detectDangerousGoods(it) })).filter((x) => x.dg.verdict === "possible"));
  const r06 = await timed(() => fetch(`${BASE}/api/r06`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: possible.map((p) => ({ key: `${p.v.booking.bookingId}::${p.i}`, sku: p.it.sku, description: p.it.description, hsCode: normaliseHs(p.it.hsCodeRaw).digits, matched: p.dg.matched })) }) }).then((r) => r.json()));

  // 4. Engine speed on a large generated file (1,000 bookings × 2 items)
  const bh = ["Booking ID", "Seller name", "Origin city", "Origin country", "Destination city", "Destination country", "Destination type", "Ready to ship date", "Seller priority", "Pallets", "Cartons", "Total declared value", "Currency", "Total gross weight (kg)", "Delivery appointment booked"];
  const ih = ["Booking ID", "SKU", "Description", "HS code", "Quantity (units)", "Unit price", "Units per carton", "Cartons", "Unit weight (kg)", "Country of origin"];
  const N = 1000, bRows: unknown[][] = [bh], iRows: unknown[][] = [ih];
  const prios = ["Cheapest", "Fastest", "Most reliable", "Balanced"];
  for (let k = 0; k < N; k++) {
    const id = `BK-${String(k).padStart(4, "0")}`;
    bRows.push([id, "Load Test Ltd", "Leeds", "United Kingdom", "Paris", "France", "Warehouse", "12-01-2027", prios[k % 4], 3, 100, 5600, "GBP", 700, k % 7 ? "Yes" : "No"]);
    iRows.push([id, "MUG-01", "Ceramic coffee mug", 69120000, 1080, 5, 12, 90, 0.5, "United Kingdom"], [id, "BOWL-02", "Stoneware bowl", 69120000, 100, 2, 10, 10, 0.6, "China"]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bRows), "Bookings");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(iRows), "Items");
  const buf = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  const t0 = performance.now(); const big = parseWorkbook(buf, "load.xlsx"); const t1 = performance.now();
  const bigRun = runFile(big.bookings, big.items); const t2 = performance.now();

  const out = {
    baseUrl: BASE, collectedAt: new Date().toISOString(),
    pages,
    explain: { chunks, sources, aiCount: Object.values(sources).filter((s) => s === "ai").length, total: views.length },
    r06: { items: possible.length, ms: r06.ms, source: r06.v.source, verdicts: r06.v.verdicts },
    engine: { bookings: N, items: N * 2, fileKb: Math.round(buf.length / 1024), parseMs: Math.round(t1 - t0), checkMs: Math.round(t2 - t1), statuses: bigRun.summary },
  };
  fs.writeFileSync("reports/metrics.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ pages, explain: { ...out.explain, sources: undefined }, r06: { ...out.r06, verdicts: out.r06.verdicts?.length }, engine: out.engine }, null, 1));
}
main();

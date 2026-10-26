/** V1 API cases: server-side rule enforcement, AI routes with guardrails, saving, secrets. */
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import * as C from "@/lib/calculations";
import { parseWorkbook } from "@/lib/parseExcel";

const sample = parseWorkbook(new Uint8Array(fs.readFileSync(path.resolve(__dirname, "../public/samples/stress-test.xlsx"))), "stress-test.xlsx");
const run = C.runFile(sample.bookings, sample.items);
const view = (id: string) => {
  const i = sample.bookings.findIndex((b) => b.bookingId === id);
  return { booking: sample.bookings[i], items: sample.items.filter((x) => x.bookingId === id), result: run.results[i], raw: sample.bookingRows[i], i };
};
const confirmBody = (over: Record<string, unknown>) => ({ uploadId: null, bookingRowId: null, bookingId: "BK-T01", status: "GREEN", acknowledgedAmber: false, carrierId: "A-DE", ...over });

test.describe("[API] Confirm enforces the status rules on the server", () => {
  test("[API] RED booking is refused (409)", async ({ request }) => {
    const r = await request.post("/api/confirm", { data: confirmBody({ status: "RED" }) });
    expect(r.status()).toBe(409);
  });
  test("[API] INCOMPLETE booking is refused (409)", async ({ request }) => {
    expect((await request.post("/api/confirm", { data: confirmBody({ status: "INCOMPLETE" }) })).status()).toBe(409);
  });
  test("[API] AMBER without acknowledgement is refused; with it, confirmed", async ({ request }) => {
    expect((await request.post("/api/confirm", { data: confirmBody({ status: "AMBER" }) })).status()).toBe(409);
    const ok = await (await request.post("/api/confirm", { data: confirmBody({ status: "AMBER", acknowledgedAmber: true }) })).json();
    expect(ok.reference).toMatch(/^PF-\d{6}-[0-9A-F]{6}$/);
  });
  test("[API] saved RED booking can't be confirmed by claiming GREEN", async ({ request }) => {
    const v = view("BK-T06");
    const saved = await (await request.post("/api/uploads", { data: {
      fileName: "api-test.xlsx", checkedAt: new Date().toISOString(), bookingHeaders: sample.bookingHeaders, itemHeaders: sample.itemHeaders,
      notices: [], usedExampleAsDemo: false, fileIssues: [], orphanRows: [], summary: run.summary, r06: { source: "none", verdicts: [] },
      views: [{ booking: v.booking, items: v.items, raw: v.raw, itemRaws: [], result: v.result }],
    } })).json();
    test.skip(!saved.saved, "database not reachable in this environment");
    const r = await request.post("/api/confirm", { data: confirmBody({ bookingId: "BK-T06", bookingRowId: saved.rowIds[0], uploadId: saved.uploadId, status: "GREEN" }) });
    expect(r.status()).toBe(409);
  });
  test("[API] malformed request is rejected (400)", async ({ request }) => {
    expect((await request.post("/api/confirm", { data: { nonsense: true } })).status()).toBe(400);
  });
});

test.describe("[API] Saving and sharing", () => {
  test("[API] upload is saved and the shared page shows it", async ({ request }) => {
    const v = view("BK-T01");
    const res = await (await request.post("/api/uploads", { data: {
      fileName: "share-test.xlsx", checkedAt: new Date().toISOString(), bookingHeaders: sample.bookingHeaders, itemHeaders: sample.itemHeaders,
      notices: [], usedExampleAsDemo: false, fileIssues: [], orphanRows: [], summary: run.summary, r06: { source: "none", verdicts: [] },
      views: [{ booking: v.booking, items: v.items, raw: v.raw, itemRaws: [], result: v.result }],
    } })).json();
    test.skip(!res.saved, "database not reachable in this environment");
    const page = await request.get(`/results/${res.uploadId}`);
    expect(page.status()).toBe(200);
    expect(await page.text()).toContain("share-test.xlsx");
  });
  test("[API] invalid upload body is rejected (400)", async ({ request }) => {
    expect((await request.post("/api/uploads", { data: { views: [] } })).status()).toBe(400);
  });
});

test.describe("[AI] Gemini routes with guardrails", () => {
  test("[AI] R-06 second opinion answers yes/no per item (or reports unavailable)", async ({ request }) => {
    const t0 = Date.now();
    const r = await (await request.post("/api/r06", { data: { items: [
      { key: "a", sku: "SPK-01", description: "Bluetooth speaker", hsCode: "85182200", matched: ["bluetooth speaker"] },
      { key: "b", sku: "DRL-01", description: "Cordless drill with battery", hsCode: null, matched: ["cordless"] },
    ] } })).json();
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(["ai", "unavailable"]).toContain(r.source);
    if (r.source === "ai") { expect(r.verdicts.map((v: { key: string }) => v.key).sort()).toEqual(["a", "b"]); expect(typeof r.verdicts[0].restricted).toBe("boolean"); }
  });
  test("[AI] R-06 with no items returns no verdicts; bad body is 400", async ({ request }) => {
    expect(await (await request.post("/api/r06", { data: { items: [] } })).json()).toEqual({ verdicts: [], source: "ai" });
    expect((await request.post("/api/r06", { data: { items: "x" } })).status()).toBe(400);
  });
  test("[AI] explanation uses only the engine's numbers, within the time-box", async ({ request }) => {
    const v = view("BK-T01");
    const t0 = Date.now();
    const r = await (await request.post("/api/explain", { data: { bookings: [{ booking: v.booking, items: v.items, result: v.result }] } })).json();
    expect(Date.now() - t0).toBeLessThan(20_000);
    const ex = r.explanations[0].explanation;
    expect(["ai", "fallback"]).toContain(ex.source);
    expect(ex.headline).toContain("£540.00");
    const text = [ex.headline, ex.reason, ex.tradeoff, ex.caveat, ex.confirmation, ...ex.exclusions].join(" ");
    for (const money of text.match(/£[\d,]+\.\d{2}/g) ?? []) expect(["£540.00", "£660.00", "£1,020.00", "£120.00", "£480.00", "£5,400.00", "£180.00"]).toContain(money);
  });
  test("[AI] blocked booking is explained as 'once the issues are fixed'", async ({ request }) => {
    const v = view("BK-T06");
    const ex = (await (await request.post("/api/explain", { data: { bookings: [{ booking: v.booking, items: v.items, result: v.result }] } })).json()).explanations[0].explanation;
    expect(`${ex.caveat} ${ex.confirmation}`).toMatch(/once the issues/i);
  });
  test("[AI] bad explain body is rejected (400)", async ({ request }) => {
    expect((await request.post("/api/explain", { data: { bookings: [{ booking: {} }] } })).status()).toBe(400);
  });
});

test.describe("[Security] Secrets stay on the server", () => {
  test("[Security] no API key or database URL in the page or its scripts", async ({ request, baseURL }) => {
    const html = await (await request.get("/")).text();
    const scripts = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
    const bodies = [html, ...(await Promise.all(scripts.map(async (s) => (await request.get(`${baseURL}${s}`)).text())))].join("\n");
    expect(bodies).not.toMatch(/GEMINI_API_KEY|AQ\.Ab8|postgresql:\/\/|npg_/);
  });
});

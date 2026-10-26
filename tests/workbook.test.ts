/** Corrected Excel + blank template (lib/workbook.ts). */
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWorkbook } from "@/lib/checkFile";
import { BOOKING_COLUMNS, ITEM_COLUMNS } from "@/lib/parseExcel";
import { correctBooking, correctedWorkbook, templateWorkbook } from "@/lib/workbook";

const STRESS = path.resolve(__dirname, "../public/samples/stress-test.xlsx");
async function stress() {
  const buf = fs.readFileSync(STRESS);
  const out = await checkWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "stress-test.xlsx", () => undefined);
  if (!out.ok) throw new Error(out.error);
  return out.file;
}
async function reread(wb: ExcelJS.Workbook) {
  const back = new ExcelJS.Workbook();
  await back.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return back;
}

describe("Excel template", () => {
  it("has only Bookings and Items, headings only", async () => {
    const wb = await reread(await templateWorkbook());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bookings", "Items"]);
    expect(wb.getWorksheet("Bookings")!.rowCount).toBe(1);
    expect(wb.getWorksheet("Items")!.rowCount).toBe(1);
    expect((wb.getWorksheet("Bookings")!.getRow(1).values as unknown[]).slice(1)).toEqual([...BOOKING_COLUMNS]);
    expect((wb.getWorksheet("Items")!.getRow(1).values as unknown[]).slice(1)).toEqual([...ITEM_COLUMNS]);
  });
  it("the shipped file public/samples/template.xlsx matches", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.resolve(__dirname, "../public/samples/template.xlsx"));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bookings", "Items"]);
    expect(wb.getWorksheet("Bookings")!.rowCount + wb.getWorksheet("Items")!.rowCount).toBe(2);
  });
});

describe("corrected Excel", () => {
  it("two sheets, one row per booking and item", async () => {
    const file = await stress();
    const wb = await reread(await correctedWorkbook(file.views));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bookings", "Items"]);
    expect(wb.getWorksheet("Bookings")!.rowCount).toBe(1 + file.views.length);
    expect(wb.getWorksheet("Items")!.rowCount).toBe(1 + file.views.reduce((n, v) => n + v.items.length, 0));
  });
  it("R-02: declared value replaced by the line total, marked green with the old value", async () => {
    const file = await stress();
    const v = file.views.find((x) => x.result.issues.some((i) => i.code === "R-02"))!;
    const c = correctBooking(v);
    const computed = Number(v.result.issues.find((i) => i.code === "R-02")!.numbers!.computed);
    expect(c.bVals["Total declared value"]).toBe(computed);
    expect(c.bMarks["Total declared value"]).toMatchObject({ kind: "fixed" });
    expect(c.bMarks["Total declared value"].note).toMatch(/^Was /);
  });
  it("problems it can't fix are flagged red (must fix) or yellow (worth a look) with a note", async () => {
    const file = await stress();
    const r01 = file.views.find((x) => x.result.issues.some((i) => i.code === "R-01"))!;
    const c = correctBooking(r01);
    const k = r01.result.issues.find((i) => i.code === "R-01")!.itemIndex!;
    expect(c.iMarks[k]["HS code"]).toMatchObject({ kind: "red" });
    expect(c.iMarks[k]["HS code"].note).toMatch(/^Must fix \(R-01\)/);
    const r08 = file.views.find((x) => x.result.issues.some((i) => i.code === "R-08"))!;
    expect(correctBooking(r08).bMarks["Delivery appointment booked"]).toMatchObject({ kind: "yellow" });
  });
  it("a corrected file re-checks with the fixed rules passing", async () => {
    const file = await stress();
    const v = file.views.find((x) => x.result.issues.some((i) => i.code === "R-02") && !x.result.issues.some((i) => i.code === "R-03"))!;
    const buf = await (await correctedWorkbook([v])).xlsx.writeBuffer();
    const again = await checkWorkbook(buf as ArrayBuffer, "corrected.xlsx", () => undefined);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.file.views[0].result.issues.map((i) => i.code)).not.toContain("R-02");
  });
});

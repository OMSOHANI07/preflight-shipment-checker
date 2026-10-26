/** Excel parser: header detection, grey example row, HS numeric vs text, date serials, orphans, missing columns. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import * as C from "@/lib/calculations";
import { BOOKING_COLUMNS, ITEM_COLUMNS, parseWorkbook } from "@/lib/parseExcel";
import { csvLine, safeCell } from "@/lib/safeCell";

const now = new Date("2026-10-26T10:00:00Z");
const TEMPLATE = path.resolve(__dirname, "../data/Case2_Shipment_Booking_Test_Data_Format.xlsx");

type Row = (string | number | null)[];
const BK_ROW: Row = ["BK-101", "Acme", "London", "United Kingdom", "Paris", "France", "Warehouse", "12-01-2027", "Cheapest", 3, 90, 5400, "GBP", 620, "Yes"];
const IT_ROW: Row = ["BK-101", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"];

/** Build a workbook with SheetJS (no styles). */
function plainBook(opts: { bookings?: Row[]; items?: Row[]; bHeaders?: string[]; iHeaders?: string[]; names?: [string, string]; title?: boolean } = {}) {
  const wb = XLSX.utils.book_new();
  const lead = opts.title === false ? [] : [["Title row"]];
  const b = XLSX.utils.aoa_to_sheet([...lead, opts.bHeaders ?? [...BOOKING_COLUMNS], ...(opts.bookings ?? [BK_ROW])]);
  const i = XLSX.utils.aoa_to_sheet([...lead, opts.iHeaders ?? [...ITEM_COLUMNS], ...(opts.items ?? [IT_ROW])]);
  const [bn, iname] = opts.names ?? ["Bookings", "Items"];
  XLSX.utils.book_append_sheet(wb, b, bn);
  XLSX.utils.book_append_sheet(wb, i, iname);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

async function templateWith(extraBookings: Row[], extraItems: Row[]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  extraBookings.forEach((r, k) => r.forEach((v, c) => (wb.getWorksheet("Bookings")!.getCell(4 + k, c + 1).value = v)));
  extraItems.forEach((r, k) => r.forEach((v, c) => (wb.getWorksheet("Items")!.getCell(4 + k, c + 1).value = v)));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("parseWorkbook", () => {
  it("original template: only the grey example → checked as a demo, BK-001 GREEN, Carrier A £540", () => {
    const p = parseWorkbook(new Uint8Array(fs.readFileSync(TEMPLATE)), "template.xlsx");
    expect(p.fatal).toBeNull();
    expect(p.usedExampleAsDemo).toBe(true);
    expect(p.bookings).toHaveLength(1);
    const r = C.runFile(p.bookings, p.items, { now }).results[0];
    expect(r.status).toBe("GREEN");
    expect(r.recommendation.recommended?.carrier.id).toBe("A-DE");
    expect(r.recommendation.recommended?.cost).toBe(540);
  });

  it("template with real rows: grey example row is skipped", async () => {
    const p = parseWorkbook(await templateWith([BK_ROW], [IT_ROW]), "t.xlsx");
    expect(p.usedExampleAsDemo).toBe(false);
    expect(p.bookings.map((b) => b.bookingId)).toEqual(["BK-101"]);
    expect(p.items.map((i) => i.bookingId)).toEqual(["BK-101"]);
    expect(p.notices.some((n) => /grey example/.test(n.message))).toBe(true);
  });

  it("a non-grey BK-001 in row 3 is treated as data", () => {
    const p = parseWorkbook(plainBook({ bookings: [["BK-001", ...BK_ROW.slice(1)]], items: [["BK-001", ...IT_ROW.slice(1)]] }), "x.xlsx");
    expect(p.bookings.map((b) => b.bookingId)).toEqual(["BK-001"]);
    expect(p.usedExampleAsDemo).toBe(false);
  });

  it("finds the header row by 'Booking ID' (no title row)", () => {
    const p = parseWorkbook(plainBook({ title: false }), "x.xlsx");
    expect(p.bookings[0].bookingId).toBe("BK-101");
    expect(p.bookingRows[0].rowNumber).toBe(2);
  });

  it("keeps HS code raw: numeric stays a number, text keeps leading zero", () => {
    const p = parseWorkbook(plainBook({ items: [IT_ROW, ["BK-101", "TEA-01", "Green tea, loose leaf", "090210", 10, 5, 10, 1, 0.1, "India"], ["BK-101", "COF-01", "Roasted coffee", 90111, 10, 5, 10, 1, 0.1, "India"]] }), "x.xlsx");
    expect(p.items.map((i) => i.hsCodeRaw)).toEqual([691200, "090210", 90111]);
    expect(C.normaliseHs(p.items[2].hsCodeRaw).possibleLostLeadingZero).toBe(true);
  });

  it("reads Excel date serials and DD-MM-YYYY text", () => {
    const p = parseWorkbook(plainBook({ bookings: [BK_ROW, ["BK-102", ...BK_ROW.slice(1, 7), 46331, ...BK_ROW.slice(8)]] }), "x.xlsx");
    expect(p.bookings.map((b) => b.readyToShipDate)).toEqual(["2027-01-12", "2026-11-05"]);
  });

  it("orphan items surface as V-11", () => {
    const p = parseWorkbook(plainBook({ items: [IT_ROW, ["BK-999", ...IT_ROW.slice(1)]] }), "x.xlsx");
    expect(C.runFile(p.bookings, p.items, { now }).fileIssues.map((i) => i.code)).toEqual(["V-11"]);
  });

  it("missing columns: file notice + V-02 on every booking", () => {
    const p = parseWorkbook(plainBook({ bHeaders: BOOKING_COLUMNS.filter((c) => c !== "Pallets"), bookings: [BK_ROW.filter((_, i) => i !== 9)] }), "x.xlsx");
    expect(p.notices.some((n) => n.level === "error" && /Pallets/.test(n.message))).toBe(true);
    const r = C.runFile(p.bookings, p.items, { now }).results[0];
    expect(r.status).toBe("INCOMPLETE");
    expect(r.issues.some((i) => i.code === "V-02" && i.fields.includes("pallets"))).toBe(true);
  });

  it("falls back to the first two sheets with a notice", () => {
    const p = parseWorkbook(plainBook({ names: ["Sheet1", "Sheet2"] }), "x.xlsx");
    expect(p.fatal).toBeNull();
    expect(p.notices.some((n) => /used "Sheet1" as Bookings/.test(n.message))).toBe(true);
  });

  it("matches sheet names case-insensitively", () => {
    expect(parseWorkbook(plainBook({ names: ["BOOKINGS", "items"] }), "x.xlsx").notices).toEqual([]);
  });

  it("rejects non-Excel files and unreadable data", () => {
    expect(parseWorkbook(new Uint8Array([1, 2, 3]), "notes.csv").fatal).toMatch(/isn't an Excel file/);
    expect(parseWorkbook(plainBook({ bHeaders: ["Something else"], bookings: [["x"]] }), "x.xlsx").fatal).toMatch(/No header row/);
  });

  it("skips empty rows; a row with only a Booking ID is data with missing fields", () => {
    const p = parseWorkbook(plainBook({ bookings: [BK_ROW, [null, null], ["BK-103"]] }), "x.xlsx");
    expect(p.bookings.map((b) => b.bookingId)).toEqual(["BK-101", "BK-103"]);
    expect(C.runFile(p.bookings, p.items, { now }).results[1].status).toBe("INCOMPLETE");
  });
});

describe("parseWorkbook warnings and export safety", () => {
  it("warns about formulas with no saved value and merged cells", () => {
    const wb = XLSX.utils.book_new();
    const b = XLSX.utils.aoa_to_sheet([[...BOOKING_COLUMNS], BK_ROW, ["BK-102", ...BK_ROW.slice(1)]]);
    b["L2"] = { t: "n", f: "J2*1800" } as XLSX.CellObject; // declared value as a formula, never calculated
    b["!merges"] = [XLSX.utils.decode_range("B2:B3")];
    XLSX.utils.book_append_sheet(wb, b, "Bookings");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...ITEM_COLUMNS], IT_ROW]), "Items");
    const p = parseWorkbook(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })), "x.xlsx");
    expect(p.notices.some((n) => n.level === "warning" && /formula with no saved value \(L2\)/.test(n.message))).toBe(true);
    expect(p.notices.some((n) => n.level === "warning" && /merged cells \(B2:B3\)/.test(n.message))).toBe(true);
  });
  it("safeCell prefixes formula-like text with an apostrophe", () => {
    expect(['=HYPERLINK("x")', "+44 20", "-5", "@SUM(A1)", "Acme"].map(safeCell)).toEqual(["'=HYPERLINK(\"x\")", "'+44 20", "'-5", "'@SUM(A1)", "Acme"]);
    expect(csvLine(["=1+1", 'say "hi"'])).toBe('"\'=1+1","say ""hi"""');
  });
});

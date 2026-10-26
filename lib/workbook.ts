/**
 * Excel files we hand back: the blank template (Bookings + Items, headings only) and the corrected
 * workbook (same two sheets, the seller's data with the safe fixes applied). exceljs is loaded on demand.
 *
 * Corrections are only the ones the rules make certain — the declared value when the lines add up to
 * something else (R-02), the carton total when every product's cartons are right (R-04), the country
 * from the city (V-04), the GBP / United Kingdom defaults, digits-only HS codes and tidied spellings.
 * Each corrected cell is green with a note saying what it was. Anything that still needs the seller is
 * red (must fix) or yellow (worth a look), with a note saying what's wrong and how to fix it.
 */
import type ExcelJS from "exceljs";
import { DESTINATION_CITIES, formatDDMMYYYY, isNum, type Issue } from "@/lib/calculations";
import { BOOKING_COLUMNS, BOOKING_FIELD_BY_COLUMN, ITEM_COLUMNS, ITEM_FIELD_BY_COLUMN } from "@/lib/parseExcel";
import type { BookingView } from "@/lib/types";

const FILL = {
  head: "FF1D3557",
  fixed: "FFD8F5DF",
  red: "FFFFD6D3",
  yellow: "FFFFF3B0",
} as const;

type Cell = string | number | null;
interface Mark { kind: "fixed" | "red" | "yellow"; note: string }

async function loadExcel(): Promise<typeof ExcelJS> {
  const m = (await import("exceljs")) as unknown as { default?: typeof ExcelJS } & typeof ExcelJS;
  return m.default ?? m;
}

function sheet(wb: ExcelJS.Workbook, name: string, columns: readonly string[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.max(12, c.length + 4) }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL.head } };
  head.height = 20;
  return ws;
}

/** The blank template: two sheets, headings only. */
export async function templateWorkbook(): Promise<ExcelJS.Workbook> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  wb.creator = "Ship Eazy";
  sheet(wb, "Bookings", BOOKING_COLUMNS);
  sheet(wb, "Items", ITEM_COLUMNS);
  return wb;
}

const CITY_COUNTRY: Record<string, string> = Object.fromEntries(Object.entries(DESTINATION_CITIES).flatMap(([country, cities]) => cities.map((c) => [c, country])));

const show = (field: string, v: unknown): Cell =>
  v == null || v === "" ? null
    : typeof v === "boolean" ? (v ? "Yes" : "No")
    : field === "readyToShipDate" ? formatDDMMYYYY(String(v))
    : typeof v === "number" ? v
    : String(v);

const same = (a: Cell, b: string) => String(a ?? "").trim().toLowerCase() === b.trim().toLowerCase()
  || (isNum(a) && b.trim() !== "" && Number(b.replace(/[£,\s]/g, "")) === a);

/** One booking's rows with corrections applied and every cell's mark. */
export function correctBooking(v: BookingView) {
  const { booking: b, items, result: r, raw, itemRaws } = v;
  const codes = new Set(r.issues.map((i) => i.code));
  const bVals: Record<string, Cell> = {}, bMarks: Record<string, Mark> = {};
  const iVals: Record<string, Cell>[] = items.map(() => ({})), iMarks: Record<string, Mark>[] = items.map(() => ({}));
  const fixes: string[] = [];

  for (const col of BOOKING_COLUMNS) {
    const f = BOOKING_FIELD_BY_COLUMN[col];
    const was = raw.display[col] ?? "";
    let val = show(f, (b as unknown as Record<string, unknown>)[f]);
    if (val == null && was.trim()) val = was; // unreadable: keep what was written, flagged below
    if (f === "currency" && val == null) { val = "GBP"; bMarks[col] = { kind: "fixed", note: "Filled in: all bookings are in GBP." }; }
    if (f === "originCountry" && val == null) { val = "United Kingdom"; bMarks[col] = { kind: "fixed", note: "Filled in: collections are from the UK." }; }
    bVals[col] = val;
    if (!bMarks[col] && was.trim() && val != null && !same(val, was)) bMarks[col] = { kind: "fixed", note: `Was "${was}" — tidied to the standard spelling/format.` };
  }
  items.forEach((it, i) => {
    for (const col of ITEM_COLUMNS) {
      const f = ITEM_FIELD_BY_COLUMN[col];
      const was = itemRaws[i]?.display[col] ?? "";
      let val = show(f, (it as unknown as Record<string, unknown>)[f]);
      if (f === "hsCodeRaw" && val != null) { const d = String(val).replace(/\D/g, ""); if (d && d !== String(val)) val = d; else val = String(val); }
      if (val == null && was.trim()) val = was;
      iVals[i][col] = val;
      if (was.trim() && val != null && !same(val, was)) iMarks[i][col] = { kind: "fixed", note: `Was "${was}" — tidied to the standard spelling/format.` };
    }
  });

  // R-02: the declared value should be what the lines add up to
  const r02 = r.issues.find((i) => i.code === "R-02");
  if (r02 && isNum(r02.numbers?.computed)) {
    const to = Number(r02.numbers!.computed);
    bMarks["Total declared value"] = { kind: "fixed", note: `Was ${bVals["Total declared value"] ?? "blank"} — changed to ${to.toFixed(2)}, what the products add up to (quantity × unit price).` };
    bVals["Total declared value"] = to;
    fixes.push("R-02");
  }
  // R-04: the booking's cartons should be the sum of the products' cartons (only when those are right)
  if (codes.has("R-04") && !codes.has("R-03") && isNum(r.totals.sumItemCartons)) {
    bMarks["Cartons"] = { kind: "fixed", note: `Was ${bVals["Cartons"] ?? "blank"} — changed to ${r.totals.sumItemCartons}, the products' cartons added together.` };
    bVals["Cartons"] = r.totals.sumItemCartons;
    fixes.push("R-04");
  }
  // V-04: the city decides the country
  const city = b.destinationCity, country = city ? CITY_COUNTRY[city] : undefined;
  if (codes.has("V-04") && country) {
    bMarks["Destination country"] = { kind: "fixed", note: `Was ${bVals["Destination country"] ?? "blank"} — ${city} is in ${country}.` };
    bVals["Destination country"] = country;
    fixes.push("V-04");
  }

  // what still needs the seller
  const markIssue = (i: Issue) => {
    if (i.severity === "Advisory" || fixes.includes(i.code)) return;
    const kind = i.severity === "Amber" ? "yellow" : "red";
    const note = `${i.severity === "Amber" ? "Worth a look" : "Must fix"} (${i.code}): ${i.whatIsWrong}${i.howToFix[0] ? ` Fix: ${i.howToFix[0]}` : ""}`;
    const put = (marks: Record<string, Mark>, col: string) => {
      const prev = marks[col];
      if (prev?.kind === "red" && kind === "yellow") return;
      marks[col] = { kind, note: prev && prev.kind !== "fixed" ? `${prev.note}\n${note}` : note };
    };
    for (const f of i.fields) {
      const bCol = BOOKING_COLUMNS.find((c) => BOOKING_FIELD_BY_COLUMN[c] === f);
      const iCol = ITEM_COLUMNS.find((c) => ITEM_FIELD_BY_COLUMN[c] === f);
      if (i.scope === "booking" && bCol && f !== "bookingId") put(bMarks, bCol);
      else if (iCol) (i.itemIndex != null ? [i.itemIndex] : items.map((_, k) => k)).forEach((k) => iMarks[k] && put(iMarks[k], iCol));
      else if (bCol) put(bMarks, bCol);
    }
  };
  r.issues.forEach(markIssue);
  return { bVals, bMarks, iVals, iMarks, fixes };
}

function writeRow(ws: ExcelJS.Worksheet, columns: readonly string[], vals: Record<string, Cell>, marks: Record<string, Mark>) {
  const row = ws.addRow(columns.map((c) => vals[c] ?? null));
  columns.forEach((c, k) => {
    const m = marks[c];
    const cell = row.getCell(k + 1);
    if (c === "HS code" && cell.value != null) cell.numFmt = "@";
    if (!m) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[m.kind] } };
    cell.note = m.note;
  });
}

/** The corrected workbook for some bookings: Bookings + Items, nothing else. */
export async function correctedWorkbook(views: BookingView[]): Promise<ExcelJS.Workbook> {
  const wb = await templateWorkbook();
  const bs = wb.getWorksheet("Bookings")!, is = wb.getWorksheet("Items")!;
  for (const v of views) {
    const c = correctBooking(v);
    writeRow(bs, BOOKING_COLUMNS, c.bVals, c.bMarks);
    c.iVals.forEach((vals, i) => writeRow(is, ITEM_COLUMNS, vals, c.iMarks[i]));
  }
  return wb;
}

/** Browser: build and download. */
export async function downloadCorrectedExcel(views: BookingView[], fileName: string) {
  const wb = await correctedWorkbook(views);
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

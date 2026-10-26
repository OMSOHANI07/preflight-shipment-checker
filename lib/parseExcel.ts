/**
 * Excel → Booking[] + Item[] (RULEBOOK §8.1, E-1 … E-4).
 * Pure: works in the browser and in Node. All normalisation is done by
 * bookingFromRow / itemFromRow in calculations.ts — never re-implemented here.
 */
import * as XLSX from "xlsx";
import { bookingFromRow, itemFromRow, type Booking, type Item } from "@/lib/calculations";

export const BOOKING_COLUMNS = [
  "Booking ID", "Seller name", "Origin city", "Origin country", "Destination city", "Destination country",
  "Destination type", "Ready to ship date", "Seller priority", "Pallets", "Cartons", "Total declared value",
  "Currency", "Total gross weight (kg)", "Delivery appointment booked",
] as const;
export const ITEM_COLUMNS = [
  "Booking ID", "SKU", "Description", "HS code", "Quantity (units)", "Unit price", "Units per carton",
  "Cartons", "Unit weight (kg)", "Country of origin",
] as const;

/** Booking / Item field key for each template column (used to highlight cells). */
export const BOOKING_FIELD_BY_COLUMN: Record<string, string> = {
  "Booking ID": "bookingId", "Seller name": "sellerName", "Origin city": "originCity", "Origin country": "originCountry",
  "Destination city": "destinationCity", "Destination country": "destinationCountry", "Destination type": "destinationType",
  "Ready to ship date": "readyToShipDate", "Seller priority": "sellerPriority", Pallets: "pallets", Cartons: "cartons",
  "Total declared value": "totalDeclaredValue", Currency: "currency", "Total gross weight (kg)": "totalGrossWeightKg",
  "Delivery appointment booked": "deliveryAppointmentBooked",
};
export const ITEM_FIELD_BY_COLUMN: Record<string, string> = {
  "Booking ID": "bookingId", SKU: "sku", Description: "description", "HS code": "hsCodeRaw",
  "Quantity (units)": "quantity", "Unit price": "unitPrice", "Units per carton": "unitsPerCarton", Cartons: "cartons",
  "Unit weight (kg)": "unitWeightKg", "Country of origin": "countryOfOrigin",
};

export type CellValue = string | number | boolean | null;
export interface RawRow {
  /** 1-based spreadsheet row number. */
  rowNumber: number;
  /** Raw cell values keyed by the header text as written in the file. */
  values: Record<string, CellValue>;
  /** Display text per header (Excel's formatted text when available). */
  display: Record<string, string>;
}
export interface FileNotice { level: "info" | "warning" | "error"; message: string }
export interface ParsedWorkbook {
  bookings: Booking[];
  items: Item[];
  bookingRows: RawRow[];
  itemRows: RawRow[];
  bookingHeaders: string[];
  itemHeaders: string[];
  notices: FileNotice[];
  /** Set when the file can't be checked at all. */
  fatal: string | null;
  usedExampleAsDemo: boolean;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Light-grey solid fill (template uses F2F2F2). Any neutral grey from C0C0C0 to F8F8F8 counts. */
export function isGreyFill(cell: XLSX.CellObject | undefined): boolean {
  const s = cell?.s as { patternType?: string; fgColor?: { rgb?: string } } | undefined;
  if (!s || s.patternType !== "solid") return false;
  const rgb = (s.fgColor?.rgb ?? "").replace(/^FF(?=[0-9A-F]{6}$)/i, "").toUpperCase();
  const m = rgb.match(/^([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/);
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return r === g && g === b && r >= 0xc0 && r <= 0xf8;
}

interface SheetRead {
  headers: string[];
  rows: RawRow[];
  exampleRow: RawRow | null;
  headerFound: boolean;
  /** Cells like "Bookings!H7" that hold a formula with no saved value (shown blank). */
  uncachedFormulas: string[];
  /** Merged ranges inside the data area, e.g. "A5:A6". */
  mergedRanges: string[];
}

function readSheet(ws: XLSX.WorkSheet): SheetRead {
  const ref = ws["!ref"];
  if (!ref) return { headers: [], rows: [], exampleRow: null, headerFound: false, uncachedFormulas: [], mergedRanges: [] };
  const range = XLSX.utils.decode_range(ref);
  const cell = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;

  // Header row = first row (within the first 20) containing a "Booking ID" cell.
  let headerRow = -1;
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 20) && headerRow < 0; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) if (norm(cell(r, c)?.v) === "booking id") { headerRow = r; break; }
  }
  if (headerRow < 0) return { headers: [], rows: [], exampleRow: null, headerFound: false, uncachedFormulas: [], mergedRanges: [] };

  const cols: { c: number; header: string }[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = cell(headerRow, c)?.v;
    if (h != null && String(h).trim() !== "") cols.push({ c, header: String(h).trim() });
  }
  const idCol = cols.find((x) => norm(x.header) === "booking id")!.c;

  const rows: RawRow[] = [];
  let exampleRow: RawRow | null = null;
  const uncachedFormulas: string[] = [];
  const mergedRanges = (ws["!merges"] ?? []).filter((m) => m.e.r > headerRow).map((m) => XLSX.utils.encode_range(m));
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const values: Record<string, CellValue> = {};
    const display: Record<string, string> = {};
    let any = false;
    for (const { c, header } of cols) {
      const ce = cell(r, c);
      if (ce?.f && ce.v == null) uncachedFormulas.push(XLSX.utils.encode_cell({ r, c }));
      let v: CellValue = ce == null || ce.v == null ? null : (ce.v as CellValue);
      if (typeof v === "string" && v.trim() === "") v = null;
      if (v != null) any = true;
      values[header] = v;
      display[header] = v == null ? "" : String(ce?.w ?? v);
    }
    if (!any) continue; // skip empty rows
    const row: RawRow = { rowNumber: r + 1, values, display };
    // The template's grey example row: directly under the header, grey-filled.
    if (r === headerRow + 1 && isGreyFill(cell(r, idCol))) { exampleRow = row; continue; }
    rows.push(row);
  }
  return { headers: cols.map((x) => x.header), rows, exampleRow, headerFound: true, uncachedFormulas, mergedRanges };
}

function findSheet(wb: XLSX.WorkBook, name: string): string | null {
  return wb.SheetNames.find((n) => norm(n) === name) ?? wb.SheetNames.find((n) => norm(n).includes(name)) ?? null;
}

function missingColumns(headers: string[], required: readonly string[]) {
  const have = new Set(headers.map(norm));
  return required.filter((c) => !have.has(norm(c)));
}

export function parseWorkbook(data: ArrayBuffer | Uint8Array, fileName = "upload.xlsx"): ParsedWorkbook {
  const empty: ParsedWorkbook = {
    bookings: [], items: [], bookingRows: [], itemRows: [], bookingHeaders: [], itemHeaders: [],
    notices: [], fatal: null, usedExampleAsDemo: false,
  };
  if (!/\.(xlsx|xls)$/i.test(fileName)) return { ...empty, fatal: `"${fileName}" isn't an Excel file. Upload a .xlsx or .xls file in the template format.` };

  let wb: XLSX.WorkBook;
  try {
    // Raw values only: dates stay as Excel serial numbers / text, HS codes stay as typed.
    wb = XLSX.read(data, { type: "array", cellStyles: true, cellDates: false, cellNF: false, cellFormula: true });
  } catch {
    return { ...empty, fatal: "We couldn't read this file. Make sure it's a real Excel workbook (.xlsx or .xls) and not password-protected." };
  }

  const notices: FileNotice[] = [];
  let bName = findSheet(wb, "bookings");
  let iName = findSheet(wb, "items");
  if (!bName || !iName) {
    if (wb.SheetNames.length < 2) return { ...empty, fatal: "The file needs two sheets: Bookings and Items. We found only one sheet." };
    bName = bName ?? wb.SheetNames.find((n) => n !== iName)!;
    iName = iName ?? wb.SheetNames.find((n) => n !== bName)!;
    notices.push({ level: "warning", message: `Sheets named "Bookings" and "Items" weren't both found, so we used "${bName}" as Bookings and "${iName}" as Items.` });
  }

  const b = readSheet(wb.Sheets[bName]);
  const it = readSheet(wb.Sheets[iName]);
  if (!b.headerFound) return { ...empty, notices, fatal: `No header row with "Booking ID" was found on the "${bName}" sheet. Use the template's column headings.` };
  if (!it.headerFound) return { ...empty, notices, fatal: `No header row with "Booking ID" was found on the "${iName}" sheet. Use the template's column headings.` };

  const list = (xs: string[]) => xs.slice(0, 6).join(", ") + (xs.length > 6 ? ` and ${xs.length - 6} more` : "");
  for (const [name, sheet] of [[bName, b], [iName, it]] as const) {
    if (sheet.uncachedFormulas.length)
      notices.push({ level: "warning", message: `${name}: ${sheet.uncachedFormulas.length} cell(s) contain a formula with no saved value (${list(sheet.uncachedFormulas)}), so they read as blank. Open the file in Excel, let it recalculate, save, and upload again — or paste the values.` });
    if (sheet.mergedRanges.length)
      notices.push({ level: "warning", message: `${name}: merged cells (${list(sheet.mergedRanges)}). Only the first cell of a merge holds the value, so the other rows read as blank. Unmerge them and fill every row.` });
  }
  const mb = missingColumns(b.headers, BOOKING_COLUMNS);
  const mi = missingColumns(it.headers, ITEM_COLUMNS);
  if (mb.length) notices.push({ level: "error", message: `Column not found on the Bookings sheet: ${mb.join(", ")}. Every booking will show these fields as missing (V-02).` });
  if (mi.length) notices.push({ level: "error", message: `Column not found on the Items sheet: ${mi.join(", ")}. Every item will show these fields as missing.` });

  let bookingRows = b.rows;
  let itemRows = it.rows;
  let usedExampleAsDemo = false;
  if (bookingRows.length === 0 && b.exampleRow) {
    // Demo fallback: the file only contains the template's grey example — check it so the user sees a result.
    bookingRows = [b.exampleRow];
    if (it.exampleRow) itemRows = [it.exampleRow, ...itemRows];
    usedExampleAsDemo = true;
    notices.push({ level: "info", message: "This file only has the template's grey example row, so we checked it as a demo. Add your own bookings from row 4." });
  } else if (b.exampleRow || it.exampleRow) {
    notices.push({ level: "info", message: "Skipped the template's grey example row (row 3)." });
  }

  if (bookingRows.length === 0) return { ...empty, notices, fatal: `The "${bName}" sheet has no bookings. Add one row per shipment under the header row.` };

  const bookings = bookingRows.map((r) => bookingFromRow(r.values));
  const items = itemRows.map((r) => itemFromRow(r.values, `${iName}!row ${r.rowNumber}`));
  return {
    bookings, items, bookingRows, itemRows, bookingHeaders: b.headers, itemHeaders: it.headers,
    notices, fatal: null, usedExampleAsDemo,
  };
}

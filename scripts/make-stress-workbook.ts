/**
 * Generates public/samples/stress-test.xlsx in the exact template format:
 * starts from the real template (title row, header row 2, grey example row 3,
 * Carrier options, Rulebook, Allowed values, Field guide, Glossary) and writes
 * the stress bookings from row 4.   Run: npm run make:stress
 */
import ExcelJS from "exceljs";
import path from "node:path";
import { BOOKING_COLUMNS, ITEM_COLUMNS } from "@/lib/parseExcel";
import { ORPHAN_ITEM, STRESS_BOOKINGS } from "./stress-data";

const root = path.resolve(__dirname, "..");
const TEMPLATE = path.join(root, "data/Case2_Shipment_Booking_Test_Data_Format.xlsx");
const OUT = path.join(root, "public/samples/stress-test.xlsx");

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  const bookings = wb.getWorksheet("Bookings")!;
  const items = wb.getWorksheet("Items")!;

  let r = 4;
  for (const s of STRESS_BOOKINGS) {
    BOOKING_COLUMNS.forEach((col, c) => {
      const cell = bookings.getCell(r, c + 1);
      cell.value = s.row[col] ?? null;
      if (s.row[col] instanceof Date) cell.numFmt = "dd-mm-yyyy";
    });
    r++;
  }
  let ir = 4;
  for (const it of [...STRESS_BOOKINGS.flatMap((s) => s.items), ORPHAN_ITEM]) {
    ITEM_COLUMNS.forEach((col, c) => {
      const v = it[col] ?? null;
      const cell = items.getCell(ir, c + 1);
      cell.value = v;
      // HS codes given as strings are stored as text cells (like a seller who formatted the column as Text).
      if (col === "HS code" && typeof v === "string") cell.numFmt = "@";
    });
    ir++;
  }
  await wb.xlsx.writeFile(OUT);
  console.log(`Wrote ${OUT}: ${STRESS_BOOKINGS.length} bookings, ${ir - 4} item rows (incl. 1 orphan).`);
}

main().catch((e) => { console.error(e); process.exit(1); });

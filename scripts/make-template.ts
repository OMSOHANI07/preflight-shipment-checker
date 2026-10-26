/** Writes public/samples/template.xlsx: the Bookings and Items sheets with headings only. */
import { templateWorkbook } from "../lib/workbook";

templateWorkbook()
  .then((wb) => wb.xlsx.writeFile("public/samples/template.xlsx"))
  .then(() => console.log("wrote public/samples/template.xlsx"));

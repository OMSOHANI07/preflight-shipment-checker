/**
 * Purchase order PDF (jsPDF + autotable), loaded on demand in the browser — one per booking.
 * Buyer = the seller; supplier = the recommended carrier. Goods lines, freight charge, totals and a
 * status banner (a booking that can't ship yet is marked DRAFT). No rules or checker output in here:
 * the seller gets that in the corrected Excel.
 */
import type { jsPDF as JsPDF } from "jspdf";
import { formatDDMMYYYY, gbp, isNum, round, weekdayName } from "@/lib/calculations";
import type { BookingView } from "@/lib/types";

/**
 * Text goes into the PDF in an embedded Unicode font (Geist, OFL — public/fonts/Geist-Regular.ttf), so
 * £, é, ü, –, “ ” print as written. Only a few symbols the font lacks are swapped. If the font can't be
 * loaded we fall back to Helvetica (WinAnsi) and strip what it can't draw.
 */
let FONT = "helvetica";
const pdfText = (s: string) => {
  const t = s.replace(/[✓✔]/g, "pass").replace(/[✕✗]/g, "fail").replace(/≠/g, "!=").replace(/≤/g, "<=").replace(/≥/g, ">=");
  if (FONT !== "helvetica") return t.replace(/[\u{1F000}-\u{1FFFF}]/gu, "");
  return t.replace(/→/g, "->").replace(/×/g, "x").replace(/÷/g, "/").replace(/…/g, "...")
    .replace(/[–—]/g, "-").replace(/•/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "");
};

let fontB64: Promise<string | null> | null = null;
function loadFont(): Promise<string | null> {
  fontB64 ??= fetch("/fonts/Geist-Regular.ttf")
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((buf) => { let bin = ""; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); })
    .catch(() => { fontB64 = null; return null; });
  return fontB64;
}


type AutoTable = (doc: JsPDF, opts: Record<string, unknown>) => void;
interface Ctx { doc: JsPDF; autoTable: AutoTable; y: number }
const W = 595.28, M = 40;
const lastY = (doc: JsPDF) => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;

function ensure(ctx: Ctx, h: number) {
  if (ctx.y + h > 800) { ctx.doc.addPage(); ctx.y = M; }
}
function heading(ctx: Ctx, text: string, size = 13) {
  ensure(ctx, 30);
  ctx.doc.setFont(FONT, "bold").setFontSize(size).setTextColor(29, 29, 31);
  ctx.doc.text(pdfText(text), M, ctx.y);
  ctx.y += size + 6;
}
function para(ctx: Ctx, text: string, size = 10, color: [number, number, number] = [60, 60, 67]) {
  ctx.doc.setFont(FONT, "normal").setFontSize(size).setTextColor(...color);
  const lines = ctx.doc.splitTextToSize(pdfText(text), W - 2 * M) as string[];
  for (const l of lines) { ensure(ctx, size + 4); ctx.doc.text(l, M, ctx.y); ctx.y += size + 4; }
  ctx.y += 4;
}
function table(ctx: Ctx, head: string[], body: string[][], widths?: number[]) {
  ctx.autoTable(ctx.doc, {
    startY: ctx.y, head: [head.map(pdfText)], body: body.map((r) => r.map(pdfText)), margin: { left: M, right: M },
    styles: { font: FONT, fontSize: 8.5, cellPadding: 4, overflow: "linebreak", textColor: [29, 29, 31] },
    headStyles: { fillColor: [245, 245, 247], textColor: [29, 29, 31], fontStyle: "bold" },
    columnStyles: widths ? Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w }])) : undefined,
  });
  ctx.y = lastY(ctx.doc) + 16;
}

async function newDoc(): Promise<Ctx> {
  const [{ jsPDF }, autoTableMod, font] = await Promise.all([import("jspdf"), import("jspdf-autotable"), loadFont()]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  FONT = "helvetica";
  if (font) {
    doc.addFileToVFS("Geist-Regular.ttf", font);
    // One weight is embedded; "bold" maps to it so headings stay in the same font (hierarchy comes from size).
    doc.addFont("Geist-Regular.ttf", "Geist", "normal");
    doc.addFont("Geist-Regular.ttf", "Geist", "bold");
    FONT = "Geist";
  }
  return { doc, autoTable: autoTableMod.default as unknown as AutoTable, y: M };
}

const INK: [number, number, number] = [29, 29, 31], GREY: [number, number, number] = [110, 110, 115];
const BANNER: Record<string, { fill: [number, number, number]; ink: [number, number, number] }> = {
  RED: { fill: [255, 228, 226], ink: [180, 20, 20] }, INCOMPLETE: { fill: [235, 235, 238], ink: [70, 70, 75] },
  AMBER: { fill: [255, 243, 176], ink: [110, 82, 0] }, GREEN: { fill: [216, 245, 223], ink: [25, 105, 45] },
};
/** "HS code missing" stays as is; "Pallets too heavy" → "pallets too heavy" mid-sentence. */
const midSentence = (t: string) => (/^[A-Z]{2}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
const longDay = (iso: string | null | undefined) => (iso ? `${weekdayName(iso)} ${formatDDMMYYYY(iso)}` : "—");
const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 60) || "booking";

function box(ctx: Ctx, x: number, w: number, title: string, lines: string[]) {
  const h = 22 + lines.length * 13;
  ctx.doc.setDrawColor(225, 225, 230).roundedRect(x, ctx.y, w, h, 6, 6);
  ctx.doc.setFont(FONT, "bold").setFontSize(8).setTextColor(...GREY).text(pdfText(title.toUpperCase()), x + 10, ctx.y + 14);
  ctx.doc.setFont(FONT, "normal").setFontSize(10).setTextColor(...INK);
  lines.forEach((l, i) => ctx.doc.text(pdfText(l), x + 10, ctx.y + 29 + i * 13));
  return h;
}

function footer(doc: JsPDF, po: string) {
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setFont(FONT, "normal").setFontSize(8).setTextColor(140, 140, 145);
    doc.text(pdfText(`Ship Eazy · ${po} · prices and dates are estimates from the carrier rate card · page ${p} of ${n}`), M, 825);
  }
}

/** The purchase order for one booking. `reference` = the confirmation reference once booked. */
export async function downloadPurchaseOrder(v: BookingView, reference?: string | null) {
  const { doc, fileName } = await buildPurchaseOrder(v, reference);
  doc.save(fileName);
}

export async function buildPurchaseOrder(v: BookingView, reference?: string | null): Promise<{ doc: JsPDF; fileName: string; po: string }> {
  const ctx = await newDoc();
  const { doc } = ctx;
  const { booking: b, items, result: r } = v;
  const best = r.recommendation.recommended;
  const po = reference ? `PO-${reference.replace(/^PF-/, "")}` : `PO-${safeName(b.bookingId || "DRAFT").toUpperCase()}`;
  const issued = new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London" }).replace(/\//g, "-");

  // title block
  doc.setFont(FONT, "bold").setFontSize(18).setTextColor(...INK).text("Ship Eazy", M, ctx.y + 8);
  doc.setFont(FONT, "normal").setFontSize(9).setTextColor(...GREY).text(pdfText("Road freight, UK → Europe"), M, ctx.y + 22);
  doc.setFont(FONT, "bold").setFontSize(22).setTextColor(...INK).text("PURCHASE ORDER", W - M, ctx.y + 10, { align: "right" });
  doc.setFont(FONT, "normal").setFontSize(10).setTextColor(...GREY);
  doc.text(pdfText(`PO number: ${po}`), W - M, ctx.y + 26, { align: "right" });
  doc.text(pdfText(`Date issued: ${issued}`), W - M, ctx.y + 39, { align: "right" });
  if (reference) doc.text(pdfText(`Booking reference: ${reference}`), W - M, ctx.y + 52, { align: "right" });
  ctx.y += reference ? 66 : 56;

  // status banner
  const blocking = r.issues.filter((i) => i.severity === "Red" || i.severity === "Data");
  const yellow = r.issues.filter((i) => i.severity === "Amber");
  const bannerText = r.status === "RED" || r.status === "INCOMPLETE"
    ? `DRAFT — not ready to ship. ${blocking.length} thing${blocking.length === 1 ? "" : "s"} must be fixed first: ${blocking.slice(0, 3).map((i) => midSentence(i.title)).join("; ")}${blocking.length > 3 ? "; …" : ""}.`
    : r.status === "AMBER"
      ? `Ready to ship — but check first: ${yellow.map((i) => midSentence(i.title)).join("; ")}.`
      : "Ready to ship — every check passed.";
  const c = BANNER[r.status];
  const bl = doc.setFont(FONT, "bold").setFontSize(10).splitTextToSize(pdfText(bannerText), W - 2 * M - 20) as string[];
  doc.setFillColor(...c.fill).roundedRect(M, ctx.y, W - 2 * M, 14 + bl.length * 13, 6, 6, "F");
  doc.setTextColor(...c.ink);
  bl.forEach((l, i) => doc.text(l, M + 10, ctx.y + 16 + i * 13));
  ctx.y += 26 + bl.length * 13;

  // parties
  const half = (W - 2 * M - 12) / 2;
  const h1 = box(ctx, M, half, "Buyer (shipper)", [b.sellerName ?? "—", `Collection: ${b.originCity ?? "—"}, ${b.originCountry ?? "United Kingdom"}`]);
  const h2 = box(ctx, M + half + 12, half, "Supplier (carrier)", best
    ? [`${best.carrier.carrier} — ${best.carrier.service}`, `${best.carrier.transitDays} working days · ${best.carrier.onTimePct}% on time`]
    : ["No carrier fits this load yet", "Fix the booking to get a quote"]);
  ctx.y += Math.max(h1, h2) + 16;

  // shipment
  table(ctx, ["Booking ID", "Deliver to", "Ready for collection", "Estimated delivery"], [[
    b.bookingId || "—",
    `${b.destinationCity ?? "—"}, ${b.destinationCountry ?? "—"} (${(b.destinationType ?? "—").toLowerCase()})`,
    longDay(b.readyToShipDate),
    best?.etaDate ? longDay(best.etaDate) : "—",
  ]]);
  const sumCartons = items.every((it) => isNum(it.cartons)) ? items.reduce((n, it) => n + (it.cartons as number), 0) : b.cartons;
  table(ctx, ["Pallets", "Cartons", "Gross weight", "Delivery slot booked"], [[
    String(b.pallets ?? "—"), String(sumCartons ?? "—"), isNum(b.totalGrossWeightKg) ? `${b.totalGrossWeightKg.toLocaleString("en-GB")} kg` : "—",
    b.deliveryAppointmentBooked == null ? "—" : b.deliveryAppointmentBooked ? "Yes" : "No",
  ]]);

  // goods
  let goods = 0, allPriced = true;
  const rows = items.map((it, i) => {
    const line = isNum(it.quantity) && isNum(it.unitPrice) ? round(it.quantity * it.unitPrice, 2) : null;
    if (line == null) allPriced = false; else goods += line;
    const hs = it.hsCodeRaw == null ? "—" : String(it.hsCodeRaw).replace(/\D/g, "") || String(it.hsCodeRaw);
    return [String(i + 1), it.sku ?? "—", it.description ?? "—", hs, it.countryOfOrigin ?? "—", isNum(it.quantity) ? it.quantity.toLocaleString("en-GB") : "—", isNum(it.unitPrice) ? gbp(it.unitPrice) : "—", line != null ? gbp(line) : "—"];
  });
  heading(ctx, "Goods");
  table(ctx, ["#", "SKU", "Description", "HS code", "Made in", "Qty", "Unit price", "Line total"], [...rows, ["", "", "", "", "", "", "Goods value", allPriced ? gbp(round(goods, 2)) : "—"]], [20, 60, 140, 55, 60, 45, 60, 75]);
  para(ctx, "The goods value is for the customs declaration and commercial invoice. It is not payable to the carrier.", 8.5, GREY);

  // freight
  heading(ctx, "Freight charges");
  if (best && isNum(best.cost) && isNum(b.pallets) && b.pallets > 0) {
    const rate = round(best.cost / b.pallets, 2);
    table(ctx, ["Service", "Pallets", "Rate per pallet", "Amount"], [
      [`${best.carrier.carrier} ${best.carrier.service}: ${b.originCity ?? "—"} → ${b.destinationCity ?? "—"}`, String(b.pallets), gbp(rate), gbp(best.cost)],
      ["", "", "Total to pay (estimate)", gbp(best.cost)],
    ], [260, 50, 100, 105]);
  } else para(ctx, "No carrier can take this load as it stands, so there is no freight charge yet. Fix the booking and download the purchase order again.");

  // terms + sign-off
  heading(ctx, "Terms", 11);
  para(ctx, "Prices are from the carrier rate card and are estimates until the carrier accepts this order. Delivery dates are estimated in working days and exclude weekends. Goods must be packed, labelled and ready for collection on the date above.", 9);
  ensure(ctx, 60);
  ctx.y += 20;
  doc.setDrawColor(180, 180, 185);
  doc.line(M, ctx.y, M + 200, ctx.y); doc.line(W - M - 160, ctx.y, W - M, ctx.y);
  doc.setFont(FONT, "normal").setFontSize(8.5).setTextColor(...GREY);
  doc.text("Authorised by (buyer)", M, ctx.y + 12); doc.text("Date", W - M - 160, ctx.y + 12);

  footer(doc, po);
  return { doc, fileName: `Purchase_Order_${safeName(b.bookingId || "draft")}.pdf`, po };
}

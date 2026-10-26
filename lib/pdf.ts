/**
 * PDF export (jsPDF + autotable), loaded on demand in the browser.
 * Per booking: status, confirmation, next steps, issues, rule table, recommendation, invoice checklist.
 * Full report: summary + every booking.
 */
import type { jsPDF as JsPDF } from "jspdf";
import { formatDDMMYYYY, gbp, RULES, type RuleId } from "@/lib/calculations";
import { invoiceChecklist, longDate, nextSteps } from "@/lib/explain";
import type { Explanation } from "@/lib/schema";
import type { BookingView, CheckedFile } from "@/lib/types";
import { SEVERITY_LABEL, STATUS_LABEL, STATUS_MEANING } from "@/lib/ui";

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

const STATUS_RGB: Record<string, [number, number, number]> = { RED: [215, 0, 21], INCOMPLETE: [99, 99, 102], AMBER: [122, 92, 0], GREEN: [31, 122, 53] };

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

function bookingSection(ctx: Ctx, v: BookingView, ex: Explanation) {
  const { booking: b, result: r } = v;
  const rec = r.recommendation;
  heading(ctx, `${b.bookingId || "(no ID)"} · ${b.sellerName ?? "—"}`, 16);
  ctx.doc.setFont(FONT, "bold").setFontSize(11).setTextColor(...STATUS_RGB[r.status]);
  ctx.doc.text(pdfText(`${STATUS_LABEL[r.status]} — ${STATUS_MEANING[r.status]}`), M, ctx.y);
  ctx.y += 16;
  para(ctx, `${b.originCity ?? "—"} → ${b.destinationCity ?? "—"} (${b.destinationCountry ?? "—"}) · ${b.destinationType ?? "—"} · priority ${b.sellerPriority ?? "—"} · checked against ${formatDDMMYYYY(r.checkedAgainstDate)}`, 9, [110, 110, 115]);

  heading(ctx, "Confirmation");
  para(ctx, ex.confirmation);
  heading(ctx, "What happens next");
  nextSteps(b, r).forEach((s, i) => para(ctx, `${i + 1}. ${s}`));

  const main = r.issues.filter((i) => i.severity !== "Advisory");
  heading(ctx, main.length ? `Issues (${main.length})` : "Issues");
  if (main.length) {
    table(ctx, ["Rule", "Type", "What is wrong", "How to fix"],
      main.map((i) => [i.code, SEVERITY_LABEL[i.severity], i.whatIsWrong, i.howToFix.map((f) => `• ${f}`).join("\n")]), [40, 50, 200, 224]);
  } else para(ctx, "No problems found against the 10 rules.");

  heading(ctx, "Rule results");
  table(ctx, ["Rule", "Check", "Result"], (Object.keys(RULES) as RuleId[]).map((id) => [id, RULES[id].text, r.ruleResults[id] === "not_evaluable" ? "not evaluable" : r.ruleResults[id]]), [40, 394, 80]);

  heading(ctx, `Carrier — ${rec.label}`);
  if (rec.recommended) {
    const best = rec.recommended;
    para(ctx, `${best.carrier.carrier} ${best.carrier.service}: ${gbp(best.cost)} · ${best.carrier.transitDays} working days · ${best.carrier.onTimePct}% on time · collection ${longDate(best.collectionDate)} · estimated delivery ${longDate(best.etaDate)}.`, 10, [29, 29, 31]);
  }
  para(ctx, [ex.reason, ex.tradeoff, ex.caveat].filter(Boolean).join(" "));
  table(ctx, ["Option", "Cost", "Transit", "On time", "Max kg/pallet", "Est. delivery", "Eligible"],
    rec.allOptions.map((e) => [`${e.carrier.carrier} ${e.carrier.service}`, gbp(e.cost), `${e.carrier.transitDays} days`, `${e.carrier.onTimePct}%`, `${e.carrier.maxKgPerPallet}`, formatDDMMYYYY(e.etaDate), e.eligible ? "Yes" : `No — ${e.ineligibleReasons.join("; ")}`]));

  const tips = r.issues.filter((i) => i.severity === "Advisory" && i.code !== "A-08");
  if (tips.length) {
    heading(ctx, "Tips (UK export guidance)");
    tips.forEach((t) => para(ctx, `${t.code} ${t.title}: ${t.whatIsWrong}`, 9));
  }
  heading(ctx, "Commercial invoice checklist (A-08)");
  table(ctx, ["Invoice element", "Status", "Detail"], invoiceChecklist(b, v.items, r).map((c) => [c.element, c.status, c.detail]), [170, 55, 289]);
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

function header(ctx: Ctx, title: string, sub: string) {
  ctx.doc.setFont(FONT, "bold").setFontSize(20).setTextColor(29, 29, 31).text(pdfText(title), M, ctx.y + 6);
  ctx.y += 26;
  para(ctx, sub, 9, [110, 110, 115]);
  ctx.doc.setDrawColor(220, 220, 225).line(M, ctx.y, W - M, ctx.y);
  ctx.y += 18;
}

function footer(doc: JsPDF) {
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setFont(FONT, "normal").setFontSize(8).setTextColor(140, 140, 145);
    doc.text(pdfText(`Pre-Flight Shipment Checker · estimates only · page ${p} of ${n}`), M, 825);
  }
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 60) || "booking";

export async function downloadBookingPdf(v: BookingView, ex: Explanation) {
  const ctx = await newDoc();
  header(ctx, "Pre-Flight booking report", `Booking ${v.booking.bookingId} · generated ${new Date().toLocaleString("en-GB", { timeZone: "Europe/London" })} (UK time)`);
  bookingSection(ctx, v, ex);
  footer(ctx.doc);
  ctx.doc.save(`preflight-${safeName(v.booking.bookingId)}.pdf`);
}

export async function downloadFullReportPdf(file: CheckedFile, explanationFor: (v: BookingView, i: number) => Explanation) {
  const ctx = await newDoc();
  const s = file.summary;
  header(ctx, "Pre-Flight full report", `${file.fileName} · ${s.total} bookings · checked against ${formatDDMMYYYY(file.views[0]?.result.checkedAgainstDate ?? null)}`);
  table(ctx, ["Total", STATUS_LABEL.RED, STATUS_LABEL.INCOMPLETE, STATUS_LABEL.AMBER, STATUS_LABEL.GREEN], [[String(s.total), String(s.red), String(s.incomplete), String(s.amber), String(s.green)]]);
  table(ctx, ["Rule", "Bookings failing"], (Object.keys(RULES) as RuleId[]).map((id) => [`${id} ${RULES[id].text}`, String(s.ruleFailCounts[id] ?? 0)]), [430, 84]);
  if (file.fileIssues.length) {
    heading(ctx, "File-level problems");
    file.fileIssues.forEach((i) => para(ctx, `${i.code}: ${i.whatIsWrong} ${i.howToFix.join(" ")}`));
  }
  table(ctx, ["Booking", "Seller", "Status", "Carrier", "Cost", "Est. delivery"], file.views.map((v) => {
    const best = v.result.recommendation.recommended;
    return [v.booking.bookingId, v.booking.sellerName ?? "—", STATUS_LABEL[v.result.status], best ? `${best.carrier.carrier} ${best.carrier.service}` : "No carrier fits", gbp(best?.cost), formatDDMMYYYY(best?.etaDate ?? null)];
  }));
  file.views.forEach((v, i) => { ctx.doc.addPage(); ctx.y = M; bookingSection(ctx, v, explanationFor(v, i)); });
  footer(ctx.doc);
  ctx.doc.save(`preflight-report-${safeName(file.fileName.replace(/\.xlsx?$/i, ""))}.pdf`);
}

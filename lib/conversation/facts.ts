/**
 * FACTS — the only things a reply may say (RECOMMENDATION_RULES §6.3, prompt Step 8). Built from the
 * engine's BookingResult and diffResults(); Gemini phrases them, the template joins them, and the
 * validator rejects any reply that mentions a £ amount, date, carrier or rule ID not in here.
 */
import { formatDDMMYYYY, gbp, weekdayName, type BookingResult, type BookingStatus, type Issue } from "@/lib/calculations";
import { STATUS_LABEL } from "@/lib/ui";
import type { Change } from "./state";
import type { Mode, NextQuestion, TurnDiff } from "./types";

export interface Facts {
  changeSummary: string[];
  cascadeNotes: string[];
  readbacks: string[];
  fixedRules: string[];
  newRules: { id: string; whatIsWrong: string; howToFix: string }[];
  status: string | null;
  /** "Can't ship yet → Check first" when this turn changed the status, else null */
  statusChange: string | null;
  recommendation: { label: string; carrier: string | null; cost: string | null; eta: string | null; reasonFacts: string[] } | null;
  nextQuestion: { text: string; options: string[] };
  answerToQuestion: string | null;
  sellerQuestion: string | null;
  notes: string[];
  mode: Mode;
}

const shortDate = (iso: string | null) => (iso ? `${weekdayName(iso).slice(0, 3)} ${formatDDMMYYYY(iso).slice(0, 5)}` : "—");
const carrierName = (r: BookingResult | null) => {
  const c = r?.recommendation.recommended?.carrier;
  return c ? `${c.carrier} ${c.service}` : null;
};

/** The DiffToast / inline "what changed" line (prompt §4). */
type Delta = { added: Issue[]; fixed: string[] };
export function turnDiff(changes: Change[], cascade: string[], d: Delta | null, prev: BookingResult | null, cur: BookingResult | null): TurnDiff | null {
  const fixed = d?.fixed ?? [];
  const added = (d?.added ?? []).map((i) => `${i.code}${i.sku ? ` (${i.sku})` : ""}`);
  const pc = prev?.recommendation.recommended, cc = cur?.recommendation.recommended;
  const out: TurnDiff = {
    fields: changes.map((c) => ({ field: c.field, from: c.from, to: c.to })),
    fixed, newIssues: added,
    status: prev && cur && prev.status !== cur.status ? { from: prev.status, to: cur.status } : null,
    carrier: prev && (pc?.carrier.id ?? null) !== (cc?.carrier.id ?? null) ? { from: pc ? pc.carrier.carrier : null, to: cc ? cc.carrier.carrier : null } : null,
    cost: prev && pc?.cost !== cc?.cost && (pc?.cost != null || cc?.cost != null) ? { from: gbp(pc?.cost), to: gbp(cc?.cost) } : null,
    eta: prev && pc?.etaDate !== cc?.etaDate && (pc?.etaDate || cc?.etaDate) ? { from: shortDate(pc?.etaDate ?? null), to: shortDate(cc?.etaDate ?? null) } : null,
    cascade,
  };
  const empty = !out.fields.length && !out.fixed.length && !out.newIssues.length && !out.status && !out.carrier && !out.cost && !out.eta && !out.cascade.length;
  return empty ? null : out;
}

export function buildFacts(o: {
  changes: Change[]; cascade: string[]; readbacks: string[]; delta: Delta | null; result: BookingResult | null;
  next: NextQuestion; answer: string | null; sellerQuestion: string | null; notes: string[]; mode: Mode; showRecommendation: boolean; prevStatus?: string | null;
}): Facts {
  const r = o.result;
  // the rule the next question is about is explained by the question itself — don't say it twice
  const added = (o.delta?.added ?? []).filter((i) => !(o.next.kind === "rule" && o.next.id === i.code && (o.next.itemIndex ?? null) === (i.itemIndex ?? null)));
  const best = r?.recommendation.recommended;
  return {
    changeSummary: o.changes.map((c) => (c.from === "—" ? `${c.field}: ${c.to}` : `${c.field} ${c.from} → ${c.to}`)),
    cascadeNotes: o.cascade,
    readbacks: o.readbacks,
    fixedRules: o.delta?.fixed ?? [],
    newRules: added.slice(0, 3).map((i) => ({ id: i.code, whatIsWrong: i.whatIsWrong, howToFix: i.howToFix[0] ?? "" })),
    status: r ? STATUS_LABEL[r.status] : null,
    statusChange: o.prevStatus && r && o.prevStatus !== r.status ? `${STATUS_LABEL[o.prevStatus as BookingStatus] ?? o.prevStatus} → ${STATUS_LABEL[r.status]}` : null,
    recommendation: r && o.showRecommendation ? {
      label: r.recommendation.label, carrier: carrierName(r), cost: best ? gbp(best.cost) : null,
      eta: best?.etaDate ? `${weekdayName(best.etaDate)} ${formatDDMMYYYY(best.etaDate)}` : null, reasonFacts: r.recommendation.reasonFacts,
    } : null,
    nextQuestion: { text: o.next.text, options: o.next.options },
    answerToQuestion: o.answer,
    sellerQuestion: o.sellerQuestion,
    notes: o.notes,
    mode: o.mode,
  };
}

/** Fixed-wording reply from FACTS (used when Gemini is off, slow, or its text fails validation). */
export function templateReply(f: Facts): string {
  const parts: string[] = [];
  if (f.answerToQuestion) parts.push(f.answerToQuestion);
  if (f.changeSummary.length) parts.push(`Updated: ${f.changeSummary.join("; ")}.`);
  parts.push(...f.cascadeNotes.map((c) => `${c}.`));
  parts.push(...f.readbacks);
  if (f.fixedRules.length) parts.push(`✓ Fixed: ${f.fixedRules.join(", ")}.`);
  for (const r of f.newRules) parts.push(`⚠ ${r.id}: ${r.whatIsWrong}`);
  if (f.notes.includes("confirmation-voided")) parts.push("I'll need you to confirm again with the changes.");
  if (f.recommendation?.carrier) parts.push(`${f.recommendation.label}: ${f.recommendation.carrier}, ${f.recommendation.cost}, estimated delivery ${f.recommendation.eta}.`);
  parts.push(f.nextQuestion.text);
  return parts.filter(Boolean).join(" ").replace(/\.\./g, ".").trim();
}

/** Every £ amount, date, carrier name and rule ID in the reply must be in FACTS; the next question must be there. */
export function validateReply(reply: string, f: Facts): { ok: boolean; problem?: string } {
  const facts = JSON.stringify(f);
  const factsText = facts.replace(/\\"/g, '"');
  for (const m of reply.match(/£\s?[\d,]+(?:\.\d{1,2})?/g) ?? []) if (!factsText.includes(m.replace(/\s/g, ""))) return { ok: false, problem: `amount ${m}` };
  for (const m of reply.match(/\b\d{1,2}-\d{1,2}-\d{4}\b/g) ?? []) if (!factsText.includes(m)) return { ok: false, problem: `date ${m}` };
  for (const m of reply.match(/\bCarrier [ABC]\b/g) ?? []) if (!factsText.includes(m)) return { ok: false, problem: `carrier ${m}` };
  for (const m of reply.match(/\b[RVA]-\d{2}\b/g) ?? []) if (!factsText.includes(m)) return { ok: false, problem: `rule ${m}` };
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9£]+/g, " ").trim();
  if (!norm(reply).includes(norm(f.nextQuestion.text).slice(0, Math.min(60, norm(f.nextQuestion.text).length)))) return { ok: false, problem: "next question missing" };
  if (reply.length > 1200) return { ok: false, problem: "too long" };
  return { ok: true };
}

/** What the voice reads aloud: short (prompt §5, G11) — one sentence of news + the question. */
export function speakText(reply: string, f: Facts, voiceQuestion: string): string {
  // a short reply is spoken as written; a long one is cut to the news plus the short voice question
  if (reply.length <= 260) return reply;
  const rec = f.recommendation?.carrier ? `${f.recommendation.carrier}, ${f.recommendation.cost}, arriving ${f.recommendation.eta}.` : "";
  if (rec && f.changeSummary.length === 0) return `${rec} ${voiceQuestion}`.trim();
  const news = f.changeSummary.length ? `Updated: ${f.changeSummary[0]}.` : f.newRules[0] ? `${f.newRules[0].id}: ${f.newRules[0].whatIsWrong.split(". ")[0]}.` : f.readbacks[0] ?? (f.answerToQuestion ? f.answerToQuestion.split(". ")[0] + "." : "");
  return `${news} ${voiceQuestion}`.trim();
}

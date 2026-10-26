/**
 * One conversation turn (prompt §3.2). Pure apart from the injected deps (Gemini extract / reply,
 * R-06 second opinion, confirmation store), so tests run it with mocks and no network.
 */
import { diffResults, runAll, todayISO, type BookingResult } from "@/lib/calculations";
import { confirmationDraft, nextSteps } from "@/lib/explain";
import { buildFacts, speakText, templateReply, turnDiff, validateReply, type Facts } from "./facts";
import { cannedAnswer, fallbackExtract, supplementExtraction } from "./fallback";
import { pickNextQuestion, reviewQuestion } from "./nextQuestion";
import * as N from "./normalise";
import { issueDelta } from "./issues";
import { applyExtraction, productName, toRunInputs } from "./state";
import type { ConversationState, Extraction, Mode, NextQuestion, Pending, TurnResponse } from "./types";

export const MAX_MESSAGE = 1000;

export interface ExtractContext { message: string; pending: Pending | null; state: ConversationState; today: string }
export interface TurnDeps {
  /** Gemini (or a mock). Return null on any failure → fallback. */
  extract?: (ctx: ExtractContext) => Promise<Extraction | null>;
  /** Gemini reply writer. Return null on any failure → template. */
  reply?: (facts: Facts) => Promise<string | null>;
  /** R-06 second opinion for an item the seller doesn't know about. null = unavailable. */
  r06?: (item: { sku: string | null; description: string | null; hsCode: string | null }) => Promise<boolean | null>;
  /** Saves a confirmation, returns its reference. */
  confirm?: (c: { bookingId: string; status: string; acknowledgedAmber: boolean; carrierId: string | null }) => Promise<{ reference: string; saved: boolean }>;
  extractionSource?: "ai" | "mock";
}

export const OPENING = {
  chat: "Hi! Tell me about the shipment you'd like to send — where it's going, what's in it, and when it'll be ready. I'll ask for anything I still need and check it for mistakes before it leaves.",
  voice: "Hi! Tell me about your shipment — where it's going, what's in it, and when it's ready.",
};

const nowIso = () => new Date().toISOString();
const runFor = (s: ConversationState, now: Date) => {
  const { booking, items, geminiR06Verdicts } = toRunInputs(s);
  return { booking, items, result: runAll(booking, items, { now, geminiR06Verdicts }) };
};
const hasAnyData = (s: ConversationState) => !!(s.booking.sellerName || s.booking.destinationCity || s.items.length || s.booking.originCity);

function setPending(s: ConversationState, q: NextQuestion) {
  s.pending = { questionId: q.id, field: q.field, itemIndex: q.itemIndex, kind: q.kind, options: q.options };
  if (q.confirm) s.pendingConfirm = q.confirm;
  if (["Q-07", "Q-24", "Q-25", "Q-26"].includes(q.id) && !s.askedOnce.includes(q.id)) s.askedOnce.push(q.id);
  if (q.id === "Q-15" && q.itemIndex != null) s.askedOnce.push(`Q-15:${q.itemIndex}`);
  if (q.id === "Q-16" && q.itemIndex != null) s.askedOnce.push(`Q-16:${q.itemIndex}`);
}

export async function runTurn(prev: ConversationState, message: string, mode: Mode, deps: TurnDeps = {}, now: Date = new Date()): Promise<TurnResponse> {
  const today = todayISO(now);
  let state: ConversationState = { ...structuredClone(prev), mode };
  const text = message.trim();
  const prevRun = hasAnyData(prev) ? runFor({ ...prev, mode }, now) : null;

  const finish = (s: ConversationState, reply: string, q: NextQuestion | null, result: BookingResult | null, diff: TurnResponse["diff"], replySource: "ai" | "template", extractionSource: TurnResponse["extractionSource"], speak?: string): TurnResponse => {
    s.history.push({ role: "assistant", text: reply, at: nowIso(), quickReplies: q?.options ?? [], diff });
    if (s.history.length > 200) s.history = s.history.slice(-200);
    s.version += 1;
    s.lastResult = result;
    return { state: s, reply, speak: speak ?? (mode === "voice" ? `${q?.voiceText ?? reply}` : reply), quickReplies: q?.options ?? [], result, diff, replySource, extractionSource };
  };

  /* Step 1 — guard */
  if (!text) {
    const q = state.pending ? { ...pickNextQuestion(state, { invalid: [], conflicts: [], ambiguous: null, newlyFailing: [], result: prevRun?.result ?? null, notes: [] }) } : null;
    return finish(state, q?.text ?? OPENING[mode], q, prevRun?.result ?? null, null, "template", "fallback");
  }
  state.history.push({ role: "seller", text: text.slice(0, MAX_MESSAGE), at: nowIso() });
  if (text.length > MAX_MESSAGE) {
    const q = pickNextQuestion(state, { invalid: [], conflicts: [], ambiguous: null, newlyFailing: [], result: prevRun?.result ?? null, notes: [] });
    setPending(state, q);
    return finish(state, `That's a lot — for many bookings, use the File Upload tab. Here, let's do one shipment at a time. ${q.text}`, q, prevRun?.result ?? null, null, "template", "fallback");
  }

  /* Step 2 — extract (Gemini, else regex on the pending field) */
  let extraction: Extraction | null = null;
  let extractionSource: TurnResponse["extractionSource"] = "fallback";
  if (deps.extract) {
    try { extraction = await deps.extract({ message: text, pending: state.pending, state, today }); } catch { extraction = null; }
    if (extraction) { extractionSource = deps.extractionSource ?? "ai"; extraction = supplementExtraction(text, extraction, state.pending); }
  }
  if (!extraction) extraction = fallbackExtract(text, state.pending);
  // pending R-06 safety question answered "don't know" → second opinion below
  if (state.pending?.field === "dg" && state.pending.itemIndex != null && extraction.yesNo == null && N.isUnknown(text)) state.dgAnswers[state.pending.itemIndex] = null;

  /* Steps 3–4 — normalise + apply */
  const applied = applyExtraction(state, extraction, today);
  state = applied.state;
  // failures per field → after two, show options; priority falls back to Balanced (Q-06)
  for (const inv of applied.invalid) state.failures[inv.field] = (state.failures[inv.field] ?? 0) + 1;
  for (const c of applied.changes) for (const f of Object.keys(state.failures)) if (c.field.toLowerCase().includes(f.replace(/^item\./, "").toLowerCase())) delete state.failures[f];
  const extraNotes: string[] = [];
  if (!state.booking.sellerPriority && (state.failures.sellerPriority ?? 0) >= 2) {
    state.booking.sellerPriority = "Balanced";
    state.booking.provenance = { ...state.booking.provenance, sellerPriority: "default" };
    applied.invalid = applied.invalid.filter((i) => i.field !== "sellerPriority");
    extraNotes.push("I'll use Balanced — the best mix of cost, speed and reliability. You can change it any time.");
  }

  /* Step 5 — R-06: seller's answer wins; Gemini only when they don't know */
  for (const [k, v] of Object.entries(state.dgAnswers)) {
    const i = Number(k);
    if (v === null && deps.r06 && state.items[i]) {
      const it = state.items[i];
      const verdict = await deps.r06({ sku: it.sku, description: it.description, hsCode: it.hsCodeRaw == null ? null : String(it.hsCodeRaw) }).catch(() => null);
      if (verdict != null) { state.dgAnswers[i] = verdict; extraNotes.push(`I double-checked ${productName(it)}: ${verdict ? "it likely contains a lithium battery, aerosol or flammable liquid" : "it doesn't look restricted"}.`); }
    }
  }

  /* Step 6 — check */
  const cur = hasAnyData(state) ? runFor(state, now) : null;
  const result = cur?.result ?? null;
  const report = prevRun && cur ? diffResults(prevRun.booking, prevRun.items, prevRun.result, cur.booking, cur.items, cur.result) : null;
  const delta = issueDelta(prev, prevRun?.result ?? null, state, result);
  const diff = turnDiff(applied.changes, applied.cascade, delta, prevRun?.result ?? null, result);

  /* confirmation (prompt §3.3) */
  let answer: string | null = null;
  let next: NextQuestion | null = null;
  if (applied.confirmRequested && result) {
    const blocking = result.issues.filter((i) => i.severity === "Red" || i.severity === "Data");
    const amber = result.issues.filter((i) => i.severity === "Amber");
    if (blocking.length) {
      answer = `I can't book it yet — ${blocking.length === 1 ? "1 issue must" : `${blocking.length} issues must`} be fixed first, whatever we do (the rules stop the shipment, not me).`;
      next = reviewQuestion(state, result, mode);
    } else if (amber.length && !applied.amberAcknowledged) {
      const reason = `There ${amber.length === 1 ? "is 1 warning" : `are ${amber.length} warnings`}: ${amber.map((i) => `${i.code} ${i.title.toLowerCase()}`).join("; ")}. Confirm anyway?`;
      next = { id: "Q-31", kind: "amber", field: "amberAck", text: reason, voiceText: `There ${amber.length === 1 ? "is a warning" : "are warnings"}. Confirm anyway?`, options: ["Confirm anyway", "Fix the warnings"], confirm: { field: "amberAck", value: null, kind: "amber", reason } };
    } else {
      const c = deps.confirm ? await deps.confirm({ bookingId: state.booking.bookingId, status: result.status, acknowledgedAmber: applied.amberAcknowledged, carrierId: result.recommendation.recommended?.carrier.id ?? null }).catch(() => null) : null;
      const reference = c?.reference ?? `PF-${today.replace(/-/g, "").slice(2)}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      state.confirmed = { at: nowIso(), reference };
      state.pending = null; state.pendingConfirm = null;
      const conf = confirmationDraft(cur!.booking, cur!.items, result);
      const steps = nextSteps(cur!.booking, result).filter((x) => !/^(Review the warnings|Fix the)/.test(x)).slice(0, 4).map((x, i) => `${i + 1}) ${x}`).join(" ");
      const reply = `Booked! Reference ${reference}. ${conf} Next steps: ${steps} You can download the PDF below.`;
      const done: NextQuestion = { id: "Q-32", kind: "done", field: "done", text: "Anything else you'd like to change?", voiceText: "Booked! Anything else?", options: ["Download PDF"] };
      return finish(state, reply, done, result, diff, "template", extractionSource, mode === "voice" ? `Booked! Your reference is ${reference.split("-").join(" ")}. ${conf.split(". ")[0]}.` : undefined);
    }
  }

  /* Step 7 — next question (code, not Gemini) */
  next ??= pickNextQuestion(state, {
    invalid: applied.invalid, conflicts: applied.conflicts, ambiguous: applied.ambiguous, newlyFailing: delta.added.map((i) => i.code),
    result, notes: applied.notes,
  });
  // conflicts outrank derived proposals; a fresh question replaces an unanswered confirm
  if (!next.confirm && state.pendingConfirm && state.pendingConfirm.kind !== "amber") state.pendingConfirm = null;
  setPending(state, next);

  /* the seller asked something (F12) / said something unrelated (F15) */
  if (extraction.question) answer = cannedAnswer(extraction.question);
  const nothingHappened = !applied.changes.length && !applied.invalid.length && !applied.cascade.length && !applied.undone && !applied.startedOver && !applied.confirmRequested && !extraction.question && extraction.yesNo == null;
  if (nothingHappened && prev.pending?.field === "review") answer = "Sure — what would you like to change? For example 'add a pallet' or 'the mugs are £6 each'.";
  else if (nothingHappened && extraction.intent === "other") answer = "I can only help with booking this shipment, so let's carry on.";
  if (applied.undone) answer = "Undone — back to how it was before your last change.";
  if (applied.startedOver) answer = "Starting over with a fresh booking.";
  if (applied.notes.some((n) => n.startsWith("auto-sku:"))) answer = [answer, `I've called it ${applied.notes.find((n) => n.startsWith("auto-sku:"))!.slice(9)}.`].filter(Boolean).join(" ");
  if (applied.notes.some((n) => n.startsWith("unknown:hsCodeRaw"))) answer = [answer, "No problem — you can look it up on the UK Trade Tariff (gov.uk/trade-tariff). I'll flag it as missing for now."].filter(Boolean).join(" ");
  if (extraNotes.length) answer = [answer, ...extraNotes].filter(Boolean).join(" ");

  /* Step 8 — reply (Gemini from FACTS, validated; else template) */
  const hadRec = !!prevRun?.result.recommendation.recommended;
  const showRec = (hadRec && !!(report?.recommendationChange || report?.costChange || report?.etaChange)) || next.kind === "review" || next.kind === "blocked" || next.kind === "amber";
  const facts = buildFacts({ changes: applied.changes, cascade: applied.cascade, readbacks: applied.readbacks, delta, result, next, answer, sellerQuestion: extraction.question, notes: applied.notes, mode, showRecommendation: showRec });
  let reply: string | null = null, replySource: "ai" | "template" = "template";
  // nothing to report → the question alone (no AI rewording, faster)
  const somethingToSay = facts.changeSummary.length || facts.cascadeNotes.length || facts.fixedRules.length || facts.newRules.length || facts.answerToQuestion || facts.sellerQuestion || facts.recommendation;
  if (deps.reply && somethingToSay) {
    try { reply = await deps.reply(facts); } catch { reply = null; }
    if (reply && validateReply(reply, facts).ok) replySource = "ai"; else reply = null;
  }
  reply ??= templateReply(facts);
  return finish(state, reply, next, result, diff, replySource, extractionSource, mode === "voice" ? speakText(reply, facts, next.voiceText) : undefined);
}

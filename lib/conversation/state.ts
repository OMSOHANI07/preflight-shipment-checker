/**
 * Conversation state — pure functions only (RULEBOOK §3, §8.2, §10; QUESTIONS.md §1, §6).
 * Values from the seller are "stated"; values we work out are "derived" and only stored after the
 * seller says yes. Stated values are never overwritten by a calculation: a conflict becomes a question.
 */
import {
  bookingKey, deriveBookingTotals, detectDangerousGoods, isNum, type Booking, type Item, type RecommendationPrefs,
} from "@/lib/calculations";
import * as N from "./normalise";
import { readBack } from "./readback";
import {
  BOOKING_FIELDS, type BookingField, type CarrierLetter, type ConvItem, type ConversationState, type ExtractedItem,
  type Extraction, type ItemField, type PendingConfirm, type Snapshot,
} from "./types";

export const MAX_UNDO = 20;
const REQUIRED_ITEM: ItemField[] = ["description", "sku", "quantity", "unitsPerCarton", "cartons", "unitPrice", "unitWeightKg"];
export const LABEL: Record<string, string> = {
  sellerName: "seller", originCity: "collection city", destinationCity: "destination city", destinationCountry: "destination country",
  destinationType: "destination type", readyToShipDate: "ready date", sellerPriority: "priority", pallets: "pallets", cartons: "total cartons",
  totalDeclaredValue: "declared value", totalGrossWeightKg: "gross weight", deliveryAppointmentBooked: "delivery appointment",
  sku: "SKU", description: "description", hsCodeRaw: "HS code", quantity: "quantity", unitPrice: "unit price", unitsPerCarton: "units per carton",
  unitWeightKg: "unit weight", countryOfOrigin: "country of origin",
  requiredDeliveryDate: "must arrive by", appointmentDate: "appointment date", maxBudgetGbp: "freight budget", highValueOrFragile: "high-value/fragile",
};

/* ---------------------------------------------------------------- create / snapshot */

function ukStamp(now: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

export function createState(now: Date = new Date(), id: string = cryptoId()): ConversationState {
  const booking: Booking = {
    bookingId: `BK-CHAT-${ukStamp(now)}`, sellerName: null, originCity: null, originCountry: "United Kingdom", destinationCity: null,
    destinationCountry: null, destinationType: null, readyToShipDate: null, sellerPriority: null, pallets: null, cartons: null,
    totalDeclaredValue: null, currency: "GBP", totalGrossWeightKg: null, deliveryAppointmentBooked: null,
    provenance: { bookingId: "default", originCountry: "default", currency: "default" },
  };
  return {
    id, version: 0, booking, items: [], prefs: {}, chosenCarrier: null, pending: null, pendingConfirm: null, history: [],
    undoStack: [], lastResult: null, confirmed: null, askedOnce: [], mode: "chat", dgAnswers: {}, itemLoopOpen: true,
    declined: [], failures: {}, nextAutoSku: 1,
  };
}

function cryptoId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `conv-${Date.now().toString(36)}`;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export const snapshotOf = (s: ConversationState): Snapshot => clone({
  booking: s.booking, items: s.items, prefs: s.prefs, chosenCarrier: s.chosenCarrier, dgAnswers: s.dgAnswers, itemLoopOpen: s.itemLoopOpen,
});

/** Undo: restore the snapshot taken before the last change. */
export function undo(s: ConversationState): { state: ConversationState; undone: boolean } {
  const next = clone(s);
  const snap = next.undoStack.pop();
  if (!snap) return { state: next, undone: false };
  Object.assign(next, snap);
  next.pendingConfirm = null;
  if (next.confirmed) next.confirmed = null;
  return { state: next, undone: true };
}

export function startOver(s: ConversationState, now: Date = new Date()): ConversationState {
  const fresh = createState(now, s.id);
  fresh.version = s.version;
  fresh.mode = s.mode;
  return fresh;
}

/* ---------------------------------------------------------------- run inputs (identical shape to Excel) */

const COUNTRY_CODE: Record<string, string> = { Germany: "DE", France: "FR", Netherlands: "NL" };

export function toRunInputs(s: ConversationState) {
  const b = s.booking;
  const code = b.destinationCountry ? COUNTRY_CODE[b.destinationCountry] : null;
  const booking: Booking = {
    ...b, prefs: { ...s.prefs }, chosenCarrierId: s.chosenCarrier && code ? `${s.chosenCarrier}-${code}` : null,
  };
  const items: Item[] = s.items.map(({ prov: _prov, ...it }) => { void _prov; return { ...it, bookingId: b.bookingId }; });
  const geminiR06Verdicts: Record<number, boolean> = {};
  for (const [k, v] of Object.entries(s.dgAnswers)) if (typeof v === "boolean") geminiR06Verdicts[Number(k)] = v;
  return { booking, items, geminiR06Verdicts };
}

/* ---------------------------------------------------------------- helpers */

export const itemComplete = (it: ConvItem) => REQUIRED_ITEM.every((f) => it[f] != null);
export const productName = (it: Pick<Item, "description" | "sku"> | undefined) => {
  if (!it) return "product";
  const d = (it.description ?? it.sku ?? "product").replace(/,.*$/, "").trim();
  return d.length > 40 ? d.slice(0, 40).replace(/\s+\S*$/, "") + "…" : d;
};
const ITEM_LABEL: Record<ItemField, string> = {
  sku: "SKU", description: "description", hsCodeRaw: "HS code", quantity: "quantity", unitPrice: "unit price", unitsPerCarton: "units per carton",
  cartons: "cartons", unitWeightKg: "unit weight", countryOfOrigin: "country of origin",
};
const fmt = (field: string, v: unknown) => (v == null ? "—" : typeof v === "boolean" ? (v ? "yes" : "no") : readBack(field, v) ?? String(v));

function newItem(s: ConversationState): ConvItem {
  return {
    bookingId: s.booking.bookingId, sku: null, description: null, hsCodeRaw: null, quantity: null, unitPrice: null, unitsPerCarton: null,
    cartons: null, unitWeightKg: null, countryOfOrigin: null, prov: {},
  };
}

/** The product the conversation is currently filling in (first incomplete one), if any. */
export function currentItemIndex(s: ConversationState): number | null {
  const i = s.items.findIndex((it) => !itemComplete(it));
  return i >= 0 ? i : null;
}

const STOP = new Set(["the", "a", "an", "of", "and", "those", "these", "my", "some", "ml", "for", "with"]);
const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(es|s)$/, ""));
const ORDINALS: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, last: -1 };

/**
 * "the mugs" / "MUG-01" / "the second one" / 1 → item index. Returns "new" when the reference
 * names a product we don't have yet, or { ambiguous } when two products match.
 */
export function resolveItemRef(s: ConversationState, ref: string | number, incoming?: ExtractedItem): number | "new" | { ambiguous: number[] } {
  if (typeof ref === "number") return ref >= 0 && ref < s.items.length ? ref : "new";
  const r = String(ref).trim();
  if (r === "new") return "new";
  if (/^\d+$/.test(r)) { const i = Number(r); return i < s.items.length ? i : "new"; }
  if (r === "pending" || r === "") {
    const p = s.pending?.itemIndex ?? currentItemIndex(s);
    if (p == null) return s.items.length && !incoming?.description ? s.items.length - 1 : "new";
    // A different description while an item is half-filled means another product (F2)
    const cur = s.items[p];
    if (incoming?.description && cur?.description && words(String(incoming.description)).every((w) => !words(cur.description!).includes(w))) return "new";
    return p;
  }
  const ord = r.toLowerCase().match(/\b(first|second|third|fourth|fifth|last)\b/);
  if (ord && s.items.length) { const i = ORDINALS[ord[1]] === -1 ? s.items.length - 1 : ORDINALS[ord[1]]; if (i < s.items.length) return i; }
  const bySku = s.items.findIndex((it) => it.sku && bookingKey(it.sku) === bookingKey(r));
  if (bySku >= 0) return bySku;
  const want = words(r);
  if (!want.length) return currentItemIndex(s) ?? "new";
  const hits = s.items.map((it, i) => ({ i, score: words(`${it.description ?? ""} ${it.sku ?? ""}`).filter((w) => want.includes(w)).length })).filter((x) => x.score > 0);
  if (!hits.length) return "new";
  const best = Math.max(...hits.map((h) => h.score));
  const top = hits.filter((h) => h.score === best).map((h) => h.i);
  return top.length === 1 ? top[0] : { ambiguous: top };
}

/* ---------------------------------------------------------------- apply */

export interface Change { field: string; itemIndex?: number; from: string; to: string }
export interface Invalid { field: string; itemIndex?: number; raw: string; reason: string; options?: string[] }
export interface ApplyResult {
  state: ConversationState;
  changes: Change[];
  invalid: Invalid[];
  cascade: string[];
  conflicts: PendingConfirm[];
  readbacks: string[];
  notes: string[];
  ambiguous: { text: string; options: string[] } | null;
  confirmRequested: boolean;
  amberAcknowledged: boolean;
  /** Item indexes whose description changed this turn (R-06 re-check). */
  describedItems: number[];
  undone: boolean;
  startedOver: boolean;
}

type BookingNormaliser = (v: unknown, today: string) => N.Norm<unknown>;
const BOOKING_NORMALISERS: Partial<Record<BookingField, BookingNormaliser>> = {
  sellerName: (v) => N.text(v),
  originCity: (v) => N.originCity(v),
  destinationCity: (v) => N.destinationCity(v),
  destinationCountry: (v) => N.destinationCountry(v),
  destinationType: (v) => N.destinationType(v),
  readyToShipDate: (v, t) => N.date(v, t),
  sellerPriority: (v) => N.priority(v),
  pallets: (v) => N.wholeNumber(v, "pallets"),
  cartons: (v) => N.wholeNumber(v, "cartons"),
  totalDeclaredValue: (v) => N.money(v),
  totalGrossWeightKg: (v) => N.grossKg(v),
  deliveryAppointmentBooked: (v) => N.yesNo(v),
};
const ITEM_NORMALISERS: Record<ItemField, (v: unknown) => N.Norm<unknown>> = {
  sku: (v) => N.text(v),
  description: (v) => N.text(v),
  hsCodeRaw: (v) => N.hsCode(v),
  quantity: (v) => N.wholeNumber(v, "units"),
  unitPrice: (v) => N.money(v),
  unitsPerCarton: (v) => N.wholeNumber(v, "units per carton"),
  cartons: (v) => N.wholeNumber(v, "cartons"),
  unitWeightKg: (v) => N.unitWeightKg(v),
  countryOfOrigin: (v) => N.originCountry(v),
};
const isRaw = (v: unknown) => v != null && !(typeof v === "string" && v.trim() === "");
const CARRIER = /(?:carrier\s*)?\b([abc])\b/i;

export function applyExtraction(prev: ConversationState, ex: Extraction, today: string): ApplyResult {
  const s = clone(prev);
  const out: ApplyResult = {
    state: s, changes: [], invalid: [], cascade: [], conflicts: [], readbacks: [], notes: [], ambiguous: null,
    confirmRequested: false, amberAcknowledged: false, describedItems: [], undone: false, startedOver: false,
  };
  const before = snapshotOf(prev);
  let snapshotTaken = false;
  const touch = () => { if (!snapshotTaken) { s.undoStack.push(before); if (s.undoStack.length > MAX_UNDO) s.undoStack.shift(); snapshotTaken = true; } };
  const touchedSources = new Set<string>(); // fields whose change can make booking totals stale

  /* intents that replace the whole state */
  if (ex.intent === "undo") { const u = undo(prev); return { ...out, state: u.state, undone: u.undone }; }
  if (ex.intent === "start_over") return { ...out, state: startOver(prev), startedOver: true };

  /* yes/no answers to what we asked */
  const pc = s.pendingConfirm;
  const yes = ex.yesNo ?? (ex.intent === "confirm" ? true : ex.intent === "reject" ? false : null);
  if (pc && yes != null) {
    s.pendingConfirm = null;
    if (pc.kind === "amber") { out.confirmRequested = yes; out.amberAcknowledged = yes; }
    else if (yes && pc.value != null) {
      touch();
      setValue(s, pc.field, pc.itemIndex, pc.value, "derived", out, touchedSources);
    } else if (!yes) s.declined.push(`${pc.field}:${pc.itemIndex ?? ""}`);
  } else if (ex.intent === "confirm" && !pc && !(s.pending?.kind === "confirm" || ["loop.moreItems", "dg", "deliveryAppointmentBooked", "item.sku", "prefs.requiredDeliveryDate", "prefs.appointmentDate", "prefs.highValueOrFragile", "prefs.maxBudgetGbp"].includes(s.pending?.field ?? ""))) {
    // "confirm" / "just book it" outside a yes/no question = a booking request (refused if RED/INCOMPLETE)
    out.confirmRequested = true;
  }

  const pendingField = s.pending?.field;
  /* yes/no answers to plain yes/no questions */
  if (yes != null && !pc) {
    if (pendingField === "loop.moreItems") {
      if (!yes) { if (s.itemLoopOpen) { touch(); s.itemLoopOpen = false; } }
      // "yes" → the next turn asks Q-08 for a new product (the item loop is still open)
      else if (s.items.length && s.items.every(itemComplete)) { touch(); s.items.push(newItem(s)); }
    } else if (pendingField === "dg" && s.pending?.itemIndex != null) {
      touch(); s.dgAnswers[s.pending.itemIndex] = yes;
      out.notes.push(yes ? `dg-yes:${s.pending.itemIndex}` : `dg-no:${s.pending.itemIndex}`);
    } else if (pendingField === "prefs.requiredDeliveryDate") {
      if (yes && !isRaw(ex.prefs.requiredDeliveryDate)) out.notes.push("ask-deadline-date"); // "yes" → ask which date
    } else if (pendingField === "prefs.appointmentDate") {
      if (yes && !isRaw(ex.prefs.appointmentDate)) out.notes.push("ask-appointment-date");
    } else if (pendingField === "prefs.highValueOrFragile") {
      touch(); s.prefs.highValueOrFragile = yes; out.changes.push({ field: LABEL.highValueOrFragile, from: "—", to: yes ? "yes" : "no" });
    } else if (pendingField === "deliveryAppointmentBooked" && ex.booking.deliveryAppointmentBooked == null) {
      ex.booking.deliveryAppointmentBooked = yes;
    } else if (pendingField === "item.sku" && !yes && s.pending?.itemIndex != null && s.items[s.pending.itemIndex] && !s.items[s.pending.itemIndex].sku) {
      autoSku(s, s.pending.itemIndex, out, touch);
    }
  }
  /* "I don't know" for the SKU → ITEM-n */
  if (pendingField === "item.sku" && s.pending?.itemIndex != null && ex.items.some((x) => x.sku != null && N.isUnknown(x.sku))) {
    ex.items = ex.items.map((x) => ({ ...x, sku: undefined }));
    autoSku(s, s.pending.itemIndex, out, touch);
  }

  /* booking fields */
  const bookingRaw = ex.booking as Partial<Record<BookingField, unknown>>;
  const statedCountry = isRaw(bookingRaw.destinationCountry);
  for (const f of BOOKING_FIELDS) {
    const raw = bookingRaw[f];
    if (f === "totalGrossWeightKg" && isRaw(raw) && N.isUnknown(raw)) { out.notes.push("gross-unknown"); continue; }
    if (!isRaw(raw) || f === "originCountry" || f === "currency") {
      if (f === "currency" && isRaw(raw) && !/^(gbp|£|pounds?|sterling|quid)$/i.test(String(raw).trim()))
        out.invalid.push({ field: "totalDeclaredValue", raw: String(raw), reason: "All prices need to be in GBP — what's the value in pounds?" });
      if (f === "originCountry" && isRaw(raw)) {
        const c = N.destinationCountry(raw);
        if (!/^(uk|u\.k\.|united kingdom|gb|great britain|britain|england|scotland|wales|northern ireland)$/i.test(String(raw).trim()))
          out.invalid.push({ field: "originCity", raw: String(raw), reason: `We only collect from the UK${c.ok ? "" : ""} — London, Manchester, Birmingham or Leeds.`, options: ["London", "Manchester", "Birmingham", "Leeds"] });
      }
      continue;
    }
    // a bare weekday answering the "next week could be any day from Monday DD-MM-YYYY…" question
    const weekOf = f === "readyToShipDate" && s.pending?.field === "readyToShipDate"
      ? [...s.history].reverse().find((t) => t.role === "assistant")?.text.match(/any day from Monday (\d{2})-(\d{2})-(\d{4})/) : null;
    const inWeek = weekOf ? N.weekdayInWeekOf(raw, `${weekOf[3]}-${weekOf[2]}-${weekOf[1]}`) : null;
    const norm = inWeek ? { ok: true as const, value: inWeek } : BOOKING_NORMALISERS[f]!(raw, today);
    if (!norm.ok) { out.invalid.push({ field: f, raw: String(raw), reason: norm.reason, options: norm.options }); continue; }
    if (setBooking(s, f, norm.value, out, touch)) {
      touchedSources.add(f);
      if (f === "readyToShipDate" && s.mode === "voice") out.readbacks.push(`That's ${fmt(f, norm.value)}.`);
      if (f === "destinationCity" && !statedCountry) {
        const c = N.countryForCity(norm.value as string);
        if (c && s.booking.destinationCountry !== c) { setBooking(s, "destinationCountry", c, out, touch, "derived"); }
      }
    }
  }
  if (ex.palletDelta && isNum(s.booking.pallets)) {
    setBooking(s, "pallets", Math.max(1, s.booking.pallets + ex.palletDelta), out, touch);
    touchedSources.add("pallets");
  } else if (ex.palletDelta && !isNum(s.booking.pallets)) {
    out.invalid.push({ field: "pallets", raw: String(ex.palletDelta), reason: "How many pallets is it on now?" });
  }

  /* items */
  for (const x of ex.items) {
    const hasAny = (Object.keys(ITEM_NORMALISERS) as ItemField[]).some((f) => isRaw(x[f]));
    if (!hasAny) continue;
    let idx = resolveItemRef(s, x.ref ?? "pending", x);
    if (typeof idx === "object") {
      const names = idx.ambiguous.map((i) => productName(s.items[i]));
      out.ambiguous = { text: `Which product — ${names.join(" or ")}?`, options: names };
      continue;
    }
    if (idx === "new") {
      // reuse an empty placeholder (after "yes, another product")
      const empty = s.items.findIndex((it) => (Object.keys(ITEM_NORMALISERS) as ItemField[]).every((f) => it[f] == null));
      touch();
      if (empty >= 0) idx = empty; else { s.items.push(newItem(s)); idx = s.items.length - 1; }
      s.itemLoopOpen = true;
    }
    for (const f of Object.keys(ITEM_NORMALISERS) as ItemField[]) {
      const raw = x[f];
      if (!isRaw(raw)) continue;
      if ((f === "hsCodeRaw" || f === "countryOfOrigin") && N.isUnknown(raw)) {
        markAsked(s, `${f === "hsCodeRaw" ? "Q-15" : "Q-16"}:${idx}`);
        out.notes.push(`unknown:${f}:${idx}`);
        continue;
      }
      if (f === "sku" && N.isUnknown(raw)) { autoSku(s, idx, out, touch); continue; }
      const norm = ITEM_NORMALISERS[f](raw);
      if (!norm.ok) { out.invalid.push({ field: `item.${f}`, itemIndex: idx, raw: String(raw), reason: norm.reason, options: norm.options }); continue; }
      if (setItem(s, idx, f, norm.value, "stated", out, touch)) {
        touchedSources.add(`item.${f}`);
        if (f === "description") out.describedItems.push(idx);
        if (f === "hsCodeRaw" && s.mode === "voice") out.readbacks.push(`HS code ${fmt(f, norm.value)}.`);
      }
    }
    cascadeItem(s, idx, out, touchedSources);
  }

  /* remove products */
  for (const ref of ex.removeItems) {
    const idx = resolveItemRef(s, ref);
    if (typeof idx !== "number") { if (typeof idx === "object") out.ambiguous = { text: `Which product should I remove — ${idx.ambiguous.map((i) => productName(s.items[i])).join(" or ")}?`, options: idx.ambiguous.map((i) => productName(s.items[i])) }; continue; }
    touch();
    const [gone] = s.items.splice(idx, 1);
    const dg: Record<number, boolean | null> = {};
    for (const [k, v] of Object.entries(s.dgAnswers)) { const i = Number(k); if (i < idx) dg[i] = v; else if (i > idx) dg[i - 1] = v; }
    s.dgAnswers = dg;
    out.changes.push({ field: "removed product", from: productName(gone), to: "—" });
    touchedSources.add("items");
    if (!s.items.length) s.itemLoopOpen = true;
  }

  /* preferences */
  const p = ex.prefs;
  const setPref = <K extends keyof RecommendationPrefs>(k: K, v: RecommendationPrefs[K]) => {
    if (JSON.stringify(s.prefs[k]) === JSON.stringify(v)) return;
    touch(); out.changes.push({ field: LABEL[k] ?? k, from: fmt(k, s.prefs[k]), to: fmt(k, v) }); s.prefs[k] = v;
  };
  for (const k of ["requiredDeliveryDate", "appointmentDate"] as const) {
    if (!isRaw(p[k])) continue;
    if (N.isUnknown(p[k]) || /^(no|none|nope|not really|n\/a|no (deadline|date|rush|slot|particular (date|day)))\b|^(any ?time|whenever)\b/i.test(String(p[k]).trim())) { markAsked(s, k); continue; }
    const d = N.date(p[k], today);
    if (d.ok) { setPref(k, d.value); out.readbacks.push(`${k === "requiredDeliveryDate" ? "Must arrive by" : "Slot on"} ${fmt(k, d.value)}.`); }
    else out.invalid.push({ field: `prefs.${k}`, raw: String(p[k]), reason: d.reason });
  }
  if (isRaw(p.maxBudgetGbp)) {
    if (/^no(ne)?$|no (budget|limit|max)/i.test(String(p.maxBudgetGbp))) markAsked(s, "maxBudgetGbp");
    else { const m = N.money(p.maxBudgetGbp); if (m.ok) setPref("maxBudgetGbp", m.value); else out.invalid.push({ field: "prefs.maxBudgetGbp", raw: String(p.maxBudgetGbp), reason: m.reason }); }
  }
  if (isRaw(p.highValueOrFragile)) { const y = N.yesNo(p.highValueOrFragile); if (y.ok) setPref("highValueOrFragile", y.value); }
  if (p.excludeCarriers?.length) {
    const letters = p.excludeCarriers.map((c) => c.match(CARRIER)?.[1]?.toUpperCase()).filter(Boolean).map((l) => `Carrier ${l}`);
    if (letters.length) setPref("excludeCarriers", letters);
  }

  /* carrier choice */
  if (ex.chosenCarrier) {
    const m = String(ex.chosenCarrier).match(CARRIER);
    const letter = (m?.[1]?.toUpperCase() ?? null) as CarrierLetter | null;
    if (letter && letter !== s.chosenCarrier) { touch(); out.changes.push({ field: "carrier", from: s.chosenCarrier ? `Carrier ${s.chosenCarrier}` : "recommended", to: `Carrier ${letter}` }); s.chosenCarrier = letter; }
  }

  /* booking totals: derived → recompute; stated → ask (RULEBOOK §10.1) */
  if ([...touchedSources].some((f) => f.startsWith("item.") || f === "items")) cascadeBooking(s, out, touchedSources);

  /* any change voids a confirmation */
  if (snapshotTaken && s.confirmed) { s.confirmed = null; out.notes.push("confirmation-voided"); }
  return out;
}

function markAsked(s: ConversationState, key: string) {
  if (!s.askedOnce.includes(key)) s.askedOnce.push(key);
}

function autoSku(s: ConversationState, idx: number, out: ApplyResult, touch: () => void) {
  if (!s.items[idx] || s.items[idx].sku) return;
  touch();
  const sku = `ITEM-${s.nextAutoSku++}`;
  s.items[idx].sku = sku; s.items[idx].prov.sku = "derived";
  out.changes.push({ field: `${productName(s.items[idx])}: SKU`, itemIndex: idx, from: "—", to: sku });
  out.notes.push(`auto-sku:${sku}`);
}

function setBooking(s: ConversationState, f: BookingField, v: unknown, out: ApplyResult, touch: () => void, prov: "stated" | "derived" = "stated"): boolean {
  const cur = s.booking[f];
  if (JSON.stringify(cur) === JSON.stringify(v)) { s.booking.provenance = { ...s.booking.provenance, [f]: s.booking.provenance?.[f] ?? prov }; return false; }
  touch();
  out.changes.push({ field: LABEL[f] ?? f, from: fmt(f, cur), to: fmt(f, v) });
  (s.booking as unknown as Record<string, unknown>)[f] = v;
  s.booking.provenance = { ...s.booking.provenance, [f]: prov };
  return true;
}

function setItem(s: ConversationState, i: number, f: ItemField, v: unknown, prov: "stated" | "derived", out: ApplyResult, touch: () => void): boolean {
  const it = s.items[i];
  if (JSON.stringify(it[f]) === JSON.stringify(v)) { it.prov[f] = it.prov[f] ?? prov; return false; }
  touch();
  if (f === "description" && it.description == null) out.changes.push({ field: "new product", itemIndex: i, from: "—", to: String(v) });
  else out.changes.push({ field: `${productName(it)}: ${ITEM_LABEL[f]}`, itemIndex: i, from: fmt(f, it[f]), to: fmt(f, v) });
  (it as unknown as Record<string, unknown>)[f] = v;
  it.prov[f] = prov;
  if (f === "description") delete s.dgAnswers[i];
  return true;
}

function setValue(s: ConversationState, field: string, itemIndex: number | undefined, value: number, prov: "derived", out: ApplyResult, touched: Set<string>) {
  const noTouch = () => undefined;
  if (field.startsWith("item.") && itemIndex != null && s.items[itemIndex]) {
    const f = field.slice(5) as ItemField;
    setItem(s, itemIndex, f, value, prov, out, noTouch);
    touched.add(field);
    cascadeItem(s, itemIndex, out, touched);
    cascadeBooking(s, out, touched);
  } else if ((BOOKING_FIELDS as readonly string[]).includes(field)) {
    setBooking(s, field as BookingField, value, out, noTouch, prov);
  }
}

/** Item-level cascade: derived dependents follow their inputs; stated ones are left for R-03 to judge. */
function cascadeItem(s: ConversationState, i: number, out: ApplyResult, touched: Set<string>) {
  const it = s.items[i];
  if (!it) return;
  const changed = (f: ItemField) => touched.has(`item.${f}`);
  if ((changed("quantity") || changed("unitsPerCarton")) && it.prov.cartons === "derived" && isNum(it.quantity) && isNum(it.unitsPerCarton)) {
    const exact = it.quantity % it.unitsPerCarton === 0 ? it.quantity / it.unitsPerCarton : null;
    if (exact != null && exact !== it.cartons) { out.cascade.push(`${productName(it)}: cartons ${it.cartons} → ${exact} (${it.quantity.toLocaleString("en-GB")} ÷ ${it.unitsPerCarton})`); it.cartons = exact; touched.add("item.cartons"); }
    else if (exact == null) { out.cascade.push(`${productName(it)}: ${it.quantity.toLocaleString("en-GB")} doesn't split evenly into cartons of ${it.unitsPerCarton}, so I've cleared the carton count`); it.cartons = null; delete it.prov.cartons; touched.add("item.cartons"); }
  }
  if ((changed("cartons") || changed("unitsPerCarton")) && it.prov.quantity === "derived" && isNum(it.cartons) && isNum(it.unitsPerCarton)) {
    const q = it.cartons * it.unitsPerCarton;
    if (q !== it.quantity) { out.cascade.push(`${productName(it)}: quantity ${it.quantity} → ${q} (${it.unitsPerCarton} × ${it.cartons})`); it.quantity = q; touched.add("item.quantity"); }
  }
}

/** Booking-level cascade for total cartons and declared value (QUESTIONS.md §6.3). */
function cascadeBooking(s: ConversationState, out: ApplyResult, touched: Set<string>) {
  if (!s.items.length || !s.items.every((it) => isNum(it.cartons))) return;
  const t = deriveBookingTotals(s.items);
  const b = s.booking;
  const cartonsTouched = [...touched].some((f) => f === "items" || f === "item.cartons");
  if (cartonsTouched && t.cartons != null && isNum(b.cartons) && b.cartons !== t.cartons) {
    if (b.provenance?.cartons === "derived") { out.cascade.push(`Total cartons ${b.cartons} → ${t.cartons} (sum of the products)`); b.cartons = t.cartons; }
    else out.conflicts.push({ field: "cartons", value: t.cartons, kind: "conflict", reason: `You told me ${b.cartons} cartons in total, but the products now add up to ${t.cartons}. Should I change the total to ${t.cartons}?` });
  }
  const valueTouched = [...touched].some((f) => f === "items" || f === "item.quantity" || f === "item.unitPrice");
  if (valueTouched && t.totalDeclaredValue != null && isNum(b.totalDeclaredValue) && b.totalDeclaredValue !== t.totalDeclaredValue) {
    const v = t.totalDeclaredValue;
    if (b.provenance?.totalDeclaredValue === "derived") { out.cascade.push(`Declared value ${fmt("totalDeclaredValue", b.totalDeclaredValue)} → ${fmt("totalDeclaredValue", v)} (sum of the products)`); b.totalDeclaredValue = v; }
    else out.conflicts.push({ field: "totalDeclaredValue", value: v, kind: "conflict", reason: `You told me the declared value is ${fmt("totalDeclaredValue", b.totalDeclaredValue)}, but the products now add up to ${fmt("totalDeclaredValue", v)}. Should the declared value become ${fmt("totalDeclaredValue", v)}?` });
  }
}

/** R-06 verdict of an item (definite / possible / none). */
export const dgVerdict = (it: ConvItem) => detectDangerousGoods({ ...it, bookingId: "" }).verdict;

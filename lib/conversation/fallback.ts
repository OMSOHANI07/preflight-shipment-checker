/**
 * Works without Gemini (timeout, 429, invalid JSON, no key): reads ONLY the field we last asked about,
 * with calculations.ts parsers, plus a few keywords (undo, start over, confirm, add a pallet, carrier,
 * remove). Also the fixed-wording reply built from the same FACTS Gemini would phrase.
 */
import { normaliseYesNo } from "@/lib/calculations";
import { emptyExtraction, type Extraction, type Pending } from "./types";

const BOOKING_PENDING = new Set([
  "sellerName", "originCity", "destinationCity", "destinationCountry", "destinationType", "readyToShipDate", "sellerPriority",
  "pallets", "cartons", "totalDeclaredValue", "totalGrossWeightKg", "deliveryAppointmentBooked",
]);

export function fallbackExtract(message: string, pending: Pending | null): Extraction {
  const ex = emptyExtraction();
  const t = message.trim();
  const low = t.toLowerCase();
  ex.intent = "provide";

  // keywords that work whatever we asked
  if (/^(undo|go back|undo that|undo the last change)\b/.test(low)) { ex.intent = "undo"; return ex; }
  if (/^(start over|start again|restart|reset|new booking)\b/.test(low)) { ex.intent = "start_over"; return ex; }
  if (/^(confirm|book it|confirm anyway|yes,? confirm|go ahead and book|just book it)\b/.test(low)) { ex.intent = "confirm"; ex.yesNo = true; return ex; }
  const deltaMatch = low.match(/\b(add|one more|another|extra)\s+(a\s+|one\s+)?pallet\b/) ? 1 : low.match(/\b(one (less|fewer) pallet|remove a pallet|drop a pallet)\b/) ? -1 : 0;
  if (deltaMatch) { ex.intent = "change"; ex.palletDelta = deltaMatch; return ex; }
  const usePallets = low.match(/\buse\s+(\d+)\s+pallets?\b|\b(\d+)\s+pallets?\b/);
  if (usePallets && pending?.field !== "item.cartons") { ex.intent = "change"; ex.booking.pallets = Number(usePallets[1] ?? usePallets[2]); return ex; }
  const carrier = low.match(/\b(?:switch to|go with|use|choose|pick)\s+carrier\s*([abc])\b|^carrier\s*([abc])$/);
  if (carrier) { ex.intent = "change"; ex.chosenCarrier = `Carrier ${(carrier[1] ?? carrier[2]).toUpperCase()}`; return ex; }
  const remove = low.match(/^(?:remove|drop|delete)\s+(?:the\s+)?(.+)$/);
  if (remove) { ex.intent = "change"; ex.removeItems = [pending?.itemIndex != null && /^(it|this|that)$/.test(remove[1]) ? pending.itemIndex : remove[1]]; return ex; }
  if (/^(description is wrong|wrong description)/.test(low)) { ex.intent = "other"; return ex; }

  const yn = normaliseYesNo(t.replace(/^(yes|yeah|yep),?\s.*$/i, "yes").replace(/^(no|nope),?\s.*$/i, "no"));
  if (!pending) { ex.intent = "other"; return ex; }
  const f = pending.field;

  if (f === "review") { if (yn === true) { ex.intent = "confirm"; ex.yesNo = true; } else if (yn === false) ex.intent = "reject"; else ex.intent = "other"; return ex; }
  const isConfirm = pending.kind === "confirm";
  if (["loop.moreItems", "dg", "prefs.highValueOrFragile"].includes(f) || isConfirm) {
    if (yn != null) { ex.yesNo = yn; ex.intent = yn ? "confirm" : "reject"; }
    else if (f === "dg" && /don'?t know|not sure|no idea/.test(low)) ex.yesNo = null;
    else if (f === "loop.moreItems" && t.length > 3) ex.items = [{ ref: "new", description: t }];
    // a number instead of "yes" for a derived value → the seller is stating it
    if (yn == null && isConfirm) {
      const field = pending.field;
      if (field.startsWith("item.")) ex.items = [{ ref: pending.itemIndex ?? "pending", [field.slice(5)]: t }];
      else (ex.booking as Record<string, unknown>)[field] = t;
    }
    return ex;
  }
  if (f.startsWith("prefs.")) {
    if (yn != null && (t.split(/\s+/).length <= 2 || /^(yes|no|nope)\b/i.test(t))) { ex.yesNo = yn; return ex; }
    (ex.prefs as Record<string, unknown>)[f.slice(6)] = t;
    return ex;
  }
  if (f.startsWith("item.")) {
    const field = f.slice(5);
    // keyword wins for carton maths answers ("1,020 units", "90 cartons", "10 per carton")
    const kw = low.match(/^([\d,.\s]+)\s*(units?|pcs|pieces)$/) ? "quantity" : low.match(/^([\d,.\s]+)\s*(per carton|a box|each)$/) ? "unitsPerCarton" : low.match(/^([\d,.\s]+)\s*cartons?$/) ? "cartons" : field;
    if (field === "sku" && yn === false) { ex.yesNo = false; return ex; }
    ex.items = [{ ref: pending.itemIndex ?? "pending", [kw]: kw === field ? t : t.replace(/[^\d.,]/g, "") }];
    return ex;
  }
  if (BOOKING_PENDING.has(f)) {
    if (f === "deliveryAppointmentBooked") { if (yn != null) { ex.booking.deliveryAppointmentBooked = yn; ex.yesNo = yn; } else if (/carry on|without|not yet/.test(low)) ex.booking.deliveryAppointmentBooked = false; else if (/booked/.test(low)) ex.booking.deliveryAppointmentBooked = true; return ex; }
    if (f === "cartons" && /^make it\s+/i.test(t)) { ex.booking.cartons = t.replace(/^make it\s+/i, ""); return ex; }
    if (f === "totalDeclaredValue" && /^use\s+/i.test(t)) { ex.booking.totalDeclaredValue = t.replace(/^use\s+/i, ""); return ex; }
    if (f === "destinationCountry" && /,\s*(germany|france|netherlands)$/i.test(t)) { ex.booking.destinationCountry = t.split(",").pop()!.trim(); return ex; }
    (ex.booking as Record<string, unknown>)[f] = t;
    return ex;
  }
  ex.intent = "other";
  return ex;
}

/** Short canned answers when the seller asks something and Gemini isn't available (F12). */
export function cannedAnswer(question: string): string | null {
  const q = question.toLowerCase();
  if (/hs code|commodity code|customs code/.test(q)) return "An HS code is the customs code that classifies a product; it needs at least 6 digits. You can look it up on the UK Trade Tariff (gov.uk/trade-tariff).";
  if (/gross weight/.test(q)) return "Gross weight is everything being shipped: the goods plus cartons and pallets.";
  if (/declared value/.test(q)) return "The declared value is the total value of the goods on your invoice — it must match quantity × unit price within 1%.";
  if (/pallet/.test(q) && /(heavy|weight|limit|max)/.test(q)) return "Carrier C takes up to 400 kg per pallet, Carrier A 500 kg and Carrier B 750 kg.";
  if (/(which|what) carriers?|carrier options/.test(q)) return "Three road services run on every route: Carrier A Road economy (cheapest, 5 working days), Carrier B Road standard (3 working days, heaviest pallets) and Carrier C Road express (fastest, 2 working days, most reliable).";
  if (/(appointment|slot)/.test(q)) return "A delivery appointment is a booked time slot at the receiving warehouse; warehouses often turn away trucks without one.";
  if (/country of origin|origin/.test(q)) return "Country of origin is where the product was made, not where it ships from.";
  return null;
}

/**
 * Deterministic safety net on top of Gemini: a "£5 each" / "£3.50 a piece" / "5 pounds per mug" unit
 * price that the model dropped is filled in (it reliably drops it in long lists). Only fills gaps.
 */
export function supplementExtraction(message: string, ex: Extraction, pending: Pending | null, readyKnown = true): Extraction {
  // a date with no "arrive by / deadline" wording, while the ready date is still unknown, is the ready date
  const due = ex.prefs.requiredDeliveryDate;
  if (!readyKnown && due != null && ex.booking.readyToShipDate == null && pending?.field !== "prefs.requiredDeliveryDate"
    && !/\b(arrive|arrives|arriving|deadline|there by|delivered by|deliver(ed)? by|need(s)? it by|latest|no rush|no deadline)\b/i.test(message)) {
    ex = { ...ex, booking: { ...ex.booking, readyToShipDate: due }, prefs: { ...ex.prefs, requiredDeliveryDate: undefined } };
  }
  // "HS 691200" / "HS code 6912.00" that the model dropped from a long message
  const hs = message.match(/\b(?:hs|commodity|customs)(?:\s*code)?\s*(?:is|:|=)?\s*(\d[\d.\s]{4,12}\d)\b/i);
  if (hs && !ex.items.some((x) => x.hsCodeRaw != null)) {
    if (ex.items.length) ex.items[0] = { ...ex.items[0], hsCodeRaw: hs[1].replace(/\s/g, "") };
    else if (pending?.field.startsWith("item.")) ex.items = [{ ref: pending.itemIndex ?? "pending", hsCodeRaw: hs[1].replace(/\s/g, "") }];
  }
  // labelled forms, e.g. a voice agent's summary: "Unit price £5. Unit weight half a kilo (0.5 kg)."
  const target = () => (ex.items.length ? 0 : pending?.field.startsWith("item.") ? (ex.items = [{ ref: pending.itemIndex ?? "pending" }], 0) : -1);
  const lp = message.match(/\bunit\s+price\s*(?:is|:|=|of)?\s*(£\s?\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s?(?:pounds?|gbp))/i);
  if (lp && !ex.items.some((x) => x.unitPrice != null)) { const k = target(); if (k >= 0) ex.items[k] = { ...ex.items[k], unitPrice: lp[1].trim() }; }
  const lw = message.match(/\bunit\s+weight\s*(?:is|:|=|of)?\s*((?:[^.;\n]|\.(?=\d))+?)(?:\.(?!\d)|;|\n|$)/i);
  if (lw && !ex.items.some((x) => x.unitWeightKg != null)) { const k = target(); if (k >= 0) ex.items[k] = { ...ex.items[k], unitWeightKg: lw[1].trim() }; }
  const m = message.match(/(£\s?\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s?(?:pounds?|quid|gbp))\s*(?:each|apiece|a piece|per (?:unit|item|piece|[a-z]+)|a (?:unit|piece|[a-z]+))\b/i);
  if (!m) return ex;
  const price = m[1].trim();
  if (ex.items.some((x) => x.unitPrice != null)) return ex;
  if (ex.items.length) ex.items[0] = { ...ex.items[0], unitPrice: price };
  else if (pending?.field.startsWith("item.")) ex.items = [{ ref: pending.itemIndex ?? "pending", unitPrice: price }];
  return ex;
}

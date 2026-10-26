/**
 * What changed in the rule results between two turns, keyed by rule + product position (not SKU, so
 * naming a product doesn't look like a fix). Only "real" rule failures count: missing data the
 * conversation simply hasn't asked for yet (V-xx, a blank HS code or origin not asked about) is not news.
 */
import type { BookingResult, Issue } from "@/lib/calculations";
import type { ConversationState } from "./types";

const key = (i: Issue) => `${i.code}#${i.itemIndex ?? ""}`;

export function newsworthy(s: ConversationState, r: BookingResult | null): Issue[] {
  if (!r) return [];
  return r.issues.filter((i) => {
    if (!(i.code.startsWith("R-") || i.code === "V-04")) return false;
    const it = i.itemIndex != null ? s.items[i.itemIndex] : undefined;
    if (i.code === "R-01" && it && it.hsCodeRaw == null) return false;
    if (i.code === "R-09" && it && it.countryOfOrigin == null && !s.askedOnce.includes(`Q-16:${i.itemIndex}`)) return false;
    return true;
  });
}

export function issueDelta(prevS: ConversationState, prev: BookingResult | null, curS: ConversationState, cur: BookingResult | null) {
  const before = newsworthy(prevS, prev), after = newsworthy(curS, cur);
  const bk = new Set(before.map(key)), ak = new Set(after.map(key));
  const label = (i: Issue) => `${i.code}${i.sku ? ` (${i.sku})` : ""}`;
  return {
    added: after.filter((i) => !bk.has(key(i))),
    fixed: [...new Set(before.filter((i) => !ak.has(key(i))).map(label))],
  };
}

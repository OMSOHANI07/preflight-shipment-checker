/** Which spreadsheet cells each issue points at (issue.fields + itemIndex), for highlighting. */
import type { Issue, Item } from "@/lib/calculations";
import { BOOKING_FIELD_BY_COLUMN, ITEM_FIELD_BY_COLUMN } from "@/lib/parseExcel";
import { SEV_RANK } from "@/lib/ui";

const BOOKING_FIELDS = new Set(Object.values(BOOKING_FIELD_BY_COLUMN));
const ITEM_FIELDS = new Set(Object.values(ITEM_FIELD_BY_COLUMN));
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Cell keys: "b:<field>" for the booking row, "i:<itemIndex>:<field>" for item rows. */
export function cellsForIssue(issue: Issue, items: Item[]): string[] {
  const out: string[] = [];
  const itemRows = issue.scope === "item"
    ? issue.itemIndex != null ? [issue.itemIndex] : items.map((it, i) => (issue.sku && it.sku === issue.sku ? i : -1)).filter((i) => i >= 0)
    : items.map((_, i) => i);
  for (const f of issue.fields) {
    if (issue.scope === "booking" && BOOKING_FIELDS.has(f)) out.push(`b:${f}`);
    else if (ITEM_FIELDS.has(f)) itemRows.forEach((i) => out.push(`i:${i}:${f}`));
  }
  return out;
}

export function cellIssueMap(issues: Issue[], items: Item[]): Map<string, Issue[]> {
  const m = new Map<string, Issue[]>();
  for (const iss of issues) for (const k of cellsForIssue(iss, items)) m.set(k, [...(m.get(k) ?? []), iss]);
  for (const [k, list] of m) m.set(k, [...list].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]));
  return m;
}

/** Map a header as written in the file to the Booking/Item field key. */
export function fieldForHeader(header: string, sheet: "booking" | "item"): string | null {
  const map = sheet === "booking" ? BOOKING_FIELD_BY_COLUMN : ITEM_FIELD_BY_COLUMN;
  const hit = Object.keys(map).find((k) => norm(k) === norm(header));
  return hit ? map[hit] : null;
}

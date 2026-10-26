/** Read-backs for voice (always) and chat (derived / ambiguous values): RULEBOOK §8.3, QUESTIONS §1.7. */
import { formatDDMMYYYY, gbp, isNum, weekdayName } from "@/lib/calculations";

/** 1080 → "1,080" (decimals kept as given, max 3). */
export const readNumber = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 3 });
/** "2026-11-05" → "Thursday 05-11-2026". */
export const readDate = (iso: string | null) => (iso ? `${weekdayName(iso)} ${formatDDMMYYYY(iso)}` : "—");
/** 5.5 → "£5.50". */
export const readMoney = (n: number | null) => gbp(n);
/** "691200" → "69-12-00" (pairs, as customs officers read them). */
export const readHs = (digits: string) => (digits.match(/.{1,2}/g) ?? []).join("-");

const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", o: "0", nought: "0", nil: "0", one: "1", two: "2", to: "2", too: "2", three: "3", four: "4", for: "4",
  five: "5", six: "6", seven: "7", eight: "8", ate: "8", nine: "9",
};
const REPEAT: Record<string, number> = { double: 2, triple: 3 };

/**
 * Spoken HS code → digits: "six nine one two oh oh" → "691200", "six nine one two double zero" → "691200",
 * "69 12 00" → "691200". Returns null when it isn't a spoken digit sequence.
 */
export function spokenDigits(text: string): string | null {
  const t = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/-/g, " ").trim();
  if (!t) return null;
  if (/^[\d\s]+$/.test(t)) return t.replace(/\s+/g, "");
  let out = "", rep = 1, words = 0;
  for (const w of t.split(/\s+/)) {
    if (w in REPEAT) { rep = REPEAT[w]; continue; }
    if (/^\d+$/.test(w)) { out += w.repeat(rep === 1 ? 1 : rep); rep = 1; words++; continue; }
    if (w in DIGIT_WORDS) { out += DIGIT_WORDS[w].repeat(rep); rep = 1; words++; continue; }
    if (w === "and" || w === "is" || w === "its" || w === "it's" || w === "the" || w === "code") continue;
    return null;
  }
  return words ? out : null;
}

/** Short read-back of a stored value, by field. */
export function readBack(field: string, value: unknown): string | null {
  if (value == null) return null;
  if (field === "readyToShipDate" || field.endsWith("Date")) return readDate(String(value));
  if (field === "hsCodeRaw") return readHs(String(value).replace(/\D/g, ""));
  if (field === "unitPrice" || field === "totalDeclaredValue" || field === "maxBudgetGbp") return isNum(value) ? readMoney(value) : null;
  if (field === "unitWeightKg" || field === "totalGrossWeightKg") return isNum(value) ? `${readNumber(value)} kg` : null;
  if (isNum(value)) return readNumber(value);
  return null;
}

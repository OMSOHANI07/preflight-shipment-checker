/**
 * Turns one raw value (from Gemini or the regex fallback) into the value calculations.ts would store,
 * using only calculations.ts parsers. Anything unreadable or outside the allowed lists is NOT stored:
 * it comes back as { ok: false, reason, options } so the assistant re-asks (QUESTIONS.md "If invalid").
 */
import {
  CITY_TO_COUNTRY, DESTINATION_CITIES, DESTINATION_COUNTRIES, ITEM_ORIGIN_COUNTRIES, ORIGIN_CITIES, PRIORITIES,
  addCalendarDays, formatDDMMYYYY, isNum, nextWorkingDay, normaliseCity, normaliseCountry, normaliseDestinationType,
  normaliseHs, normalisePriority, normaliseYesNo, parseDate, parseNumber, parseSpokenDate, round, todayISO, weekdayName,
  type DestinationCountry,
} from "@/lib/calculations";
import { spokenDigits } from "./readback";

export type Norm<T> = { ok: true; value: T } | { ok: false; reason: string; options?: string[] };
const fail = (reason: string, options?: string[]): { ok: false; reason: string; options?: string[] } => ({ ok: false, reason, options });
const ok = <T,>(value: T): Norm<T> => ({ ok: true, value });

const DEST_CITIES = Object.values(DESTINATION_CITIES).flat();
const s = (v: unknown) => (v == null ? "" : String(v).trim());

export function text(v: unknown): Norm<string> {
  const t = s(v);
  return t ? ok(t.slice(0, 300)) : fail("I didn't catch that.");
}

export function originCity(v: unknown): Norm<string> {
  const c = normaliseCity(v);
  if (c && (ORIGIN_CITIES as readonly string[]).includes(c)) return ok(c);
  return fail(`We collect from London, Manchester, Birmingham or Leeds only${c ? ` — not ${c}` : ""}. Which is closest to the goods?`, [...ORIGIN_CITIES]);
}

export function destinationCity(v: unknown): Norm<string> {
  const c = normaliseCity(v);
  if (c && DEST_CITIES.includes(c)) return ok(c);
  return fail(`We deliver to Berlin, Frankfurt or Hamburg in Germany, Paris or Lyon in France, and Amsterdam or Rotterdam in the Netherlands${c ? ` — not ${c}` : ""}. Which one?`, DEST_CITIES);
}

export function destinationCountry(v: unknown): Norm<DestinationCountry> {
  const c = normaliseCountry(v);
  if (c && (DESTINATION_COUNTRIES as readonly string[]).includes(c)) return ok(c as DestinationCountry);
  return fail(`We only ship to Germany, France or the Netherlands${c ? ` — not ${c}` : ""}.`, [...DESTINATION_COUNTRIES]);
}

/** Country inferred from a destination city (never asked when the city is known). */
export const countryForCity = (city: string): DestinationCountry | null => {
  const c = CITY_TO_COUNTRY[city];
  return c && c !== "United Kingdom" ? c : null;
};

export function destinationType(v: unknown): Norm<"Warehouse" | "Business address"> {
  const t = normaliseDestinationType(v);
  return t ? ok(t) : fail("Just to check — is it a warehouse or a business address?", ["Warehouse", "Business address"]);
}

export function priority(v: unknown): Norm<(typeof PRIORITIES)[number]> {
  const p = normalisePriority(v);
  return p ? ok(p) : fail("Pick one: cheapest, fastest, most reliable, or balanced.", [...PRIORITIES]);
}

export function yesNo(v: unknown): Norm<boolean> {
  const y = normaliseYesNo(v);
  return y == null ? fail("Is that a yes or a no?", ["Yes", "No"]) : ok(y);
}

const ORD_UNITS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };
const ORD_TEENS: Record<string, number> = { tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
/** "the twenty first of November" → "21 november" (spoken ordinals). */
export function spokenOrdinals(t: string): string {
  return t
    .replace(/\b(twenty|thirty)[\s-]+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/g, (_, tens, u) => String((tens === "twenty" ? 20 : 30) + ORD_UNITS[u]))
    .replace(/\b(tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\b/g, (w) => String(ORD_TEENS[w]))
    .replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b(?=\s+(of\s+)?[a-z])/g, (w) => String(ORD_UNITS[w]));
}

/** Dates: DD-MM-YYYY, Excel serials, "tomorrow", "next Friday", "5th of November". Vague phrases → ask for the exact day. */
export function date(v: unknown, today: string = todayISO()): Norm<string> {
  const t = s(v).toLowerCase();
  if (!t) return fail("Sorry, I didn't catch the date — could you give it as day, month and year?");
  const monday = (iso: string) => { let d = iso; while (weekdayName(d) !== "Monday") d = addCalendarDays(d, 1); return d; };
  if (/\b(next|this|coming) week\b/.test(t)) {
    const start = t.includes("this") ? nextWorkingDay(today) : monday(addCalendarDays(today, 1));
    return fail(`"${s(v)}" could be any day from ${weekdayName(start)} ${formatDDMMYYYY(start)} to Friday ${formatDDMMYYYY(addCalendarDays(start, 4 - ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].indexOf(weekdayName(start))))} — which day exactly?`);
  }
  if (/\b(end of (the )?month|later|soon|asap|sometime|early|mid|end of next)\b/.test(t)) return fail(`"${s(v)}" isn't a specific day — what exact date will the goods be ready?`);
  // "Thursday 5th November", "on Thu, the fifth of November 2026" → "5 november 2026"
  const spoken = spokenOrdinals(t).replace(/^(on|by|for)\s+/, "")
    .replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+(?=(the\s+)?\d)/, "")
    .replace(/^the\s+/, "").replace(/\s+of\s+/g, " ").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const iso = (isNum(v) ? parseDate(v) : null) ?? parseDate(s(v)) ?? parseSpokenDate(spoken, today);
  return iso ? ok(iso) : fail("Sorry, I didn't catch the date — could you give it as day, month and year?");
}

/** "Thursday" answering "next week could be any day from Monday … — which day?" → that week's Thursday. */
export function weekdayInWeekOf(v: unknown, monday: string): string | null {
  const m = s(v).toLowerCase().replace(/^(on|the)\s+/, "").match(/^(mon|tue|wed|thu|fri)[a-z]*$/);
  return m ? addCalendarDays(monday, ["mon", "tue", "wed", "thu", "fri"].indexOf(m[1])) : null;
}

const NON_GBP = /€|\$|\beur(o|os)?\b|\busd\b|\bdollars?\b|\brupees?\b|\binr\b|\byen\b|\byuan\b|\brmb\b/i;

/** Money in GBP. Other currencies are never converted — we ask for pounds. */
export function money(v: unknown): Norm<number> {
  if (NON_GBP.test(s(v))) return fail("All prices need to be in GBP — what's the price in pounds?");
  const n = parseNumber(s(v).toLowerCase().replace(EACH, ""));
  if (n == null) return fail("I couldn't read that amount — what is it in pounds, e.g. 5.50?");
  if (!(n > 0)) return fail("The price has to be more than £0 — what is it in pounds?");
  return ok(round(n, 2));
}

/** Whole number ≥ 1 (units, units per carton, cartons, pallets). */
export function wholeNumber(v: unknown, what = "number"): Norm<number> {
  // "12 a box", "1,080 units", "90 cartons" → the leading number
  const unit = s(v).toLowerCase().match(/^(.+?)\s*(?:units?|pcs|pieces|items|each|a box|per box|in a box|per carton|a carton|to a carton|in each(?: carton| box)?|cartons?|boxes|box|pallets?)$/);
  const n = parseNumber(unit ? unit[1] : v);
  if (n == null) return fail(`I couldn't read that — how many ${what}?`);
  if (!Number.isInteger(n) || n < 1) return fail(`That has to be a whole number of ${what} (1 or more) — how many?`);
  return ok(n);
}

/** Unit weight in kg; grams, "half a kilo", pounds are converted. */
const EACH = /\s*(each|apiece|a piece|per (unit|item|piece|one)|a unit|for one)$/;

export function unitWeightKg(v: unknown): Norm<number> {
  const t = s(v).toLowerCase().replace(EACH, "");
  if (/^(half|a half)( a)? (kilo|kg|kilogram)s?$/.test(t)) return ok(0.5);
  if (/^(a )?quarter( of)?( a)? (kilo|kg)s?$/.test(t)) return ok(0.25);
  const m = t.match(/^(.+?)\s*(g|gram|grams|gm|gms)$/);
  if (m) { const n = parseNumber(m[1]); return n != null && n > 0 ? ok(round(n / 1000, 6)) : fail("How much does one unit weigh, in kg or grams?"); }
  const lb = t.match(/^(.+?)\s*(lb|lbs|pounds?)$/);
  if (lb && /lb/.test(lb[2])) { const n = parseNumber(lb[1]); return n != null && n > 0 ? ok(round(n * 0.45359237, 3)) : fail("How much does one unit weigh, in kg?"); }
  const n = parseNumber(t);
  if (n == null || !(n > 0)) return fail("How much does one unit weigh, in kg? (grams is fine too)");
  return ok(n);
}

/** Gross weight in kg; tonnes ×1000. An estimate is fine (the seller can correct it later). */
export function grossKg(v: unknown): Norm<number> {
  const t = s(v).toLowerCase().replace(/^(about|around|roughly|approx\.?|approximately|~)\s*/, "");
  const m = t.match(/^(.+?)\s*(t|tonnes?|tons?)$/);
  if (m) { const n = parseNumber(m[1]); return n != null && n > 0 ? ok(round(n * 1000, 3)) : fail("What's the total weight in kg?"); }
  const n = parseNumber(t);
  if (n == null || !(n > 0)) return fail("What's the total gross weight in kg — goods plus cartons and pallets?");
  return ok(n);
}

/** HS code: kept as digits text (never guessed). Spoken digits ("six nine one two oh oh") are mapped first. */
export function hsCode(v: unknown): Norm<string | number> {
  if (isNum(v)) return ok(v);
  const t = s(v);
  if (!t) return fail("What's the HS code? It should be at least 6 digits.");
  const spoken = spokenDigits(t);
  const candidate = spoken ?? t;
  const hs = normaliseHs(candidate);
  if (!hs.digits || hs.nonDigitChars) return fail("An HS code is digits only, at least 6 — do you have it? If not, say \"don't know\".");
  return ok(hs.digits);
}

export function originCountry(v: unknown): Norm<string> {
  const c = normaliseCountry(v);
  if (c && (ITEM_ORIGIN_COUNTRIES as readonly string[]).includes(c)) return ok(c);
  return fail(`For this service the country of origin must be one of: UK, China, India, Vietnam, Turkey or Germany${c ? ` — not ${c}` : ""}.`, ["United Kingdom", "China", "India", "Vietnam", "Turkey", "Germany"]);
}

/** "don't know" / "no idea" / "not sure" — for optional fields that may stay blank. */
export const isUnknown = (v: unknown) => /^(i )?(don'?t|do not) know|no idea|not sure|unknown|dunno|n\/a|skip|no$/i.test(s(v));

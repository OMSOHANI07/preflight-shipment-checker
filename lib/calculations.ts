/**
 * ============================================================================
 *  PRE-FLIGHT SHIPMENT CHECKER — calculations.ts
 *  Single source of truth for every number, rule check and recommendation.
 * ============================================================================
 *
 *  READ ME FIRST (for Claude Code)
 *  - Everything here is PURE and DETERMINISTIC. No network, no LLM, no DB.
 *  - Gemini NEVER computes or decides pass/fail. It only (a) extracts fields
 *    from chat/voice into the Booking/Item shapes below, (b) gives a second
 *    opinion on R-06 when detectDangerousGoods() returns "possible", and
 *    (c) writes plain-English text FROM the BookingResult this file returns.
 *  - Same function is used for file upload, chat and voice: runAll().
 *  - On ANY change (mid-conversation or edited row) call runAll() again on the
 *    full updated booking, then diffResults(before, after) to show what changed.
 *  - Companion documents: RULEBOOK.md, CALCULATIONS_FORMULAS.pdf,
 *    RECOMMENDATION_RULES.md, QUESTIONS.md.
 *
 *  Sections
 *   0. Config (all tunable numbers live here)
 *   1. Fixed reference data (Sheet 3 carriers, Sheet 4 rules, allowed values)
 *   2. Types
 *   3. Number / money / date helpers
 *   4. Input normalisation (Excel, chat and voice all pass through these)
 *   5. Input validation (V-xx data-quality rules)
 *   6. Item-level calculations
 *   7. Booking-level calculations
 *   8. Carrier calculations (cost, ETA, eligibility)
 *   9. Official rules R-01 … R-10
 *  10. Advisory checks A-xx (UK export invoice guidance; never change status)
 *  11. Status aggregation
 *  12. Recommendation engine
 *  13. runAll() — the one entry point
 *  14. diffResults() — what changed after a mid-way edit
 * ============================================================================
 */

/* ========================================================================== */
/* 0. CONFIG                                                                   */
/* ========================================================================== */

export const CONFIG = {
  /** R-02 tolerance: |declared − computed| must be ≤ this % of computed. */
  VALUE_TOLERANCE_PCT: 1,
  /** R-01 minimum HS code digits. */
  HS_MIN_DIGITS: 6,
  /**
   * Excel stores HS codes typed in a Number column without leading zeros
   * (090111 → 90111). If true, a 5-digit NUMERIC cell is zero-padded to 6
   * digits before R-01. Default false = report R-01 Red but say a leading zero
   * may have been lost.
   */
  HS_PAD_5_DIGIT_NUMERIC: false,
  /** "business" = Mon–Fri only (no bank holidays). "calendar" = every day. */
  TRANSIT_DAY_MODE: "business" as "business" | "calendar",
  /** If ready date falls on Sat/Sun, collection moves to next Monday (business mode). */
  COLLECT_NEXT_WORKING_DAY_IF_WEEKEND: true,
  /** All "today" logic uses UK time because every shipment starts in the UK. */
  TIMEZONE: "Europe/London",
  /**
   * Which carrier R-05 is checked against when the seller has not picked one:
   *  "priority_pick" = the carrier the seller's priority would choose if weight
   *                    were ignored (surfaces the problem; recommended default)
   *  "recommended"   = the best ELIGIBLE carrier (R-05 only fails if no carrier fits)
   */
  R05_MODE: "priority_pick" as "priority_pick" | "recommended",
  /** Balanced priority weights (must sum to 1). */
  BALANCED_WEIGHTS: { cost: 0.4, speed: 0.3, reliability: 0.3 },
  /** Advisory A-03: an empty pallet + wrap usually weighs at least this (kg). */
  MIN_TARE_PER_PALLET_KG: 15,
  /** Advisory A-01: descriptions shorter than this many characters look vague. */
  MIN_DESCRIPTION_CHARS: 8,
  /** Money is compared in pence to avoid floating-point errors. */
  MONEY_DP: 2,
} as const;

/* ========================================================================== */
/* 1. FIXED REFERENCE DATA                                                     */
/* ========================================================================== */

export const ORIGIN_COUNTRIES = ["United Kingdom"] as const;
export const ORIGIN_CITIES = ["London", "Manchester", "Birmingham", "Leeds"] as const;
export const DESTINATION_COUNTRIES = ["Germany", "France", "Netherlands"] as const;
export const DESTINATION_CITIES: Record<DestinationCountry, readonly string[]> = {
  Germany: ["Berlin", "Frankfurt", "Hamburg"],
  France: ["Paris", "Lyon"],
  Netherlands: ["Amsterdam", "Rotterdam"],
};
export const CURRENCIES = ["GBP"] as const;
export const ITEM_ORIGIN_COUNTRIES = [
  "United Kingdom", "China", "India", "Vietnam", "Turkey", "Germany",
] as const;
export const DESTINATION_TYPES = ["Warehouse", "Business address"] as const;
export const PRIORITIES = ["Cheapest", "Fastest", "Most reliable", "Balanced"] as const;

/** Sheet 3 — Carrier options. FIXED. Do not edit. */
export const CARRIERS: readonly Carrier[] = [
  { id: "A-DE", carrier: "Carrier A", service: "Road economy",  originCountry: "United Kingdom", destinationCountry: "Germany",     pricePerPallet: 180, currency: "GBP", transitDays: 5, onTimePct: 92, maxKgPerPallet: 500 },
  { id: "B-DE", carrier: "Carrier B", service: "Road standard", originCountry: "United Kingdom", destinationCountry: "Germany",     pricePerPallet: 220, currency: "GBP", transitDays: 3, onTimePct: 95, maxKgPerPallet: 750 },
  { id: "C-DE", carrier: "Carrier C", service: "Road express",  originCountry: "United Kingdom", destinationCountry: "Germany",     pricePerPallet: 340, currency: "GBP", transitDays: 2, onTimePct: 98, maxKgPerPallet: 400 },
  { id: "A-FR", carrier: "Carrier A", service: "Road economy",  originCountry: "United Kingdom", destinationCountry: "France",      pricePerPallet: 170, currency: "GBP", transitDays: 5, onTimePct: 92, maxKgPerPallet: 500 },
  { id: "B-FR", carrier: "Carrier B", service: "Road standard", originCountry: "United Kingdom", destinationCountry: "France",      pricePerPallet: 210, currency: "GBP", transitDays: 3, onTimePct: 95, maxKgPerPallet: 750 },
  { id: "C-FR", carrier: "Carrier C", service: "Road express",  originCountry: "United Kingdom", destinationCountry: "France",      pricePerPallet: 330, currency: "GBP", transitDays: 2, onTimePct: 98, maxKgPerPallet: 400 },
  { id: "A-NL", carrier: "Carrier A", service: "Road economy",  originCountry: "United Kingdom", destinationCountry: "Netherlands", pricePerPallet: 160, currency: "GBP", transitDays: 5, onTimePct: 92, maxKgPerPallet: 500 },
  { id: "B-NL", carrier: "Carrier B", service: "Road standard", originCountry: "United Kingdom", destinationCountry: "Netherlands", pricePerPallet: 200, currency: "GBP", transitDays: 3, onTimePct: 95, maxKgPerPallet: 750 },
  { id: "C-NL", carrier: "Carrier C", service: "Road express",  originCountry: "United Kingdom", destinationCountry: "Netherlands", pricePerPallet: 320, currency: "GBP", transitDays: 2, onTimePct: 98, maxKgPerPallet: 400 },
];

/** Sheet 4 — Rulebook. FIXED. Do not edit. */
export const RULES: Record<RuleId, { text: string; severity: "Red" | "Amber" }> = {
  "R-01": { text: "Every item must have an HS code of at least 6 digits", severity: "Red" },
  "R-02": { text: "Total declared value must equal the sum of quantity × unit price across all items (within 1%)", severity: "Red" },
  "R-03": { text: "For each item, units per carton × cartons must equal quantity", severity: "Red" },
  "R-04": { text: "Total cartons on the booking must equal the sum of cartons across all items", severity: "Red" },
  "R-05": { text: "Weight per pallet (total gross weight ÷ pallets) must not exceed the chosen carrier's max weight per pallet", severity: "Red" },
  "R-06": { text: "No lithium batteries, aerosols or flammable liquids", severity: "Red" },
  "R-07": { text: "Total gross weight must be at least the sum of unit weight × quantity across all items", severity: "Amber" },
  "R-08": { text: "Shipments to a warehouse must have a delivery appointment booked", severity: "Amber" },
  "R-09": { text: "Every item must have a country of origin", severity: "Amber" },
  "R-10": { text: "Ready to ship date must not be in the past", severity: "Amber" },
};

/* ========================================================================== */
/* 2. TYPES                                                                    */
/* ========================================================================== */

export type DestinationCountry = (typeof DESTINATION_COUNTRIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type DestinationType = (typeof DESTINATION_TYPES)[number];
export type RuleId = "R-01" | "R-02" | "R-03" | "R-04" | "R-05" | "R-06" | "R-07" | "R-08" | "R-09" | "R-10";
export type Severity = "Red" | "Amber" | "Advisory" | "Data";
export type BookingStatus = "RED" | "INCOMPLETE" | "AMBER" | "GREEN";
export type InputSource = "excel" | "chat" | "voice";

export interface Carrier {
  id: string; carrier: string; service: string;
  originCountry: string; destinationCountry: DestinationCountry;
  pricePerPallet: number; currency: "GBP";
  transitDays: number; onTimePct: number; maxKgPerPallet: number;
}

/** Sheet 1 row (after normalisation). null = not provided yet. */
export interface Booking {
  bookingId: string;
  sellerName: string | null;
  originCity: string | null;
  originCountry: string | null;
  destinationCity: string | null;
  destinationCountry: DestinationCountry | null;
  destinationType: DestinationType | null;
  readyToShipDate: string | null; // ISO "YYYY-MM-DD"
  sellerPriority: Priority | null;
  pallets: number | null;
  cartons: number | null; // as stated by seller
  totalDeclaredValue: number | null; // as stated by seller, GBP
  currency: string | null;
  totalGrossWeightKg: number | null; // as stated by seller
  deliveryAppointmentBooked: boolean | null;
  /** Optional extras collected in chat/voice for better recommendations. */
  prefs?: RecommendationPrefs;
  /** Carrier the seller explicitly chose (chat "go with Carrier B"). */
  chosenCarrierId?: string | null;
  /** Where each value came from: "stated" by seller, or "derived" by us and confirmed. */
  provenance?: Partial<Record<keyof Booking, "stated" | "derived" | "default">>;
}

/** Sheet 2 row (after normalisation). */
export interface Item {
  bookingId: string;
  rowRef?: string; // e.g. "Items!row 7" for highlighting
  sku: string | null;
  description: string | null;
  hsCodeRaw: string | number | null; // exactly as received
  quantity: number | null;
  unitPrice: number | null;
  unitsPerCarton: number | null;
  cartons: number | null;
  unitWeightKg: number | null;
  countryOfOrigin: string | null;
}

export interface RecommendationPrefs {
  /** Goods must arrive on or before this date (ISO). Hard constraint. */
  requiredDeliveryDate?: string | null;
  /** Booked delivery appointment date at the receiver (ISO). Hard constraint: arrive on/before. */
  appointmentDate?: string | null;
  /** Max freight spend in GBP. Hard constraint. */
  maxBudgetGbp?: number | null;
  /** Goods are fragile / high value / time-critical → reliability bias in Balanced. */
  highValueOrFragile?: boolean | null;
  /** Seller wants to avoid a specific carrier. */
  excludeCarriers?: string[] | null;
}

export interface Issue {
  code: RuleId | string; // R-xx, V-xx or A-xx
  severity: Severity;
  scope: "booking" | "item";
  itemIndex?: number;
  sku?: string | null;
  fields: string[]; // columns to highlight
  title: string;
  whatIsWrong: string; // includes the numbers
  howToFix: string[]; // 1+ concrete options
  numbers?: Record<string, number | string | null>;
}

export interface CarrierEval {
  carrier: Carrier;
  cost: number | null;
  costPerKg: number | null;
  costPerUnit: number | null;
  collectionDate: string | null;
  etaDate: string | null;
  weightPerPallet: number | null;
  fitsWeight: boolean | null;
  minPalletsForThisCarrier: number | null;
  costIfRepalletised: number | null;
  meetsDeadline: boolean | null;
  withinBudget: boolean | null;
  excludedBySeller: boolean;
  eligible: boolean;
  ineligibleReasons: string[];
  score: number | null; // Balanced score 0–1 (only meaningful among eligible)
}

export interface Recommendation {
  priority: Priority | null;
  priorityPick: CarrierEval | null; // best by priority ignoring weight
  recommended: CarrierEval | null; // best eligible
  runnerUp: CarrierEval | null;
  allOptions: CarrierEval[];
  noEligibleCarrier: boolean;
  fallbackReason: string | null;
  label: "Recommended" | "Recommended once fixed" | "No carrier fits";
  reasonFacts: string[]; // facts for Gemini to phrase; never invent others
}

export interface BookingResult {
  bookingId: string;
  status: BookingStatus;
  canConfirm: boolean;
  needsAmberAcknowledgement: boolean;
  issues: Issue[]; // sorted: Red, Data, Amber, Advisory
  ruleResults: Record<RuleId, "pass" | "fail" | "not_evaluable">;
  totals: BookingTotals;
  recommendation: Recommendation;
  checkedAgainstDate: string; // ISO "today" used for R-10
  missingFields: string[];
}

export interface BookingTotals {
  itemCount: number;
  sumUnits: number | null;
  sumItemValue: number | null;
  sumItemCartons: number | null;
  sumNetWeightKg: number | null;
  declaredValueDiff: number | null;
  declaredValueDiffPct: number | null;
  cartonsDiff: number | null;
  weightPerPalletKg: number | null;
  packagingWeightKg: number | null;
  avgCartonsPerPallet: number | null;
  avgUnitValue: number | null;
}

/* ========================================================================== */
/* 3. NUMBER / MONEY / DATE HELPERS                                            */
/* ========================================================================== */

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const round = (n: number, dp = 2) => Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;
export const toPence = (gbp: number) => Math.round(gbp * 100);
export const fromPence = (p: number) => p / 100;
export const gbp = (n: number | null | undefined) =>
  isNum(n) ? "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
export const kg = (n: number | null | undefined) => (isNum(n) ? `${round(n, 2).toLocaleString("en-GB")} kg` : "—");
export const isPositiveInt = (n: unknown) => isNum(n) && Number.isInteger(n) && n > 0;
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Sum money exactly (in pence). */
export const sumMoney = (xs: number[]) => fromPence(sum(xs.map(toPence)));

// ---- Dates: internally always ISO "YYYY-MM-DD", treated as UTC midnight ----
const pad2 = (n: number) => String(n).padStart(2, "0");
export const isoFromParts = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const toUTC = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUTC = (dt: Date) => isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
export const formatDDMMYYYY = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
};
export const weekdayName = (iso: string) =>
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][toUTC(iso).getUTCDay()];
export const isWeekend = (iso: string) => [0, 6].includes(toUTC(iso).getUTCDay());

/** Today's date in UK time, ISO. Pass `now` in tests. */
export function todayISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CONFIG.TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return isoFromParts(get("year"), get("month"), get("day"));
}

export const addCalendarDays = (iso: string, n: number) => {
  const dt = toUTC(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
};
export function addBusinessDays(iso: string, n: number) {
  let cur = iso;
  let added = 0;
  while (added < n) {
    cur = addCalendarDays(cur, 1);
    if (!isWeekend(cur)) added++;
  }
  return cur;
}
export const nextWorkingDay = (iso: string) => {
  let cur = iso;
  while (isWeekend(cur)) cur = addCalendarDays(cur, 1);
  return cur;
};
/** Whole days b − a (positive if b is later). */
export const daysBetween = (a: string, b: string) =>
  Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
export const isBefore = (a: string, b: string) => daysBetween(a, b) > 0;

/**
 * Parse a date from Excel / chat / voice.
 * Accepts: "05-11-2026", "05/11/2026", "5.11.2026", "2026-11-05",
 * Excel serial numbers (46331), JS Date objects.
 * UK order (DD-MM) is ALWAYS assumed for ambiguous numeric dates.
 * Relative words ("tomorrow", "next Tuesday", "5th of November") are resolved
 * by parseSpokenDate(); always read the resolved date back to the seller.
 */
export function parseDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return isoFromParts(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  if (isNum(raw)) {
    // Excel serial: day 1 = 1900-01-01, with the 1900 leap-year bug → epoch 1899-12-30
    if (raw > 20000 && raw < 80000) return addCalendarDays("1899-12-30", Math.floor(raw));
    return null;
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validIso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return validIso(y, +m[2], +m[1]);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return parseDate(Number(s));
  return parseSpokenDate(s);
}
function validIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = isoFromParts(y, m, d);
  return fromUTC(toUTC(iso)) === iso ? iso : null; // rejects 31-02
}

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const WEEKDAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
/** "tomorrow", "today", "next friday", "friday", "5th november", "november 5", "in 3 days". */
export function parseSpokenDate(text: string, today: string = todayISO()): string | null {
  const t = text.toLowerCase().replace(/(\d+)(st|nd|rd|th)/g, "$1").replace(/[,]/g, " ").replace(/\bof\b/g, " ").replace(/\s+/g, " ").trim();
  if (t === "today") return today;
  if (t === "tomorrow") return addCalendarDays(today, 1);
  if (t === "day after tomorrow") return addCalendarDays(today, 2);
  let m = t.match(/^in (\d+) (day|days|week|weeks)$/);
  if (m) return addCalendarDays(today, +m[1] * (m[2].startsWith("week") ? 7 : 1));
  m = t.match(/^(next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2]);
    const cur = toUTC(today).getUTCDay();
    let diff = (target - cur + 7) % 7;
    if (diff === 0 || m[1] === "next ") diff = diff === 0 ? 7 : diff; // "next X" never means today
    return addCalendarDays(today, diff);
  }
  const monthIdx = (w: string) => MONTHS.findIndex((mm) => mm.startsWith(w.slice(0, 3)));
  m = t.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/) ;
  let d: number | null = null, mo = -1, y: number | null = null;
  if (m) { d = +m[1]; mo = monthIdx(m[2]); y = m[3] ? +m[3] : null; }
  else {
    m = t.match(/^([a-z]+) (\d{1,2})(?: (\d{4}))?$/);
    if (m) { d = +m[2]; mo = monthIdx(m[1]); y = m[3] ? +m[3] : null; }
  }
  if (d != null && mo >= 0) {
    const ty = +today.slice(0, 4);
    let iso = validIso(y ?? ty, mo + 1, d);
    // No year given and date already passed → assume next year
    if (iso && y == null && isBefore(iso, today)) iso = validIso(ty + 1, mo + 1, d);
    return iso;
  }
  return null;
}

/* ========================================================================== */
/* 4. INPUT NORMALISATION (Excel, chat and voice all go through these)         */
/* ========================================================================== */

const clean = (v: unknown) => (v == null ? "" : String(v).trim().toLowerCase().replace(/\s+/g, " "));

const COUNTRY_ALIASES: Record<string, string> = {
  "uk": "United Kingdom", "u.k.": "United Kingdom", "united kingdom": "United Kingdom", "gb": "United Kingdom",
  "great britain": "United Kingdom", "britain": "United Kingdom", "england": "United Kingdom", "scotland": "United Kingdom",
  "wales": "United Kingdom", "northern ireland": "United Kingdom",
  "germany": "Germany", "de": "Germany", "deutschland": "Germany",
  "france": "France", "fr": "France",
  "netherlands": "Netherlands", "the netherlands": "Netherlands", "nl": "Netherlands", "holland": "Netherlands", "dutch": "Netherlands",
  "china": "China", "cn": "China", "prc": "China", "people's republic of china": "China",
  "india": "India", "in": "India",
  "vietnam": "Vietnam", "viet nam": "Vietnam", "vn": "Vietnam",
  "turkey": "Turkey", "türkiye": "Turkey", "turkiye": "Turkey", "tr": "Turkey",
};
export const normaliseCountry = (v: unknown): string | null => {
  const c = clean(v);
  if (!c) return null;
  return COUNTRY_ALIASES[c] ?? titleCase(c);
};

const CITY_ALIASES: Record<string, string> = {
  "london": "London", "manchester": "Manchester", "birmingham": "Birmingham", "brum": "Birmingham", "leeds": "Leeds",
  "berlin": "Berlin", "frankfurt": "Frankfurt", "frankfurt am main": "Frankfurt", "frankfurt/main": "Frankfurt",
  "hamburg": "Hamburg", "paris": "Paris", "lyon": "Lyon", "lyons": "Lyon",
  "amsterdam": "Amsterdam", "rotterdam": "Rotterdam",
};
export const normaliseCity = (v: unknown): string | null => {
  const c = clean(v);
  if (!c) return null;
  return CITY_ALIASES[c] ?? titleCase(c);
};
/** Destination city → country (lets chat infer the country from the city). */
export const CITY_TO_COUNTRY: Record<string, DestinationCountry | "United Kingdom"> = {
  London: "United Kingdom", Manchester: "United Kingdom", Birmingham: "United Kingdom", Leeds: "United Kingdom",
  Berlin: "Germany", Frankfurt: "Germany", Hamburg: "Germany", Paris: "France", Lyon: "France",
  Amsterdam: "Netherlands", Rotterdam: "Netherlands",
};

export function normalisePriority(v: unknown): Priority | null {
  const c = clean(v);
  if (!c) return null;
  if (/(most )?reliab|on[- ]?time|dependab|safe|guarantee|can'?t be late|must not be late/.test(c)) return "Most reliable";
  if (/fast|quick|asap|urgent|express|speed|soonest|rush/.test(c)) return "Fastest";
  if (/cheap|low(est)? (cost|price)|budget|economy|save money|affordable|least expensive/.test(c)) return "Cheapest";
  if (/balanc|no (strong )?pref|best value|value for money|\bmix|trade[- ]?off|whatever|don'?t mind|\bany\b|either/.test(c)) return "Balanced";
  return null;
}

export function normaliseDestinationType(v: unknown): DestinationType | null {
  const c = clean(v);
  if (!c) return null;
  if (/warehouse|fulfil?ment|fc\b|distribution|dc\b|depot|amazon|3pl|logistics cent/.test(c)) return "Warehouse";
  if (/business|shop|store|office|retail|showroom|boutique|customer premises|address/.test(c)) return "Business address";
  return null;
}

export function normaliseYesNo(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const c = clean(v);
  if (!c) return null;
  if (/^(y|yes|yeah|yep|yup|true|1|booked|done|sorted|already|we have|got one|confirmed)\b/.test(c)) return true;
  if (/^(n|no|nope|nah|false|0|not yet|not booked|haven'?t|none)\b/.test(c)) return false;
  return null;
}

export function normaliseCurrency(v: unknown): string | null {
  const c = clean(v);
  if (!c) return null;
  if (/^(gbp|£|pound|pounds|sterling|quid|gbp£)$/.test(c)) return "GBP";
  return c.toUpperCase();
}

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, a: 1, an: 1,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, k: 1000, million: 1_000_000, grand: 1000, dozen: 12 };

/**
 * Parse numbers from Excel/chat/voice: 1080, "1,080", "£5.00", "620kg", "620 kilos",
 * "1.2k", "ninety", "one thousand and eighty", "a dozen", "five pounds fifty".
 */
export function parseNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (isNum(v)) return v;
  let s = String(v).toLowerCase().trim();
  // "five pounds fifty" / "5 pounds 50"
  const pp = s.match(/^(.+?) pounds? (?:and )?(.+?)( pence| p)?$/);
  if (pp) {
    const a = parseNumber(pp[1]), b = parseNumber(pp[2]);
    if (a != null && b != null && b < 100) return round(a + b / 100, 2);
  }
  s = s.replace(/[£$€,]|gbp|pounds?|quid|kgs?|kilos?|kilograms?|units?|pcs|pieces|cartons?|boxes|pallets?|days?/g, " ").trim();
  const km = s.match(/^(-?\d+(?:\.\d+)?)\s*k$/);
  if (km) return +km[1] * 1000;
  if (/^-?\d+(\.\d+)?$/.test(s.replace(/\s+/g, ""))) return Number(s.replace(/\s+/g, ""));
  // words
  const tokens = s.replace(/-/g, " ").split(/\s+/).filter((t) => t && t !== "and");
  if (!tokens.length) return null;
  let total = 0, current = 0, seen = false;
  for (const t of tokens) {
    if (/^\d+(\.\d+)?$/.test(t)) { current += Number(t); seen = true; continue; }
    if (t in WORDS) { current += WORDS[t]; seen = true; continue; }
    if (t === "point") return null; // keep simple: ask again
    if (t in SCALES) {
      const sc = SCALES[t];
      if (sc === 100) current = (current || 1) * 100;
      else if (sc === 12) current = (current || 1) * 12;
      else { total += (current || 1) * sc; current = 0; }
      seen = true; continue;
    }
    return null;
  }
  return seen ? total + current : null;
}

/** HS code: keep as text, strip spaces/dots/dashes, report digit count and Excel-zero risk. */
export function normaliseHs(raw: string | number | null | undefined) {
  if (raw == null || String(raw).trim() === "") {
    return { digits: null as string | null, digitCount: 0, wasNumericCell: false, possibleLostLeadingZero: false, nonDigitChars: false, padded: false };
  }
  const wasNumericCell = isNum(raw);
  const str = wasNumericCell ? String(Math.trunc(raw as number)) : String(raw).trim();
  const stripped = str.replace(/[\s.\-]/g, "");
  const nonDigitChars = /\D/.test(stripped);
  let digits = stripped.replace(/\D/g, "");
  const possibleLostLeadingZero = wasNumericCell && digits.length === CONFIG.HS_MIN_DIGITS - 1;
  let padded = false;
  if (possibleLostLeadingZero && CONFIG.HS_PAD_5_DIGIT_NUMERIC) { digits = "0" + digits; padded = true; }
  return { digits: digits || null, digitCount: digits.length, wasNumericCell, possibleLostLeadingZero, nonDigitChars, padded };
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Raw Excel row (header → value) → Booking. Header matching is case/space-insensitive. */
export function bookingFromRow(row: Record<string, unknown>): Booking {
  const g = (name: string) => {
    const key = Object.keys(row).find((k) => clean(k) === clean(name));
    return key ? row[key] : null;
  };
  return {
    bookingId: String(g("Booking ID") ?? "").trim(),
    sellerName: g("Seller name") == null ? null : String(g("Seller name")).trim() || null,
    originCity: normaliseCity(g("Origin city")),
    originCountry: normaliseCountry(g("Origin country")),
    destinationCity: normaliseCity(g("Destination city")),
    destinationCountry: normaliseCountry(g("Destination country")) as DestinationCountry | null,
    destinationType: normaliseDestinationType(g("Destination type")),
    readyToShipDate: parseDate(g("Ready to ship date")),
    sellerPriority: normalisePriority(g("Seller priority")),
    pallets: parseNumber(g("Pallets")),
    cartons: parseNumber(g("Cartons")),
    totalDeclaredValue: parseNumber(g("Total declared value")),
    currency: normaliseCurrency(g("Currency")),
    totalGrossWeightKg: parseNumber(g("Total gross weight (kg)")),
    deliveryAppointmentBooked: normaliseYesNo(g("Delivery appointment booked")),
    provenance: {},
  };
}

/** Raw Excel row → Item. Read HS code cell RAW (string or number) — never Number() it. */
export function itemFromRow(row: Record<string, unknown>, rowRef?: string): Item {
  const g = (name: string) => {
    const key = Object.keys(row).find((k) => clean(k) === clean(name));
    return key ? row[key] : null;
  };
  const hs = g("HS code");
  return {
    bookingId: String(g("Booking ID") ?? "").trim(),
    rowRef,
    sku: g("SKU") == null ? null : String(g("SKU")).trim() || null,
    description: g("Description") == null ? null : String(g("Description")).trim() || null,
    hsCodeRaw: hs === "" || hs == null ? null : (hs as string | number),
    quantity: parseNumber(g("Quantity (units)")),
    unitPrice: parseNumber(g("Unit price")),
    unitsPerCarton: parseNumber(g("Units per carton")),
    cartons: parseNumber(g("Cartons")),
    unitWeightKg: parseNumber(g("Unit weight (kg)")),
    countryOfOrigin: normaliseCountry(g("Country of origin")),
  };
}

/** Group items under bookings; returns orphans (items whose Booking ID is not on Sheet 1). */
export function groupItems(bookings: Booking[], items: Item[]) {
  const byId = new Map<string, Item[]>();
  bookings.forEach((b) => byId.set(b.bookingId, []));
  const orphans: Item[] = [];
  items.forEach((it) => (byId.has(it.bookingId) ? byId.get(it.bookingId)!.push(it) : orphans.push(it)));
  return { byId, orphans };
}

/* ========================================================================== */
/* 5. INPUT VALIDATION — V-xx (data quality; not in the official rulebook)     */
/* ========================================================================== */
/*
 * V-issues have severity "Data". If an official rule already covers the
 * problem (blank HS → R-01, blank country of origin → R-09), the V-rule is NOT
 * raised — the official rule is reported instead (no duplicates).
 * A booking with any blocking V-issue gets status INCOMPLETE (cannot confirm)
 * unless it is already RED.
 */
export const REQUIRED_BOOKING_FIELDS: (keyof Booking)[] = [
  "sellerName", "originCity", "originCountry", "destinationCity", "destinationCountry", "destinationType",
  "readyToShipDate", "sellerPriority", "pallets", "cartons", "totalDeclaredValue", "currency",
  "totalGrossWeightKg", "deliveryAppointmentBooked",
];
export const REQUIRED_ITEM_FIELDS: (keyof Item)[] = [
  "sku", "description", "quantity", "unitPrice", "unitsPerCarton", "cartons", "unitWeightKg",
];
export const FIELD_LABELS: Record<string, string> = {
  bookingId: "Booking ID", sellerName: "Seller name", originCity: "Origin city", originCountry: "Origin country",
  destinationCity: "Destination city", destinationCountry: "Destination country", destinationType: "Destination type",
  readyToShipDate: "Ready to ship date", sellerPriority: "Seller priority", pallets: "Pallets", cartons: "Cartons",
  totalDeclaredValue: "Total declared value", currency: "Currency", totalGrossWeightKg: "Total gross weight (kg)",
  deliveryAppointmentBooked: "Delivery appointment booked", sku: "SKU", description: "Description", hsCodeRaw: "HS code",
  quantity: "Quantity (units)", unitPrice: "Unit price", unitsPerCarton: "Units per carton", unitWeightKg: "Unit weight (kg)",
  countryOfOrigin: "Country of origin",
};

export function validateInputs(b: Booking, items: Item[], allBookingIds: string[] = [b.bookingId]): Issue[] {
  const out: Issue[] = [];
  const data = (code: string, title: string, what: string, fix: string[], fields: string[], extra: Partial<Issue> = {}): Issue =>
    ({ code, severity: "Data", scope: "booking", fields, title, whatIsWrong: what, howToFix: fix, ...extra });

  // V-01 Booking ID present and unique
  if (!b.bookingId) out.push(data("V-01", "Booking ID missing", "This booking has no Booking ID.", ["Add a unique Booking ID such as BK-001."], ["bookingId"]));
  else if (allBookingIds.filter((x) => x === b.bookingId).length > 1)
    out.push(data("V-01", "Duplicate Booking ID", `Booking ID ${b.bookingId} appears more than once on the Bookings sheet.`, ["Give each booking a unique ID."], ["bookingId"]));

  // V-02 Required booking fields
  for (const f of REQUIRED_BOOKING_FIELDS) {
    if (b[f] == null || b[f] === "") {
      out.push(data("V-02", `${FIELD_LABELS[f]} missing`, `${FIELD_LABELS[f]} is blank or could not be read.`, [`Provide the ${FIELD_LABELS[f].toLowerCase()}.`], [f]));
    }
  }
  // V-03 Allowed values
  if (b.originCountry && b.originCountry !== "United Kingdom")
    out.push(data("V-03", "Origin country not supported", `Origin country is "${b.originCountry}"; only United Kingdom is supported.`, ["Set origin country to United Kingdom."], ["originCountry"]));
  if (b.originCity && !ORIGIN_CITIES.includes(b.originCity as any))
    out.push(data("V-03", "Origin city not supported", `Origin city "${b.originCity}" is not one of ${ORIGIN_CITIES.join(", ")}.`, ["Choose London, Manchester, Birmingham or Leeds."], ["originCity"]));
  if (b.destinationCountry && !DESTINATION_COUNTRIES.includes(b.destinationCountry))
    out.push(data("V-03", "Destination country not supported", `Destination country "${b.destinationCountry}" is not Germany, France or Netherlands.`, ["Choose Germany, France or Netherlands."], ["destinationCountry"]));
  if (b.destinationCity && b.destinationCountry && DESTINATION_COUNTRIES.includes(b.destinationCountry) &&
      !DESTINATION_CITIES[b.destinationCountry].includes(b.destinationCity))
    out.push(data("V-04", "City does not match country", `${b.destinationCity} is not a supported city in ${b.destinationCountry} (${DESTINATION_CITIES[b.destinationCountry].join(", ")}).`,
      [`Correct the city, or change the country to ${CITY_TO_COUNTRY[b.destinationCity] ?? "the right one"}.`], ["destinationCity", "destinationCountry"]));
  if (b.currency && b.currency !== "GBP")
    out.push(data("V-03", "Currency not supported", `Currency is "${b.currency}"; all money values must be in GBP.`, ["Convert all values to GBP and set currency to GBP."], ["currency"]));

  // V-05 Numeric sanity on booking
  const posInt: (keyof Booking)[] = ["pallets", "cartons"];
  for (const f of posInt) {
    const v = b[f] as number | null;
    if (v != null && !isPositiveInt(v))
      out.push(data("V-05", `${FIELD_LABELS[f]} must be a whole number above 0`, `${FIELD_LABELS[f]} is ${v}.`, [`Enter a whole number of ${FIELD_LABELS[f].toLowerCase()} (1 or more).`], [f]));
  }
  for (const f of ["totalDeclaredValue", "totalGrossWeightKg"] as (keyof Booking)[]) {
    const v = b[f] as number | null;
    if (v != null && !(v > 0))
      out.push(data("V-05", `${FIELD_LABELS[f]} must be above 0`, `${FIELD_LABELS[f]} is ${v}.`, [`Enter the ${FIELD_LABELS[f].toLowerCase()} as a positive number.`], [f]));
  }
  // V-06 Booking has items
  if (items.length === 0)
    out.push(data("V-06", "No items on this booking", "No rows on the Items sheet carry this Booking ID.", ["Add at least one item for this booking on the Items sheet."], ["bookingId"]));

  // V-07 Required item fields + numeric sanity
  items.forEach((it, i) => {
    for (const f of REQUIRED_ITEM_FIELDS) {
      if (it[f] == null || it[f] === "")
        out.push(data("V-07", `Item ${it.sku ?? i + 1}: ${FIELD_LABELS[f]} missing`, `${FIELD_LABELS[f]} is blank or unreadable for item ${it.sku ?? "#" + (i + 1)}.`, [`Provide the ${FIELD_LABELS[f].toLowerCase()}.`], [f], { scope: "item", itemIndex: i, sku: it.sku }));
    }
    for (const f of ["quantity", "unitsPerCarton", "cartons"] as (keyof Item)[]) {
      const v = it[f] as number | null;
      if (v != null && !isPositiveInt(v))
        out.push(data("V-08", `Item ${it.sku ?? i + 1}: ${FIELD_LABELS[f]} must be a whole number above 0`, `${FIELD_LABELS[f]} is ${v}.`, ["Enter a whole number, 1 or more."], [f], { scope: "item", itemIndex: i, sku: it.sku }));
    }
    for (const f of ["unitPrice", "unitWeightKg"] as (keyof Item)[]) {
      const v = it[f] as number | null;
      if (v != null && !(v > 0))
        out.push(data("V-08", `Item ${it.sku ?? i + 1}: ${FIELD_LABELS[f]} must be above 0`, `${FIELD_LABELS[f]} is ${v}.`, ["Enter a positive number."], [f], { scope: "item", itemIndex: i, sku: it.sku }));
    }
    if (it.countryOfOrigin && !ITEM_ORIGIN_COUNTRIES.includes(it.countryOfOrigin as any))
      out.push(data("V-09", `Item ${it.sku ?? i + 1}: country of origin not in list`, `"${it.countryOfOrigin}" is not one of ${ITEM_ORIGIN_COUNTRIES.join(", ")}.`, ["Choose a listed country."], ["countryOfOrigin"], { scope: "item", itemIndex: i, sku: it.sku }));
  });
  // V-10 Duplicate SKU inside a booking (advisory-level data note)
  const skus = items.map((i) => i.sku).filter(Boolean) as string[];
  [...new Set(skus.filter((s, i) => skus.indexOf(s) !== i))].forEach((s) =>
    out.push(data("V-10", `SKU ${s} listed more than once`, `SKU ${s} appears on several item rows of this booking.`, ["Merge the rows, or confirm they are different products and give them different SKUs."], ["sku"], { scope: "item", sku: s })));
  return out;
}

/** V-11: Items whose Booking ID is not on the Bookings sheet (file-level). */
export function orphanItemIssues(orphans: Item[]): Issue[] {
  return orphans.map((it) => ({
    code: "V-11", severity: "Data", scope: "item", sku: it.sku, fields: ["bookingId"],
    title: `Item ${it.sku ?? ""} belongs to unknown booking ${it.bookingId}`,
    whatIsWrong: `Booking ID ${it.bookingId || "(blank)"} on the Items sheet does not exist on the Bookings sheet.`,
    howToFix: ["Correct the Booking ID on this item, or add the booking to the Bookings sheet."],
  }));
}

/** Which booking fields block which rules (used to mark rules not_evaluable). */
export const RULE_INPUTS: Record<RuleId, { booking: (keyof Booking)[]; item: (keyof Item)[] }> = {
  "R-01": { booking: [], item: ["hsCodeRaw"] },
  "R-02": { booking: ["totalDeclaredValue"], item: ["quantity", "unitPrice"] },
  "R-03": { booking: [], item: ["unitsPerCarton", "cartons", "quantity"] },
  "R-04": { booking: ["cartons"], item: ["cartons"] },
  "R-05": { booking: ["totalGrossWeightKg", "pallets", "destinationCountry", "sellerPriority"], item: [] },
  "R-06": { booking: [], item: ["description", "hsCodeRaw"] },
  "R-07": { booking: ["totalGrossWeightKg"], item: ["unitWeightKg", "quantity"] },
  "R-08": { booking: ["destinationType", "deliveryAppointmentBooked"], item: [] },
  "R-09": { booking: [], item: ["countryOfOrigin"] },
  "R-10": { booking: ["readyToShipDate"], item: [] },
};

/* ========================================================================== */
/* 6. ITEM-LEVEL CALCULATIONS                                                  */
/* ========================================================================== */

/** Line value = quantity × unit price (GBP, exact to the penny). */
export const itemLineValue = (it: Item) =>
  isNum(it.quantity) && isNum(it.unitPrice) ? fromPence(Math.round(it.quantity * toPence(it.unitPrice))) : null;
/** Net weight = quantity × unit weight (kg). */
export const itemNetWeight = (it: Item) =>
  isNum(it.quantity) && isNum(it.unitWeightKg) ? round(it.quantity * it.unitWeightKg, 3) : null;
/** Packed capacity = units per carton × cartons. R-03 compares this to quantity. */
export const itemPackedUnits = (it: Item) =>
  isNum(it.unitsPerCarton) && isNum(it.cartons) ? it.unitsPerCarton * it.cartons : null;
/** Units difference = packed − quantity (+ = more space than units, − = units don't fit). */
export const itemUnitsDiff = (it: Item) => {
  const p = itemPackedUnits(it);
  return p != null && isNum(it.quantity) ? p - it.quantity : null;
};
/** Cartons needed to hold the quantity = ceil(quantity ÷ units per carton). */
export const itemCartonsNeeded = (it: Item) =>
  isNum(it.quantity) && isPositiveInt(it.unitsPerCarton) ? Math.ceil(it.quantity / (it.unitsPerCarton as number)) : null;
/** Exact cartons if quantity divides evenly, else null. */
export const itemExactCartons = (it: Item) =>
  isNum(it.quantity) && isPositiveInt(it.unitsPerCarton) && it.quantity % (it.unitsPerCarton as number) === 0
    ? it.quantity / (it.unitsPerCarton as number) : null;
/** Units in the last (part-filled) carton if quantity is not a multiple of units per carton. */
export const itemUnitsInLastCarton = (it: Item) =>
  isNum(it.quantity) && isPositiveInt(it.unitsPerCarton) ? it.quantity % (it.unitsPerCarton as number) : null;
/** Approx. net weight per carton = units per carton × unit weight. */
export const itemCartonNetWeight = (it: Item) =>
  isNum(it.unitsPerCarton) && isNum(it.unitWeightKg) ? round(it.unitsPerCarton * it.unitWeightKg, 3) : null;
/** Value per carton = units per carton × unit price. */
export const itemCartonValue = (it: Item) =>
  isNum(it.unitsPerCarton) && isNum(it.unitPrice) ? fromPence(Math.round(it.unitsPerCarton * toPence(it.unitPrice))) : null;

/* ========================================================================== */
/* 7. BOOKING-LEVEL CALCULATIONS                                               */
/* ========================================================================== */

const allNum = (xs: (number | null)[]) => xs.length > 0 && xs.every(isNum);

export function computeTotals(b: Booking, items: Item[]): BookingTotals {
  const values = items.map(itemLineValue);
  const cartons = items.map((i) => i.cartons);
  const nets = items.map(itemNetWeight);
  const units = items.map((i) => i.quantity);

  const sumItemValue = allNum(values) ? sumMoney(values as number[]) : null;
  const sumItemCartons = allNum(cartons) ? sum(cartons as number[]) : null;
  const sumNetWeightKg = allNum(nets) ? round(sum(nets as number[]), 3) : null;
  const sumUnits = allNum(units) ? sum(units as number[]) : null;

  const declaredValueDiff = isNum(b.totalDeclaredValue) && sumItemValue != null
    ? fromPence(toPence(b.totalDeclaredValue) - toPence(sumItemValue)) : null;
  const declaredValueDiffPct = declaredValueDiff != null && sumItemValue
    ? round((Math.abs(declaredValueDiff) / sumItemValue) * 100, 3) : null;
  const cartonsDiff = isNum(b.cartons) && sumItemCartons != null ? b.cartons - sumItemCartons : null;
  const weightPerPalletKg = isNum(b.totalGrossWeightKg) && isPositiveInt(b.pallets)
    ? round(b.totalGrossWeightKg / (b.pallets as number), 2) : null;
  const packagingWeightKg = isNum(b.totalGrossWeightKg) && sumNetWeightKg != null
    ? round(b.totalGrossWeightKg - sumNetWeightKg, 3) : null;
  const avgCartonsPerPallet = sumItemCartons != null && isPositiveInt(b.pallets) ? round(sumItemCartons / (b.pallets as number), 1) : null;
  const avgUnitValue = sumItemValue != null && sumUnits ? round(sumItemValue / sumUnits, 2) : null;

  return {
    itemCount: items.length, sumUnits, sumItemValue, sumItemCartons, sumNetWeightKg,
    declaredValueDiff, declaredValueDiffPct, cartonsDiff, weightPerPalletKg, packagingWeightKg,
    avgCartonsPerPallet, avgUnitValue,
  };
}

/** Values we can DERIVE for chat/voice so we don't have to ask (always confirm with the seller). */
export function deriveBookingTotals(items: Item[]) {
  const t = computeTotals({ pallets: null, totalGrossWeightKg: null, totalDeclaredValue: null, cartons: null } as Booking, items);
  return {
    cartons: t.sumItemCartons,
    totalDeclaredValue: t.sumItemValue,
    /** Minimum possible gross weight. Real gross = this + cartons + pallets; ask, don't assume. */
    minGrossWeightKg: t.sumNetWeightKg,
    /** Rough estimate to OFFER (never to auto-fill): net + MIN_TARE_PER_PALLET_KG × pallets guess. */
    suggestedGrossWeightKg: (pallets: number) =>
      t.sumNetWeightKg != null ? round(t.sumNetWeightKg + CONFIG.MIN_TARE_PER_PALLET_KG * pallets, 1) : null,
  };
}

/** Item-level derivations offered in chat: cartons from quantity, or quantity from cartons. */
export function deriveItemField(it: Item): Partial<Item> {
  const out: Partial<Item> = {};
  if (it.cartons == null && itemExactCartons(it) != null) out.cartons = itemExactCartons(it);
  if (it.quantity == null && isNum(it.unitsPerCarton) && isNum(it.cartons)) out.quantity = it.unitsPerCarton * it.cartons;
  if (it.unitsPerCarton == null && isNum(it.quantity) && isPositiveInt(it.cartons) && it.quantity % (it.cartons as number) === 0)
    out.unitsPerCarton = it.quantity / (it.cartons as number);
  return out;
}

/* ========================================================================== */
/* 8. CARRIER CALCULATIONS                                                     */
/* ========================================================================== */

export const routeCarriers = (dest: DestinationCountry | null) =>
  dest ? CARRIERS.filter((c) => c.originCountry === "United Kingdom" && c.destinationCountry === dest) : [];
/** Freight cost = price per pallet × pallets. */
export const shipmentCost = (c: Carrier, pallets: number | null) => (isPositiveInt(pallets) ? c.pricePerPallet * (pallets as number) : null);
/** Minimum pallets so that gross ÷ pallets ≤ carrier max. */
export const minPalletsFor = (c: Carrier, grossKg: number | null) => (isNum(grossKg) && grossKg > 0 ? Math.ceil(grossKg / c.maxKgPerPallet) : null);
/** Max gross weight this carrier accepts for N pallets. */
export const maxGrossFor = (c: Carrier, pallets: number) => c.maxKgPerPallet * pallets;
/**
 * Collection date = ready date, but never before today (a past ready date is
 * treated as "ready now" for estimates — R-10 still flags it), and moved to the
 * next Monday if it falls on a weekend in business mode.
 */
export function collectionDate(ready: string | null, today: string = todayISO()) {
  if (!ready) return null;
  const start = isBefore(ready, today) ? today : ready;
  return CONFIG.TRANSIT_DAY_MODE === "business" && CONFIG.COLLECT_NEXT_WORKING_DAY_IF_WEEKEND ? nextWorkingDay(start) : start;
}
/** Estimated delivery = collection + transit days (business or calendar per CONFIG). */
export function etaDate(ready: string | null, transitDays: number, today: string = todayISO()) {
  const col = collectionDate(ready, today);
  if (!col) return null;
  return CONFIG.TRANSIT_DAY_MODE === "business" ? addBusinessDays(col, transitDays) : addCalendarDays(col, transitDays);
}
/** Latest ready date that still meets a deadline with this carrier. */
export function latestReadyDateFor(c: Carrier, deadline: string) {
  let d = deadline;
  for (let i = 0; i < 60; i++) {
    const eta = etaDate(d, c.transitDays, "1900-01-01")!;
    if (!isBefore(deadline, eta)) return d; // eta <= deadline
    d = addCalendarDays(d, -1);
  }
  return null;
}
export const latePct = (c: Carrier) => 100 - c.onTimePct;

export function evaluateCarrier(c: Carrier, b: Booking, totals: BookingTotals, today: string = todayISO()): CarrierEval {
  const prefs = b.prefs ?? {};
  const cost = shipmentCost(c, b.pallets);
  const wpp = totals.weightPerPalletKg;
  const fitsWeight = wpp == null ? null : wpp <= c.maxKgPerPallet;
  const minP = minPalletsFor(c, b.totalGrossWeightKg);
  const eta = etaDate(b.readyToShipDate, c.transitDays, today);
  const deadline = earliestDeadline(prefs);
  const meetsDeadline = deadline && eta ? !isBefore(deadline, eta) : null;
  const withinBudget = isNum(prefs.maxBudgetGbp) && cost != null ? cost <= (prefs.maxBudgetGbp as number) : null;
  const excludedBySeller = !!prefs.excludeCarriers?.some((x) => clean(x) === clean(c.carrier));
  const reasons: string[] = [];
  if (fitsWeight === false) reasons.push(`${kg(wpp)} per pallet is over its ${c.maxKgPerPallet} kg limit`);
  if (meetsDeadline === false) reasons.push(`arrives ${formatDDMMYYYY(eta)}, after ${formatDDMMYYYY(deadline)}`);
  if (withinBudget === false) reasons.push(`costs ${gbp(cost)}, over the ${gbp(prefs.maxBudgetGbp)} budget`);
  if (excludedBySeller) reasons.push("you asked not to use this carrier");
  return {
    carrier: c, cost,
    costPerKg: cost != null && isNum(b.totalGrossWeightKg) ? round(cost / b.totalGrossWeightKg, 2) : null,
    costPerUnit: cost != null && totals.sumUnits ? round(cost / totals.sumUnits, 3) : null,
    collectionDate: collectionDate(b.readyToShipDate, today), etaDate: eta, weightPerPallet: wpp, fitsWeight,
    minPalletsForThisCarrier: minP,
    costIfRepalletised: minP != null && isNum(b.pallets) && minP > (b.pallets as number) ? c.pricePerPallet * minP : null,
    meetsDeadline, withinBudget, excludedBySeller,
    eligible: fitsWeight !== false && meetsDeadline !== false && withinBudget !== false && !excludedBySeller,
    ineligibleReasons: reasons, score: null,
  };
}
export function earliestDeadline(p: RecommendationPrefs): string | null {
  const ds = [p.requiredDeliveryDate, p.appointmentDate].filter(Boolean) as string[];
  if (!ds.length) return null;
  return ds.sort((a, b) => daysBetween(b, a))[0];
}

/* ========================================================================== */
/* 9. OFFICIAL RULES R-01 … R-10                                               */
/* ========================================================================== */

const itemLabel = (it: Item, i: number) => (it.sku ? `${it.sku}${it.description ? ` (${it.description})` : ""}` : `item #${i + 1}`);
const ruleIssue = (id: RuleId, p: Omit<Issue, "code" | "severity">): Issue => ({ code: id, severity: RULES[id].severity, ...p });

/** R-01 — HS code ≥ 6 digits on every item. */
export function checkR01(items: Item[]): Issue[] {
  const out: Issue[] = [];
  items.forEach((it, i) => {
    const hs = normaliseHs(it.hsCodeRaw);
    if (hs.digitCount >= CONFIG.HS_MIN_DIGITS && !hs.nonDigitChars) return;
    let what: string;
    const fix: string[] = [];
    if (!hs.digits) {
      what = `${itemLabel(it, i)} has no HS code.`;
      fix.push("Add the product's HS (commodity) code with at least 6 digits. Look it up on the UK Trade Tariff (gov.uk/trade-tariff) using the product description.");
    } else if (hs.nonDigitChars) {
      what = `${itemLabel(it, i)} has HS code "${it.hsCodeRaw}", which contains characters that are not digits.`;
      fix.push("Enter the HS code using digits only (e.g. 691200).");
    } else {
      what = `${itemLabel(it, i)} has HS code ${hs.digits}, which is only ${hs.digitCount} digit${hs.digitCount === 1 ? "" : "s"} (minimum 6).`;
      fix.push(`Use the full code with at least 6 digits (e.g. ${hs.digits.padEnd(6, "0")} if the remaining digits are 0 — check the tariff to be sure).`);
      if (hs.possibleLostLeadingZero) fix.unshift(`If the real code is 0${hs.digits}, Excel removed the leading zero. Format the HS code column as Text and re-enter 0${hs.digits}.`);
    }
    out.push(ruleIssue("R-01", { scope: "item", itemIndex: i, sku: it.sku, fields: ["hsCodeRaw"], title: "HS code missing or too short",
      whatIsWrong: what, howToFix: fix, numbers: { hsCode: hs.digits, digits: hs.digitCount, required: CONFIG.HS_MIN_DIGITS } }));
  });
  return out;
}

/** R-02 — declared value within 1% of Σ(quantity × unit price). */
export function checkR02(b: Booking, items: Item[], t: BookingTotals): Issue[] {
  if (!isNum(b.totalDeclaredValue) || t.sumItemValue == null) return [];
  const tolerance = round((t.sumItemValue * CONFIG.VALUE_TOLERANCE_PCT) / 100, 2);
  const diffAbs = Math.abs(t.declaredValueDiff!);
  if (toPence(diffAbs) <= toPence(tolerance)) return [];
  const higher = (t.declaredValueDiff as number) > 0;
  const lines = items.map((it, i) => `${it.sku ?? "#" + (i + 1)}: ${it.quantity} × ${gbp(it.unitPrice)} = ${gbp(itemLineValue(it))}`).join("; ");
  return [ruleIssue("R-02", { scope: "booking", fields: ["totalDeclaredValue", "quantity", "unitPrice"], title: "Declared value doesn't match the items",
    whatIsWrong: `Declared value is ${gbp(b.totalDeclaredValue)} but the items add up to ${gbp(t.sumItemValue)} (${lines}). The declared value is ${gbp(diffAbs)} (${t.declaredValueDiffPct}%) ${higher ? "higher" : "lower"}; the limit is 1% (${gbp(tolerance)}).`,
    howToFix: [
      `Change the total declared value to ${gbp(t.sumItemValue)}.`,
      "Or, if the declared value is right, correct the quantity or unit price of the item(s) that are wrong.",
      "Customs uses the declared value to set duty and VAT — an under-declared value can cause a customs hold or a penalty.",
    ],
    numbers: { declared: b.totalDeclaredValue, computed: t.sumItemValue, diff: t.declaredValueDiff, diffPct: t.declaredValueDiffPct, tolerance } })];
}

/** R-03 — per item: units per carton × cartons = quantity. */
export function checkR03(items: Item[]): Issue[] {
  const out: Issue[] = [];
  items.forEach((it, i) => {
    const packed = itemPackedUnits(it);
    if (packed == null || !isNum(it.quantity) || packed === it.quantity) return;
    const fix: string[] = [];
    const exact = itemExactCartons(it);
    if (exact != null) fix.push(`If the quantity (${it.quantity}) is right: cartons should be ${exact} (${it.quantity} ÷ ${it.unitsPerCarton}).`);
    else fix.push(`${it.quantity} units don't divide evenly into cartons of ${it.unitsPerCarton}: you'd need ${itemCartonsNeeded(it)} cartons with ${itemUnitsInLastCarton(it)} units in the last one. Either correct the quantity, or correct units per carton.`);
    fix.push(`If the cartons (${it.cartons}) are right: quantity should be ${packed} (${it.unitsPerCarton} × ${it.cartons}).`);
    if (isNum(it.cartons) && it.cartons > 0 && it.quantity % (it.cartons as number) === 0)
      fix.push(`If both quantity and cartons are right: units per carton should be ${it.quantity / (it.cartons as number)}.`);
    out.push(ruleIssue("R-03", { scope: "item", itemIndex: i, sku: it.sku, fields: ["unitsPerCarton", "cartons", "quantity"], title: "Carton count doesn't match quantity",
      whatIsWrong: `${itemLabel(it, i)}: ${it.unitsPerCarton} units per carton × ${it.cartons} cartons = ${packed} units, but quantity is ${it.quantity} (${packed > it.quantity ? packed - it.quantity + " units short" : it.quantity - packed + " units more than fit"}). The receiving warehouse will count a mismatch.`,
      howToFix: fix, numbers: { unitsPerCarton: it.unitsPerCarton, cartons: it.cartons, packed, quantity: it.quantity, diff: packed - it.quantity } }));
  });
  return out;
}

/** R-04 — booking cartons = Σ item cartons. */
export function checkR04(b: Booking, items: Item[], t: BookingTotals): Issue[] {
  if (!isNum(b.cartons) || t.sumItemCartons == null || b.cartons === t.sumItemCartons) return [];
  const breakdown = items.map((it, i) => `${it.sku ?? "#" + (i + 1)}: ${it.cartons}`).join(" + ");
  return [ruleIssue("R-04", { scope: "booking", fields: ["cartons"], title: "Booking carton total doesn't match the items",
    whatIsWrong: `Booking says ${b.cartons} cartons, but the items add up to ${t.sumItemCartons} (${breakdown}). Difference: ${Math.abs(t.cartonsDiff!)} carton${Math.abs(t.cartonsDiff!) === 1 ? "" : "s"}.`,
    howToFix: [
      `Change the booking's cartons to ${t.sumItemCartons}.`,
      `Or, if ${b.cartons} cartons are really being shipped, an item is missing or its carton count is wrong — add or correct it.`,
    ], numbers: { booking: b.cartons, itemsSum: t.sumItemCartons, diff: t.cartonsDiff } })];
}

/** R-05 — gross ÷ pallets ≤ chosen carrier's max per pallet. `chosen` comes from pickR05Carrier(). */
export function checkR05(b: Booking, t: BookingTotals, chosen: CarrierEval | null, allEvals: CarrierEval[]): Issue[] {
  if (t.weightPerPalletKg == null || !chosen) return [];
  const c = chosen.carrier;
  if (t.weightPerPalletKg <= c.maxKgPerPallet) return [];
  const minP = minPalletsFor(c, b.totalGrossWeightKg)!;
  const fitting = allEvals.filter((e) => e.fitsWeight).sort((a, z) => (a.cost ?? 0) - (z.cost ?? 0));
  const fix = [
    `Spread the load over at least ${minP} pallets (${b.totalGrossWeightKg} kg ÷ ${minP} = ${kg(b.totalGrossWeightKg! / minP)} per pallet) to keep ${c.carrier} ${c.service}; freight would be ${gbp(c.pricePerPallet * minP)}.`,
  ];
  fitting.forEach((e) => fix.push(`Or switch to ${e.carrier.carrier} ${e.carrier.service} (max ${e.carrier.maxKgPerPallet} kg/pallet) at ${gbp(e.cost)}, arriving ${formatDDMMYYYY(e.etaDate)}.`));
  if (!fitting.length) fix.push(`No carrier on this route accepts ${kg(t.weightPerPalletKg)} per pallet (highest limit is ${Math.max(...allEvals.map((e) => e.carrier.maxKgPerPallet))} kg). You must add pallets.`);
  fix.push("Also double-check the total gross weight and pallet count — a typo here is common.");
  return [ruleIssue("R-05", { scope: "booking", fields: ["totalGrossWeightKg", "pallets"], title: "Pallets too heavy for the carrier",
    whatIsWrong: `${b.totalGrossWeightKg} kg ÷ ${b.pallets} pallets = ${kg(t.weightPerPalletKg)} per pallet, over ${c.carrier} ${c.service}'s limit of ${c.maxKgPerPallet} kg (by ${kg(t.weightPerPalletKg - c.maxKgPerPallet)}). The carrier would refuse the pallets at collection.`,
    howToFix: fix, numbers: { gross: b.totalGrossWeightKg, pallets: b.pallets, perPallet: t.weightPerPalletKg, max: c.maxKgPerPallet, minPallets: minP, carrier: c.id } })];
}

// ---- R-06 dangerous goods detection ----
export const DG_KEYWORDS = {
  lithium: {
    definite: ["lithium", "li-ion", "li ion", "liion", "li-po", "lipo", "li-polymer", "lifepo4", "power bank", "powerbank", "18650", "21700", "cr2032", "cr2025", "button cell", "e-cigarette", "e cigarette", "vape", "e-bike battery", "ebike battery", "battery pack", "rechargeable battery", "rechargeable batteries"],
    possible: ["battery", "batteries", "rechargeable", "cordless", "wireless earbuds", "bluetooth speaker", "smartwatch", "smart watch", "mobile phone", "smartphone", "laptop", "tablet", "drone", "e-scooter", "electric scooter", "hoverboard", "usb-c charging", "usb charging"],
  },
  aerosol: {
    definite: ["aerosol", "spray can", "spray paint", "hairspray", "hair spray", "deodorant spray", "body spray", "spray deodorant", "air freshener spray", "dry shampoo", "compressed air", "compressed gas", "pressurised", "pressurized", "gas canister", "butane", "propane", "co2 cartridge", "cream charger", "whipped cream charger", "nitrous", "spray foam", "shaving foam", "cooking spray", "fire extinguisher"],
    possible: ["spray", "mist", "foam"],
  },
  flammable: {
    definite: ["flammable", "inflammable", "petrol", "gasoline", "diesel", "kerosene", "paraffin", "lamp oil", "lighter fluid", "lighter gas", "methylated spirit", "white spirit", "turpentine", "acetone", "nail polish", "nail varnish", "nail polish remover", "isopropyl", "rubbing alcohol", "ethanol", "bioethanol", "solvent", "paint thinner", "thinners", "cellulose thinner", "lacquer", "perfume", "eau de parfum", "eau de toilette", "parfum", "cologne", "aftershave", "hand sanitiser", "hand sanitizer", "alcohol gel", "fuel", "firelighter", "fire lighter", "camping gas", "glue solvent", "contact adhesive", "superglue remover", "varnish", "wood stain", "oil-based paint", "spirit-based"],
    possible: ["paint", "essential oil", "fragrance oil", "reed diffuser", "vodka", "gin", "whisky", "whiskey", "rum", "spirits", "liqueur", "alcohol", "adhesive", "glue", "resin", "polish", "cleaner", "degreaser", "ink"],
  },
} as const;
/** Phrases removed BEFORE matching so they don't trigger (e.g. "non-flammable"). */
export const DG_NEGATIONS = [
  "battery-free", "battery free", "no battery", "no batteries", "batteries not included", "battery not included", "without battery", "without batteries",
  "non-aerosol", "non aerosol", "pump spray", "trigger spray", "spray bottle (empty)", "empty spray bottle",
  "non-flammable", "non flammable", "nonflammable", "alcohol-free", "alcohol free", "water-based", "water based", "solvent-free", "solvent free",
  "fuel-efficient", "fuel efficient",
];
/** HS 6-digit prefixes that indicate (definite) or hint (possible) restricted goods. */
export const DG_HS = {
  definite: { "850650": "lithium", "850760": "lithium", "220710": "flammable", "220720": "flammable", "271012": "flammable", "271019": "flammable", "360610": "flammable", "381400": "flammable", "330300": "flammable" } as Record<string, keyof typeof DG_KEYWORDS>,
  possible: { "8506": "lithium", "8507": "lithium", "8517": "lithium", "8471": "lithium", "8518": "lithium", "8543": "lithium", "9613": "flammable", "3208": "flammable", "3209": "flammable", "3210": "flammable", "3303": "flammable", "3307": "aerosol", "3405": "aerosol", "3808": "aerosol" } as Record<string, keyof typeof DG_KEYWORDS>,
};
export type DgCategory = keyof typeof DG_KEYWORDS;
export interface DgResult { verdict: "definite" | "possible" | "none"; categories: DgCategory[]; matched: string[] }

const wordMatch = (text: string, kw: string) => new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);
export function detectDangerousGoods(it: Item): DgResult {
  let text = ` ${clean(it.description)} ${clean(it.sku)} `;
  for (const n of DG_NEGATIONS) text = text.split(n).join(" ");
  const matched: string[] = []; const cats = new Set<DgCategory>(); let verdict: DgResult["verdict"] = "none";
  (Object.keys(DG_KEYWORDS) as DgCategory[]).forEach((cat) => {
    DG_KEYWORDS[cat].definite.forEach((k) => { if (wordMatch(text, k)) { matched.push(k); cats.add(cat); verdict = "definite"; } });
  });
  const hs = normaliseHs(it.hsCodeRaw).digits ?? "";
  for (const [p, cat] of Object.entries(DG_HS.definite)) if (hs.startsWith(p)) { matched.push(`HS ${p}`); cats.add(cat); verdict = "definite"; }
  if (verdict !== "definite") {
    (Object.keys(DG_KEYWORDS) as DgCategory[]).forEach((cat) => {
      DG_KEYWORDS[cat].possible.forEach((k) => { if (wordMatch(text, k)) { matched.push(k); cats.add(cat); verdict = "possible"; } });
    });
    for (const [p, cat] of Object.entries(DG_HS.possible)) if (hs.startsWith(p)) { matched.push(`HS ${p}`); cats.add(cat); verdict = "possible"; }
  }
  return { verdict, categories: [...cats], matched };
}
const DG_NAMES: Record<DgCategory, string> = { lithium: "lithium batteries", aerosol: "aerosols", flammable: "flammable liquids" };

/**
 * R-06 — definite matches are Red. "possible" matches need the Gemini second opinion:
 * pass geminiVerdicts[itemIndex] = true (restricted) / false (safe). Missing verdict on a
 * possible match → Advisory A-09 "needs manual check" (does not change status).
 */
export function checkR06(items: Item[], geminiVerdicts: Record<number, boolean | undefined> = {}): Issue[] {
  const out: Issue[] = [];
  items.forEach((it, i) => {
    const r = detectDangerousGoods(it);
    const confirmed = r.verdict === "definite" || (r.verdict === "possible" && geminiVerdicts[i] === true);
    if (confirmed) {
      const names = r.categories.map((c) => DG_NAMES[c]).join(" / ");
      out.push(ruleIssue("R-06", { scope: "item", itemIndex: i, sku: it.sku, fields: ["description"], title: "Restricted goods",
        whatIsWrong: `${itemLabel(it, i)} looks like ${names} (matched: ${r.matched.join(", ")}${r.verdict === "possible" ? "; confirmed by AI review" : ""}). These can't go on this service.`,
        howToFix: ["Remove this item from the shipment.", "If the description is misleading (e.g. the product has no battery), correct the description to say so and re-check.", "Restricted goods need a specialist dangerous-goods service, which isn't offered here."],
        numbers: { categories: r.categories.join(","), matched: r.matched.join(",") } }));
    } else if (r.verdict === "possible" && geminiVerdicts[i] === undefined) {
      out.push({ code: "A-09", severity: "Advisory", scope: "item", itemIndex: i, sku: it.sku, fields: ["description"], title: "Please confirm this item isn't restricted",
        whatIsWrong: `${itemLabel(it, i)} mentions "${r.matched.join(", ")}", which can indicate lithium batteries, aerosols or flammable liquids.`,
        howToFix: ["Confirm the item contains no lithium battery, isn't an aerosol and isn't a flammable liquid — or remove it."] });
    }
  });
  return out;
}

/** R-07 — gross ≥ Σ(unit weight × quantity). */
export function checkR07(b: Booking, items: Item[], t: BookingTotals): Issue[] {
  if (!isNum(b.totalGrossWeightKg) || t.sumNetWeightKg == null || b.totalGrossWeightKg >= t.sumNetWeightKg) return [];
  const breakdown = items.map((it, i) => `${it.sku ?? "#" + (i + 1)}: ${it.quantity} × ${it.unitWeightKg} kg = ${kg(itemNetWeight(it))}`).join("; ");
  const suggested = round(t.sumNetWeightKg + CONFIG.MIN_TARE_PER_PALLET_KG * ((b.pallets as number) || 1), 1);
  return [ruleIssue("R-07", { scope: "booking", fields: ["totalGrossWeightKg", "unitWeightKg", "quantity"], title: "Gross weight is less than the goods weigh",
    whatIsWrong: `Total gross weight is ${kg(b.totalGrossWeightKg)}, but the goods alone weigh ${kg(t.sumNetWeightKg)} (${breakdown}). Gross weight includes cartons and pallets, so it can't be lower — it's ${kg(t.sumNetWeightKg - b.totalGrossWeightKg)} short.`,
    howToFix: [
      `Re-weigh and enter the real gross weight. It must be at least ${kg(t.sumNetWeightKg)}; with packaging and pallets expect roughly ${kg(suggested)} or more.`,
      "Or correct the unit weight or quantity if one of them is wrong.",
      "A wrong weight can also change which carriers can take your pallets (R-05) — we'll re-check when you update it.",
    ], numbers: { gross: b.totalGrossWeightKg, net: t.sumNetWeightKg, shortBy: round(t.sumNetWeightKg - b.totalGrossWeightKg, 3) } })];
}

/** R-08 — Warehouse destination needs an appointment. */
export function checkR08(b: Booking): Issue[] {
  if (b.destinationType !== "Warehouse" || b.deliveryAppointmentBooked !== false) return [];
  return [ruleIssue("R-08", { scope: "booking", fields: ["destinationType", "deliveryAppointmentBooked"], title: "No delivery appointment at the warehouse",
    whatIsWrong: `This shipment goes to a warehouse in ${b.destinationCity ?? "the destination"}, but no delivery appointment is booked. Warehouses usually turn away trucks without a slot, which causes re-delivery fees and delays.`,
    howToFix: ["Book a delivery slot with the receiving warehouse for on or after the estimated delivery date, then update this booking to Yes.", "If the address is actually a shop or office, change the destination type to Business address."] })];
}

/** R-09 — every item has a country of origin. */
export function checkR09(items: Item[]): Issue[] {
  return items.flatMap((it, i) => (it.countryOfOrigin ? [] : [ruleIssue("R-09", { scope: "item", itemIndex: i, sku: it.sku, fields: ["countryOfOrigin"], title: "Country of origin missing",
    whatIsWrong: `${itemLabel(it, i)} has no country of origin. Customs needs to know where the product was made (not where it ships from) to set the duty.`,
    howToFix: [`Add where ${it.sku ?? "this item"} was manufactured: ${ITEM_ORIGIN_COUNTRIES.join(", ")}.`] })]));
}

/** R-10 — ready date not before today (UK time). Today itself passes. */
export function checkR10(b: Booking, today: string): Issue[] {
  if (!b.readyToShipDate || !isBefore(b.readyToShipDate, today)) return [];
  const ago = daysBetween(b.readyToShipDate, today);
  return [ruleIssue("R-10", { scope: "booking", fields: ["readyToShipDate"], title: "Ready-to-ship date is in the past",
    whatIsWrong: `Ready to ship date is ${formatDDMMYYYY(b.readyToShipDate)}, ${ago} day${ago === 1 ? "" : "s"} before today (${formatDDMMYYYY(today)}). A carrier can't collect in the past, and delivery estimates will be wrong.`,
    howToFix: [`Enter the real date the goods will be packed and ready — today (${formatDDMMYYYY(today)}) or later. Earliest collection would be ${formatDDMMYYYY(collectionDate(today, today))}.`] })];
}

/* ========================================================================== */
/* 10. ADVISORY CHECKS A-xx (from UK export invoice guidance; never change status) */
/* ========================================================================== */

export function advisoryChecks(b: Booking, items: Item[], t: BookingTotals): Issue[] {
  const out: Issue[] = [];
  const adv = (code: string, title: string, what: string, fix: string[], extra: Partial<Issue> = {}): Issue =>
    ({ code, severity: "Advisory", scope: "booking", fields: [], title, whatIsWrong: what, howToFix: fix, ...extra });

  items.forEach((it, i) => {
    // A-01 Vague description (invoice must have a plain-English description)
    const d = clean(it.description);
    if (d && (d.length < CONFIG.MIN_DESCRIPTION_CHARS || /^(goods|items?|products?|stuff|misc(ellaneous)?|samples?|parts?|gifts?|various|general cargo|merchandise)$/.test(d)))
      out.push(adv("A-01", "Description is too vague for customs", `"${it.description}" doesn't say what the product is.`, ["Use a plain-English description: what it is, what it's made of, what it's for (e.g. \"Ceramic coffee mug, 350 ml\")."], { scope: "item", itemIndex: i, sku: it.sku, fields: ["description"] }));
    // A-02 Non-UK origin → may not get zero tariff under UK–EU trade agreement
    if (it.countryOfOrigin && it.countryOfOrigin !== "United Kingdom")
      out.push(adv("A-02", "Made outside the UK — EU import duty may apply", `${itemLabel(it, i)} was made in ${it.countryOfOrigin}. Goods must originate in the UK (or EU) to qualify for zero tariff under the UK–EU Trade and Cooperation Agreement, so duty may be charged on arrival.`, ["Check the duty with your buyer or customs broker; make sure the invoice shows the real country of origin."], { scope: "item", itemIndex: i, sku: it.sku, fields: ["countryOfOrigin"] }));
    // A-06 HS code only 6 digits — declarations normally need 8 (UK export) / 10 (EU import)
    const hs = normaliseHs(it.hsCodeRaw);
    if (hs.digitCount === 6)
      out.push(adv("A-06", "Full commodity code recommended", `${itemLabel(it, i)} has a 6-digit HS code (${hs.digits}). That passes our check, but UK export declarations use an 8-digit commodity code and EU import declarations a 10-digit one.`, ["Look up the full code on the UK Trade Tariff and give it to your customs agent."], { scope: "item", itemIndex: i, sku: it.sku, fields: ["hsCodeRaw"] }));
  });
  // A-03 Gross barely above net → probably excludes packaging / pallets
  if (t.packagingWeightKg != null && t.packagingWeightKg >= 0 && isPositiveInt(b.pallets) && t.packagingWeightKg < CONFIG.MIN_TARE_PER_PALLET_KG * (b.pallets as number))
    out.push(adv("A-03", "Gross weight may not include pallets and packaging", `Gross weight is only ${kg(t.packagingWeightKg)} more than the goods themselves. ${b.pallets} pallet${b.pallets === 1 ? "" : "s"} plus cartons usually weigh at least ${kg(CONFIG.MIN_TARE_PER_PALLET_KG * (b.pallets as number))}.`, ["Re-weigh the loaded pallets. An under-stated gross weight can be rejected by the carrier."], { fields: ["totalGrossWeightKg"] }));
  // A-04 Business address without appointment → suggest arranging a time
  if (b.destinationType === "Business address" && b.deliveryAppointmentBooked === false)
    out.push(adv("A-04", "Let the receiver know when to expect delivery", "Business addresses don't need a booked slot, but someone must be there to receive pallets.", ["Share the estimated delivery date with the receiver and confirm they can unload pallets."]));
  // A-05 Ready date on a weekend
  if (b.readyToShipDate && isWeekend(b.readyToShipDate) && CONFIG.TRANSIT_DAY_MODE === "business")
    out.push(adv("A-05", "Ready date is a weekend", `${formatDDMMYYYY(b.readyToShipDate)} is a ${weekdayName(b.readyToShipDate)}; collection will be on ${formatDDMMYYYY(nextWorkingDay(b.readyToShipDate))}.`, ["No action needed unless you can get a weekend collection."], { fields: ["readyToShipDate"] }));
  // A-07 Declared value tolerance used (within 1% but not exact)
  if (t.declaredValueDiff != null && t.declaredValueDiff !== 0 && t.declaredValueDiffPct != null && t.declaredValueDiffPct <= CONFIG.VALUE_TOLERANCE_PCT)
    out.push(adv("A-07", "Declared value is close but not exact", `Declared value differs from the items by ${gbp(Math.abs(t.declaredValueDiff))} (${t.declaredValueDiffPct}%) — within the 1% allowed.`, [`For a clean invoice, set it to exactly ${gbp(t.sumItemValue)}.`], { fields: ["totalDeclaredValue"] }));
  // A-08 Commercial invoice fields we don't collect (from gov.uk guidance) — always shown once, as a checklist
  out.push(adv("A-08", "Commercial invoice checklist", "Our checks cover counts, values, weights, HS codes and origin. Your commercial invoice also needs: invoice number and date; seller and buyer full name, address and contact; consignee if different from the buyer; related paperwork number/date (purchase order, proforma, contract); payment method and any discounts; number and type of packages and package marks (e.g. carton 1 of 90); Incoterms agreed with the buyer; transport details (means and route); extra charges such as freight and insurance.", ["Fill these in on the invoice before collection. We pre-fill what we can (transport, packages, weights, values, HS codes, origin)."]));
  return out;
}

/* ========================================================================== */
/* 11. STATUS AGGREGATION                                                      */
/* ========================================================================== */

const SEV_ORDER: Record<Severity, number> = { Red: 0, Data: 1, Amber: 2, Advisory: 3 };
export function aggregateStatus(issues: Issue[]): { status: BookingStatus; canConfirm: boolean; needsAmberAcknowledgement: boolean } {
  const hasRed = issues.some((i) => i.severity === "Red");
  const hasData = issues.some((i) => i.severity === "Data");
  const hasAmber = issues.some((i) => i.severity === "Amber");
  const status: BookingStatus = hasRed ? "RED" : hasData ? "INCOMPLETE" : hasAmber ? "AMBER" : "GREEN";
  return { status, canConfirm: status === "AMBER" || status === "GREEN", needsAmberAcknowledgement: status === "AMBER" };
}
export const sortIssues = (xs: Issue[]) =>
  [...xs].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.code.localeCompare(b.code) || (a.itemIndex ?? -1) - (b.itemIndex ?? -1));

/* ========================================================================== */
/* 12. RECOMMENDATION ENGINE                                                   */
/* ========================================================================== */

/** Lower is better for cost & transit, higher for on-time. Min-max normalised to 0–1 (1 = best). */
function balancedScores(evals: CarrierEval[], highValue = false) {
  const w = highValue ? { cost: 0.3, speed: 0.3, reliability: 0.4 } : CONFIG.BALANCED_WEIGHTS;
  const costs = evals.map((e) => e.cost ?? e.carrier.pricePerPallet);
  const days = evals.map((e) => e.carrier.transitDays);
  const ots = evals.map((e) => e.carrier.onTimePct);
  const norm = (v: number, xs: number[], lowerBetter: boolean) => {
    const mn = Math.min(...xs), mx = Math.max(...xs);
    if (mx === mn) return 1;
    return lowerBetter ? (mx - v) / (mx - mn) : (v - mn) / (mx - mn);
  };
  evals.forEach((e, i) => {
    e.score = round(w.cost * norm(costs[i], costs, true) + w.speed * norm(days[i], days, true) + w.reliability * norm(ots[i], ots, false), 4);
  });
}

/** Sort comparator for a priority; ties broken by on-time ↓, cost ↑, transit ↑, carrier name. */
export function comparatorFor(priority: Priority) {
  const tie = (a: CarrierEval, b: CarrierEval) =>
    b.carrier.onTimePct - a.carrier.onTimePct || (a.cost ?? a.carrier.pricePerPallet) - (b.cost ?? b.carrier.pricePerPallet) ||
    a.carrier.transitDays - b.carrier.transitDays || a.carrier.carrier.localeCompare(b.carrier.carrier);
  return (a: CarrierEval, b: CarrierEval) => {
    switch (priority) {
      case "Cheapest": return (a.cost ?? a.carrier.pricePerPallet) - (b.cost ?? b.carrier.pricePerPallet) || tie(a, b);
      case "Fastest": return a.carrier.transitDays - b.carrier.transitDays || tie(a, b);
      case "Most reliable": return b.carrier.onTimePct - a.carrier.onTimePct || tie(a, b);
      case "Balanced": return (b.score ?? 0) - (a.score ?? 0) || tie(a, b);
    }
  };
}

export function recommend(b: Booking, totals: BookingTotals, hasRedOrData: boolean, today: string = todayISO()): Recommendation {
  const priority = b.sellerPriority ?? "Balanced"; // default when unknown; say so in the reason
  const evals = routeCarriers(b.destinationCountry).map((c) => evaluateCarrier(c, b, totals, today));
  const empty: Recommendation = { priority: b.sellerPriority, priorityPick: null, recommended: null, runnerUp: null, allOptions: evals,
    noEligibleCarrier: true, fallbackReason: "Destination country is missing, so carriers can't be compared yet.", label: "No carrier fits", reasonFacts: [] };
  if (!evals.length) return empty;

  // Priority pick: ignores weight (so R-05 can surface), respects deadline/budget/exclusions where possible
  const softPool = evals.filter((e) => e.meetsDeadline !== false && e.withinBudget !== false && !e.excludedBySeller);
  const pickPool = softPool.length ? softPool : evals;
  balancedScores(pickPool, !!b.prefs?.highValueOrFragile);
  const priorityPick = [...pickPool].sort(comparatorFor(priority))[0];

  // Recommended: best ELIGIBLE (all hard constraints)
  const eligible = evals.filter((e) => e.eligible);
  let recommended: CarrierEval | null = null, runnerUp: CarrierEval | null = null, fallbackReason: string | null = null;
  if (eligible.length) {
    balancedScores(eligible, !!b.prefs?.highValueOrFragile);
    const ranked = [...eligible].sort(comparatorFor(priority));
    recommended = ranked[0]; runnerUp = ranked[1] ?? null;
  } else {
    // Relax in this order: budget → deadline (keep weight & exclusions) ; if weight fails everywhere, no carrier fits.
    const weightOk = evals.filter((e) => e.fitsWeight !== false && !e.excludedBySeller);
    if (weightOk.length) {
      const deadlineOk = weightOk.filter((e) => e.meetsDeadline !== false);
      if (deadlineOk.length) {
        recommended = [...deadlineOk].sort(comparatorFor(priority))[0];
        fallbackReason = `No option fits your budget; ${recommended.carrier.carrier} is the best that meets everything else (${gbp(recommended.cost)}).`;
      } else {
        recommended = [...weightOk].sort(comparatorFor("Fastest"))[0];
        fallbackReason = `No option arrives by ${formatDDMMYYYY(earliestDeadline(b.prefs ?? {}))}; the fastest that can take your pallets arrives ${formatDDMMYYYY(recommended.etaDate)}.`;
      }
    } else {
      fallbackReason = `No carrier on this route can take ${kg(totals.weightPerPalletKg)} per pallet. Add pallets (see R-05) and we'll recommend again.`;
    }
  }

  const facts: string[] = [];
  if (!b.sellerPriority) facts.push("Seller priority not given — used Balanced.");
  if (recommended) {
    const c = recommended.carrier;
    facts.push(`Priority: ${priority}.`);
    facts.push(`${c.carrier} ${c.service}: ${gbp(recommended.cost)} for ${b.pallets ?? "?"} pallet(s) at ${gbp(c.pricePerPallet)} each; ${c.transitDays} ${CONFIG.TRANSIT_DAY_MODE === "business" ? "working " : ""}days; ${c.onTimePct}% on time; max ${c.maxKgPerPallet} kg/pallet.`);
    facts.push(`Collection ${formatDDMMYYYY(recommended.collectionDate)}, estimated delivery ${formatDDMMYYYY(recommended.etaDate)}.`);
    if (b.readyToShipDate && isBefore(b.readyToShipDate, today)) facts.push(`Ready date ${formatDDMMYYYY(b.readyToShipDate)} is in the past, so estimates assume collection from today.`);
    if (priority === "Balanced") {
      const w = b.prefs?.highValueOrFragile ? { cost: 0.3, speed: 0.3, reliability: 0.4 } : CONFIG.BALANCED_WEIGHTS;
      facts.push(`Balanced score ${recommended.score} out of 1 (weights: cost ${w.cost}, speed ${w.speed}, reliability ${w.reliability}${b.prefs?.highValueOrFragile ? " — reliability weighted up because goods are high-value/fragile" : ""}).`);
    }
    if (runnerUp) {
      const dCost = (runnerUp.cost ?? 0) - (recommended.cost ?? 0);
      const dDays = runnerUp.carrier.transitDays - c.transitDays;
      const dOt = runnerUp.carrier.onTimePct - c.onTimePct;
      facts.push(`Runner-up ${runnerUp.carrier.carrier} ${runnerUp.carrier.service}: ${dCost >= 0 ? gbp(dCost) + " more" : gbp(-dCost) + " less"}, ${dDays === 0 ? "same speed" : `${Math.abs(dDays)} day${Math.abs(dDays) === 1 ? "" : "s"} ${dDays > 0 ? "slower" : "faster"}`}, ${dOt === 0 ? "same on-time rate" : `${Math.abs(dOt)} percentage point${Math.abs(dOt) === 1 ? "" : "s"} ${dOt > 0 ? "more" : "less"} reliable`}.`);
    }
    if (priorityPick && priorityPick.carrier.id !== c.id) facts.push(`${priorityPick.carrier.carrier} ${priorityPick.carrier.service} would match your priority best but can't be used: ${priorityPick.ineligibleReasons.join("; ")}.`);
    evals.filter((e) => !e.eligible && e !== priorityPick).forEach((e) => facts.push(`${e.carrier.carrier} excluded: ${e.ineligibleReasons.join("; ")}.`));
    const dl = earliestDeadline(b.prefs ?? {});
    if (dl && recommended.etaDate) {
      const spare = daysBetween(recommended.etaDate, dl);
      facts.push(!recommended.meetsDeadline ? `Misses your ${formatDDMMYYYY(dl)} deadline.` : spare === 0 ? `Arrives exactly on your ${formatDDMMYYYY(dl)} deadline (no spare days).` : `Arrives ${spare} day(s) before your ${formatDDMMYYYY(dl)} deadline.`);
    }
  }
  if (fallbackReason) facts.push(fallbackReason);

  return { priority: b.sellerPriority, priorityPick, recommended, runnerUp, allOptions: evals,
    noEligibleCarrier: !eligible.length, fallbackReason,
    label: !recommended ? "No carrier fits" : hasRedOrData ? "Recommended once fixed" : "Recommended", reasonFacts: facts };
}

/** Which carrier R-05 is checked against. */
export function pickR05Carrier(b: Booking, rec: Recommendation): CarrierEval | null {
  if (b.chosenCarrierId) return rec.allOptions.find((e) => e.carrier.id === b.chosenCarrierId) ?? null;
  if (CONFIG.R05_MODE === "recommended") return rec.recommended ?? rec.priorityPick;
  return rec.priorityPick;
}

/* ========================================================================== */
/* 13. runAll() — THE ONE ENTRY POINT                                          */
/* ========================================================================== */

export interface RunOptions {
  now?: Date; // inject in tests
  geminiR06Verdicts?: Record<number, boolean | undefined>;
  /**
   * runFile() only: R-06 verdicts per Booking ID (item index → verdict). Item
   * indexes restart at 0 for every booking, so one file-wide index map would
   * apply a verdict to the same index in every booking.
   */
  geminiR06VerdictsByBooking?: Record<string, Record<number, boolean | undefined>>;
  allBookingIds?: string[];
}

export function runAll(b: Booking, items: Item[], opts: RunOptions = {}): BookingResult {
  const today = todayISO(opts.now);
  const totals = computeTotals(b, items);
  const dataIssues = validateInputs(b, items, opts.allBookingIds);

  // Rules that don't depend on the carrier
  const issues: Issue[] = [
    ...checkR01(items), ...checkR02(b, items, totals), ...checkR03(items), ...checkR04(b, items, totals),
    ...checkR06(items, opts.geminiR06Verdicts), ...checkR07(b, items, totals), ...checkR08(b), ...checkR09(items), ...checkR10(b, today),
  ];
  // Recommendation (needs to know whether the booking is already blocked)
  const preBlocked = issues.some((i) => i.severity === "Red") || dataIssues.length > 0;
  let rec = recommend(b, totals, preBlocked, today);
  const r05 = checkR05(b, totals, pickR05Carrier(b, rec), rec.allOptions);
  issues.push(...r05);
  if (r05.length && rec.label === "Recommended") rec = { ...rec, label: "Recommended once fixed" };

  // Advisory
  issues.push(...advisoryChecks(b, items, totals));

  // Rule results table (pass / fail / not evaluable)
  const ruleResults = {} as BookingResult["ruleResults"];
  (Object.keys(RULES) as RuleId[]).forEach((id) => {
    const failed = issues.some((i) => i.code === id);
    const inp = RULE_INPUTS[id];
    const missing = inp.booking.some((f) => b[f] == null) ||
      (inp.item.length > 0 && (items.length === 0 || items.some((it) => inp.item.some((f) => f !== "hsCodeRaw" && f !== "countryOfOrigin" && it[f] == null))));
    ruleResults[id] = failed ? "fail" : missing ? "not_evaluable" : "pass";
  });

  const all = sortIssues([...issues, ...dataIssues]);
  const agg = aggregateStatus(all);
  const missingFields = [
    ...REQUIRED_BOOKING_FIELDS.filter((f) => b[f] == null).map((f) => FIELD_LABELS[f]),
    ...items.flatMap((it, i) => REQUIRED_ITEM_FIELDS.filter((f) => it[f] == null).map((f) => `${it.sku ?? "item " + (i + 1)}: ${FIELD_LABELS[f]}`)),
  ];
  return { bookingId: b.bookingId, ...agg, issues: all, ruleResults, totals, recommendation: rec, checkedAgainstDate: today, missingFields };
}

/** Whole-file run (Part 2). */
export function runFile(bookings: Booking[], items: Item[], opts: RunOptions = {}) {
  const { byId, orphans } = groupItems(bookings, items);
  const ids = bookings.map((b) => b.bookingId);
  const results = bookings.map((b) => runAll(b, byId.get(b.bookingId) ?? [], {
    ...opts, allBookingIds: ids,
    geminiR06Verdicts: opts.geminiR06VerdictsByBooking?.[b.bookingId] ?? opts.geminiR06Verdicts,
  }));
  const summary = {
    total: results.length,
    red: results.filter((r) => r.status === "RED").length,
    incomplete: results.filter((r) => r.status === "INCOMPLETE").length,
    amber: results.filter((r) => r.status === "AMBER").length,
    green: results.filter((r) => r.status === "GREEN").length,
    ruleFailCounts: Object.fromEntries((Object.keys(RULES) as RuleId[]).map((id) => [id, results.filter((r) => r.ruleResults[id] === "fail").length])),
  };
  return { results, fileIssues: orphanItemIssues(orphans), summary };
}

/* ========================================================================== */
/* 14. diffResults() — WHAT CHANGED AFTER A MID-WAY EDIT                       */
/* ========================================================================== */

export interface ChangeReport {
  fieldChanges: { field: string; from: unknown; to: unknown }[];
  totalsChanges: { metric: string; from: number | null; to: number | null }[];
  newlyFailing: string[]; // issue codes (with SKU) that appeared
  nowPassing: string[]; // issue codes that disappeared
  statusChange: { from: BookingStatus; to: BookingStatus } | null;
  recommendationChange: { from: string | null; to: string | null } | null;
  costChange: { from: number | null; to: number | null } | null;
  etaChange: { from: string | null; to: string | null } | null;
}
const issueKey = (i: Issue) => `${i.code}${i.sku ? ` [${i.sku}]` : i.itemIndex != null ? ` [#${i.itemIndex + 1}]` : ""}`;

export function diffResults(beforeB: Booking, beforeItems: Item[], before: BookingResult, afterB: Booking, afterItems: Item[], after: BookingResult): ChangeReport {
  const fieldChanges: ChangeReport["fieldChanges"] = [];
  (Object.keys({ ...beforeB, ...afterB }) as (keyof Booking)[]).forEach((k) => {
    if (k === "provenance") return;
    if (JSON.stringify(beforeB[k]) !== JSON.stringify(afterB[k])) fieldChanges.push({ field: FIELD_LABELS[k] ?? k, from: beforeB[k], to: afterB[k] });
  });
  const max = Math.max(beforeItems.length, afterItems.length);
  for (let i = 0; i < max; i++) {
    const a = beforeItems[i], z = afterItems[i];
    if (!a) { fieldChanges.push({ field: `Item added`, from: null, to: z.sku }); continue; }
    if (!z) { fieldChanges.push({ field: `Item removed`, from: a.sku, to: null }); continue; }
    (Object.keys({ ...a, ...z }) as (keyof Item)[]).forEach((k) => {
      if (k === "rowRef") return;
      if (JSON.stringify(a[k]) !== JSON.stringify(z[k])) fieldChanges.push({ field: `${z.sku ?? "item " + (i + 1)}: ${FIELD_LABELS[k] ?? k}`, from: a[k], to: z[k] });
    });
  }
  const totalsChanges: ChangeReport["totalsChanges"] = [];
  (Object.keys(after.totals) as (keyof BookingTotals)[]).forEach((k) => {
    if (before.totals[k] !== after.totals[k]) totalsChanges.push({ metric: k, from: before.totals[k] as number | null, to: after.totals[k] as number | null });
  });
  const bk = new Set(before.issues.filter((i) => i.severity !== "Advisory").map(issueKey));
  const ak = new Set(after.issues.filter((i) => i.severity !== "Advisory").map(issueKey));
  const rid = (r: BookingResult) => (r.recommendation.recommended ? r.recommendation.recommended.carrier.id : null);
  const cost = (r: BookingResult) => r.recommendation.recommended?.cost ?? null;
  const eta = (r: BookingResult) => r.recommendation.recommended?.etaDate ?? null;
  return {
    fieldChanges, totalsChanges,
    newlyFailing: [...ak].filter((k) => !bk.has(k)),
    nowPassing: [...bk].filter((k) => !ak.has(k)),
    statusChange: before.status !== after.status ? { from: before.status, to: after.status } : null,
    recommendationChange: rid(before) !== rid(after) ? { from: rid(before), to: rid(after) } : null,
    costChange: cost(before) !== cost(after) ? { from: cost(before), to: cost(after) } : null,
    etaChange: eta(before) !== eta(after) ? { from: eta(before), to: eta(after) } : null,
  };
}

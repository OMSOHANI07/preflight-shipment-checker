/**
 * Conversation (V2) shapes. The booking and items use the exact Booking / Item shapes that
 * bookingFromRow / itemFromRow produce, so chat and Excel give identical runAll() results.
 */
import { z } from "zod";
import type { Booking, BookingResult, ChangeReport, Item, RecommendationPrefs } from "@/lib/calculations";

export type Provenance = "stated" | "derived" | "default";
export type Mode = "chat" | "voice";

/** Item fields the conversation can fill. */
export const ITEM_FIELDS = ["sku", "description", "hsCodeRaw", "quantity", "unitPrice", "unitsPerCarton", "cartons", "unitWeightKg", "countryOfOrigin"] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];
export const BOOKING_FIELDS = [
  "sellerName", "originCity", "originCountry", "destinationCity", "destinationCountry", "destinationType", "readyToShipDate",
  "sellerPriority", "pallets", "cartons", "totalDeclaredValue", "currency", "totalGrossWeightKg", "deliveryAppointmentBooked",
] as const;
export type BookingField = (typeof BOOKING_FIELDS)[number];

export interface ConvItem extends Item {
  prov: Partial<Record<ItemField, Provenance>>;
}

/** The question we last asked (what a bare answer like "620" or "yes" refers to). */
export interface Pending {
  questionId: string;
  field: string; // booking field, "item.<field>", "prefs.<field>", "loop.moreItems", "dg", "review", "amberAck", …
  itemIndex?: number;
  /** What kind of question it was (a "confirm" accepts yes/no or a number). */
  kind?: string;
  options?: string[];
}

/** A value we worked out (or a stated value that now conflicts) waiting for the seller's "yes". */
export interface PendingConfirm {
  field: string; // booking field or "item.<field>" or "amberAck"
  itemIndex?: number;
  value: number | null;
  reason: string;
  kind: "derive" | "conflict" | "amber";
}

export interface Turn {
  role: "seller" | "assistant";
  text: string;
  at: string;
  quickReplies?: string[];
  diff?: TurnDiff | null;
}

export interface Snapshot {
  booking: Booking;
  items: ConvItem[];
  prefs: RecommendationPrefs;
  chosenCarrier: CarrierLetter | null;
  dgAnswers: Record<number, boolean | null>;
  itemLoopOpen: boolean;
}

export type CarrierLetter = "A" | "B" | "C";

export interface TurnDiff {
  fields: { field: string; from: string; to: string }[];
  fixed: string[];
  newIssues: string[];
  status: { from: string; to: string } | null;
  carrier: { from: string | null; to: string | null } | null;
  cost: { from: string; to: string } | null;
  eta: { from: string; to: string } | null;
  cascade: string[];
}

export interface ConversationState {
  id: string;
  version: number;
  booking: Booking;
  items: ConvItem[];
  prefs: RecommendationPrefs;
  chosenCarrier: CarrierLetter | null;
  pending: Pending | null;
  pendingConfirm: PendingConfirm | null;
  history: Turn[];
  undoStack: Snapshot[];
  lastResult: BookingResult | null;
  confirmed: { at: string; reference: string } | null;
  askedOnce: string[];
  mode: Mode;
  /** Seller's answer to the R-06 safety question per item index (true = restricted). null = "don't know". */
  dgAnswers: Record<number, boolean | null>;
  /** Still collecting products (Q-18 not yet answered "no"). */
  itemLoopOpen: boolean;
  /** Derived values the seller rejected — ask for the value instead of proposing it again. */
  declined: string[];
  /** Times each question was answered with something we couldn't read (after 2 → show options). */
  failures: Record<string, number>;
  /** Number of the next auto SKU (ITEM-n). */
  nextAutoSku: number;
}

/* ---------------- Gemini extraction contract (raw values; code normalises) ---------------- */

const raw = z.union([z.string(), z.number(), z.boolean()]).nullish().transform((v) => (v == null ? null : v));
export const ExtractionSchema = z.object({
  intent: z.enum(["provide", "change", "undo", "question", "confirm", "reject", "start_over", "other"]).catch("provide"),
  booking: z.object({
    sellerName: raw, originCity: raw, originCountry: raw, destinationCity: raw, destinationCountry: raw, destinationType: raw,
    readyToShipDate: raw, sellerPriority: raw, pallets: raw, cartons: raw, totalDeclaredValue: raw, currency: raw,
    totalGrossWeightKg: raw, deliveryAppointmentBooked: raw,
  }).partial().nullish().transform((v) => v ?? {}),
  items: z.array(z.object({
    ref: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "pending" : v)),
    sku: raw, description: raw, hsCodeRaw: raw, quantity: raw, unitPrice: raw, unitsPerCarton: raw, cartons: raw,
    unitWeightKg: raw, countryOfOrigin: raw,
  }).partial({ sku: true, description: true, hsCodeRaw: true, quantity: true, unitPrice: true, unitsPerCarton: true, cartons: true, unitWeightKg: true, countryOfOrigin: true })).max(20).nullish().transform((v) => v ?? []),
  removeItems: z.array(z.union([z.string(), z.number()])).max(20).nullish().transform((v) => v ?? []),
  prefs: z.object({
    requiredDeliveryDate: raw, appointmentDate: raw, maxBudgetGbp: raw, highValueOrFragile: raw,
    excludeCarriers: z.array(z.string()).nullish(),
  }).partial().nullish().transform((v) => v ?? {}),
  chosenCarrier: z.string().nullish().transform((v) => v ?? null),
  palletDelta: z.number().int().min(-20).max(20).nullish().transform((v) => v ?? null),
  yesNo: z.boolean().nullish().transform((v) => v ?? null),
  question: z.string().max(500).nullish().transform((v) => v ?? null),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedItem = Extraction["items"][number];

export const emptyExtraction = (): Extraction => ExtractionSchema.parse({ intent: "other" });

/* ---------------- what one turn returns ---------------- */

export interface NextQuestion {
  id: string;
  kind: "ask" | "reask" | "confirm" | "rule" | "dg" | "optional" | "more-items" | "review" | "blocked" | "amber" | "done";
  field: string;
  itemIndex?: number;
  text: string;
  voiceText: string;
  options: string[];
  /** Set for derive/conflict confirmations. */
  confirm?: PendingConfirm;
}

export interface TurnResponse {
  /** Guardrail flags raised by this message (names only — for counting, never logged with text). */
  guardrailFlags?: string[];
  state: ConversationState;
  reply: string;
  speak: string;
  quickReplies: string[];
  result: BookingResult | null;
  diff: TurnDiff | null;
  replySource: "ai" | "template";
  extractionSource: "ai" | "fallback" | "mock";
}

export type { ChangeReport };

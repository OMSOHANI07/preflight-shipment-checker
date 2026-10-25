/** Zod schemas: API contracts and validation of Gemini JSON output. */
import { z } from "zod";
import { DESTINATION_COUNTRIES, DESTINATION_TYPES, PRIORITIES, type Booking, type Item } from "@/lib/calculations";

export const BookingSchema: z.ZodType<Booking> = z.object({
  bookingId: z.string(),
  sellerName: z.string().nullable(),
  originCity: z.string().nullable(),
  originCountry: z.string().nullable(),
  destinationCity: z.string().nullable(),
  destinationCountry: z.enum(DESTINATION_COUNTRIES).nullable(),
  destinationType: z.enum(DESTINATION_TYPES).nullable(),
  readyToShipDate: z.string().nullable(),
  sellerPriority: z.enum(PRIORITIES).nullable(),
  pallets: z.number().nullable(),
  cartons: z.number().nullable(),
  totalDeclaredValue: z.number().nullable(),
  currency: z.string().nullable(),
  totalGrossWeightKg: z.number().nullable(),
  deliveryAppointmentBooked: z.boolean().nullable(),
}).passthrough() as unknown as z.ZodType<Booking>;

export const ItemSchema: z.ZodType<Item> = z.object({
  bookingId: z.string(),
  rowRef: z.string().optional(),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  hsCodeRaw: z.union([z.string(), z.number()]).nullable(),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  unitsPerCarton: z.number().nullable(),
  cartons: z.number().nullable(),
  unitWeightKg: z.number().nullable(),
  countryOfOrigin: z.string().nullable(),
});

/** Gemini explanation output (RECOMMENDATION_RULES §8.2 + confirmation and issue summaries). */
export const ExplanationSchema = z.object({
  headline: z.string().min(1).max(200),
  reason: z.string().min(1).max(600),
  tradeoff: z.string().max(400).nullable(),
  exclusions: z.array(z.string().max(300)).max(5),
  caveat: z.string().max(400).nullable(),
  confirmation: z.string().min(1).max(1200),
  issueSummaries: z.array(z.object({ code: z.string(), summary: z.string().max(400) })).max(40),
});
export type ExplanationText = z.infer<typeof ExplanationSchema>;
export type Explanation = ExplanationText & { source: "ai" | "fallback" };

/** R-06 second opinion. */
export const R06ItemSchema = z.object({
  key: z.string().max(200),
  sku: z.string().max(200).nullable(),
  description: z.string().max(500).nullable(),
  hsCode: z.string().max(40).nullable(),
  matched: z.array(z.string().max(80)).max(20),
});
export const R06RequestSchema = z.object({ items: z.array(R06ItemSchema).max(200) });
export const R06VerdictSchema = z.object({ key: z.string(), restricted: z.boolean(), reason: z.string().max(400) });
export const R06ResponseSchema = z.object({ verdicts: z.array(R06VerdictSchema) });
export type R06Verdict = z.infer<typeof R06VerdictSchema>;

export const ConfirmRequestSchema = z.object({
  uploadId: z.string().uuid().nullable(),
  bookingRowId: z.string().uuid().nullable(),
  bookingId: z.string().max(200),
  status: z.enum(["RED", "INCOMPLETE", "AMBER", "GREEN"]),
  acknowledgedAmber: z.boolean(),
  carrierId: z.string().max(20).nullable(),
});

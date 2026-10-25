/** Neon Postgres schema (Drizzle). Carriers and rules mirror Sheets 3 and 4 and are seeded from calculations.ts. */
import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const carriers = pgTable("carriers", {
  id: text("id").primaryKey(), // e.g. "A-DE"
  carrier: text("carrier").notNull(),
  service: text("service").notNull(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  pricePerPallet: numeric("price_per_pallet", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  transitDays: integer("transit_days").notNull(),
  onTimePct: numeric("on_time_pct", { mode: "number" }).notNull(),
  maxKgPerPallet: numeric("max_kg_per_pallet", { mode: "number" }).notNull(),
});

export const rules = pgTable("rules", {
  ruleId: text("rule_id").primaryKey(),
  text: text("text").notNull(),
  severity: text("severity").notNull(),
});

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileName: text("file_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  summary: jsonb("summary").notNull(),
});

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id").notNull().references(() => uploads.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  bookingId: text("booking_id").notNull(),
  raw: jsonb("raw").notNull(),
  normalised: jsonb("normalised").notNull(),
  result: jsonb("result").notNull(),
  status: text("status").notNull(),
});

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingRowId: uuid("booking_row_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  rowRef: text("row_ref"),
  raw: jsonb("raw").notNull(),
  normalised: jsonb("normalised").notNull(),
});

export const confirmations = pgTable("confirmations", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingRowId: uuid("booking_row_id").references(() => bookings.id, { onDelete: "cascade" }),
  reference: text("reference").notNull(),
  bookingId: text("booking_id").notNull(),
  status: text("status").notNull(),
  acknowledgedAmber: boolean("acknowledged_amber").notNull().default(false),
  carrierId: text("carrier_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

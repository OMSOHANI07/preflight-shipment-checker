/**
 * Stress-test bookings (Build Plan §4.2, prompt §7.2). Each case lists the
 * official rules it is meant to break and the expected status; the test in
 * tests/stress.test.ts asserts both against runFile().
 */
import type { BookingStatus, RuleId } from "@/lib/calculations";

type Cell = string | number | Date | null;
export interface StressBooking {
  row: Record<string, Cell>;
  items: Record<string, Cell>[];
  expectStatus: BookingStatus;
  expectFails: RuleId[];
  note: string;
}

const READY = "12-01-2027"; // a Tuesday, safely in the future

const booking = (id: string, over: Record<string, Cell> = {}): Record<string, Cell> => ({
  "Booking ID": id, "Seller name": "Northfield Goods", "Origin city": "Manchester", "Origin country": "United Kingdom",
  "Destination city": "Frankfurt", "Destination country": "Germany", "Destination type": "Warehouse",
  "Ready to ship date": READY, "Seller priority": "Cheapest", Pallets: 3, Cartons: 90, "Total declared value": 5400,
  Currency: "GBP", "Total gross weight (kg)": 620, "Delivery appointment booked": "Yes", ...over,
});
const mug = (id: string, over: Record<string, Cell> = {}): Record<string, Cell> => ({
  "Booking ID": id, SKU: "MUG-01", Description: "Ceramic coffee mug, 350 ml", "HS code": 69120000,
  "Quantity (units)": 1080, "Unit price": 5, "Units per carton": 12, Cartons: 90, "Unit weight (kg)": 0.5,
  "Country of origin": "United Kingdom", ...over,
});

export const STRESS_BOOKINGS: StressBooking[] = [
  { note: "Clean booking", row: booking("BK-T01"), items: [mug("BK-T01")], expectStatus: "GREEN", expectFails: [] },
  { note: "R-01 only: HS code too short", row: booking("BK-T02", { "Seller name": "Hartley Ceramics", "Destination city": "Berlin" }),
    items: [mug("BK-T02", { "HS code": "6912" })], expectStatus: "RED", expectFails: ["R-01"] },
  { note: "R-02 only: declared value 7.4% low (date stored as a real Excel date)",
    row: booking("BK-T03", { "Seller name": "Pennine Homeware", "Origin city": "Leeds", "Destination city": "Paris", "Destination country": "France",
      "Seller priority": "Fastest", "Total declared value": 5000, "Ready to ship date": new Date(Date.UTC(2027, 0, 13)) }),
    items: [mug("BK-T03")], expectStatus: "RED", expectFails: ["R-02"] },
  { note: "R-03 only: 12 × 85 ≠ 1,080", row: booking("BK-T04", { Cartons: 85 }), items: [mug("BK-T04", { Cartons: 85 })],
    expectStatus: "RED", expectFails: ["R-03"] },
  { note: "R-04 only: booking says 84 cartons, items say 90", row: booking("BK-T05", { Cartons: 84, "Destination city": "Hamburg" }),
    items: [mug("BK-T05")], expectStatus: "RED", expectFails: ["R-04"] },
  { note: "R-05 only: 533 kg per pallet vs Carrier A's 500 kg", row: booking("BK-T06", { "Total gross weight (kg)": 1600 }),
    items: [mug("BK-T06")], expectStatus: "RED", expectFails: ["R-05"] },
  { note: "R-06 only: lithium power bank", row: booking("BK-T07", { "Seller name": "Volt Accessories", "Destination city": "Amsterdam", "Destination country": "Netherlands", "Seller priority": "Balanced" }),
    items: [mug("BK-T07", { SKU: "PB-01", Description: "Lithium-ion power bank 10000 mAh", "HS code": 85076000 })], expectStatus: "RED", expectFails: ["R-06"] },
  { note: "R-07 only: gross 500 kg but goods weigh 540 kg", row: booking("BK-T08", { "Total gross weight (kg)": 500 }),
    items: [mug("BK-T08")], expectStatus: "AMBER", expectFails: ["R-07"] },
  { note: "R-08 only: warehouse with no appointment", row: booking("BK-T09", { "Delivery appointment booked": "No", "Destination city": "Rotterdam", "Destination country": "Netherlands", "Seller priority": "Most reliable" }),
    items: [mug("BK-T09")], expectStatus: "AMBER", expectFails: ["R-08"] },
  { note: "R-09 only: no country of origin", row: booking("BK-T10", { "Origin city": "Birmingham", "Destination city": "Lyon", "Destination country": "France" }),
    items: [mug("BK-T10", { "Country of origin": null })], expectStatus: "AMBER", expectFails: ["R-09"] },
  { note: "R-10 only: ready date in the past", row: booking("BK-T11", { "Ready to ship date": "01-10-2026", "Origin city": "London" }),
    items: [mug("BK-T11")], expectStatus: "AMBER", expectFails: ["R-10"] },
  { note: "Many rules at once (5-digit numeric HS code, lithium item, wrong totals)",
    row: booking("BK-T12", { "Seller name": "Kestrel Trading", Cartons: 84, "Total declared value": 5000, "Total gross weight (kg)": 1600,
      "Delivery appointment booked": "No", "Ready to ship date": "01-10-2026" }),
    items: [
      mug("BK-T12", { "HS code": 90111, Cartons: 85, "Country of origin": null }),
      { "Booking ID": "BK-T12", SKU: "PB-01", Description: "Lithium-ion power bank", "HS code": 850760, "Quantity (units)": 10,
        "Unit price": 5, "Units per carton": 10, Cartons: 1, "Unit weight (kg)": 0.3, "Country of origin": "China" },
    ],
    expectStatus: "RED", expectFails: ["R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-08", "R-09", "R-10"] },
  { note: "Missing required field (pallets blank) → INCOMPLETE", row: booking("BK-T13", { Pallets: null, "Seller name": "Brightside Retail" }),
    items: [mug("BK-T13")], expectStatus: "INCOMPLETE", expectFails: [] },
  { note: "Amber only: gross too low and no appointment", row: booking("BK-T14", { "Seller name": "Dales Kitchenware", "Origin city": "Leeds",
      "Destination city": "Amsterdam", "Destination country": "Netherlands", "Seller priority": "Balanced", "Total gross weight (kg)": 500,
      "Delivery appointment booked": "No" }),
    items: [mug("BK-T14", { "Country of origin": "China" })], expectStatus: "AMBER", expectFails: ["R-07", "R-08"] },
  { note: "Overweight for every carrier: 800 kg per pallet", row: booking("BK-T15", { "Seller name": "Ironbridge Tools", "Total gross weight (kg)": 2400 }),
    items: [mug("BK-T15")], expectStatus: "RED", expectFails: ["R-05"] },
  { note: "Possible R-06: Bluetooth speaker (needs AI or manual check)", row: booking("BK-T16", { "Seller name": "Soundwave Audio",
      "Destination city": "Paris", "Destination country": "France", "Destination type": "Business address", "Delivery appointment booked": "No" }),
    items: [mug("BK-T16", { SKU: "SPK-01", Description: "Bluetooth speaker", "HS code": 85182200, "Unit price": 5 })],
    expectStatus: "GREEN", expectFails: [] },
];

/** An item whose booking doesn't exist (V-11). */
export const ORPHAN_ITEM: Record<string, Cell> = mug("BK-T99", { SKU: "ORPHAN-01", Description: "Enamel camping mug" });

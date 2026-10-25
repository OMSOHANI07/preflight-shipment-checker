/**
 * Server-only database access. Every helper is time-boxed and returns null / falls
 * back to the calculations.ts constants instead of throwing, so the app keeps
 * working when Neon is down or slow.
 */
import "server-only";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { CARRIERS, RULES, type Carrier, type DestinationCountry, type RuleId } from "@/lib/calculations";
import * as schema from "@/db/schema";

const DB_TIMEOUT_MS = 5000;
type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db | null = null;

export function getDb(): Db | null {
  if (!process.env.DATABASE_URL) return null;
  db ??= drizzle(neon(process.env.DATABASE_URL), { schema });
  return db;
}

export async function safe<T>(label: string, fn: (db: Db) => Promise<T>): Promise<T | null> {
  const d = getDb();
  if (!d) return null;
  try {
    return await Promise.race([fn(d), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), DB_TIMEOUT_MS))]);
  } catch (e) {
    console.warn(`[db] ${label} failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown error"}`);
    return null;
  }
}

/** Carriers from the DB; the CARRIERS constant if the DB is unavailable. The constant always wins on mismatch. */
export async function loadCarriers(): Promise<{ carriers: readonly Carrier[]; source: "db" | "constant" }> {
  const rows = await safe("load carriers", (d) => d.select().from(schema.carriers).orderBy(asc(schema.carriers.destination), asc(schema.carriers.id)));
  if (!rows?.length) return { carriers: CARRIERS, source: "constant" };
  const fromDb: Carrier[] = rows.map((r) => ({
    id: r.id, carrier: r.carrier, service: r.service, originCountry: r.origin, destinationCountry: r.destination as DestinationCountry,
    pricePerPallet: r.pricePerPallet, currency: "GBP", transitDays: r.transitDays, onTimePct: r.onTimePct, maxKgPerPallet: r.maxKgPerPallet,
  }));
  return carriersMatch(fromDb) ? { carriers: CARRIERS, source: "db" } : { carriers: CARRIERS, source: "constant" };
}

export function carriersMatch(fromDb: readonly Carrier[]): boolean {
  const key = (c: Carrier) => [c.id, c.carrier, c.service, c.originCountry, c.destinationCountry, c.pricePerPallet, c.transitDays, c.onTimePct, c.maxKgPerPallet].join("|");
  const a = new Set(fromDb.map(key));
  const ok = a.size === CARRIERS.length && CARRIERS.every((c) => a.has(key(c)));
  if (!ok) console.warn("[db] carriers table differs from the CARRIERS constant — using the constant. Run npm run db:seed.");
  return ok;
}

export async function loadRules(): Promise<{ id: RuleId; text: string; severity: "Red" | "Amber" }[]> {
  const rows = await safe("load rules", (d) => d.select().from(schema.rules).orderBy(asc(schema.rules.ruleId)));
  const fallback = (Object.keys(RULES) as RuleId[]).map((id) => ({ id, ...RULES[id] }));
  // The constant always wins; a drifted DB copy only produces a warning.
  if (rows && !(rows.length === fallback.length && rows.every((r) => RULES[r.ruleId as RuleId]?.text === r.text && RULES[r.ruleId as RuleId]?.severity === r.severity)))
    console.warn("[db] rules table differs from the RULES constant — using the constant. Run npm run db:seed.");
  return fallback;
}

export { eq, schema };

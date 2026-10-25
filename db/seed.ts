/** Idempotent seed: carriers (Sheet 3) and rules (Sheet 4) from calculations.ts.   Run: npm run db:seed */
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { CARRIERS, RULES, type RuleId } from "@/lib/calculations";
import * as schema from "./schema";

config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });
  await db.insert(schema.carriers)
    .values(CARRIERS.map((c) => ({
      id: c.id, carrier: c.carrier, service: c.service, origin: c.originCountry, destination: c.destinationCountry,
      pricePerPallet: c.pricePerPallet, currency: c.currency, transitDays: c.transitDays, onTimePct: c.onTimePct, maxKgPerPallet: c.maxKgPerPallet,
    })))
    .onConflictDoUpdate({
      target: schema.carriers.id,
      set: {
        carrier: sql`excluded.carrier`, service: sql`excluded.service`, origin: sql`excluded.origin`, destination: sql`excluded.destination`,
        pricePerPallet: sql`excluded.price_per_pallet`, currency: sql`excluded.currency`, transitDays: sql`excluded.transit_days`,
        onTimePct: sql`excluded.on_time_pct`, maxKgPerPallet: sql`excluded.max_kg_per_pallet`,
      },
    });
  await db.insert(schema.rules)
    .values((Object.keys(RULES) as RuleId[]).map((id) => ({ ruleId: id, text: RULES[id].text, severity: RULES[id].severity })))
    .onConflictDoUpdate({ target: schema.rules.ruleId, set: { text: sql`excluded.text`, severity: sql`excluded.severity` } });
  console.log(`Seeded ${CARRIERS.length} carriers and ${Object.keys(RULES).length} rules.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

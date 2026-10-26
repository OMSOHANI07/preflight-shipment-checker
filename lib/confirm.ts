/** Records a booking confirmation (V1 card and V2 chat share this). Best effort: works without Neon. */
import "server-only";
import { getDb, safe, schema } from "@/lib/db";

export async function createConfirmation(c: { bookingRowId: string | null; bookingId: string; status: string; acknowledgedAmber: boolean; carrierId: string | null }) {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const reference = `PF-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const saved = getDb()
    ? await safe("save confirmation", (d) => d.insert(schema.confirmations).values({ bookingRowId: c.bookingRowId, reference, bookingId: c.bookingId, status: c.status, acknowledgedAmber: c.acknowledgedAmber, carrierId: c.carrierId }))
    : null;
  return { reference, saved: saved !== null };
}

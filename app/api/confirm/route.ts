/**
 * POST /api/confirm — records a booking confirmation. Enforces RULEBOOK §2.2 again on the
 * server: RED / INCOMPLETE can't be confirmed; AMBER needs the acknowledgement. The status used is
 * the strictest of: the page's claim, the saved result, and a fresh server-side check of the booking
 * with the guardrails (so a page can never upgrade a status, and G-01 goods can never be confirmed).
 */
import type { Booking, BookingStatus, Item } from "@/lib/calculations";
import { createConfirmation } from "@/lib/confirm";
import { safe, schema, eq } from "@/lib/db";
import { runAllWithGuardrails } from "@/lib/guardrails";
import { ConfirmRequestSchema } from "@/lib/schema";

const RANK: Record<BookingStatus, number> = { RED: 0, INCOMPLETE: 1, AMBER: 2, GREEN: 3 };
const worst = (a: BookingStatus, b: BookingStatus) => (RANK[a] <= RANK[b] ? a : b);

export async function POST(req: Request) {
  const body = ConfirmRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  const c = body.data;

  let status = c.status;
  if (c.bookingRowId) {
    const row = await safe("load booking for confirm", (d) => d.select({ status: schema.bookings.status }).from(schema.bookings).where(eq(schema.bookings.id, c.bookingRowId!)).limit(1));
    if (row?.[0]) status = worst(status, row[0].status as BookingStatus);
  }
  if (c.booking && c.items) {
    try { status = worst(status, runAllWithGuardrails(c.booking as unknown as Booking, c.items as unknown as Item[]).status); }
    catch { return Response.json({ ok: false, error: "Invalid booking" }, { status: 400 }); }
  }
  if (status === "RED" || status === "INCOMPLETE")
    return Response.json({ ok: false, error: `A ${status} booking can't be confirmed until its blocking issues are fixed.` }, { status: 409 });
  if (status === "AMBER" && !c.acknowledgedAmber)
    return Response.json({ ok: false, error: "Tick “I understand these warnings” to confirm an AMBER booking." }, { status: 409 });

  const { reference, saved } = await createConfirmation({ bookingRowId: c.bookingRowId, bookingId: c.bookingId, status, acknowledgedAmber: c.acknowledgedAmber, carrierId: c.carrierId });
  return Response.json({ ok: true, reference, saved });
}

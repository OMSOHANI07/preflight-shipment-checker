/**
 * POST /api/confirm — records a booking confirmation. Enforces RULEBOOK §2.2 again on the
 * server: RED / INCOMPLETE can't be confirmed; AMBER needs the acknowledgement. The status
 * comes from the saved result when the booking row exists, so the client can't upgrade it.
 */
import { createConfirmation } from "@/lib/confirm";
import { safe, schema, eq } from "@/lib/db";
import { ConfirmRequestSchema } from "@/lib/schema";

export async function POST(req: Request) {
  const body = ConfirmRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  const c = body.data;

  let status = c.status;
  if (c.bookingRowId) {
    const row = await safe("load booking for confirm", (d) => d.select({ status: schema.bookings.status }).from(schema.bookings).where(eq(schema.bookings.id, c.bookingRowId!)).limit(1));
    if (row?.[0]) status = row[0].status as typeof status;
  }
  if (status === "RED" || status === "INCOMPLETE")
    return Response.json({ ok: false, error: `A ${status} booking can't be confirmed until its blocking issues are fixed.` }, { status: 409 });
  if (status === "AMBER" && !c.acknowledgedAmber)
    return Response.json({ ok: false, error: "Tick “I understand these warnings” to confirm an AMBER booking." }, { status: 409 });

  const { reference, saved } = await createConfirmation({ bookingRowId: c.bookingRowId, bookingId: c.bookingId, status, acknowledgedAmber: c.acknowledgedAmber, carrierId: c.carrierId });
  return Response.json({ ok: true, reference, saved });
}

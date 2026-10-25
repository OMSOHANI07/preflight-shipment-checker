/**
 * POST /api/uploads — saves a checked file so /results/[uploadId] can be shared.
 * Results are computed in the browser by calculations.ts; this route only stores them.
 * If Neon is unavailable it answers { saved: false } and the UI keeps working.
 */
import { z } from "zod";
import type { BookingResult } from "@/lib/calculations";
import { getDb, schema } from "@/lib/db";
import { BookingSchema, ItemSchema } from "@/lib/schema";

export const maxDuration = 30;

const Raw = z.object({ rowNumber: z.number(), values: z.record(z.string(), z.unknown()), display: z.record(z.string(), z.string()) });
const Result = z.custom<BookingResult>((v) => typeof v === "object" && v !== null && "status" in v && "issues" in v);
const Body = z.object({
  fileName: z.string().max(300),
  checkedAt: z.string().max(40),
  bookingHeaders: z.array(z.string()).max(60),
  itemHeaders: z.array(z.string()).max(60),
  notices: z.array(z.object({ level: z.enum(["info", "warning", "error"]), message: z.string().max(1000) })).max(50),
  usedExampleAsDemo: z.boolean(),
  fileIssues: z.array(z.unknown()).max(2000),
  orphanRows: z.array(Raw).max(2000),
  summary: z.unknown(),
  r06: z.unknown(),
  views: z.array(z.object({ booking: BookingSchema, items: z.array(ItemSchema), raw: Raw, itemRaws: z.array(Raw), result: Result })).min(1).max(1000),
});

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ saved: false, error: "Invalid request" }, { status: 400 });
  const db = getDb();
  if (!db) return Response.json({ saved: false, error: "Database not configured" });

  const f = body.data;
  const uploadId = crypto.randomUUID();
  const rowIds = f.views.map(() => crypto.randomUUID());
  try {
    const bookingRows = f.views.map((v, i) => ({
      id: rowIds[i], uploadId, position: i, bookingId: v.booking.bookingId, raw: v.raw, normalised: v.booking, result: v.result, status: v.result.status,
    }));
    const itemRows = f.views.flatMap((v, i) => v.items.map((it, k) => ({
      bookingRowId: rowIds[i], position: k, rowRef: it.rowRef ?? null, raw: v.itemRaws[k] ?? {}, normalised: it,
    })));
    const summary = {
      checkedAt: f.checkedAt, bookingHeaders: f.bookingHeaders, itemHeaders: f.itemHeaders, notices: f.notices,
      usedExampleAsDemo: f.usedExampleAsDemo, fileIssues: f.fileIssues, orphanRows: f.orphanRows, summary: f.summary, r06: f.r06,
    };
    await db.batch([
      db.insert(schema.uploads).values({ id: uploadId, fileName: f.fileName, summary }),
      db.insert(schema.bookings).values(bookingRows),
      ...(itemRows.length ? [db.insert(schema.items).values(itemRows)] : []),
    ]);
    return Response.json({ saved: true, uploadId, rowIds });
  } catch (e) {
    console.warn(`[db] save upload failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown error"}`);
    return Response.json({ saved: false, error: "Could not save" });
  }
}

/** Server-only: rebuild a CheckedFile from Neon for /results/[uploadId]. */
import "server-only";
import { asc, inArray } from "drizzle-orm";
import type { Booking, BookingResult, Issue, Item } from "@/lib/calculations";
import { eq, safe, schema } from "@/lib/db";
import type { FileNotice, RawRow } from "@/lib/parseExcel";
import type { CheckedFile, FileSummary, R06Review } from "@/lib/types";

interface StoredSummary {
  checkedAt: string; bookingHeaders: string[]; itemHeaders: string[]; notices: FileNotice[]; usedExampleAsDemo: boolean;
  fileIssues: Issue[]; orphanRows: RawRow[]; summary: FileSummary; r06: R06Review;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadUpload(uploadId: string): Promise<CheckedFile | null> {
  if (!UUID.test(uploadId)) return null;
  return safe("load upload", async (db) => {
    const [up] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId)).limit(1);
    if (!up) return null;
    const bRows = await db.select().from(schema.bookings).where(eq(schema.bookings.uploadId, uploadId)).orderBy(asc(schema.bookings.position));
    const iRows = bRows.length
      ? await db.select().from(schema.items).where(inArray(schema.items.bookingRowId, bRows.map((b) => b.id))).orderBy(asc(schema.items.position))
      : [];
    const s = up.summary as StoredSummary;
    return {
      uploadId, fileName: up.fileName, checkedAt: s.checkedAt, bookingHeaders: s.bookingHeaders, itemHeaders: s.itemHeaders,
      notices: s.notices, usedExampleAsDemo: s.usedExampleAsDemo, fileIssues: s.fileIssues, orphanRows: s.orphanRows,
      summary: s.summary, r06: s.r06,
      views: bRows.map((b) => {
        const its = iRows.filter((i) => i.bookingRowId === b.id);
        return {
          booking: b.normalised as Booking, items: its.map((i) => i.normalised as Item), raw: b.raw as RawRow,
          itemRaws: its.map((i) => i.raw as RawRow), result: b.result as BookingResult, rowId: b.id,
        };
      }),
    };
  });
}

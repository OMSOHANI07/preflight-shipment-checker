/** Shapes shared by the upload flow, the results page and the API routes. */
import type { Booking, BookingResult, Issue, Item, RuleId } from "@/lib/calculations";
import type { FileNotice, RawRow } from "@/lib/parseExcel";

export interface FileSummary {
  total: number;
  red: number;
  incomplete: number;
  amber: number;
  green: number;
  ruleFailCounts: Record<RuleId, number>;
}

export interface R06Review {
  source: "ai" | "unavailable" | "none";
  verdicts: { bookingId: string; itemIndex: number; sku: string | null; restricted: boolean; reason: string }[];
}

export interface BookingView {
  booking: Booking;
  items: Item[];
  raw: RawRow;
  itemRaws: RawRow[];
  result: BookingResult;
  /** Row id in the bookings table, when the upload was saved. */
  rowId: string | null;
}

export interface CheckedFile {
  uploadId: string | null;
  fileName: string;
  checkedAt: string; // ISO timestamp
  bookingHeaders: string[];
  itemHeaders: string[];
  notices: FileNotice[];
  usedExampleAsDemo: boolean;
  fileIssues: Issue[];
  orphanRows: RawRow[];
  summary: FileSummary;
  r06: R06Review;
  views: BookingView[];
}

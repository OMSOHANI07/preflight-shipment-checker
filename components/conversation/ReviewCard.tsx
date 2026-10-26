"use client";

/**
 * End of the conversation: the SAME BookingCard as V1 (issues, rule table, data, carrier card,
 * confirmation, next steps, invoice checklist, Confirm / PDF / Share). Confirm goes through the
 * conversation so its rules and reference stay in one place; Share saves the booking as an upload.
 */
import { useEffect, useMemo, useState } from "react";
import { formatDDMMYYYY, type BookingResult } from "@/lib/calculations";
import { saveCheckedFile } from "@/lib/checkFile";
import { toRunInputs } from "@/lib/conversation/state";
import type { ConversationState } from "@/lib/conversation/types";
import { BOOKING_COLUMNS, BOOKING_FIELD_BY_COLUMN, ITEM_COLUMNS, ITEM_FIELD_BY_COLUMN, type RawRow } from "@/lib/parseExcel";
import type { BookingView, CheckedFile } from "@/lib/types";
import { useExplanations } from "@/lib/useExplanations";
import { BookingCard } from "../BookingCard";

const show = (field: string, v: unknown) =>
  v == null ? "" : typeof v === "boolean" ? (v ? "Yes" : "No") : field === "readyToShipDate" ? formatDDMMYYYY(String(v)) : String(v);

function rawRow(values: Record<string, unknown>, columns: readonly string[], map: Record<string, string>, rowNumber: number): RawRow {
  const vals: RawRow["values"] = {}, display: RawRow["display"] = {};
  for (const c of columns) { const f = map[c]; const v = values[f]; vals[c] = v == null ? null : typeof v === "boolean" ? (v ? "Yes" : "No") : (v as string | number); display[c] = show(f, v); }
  return { rowNumber, values: vals, display };
}

export function buildView(s: ConversationState, result: BookingResult): BookingView {
  const { booking, items } = toRunInputs(s);
  return {
    booking, items, result, rowId: null,
    raw: rawRow(booking as unknown as Record<string, unknown>, BOOKING_COLUMNS, BOOKING_FIELD_BY_COLUMN, 1),
    itemRaws: items.map((it, i) => rawRow(it as unknown as Record<string, unknown>, ITEM_COLUMNS, ITEM_FIELD_BY_COLUMN, i + 1)),
  };
}

export function ReviewCard({ state, result, onConfirm }: { state: ConversationState; result: BookingResult; onConfirm: (ack: boolean) => Promise<string | null> }) {
  const view = useMemo(() => buildView(state, result), [state, result]);
  const views = useMemo(() => [view], [view]);
  const ex = useExplanations(views).get(view.booking.bookingId + "#0")!;
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "failed">("saving");
  const [open, setOpen] = useState(true);

  // save once per version so Share has a link (/results/[id])
  useEffect(() => {
    let alive = true;
    const file: CheckedFile = {
      uploadId: null, fileName: `Chat booking ${view.booking.bookingId}`, checkedAt: new Date().toISOString(),
      bookingHeaders: [...BOOKING_COLUMNS], itemHeaders: [...ITEM_COLUMNS], notices: [], usedExampleAsDemo: false, fileIssues: [], orphanRows: [],
      summary: { total: 1, red: +(result.status === "RED"), incomplete: +(result.status === "INCOMPLETE"), amber: +(result.status === "AMBER"), green: +(result.status === "GREEN"), ruleFailCounts: Object.fromEntries(Object.entries(result.ruleResults).map(([k, v]) => [k, v === "fail" ? 1 : 0])) as CheckedFile["summary"]["ruleFailCounts"] },
      r06: { source: "none", verdicts: [] }, views: [view],
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while the new version saves
    setSaveState("saving");
    saveCheckedFile(file).then((r) => { if (!alive) return; setUploadId(r?.uploadId ?? null); setSaveState(r ? "saved" : "failed"); });
    return () => { alive = false; };
  }, [view, result, state.version]);

  return (
    <div data-testid="review-card">
      <BookingCard
        view={view} ex={ex} uploadId={uploadId} saveState={saveState} bookingHeaders={[...BOOKING_COLUMNS]} itemHeaders={[...ITEM_COLUMNS]}
        r06={{ source: "none", verdicts: [] }} open={open} onToggle={() => setOpen((o) => !o)} anchorId={view.booking.bookingId}
        onConfirm={onConfirm} confirmedRef={state.confirmed?.reference ?? null}
      />
    </div>
  );
}

"use client";

import type { Issue } from "@/lib/calculations";
import { fieldForHeader } from "@/lib/highlight";
import type { RawRow } from "@/lib/parseExcel";
import { cx, severityClass } from "@/lib/ui";

interface Props {
  bookingHeaders: string[];
  itemHeaders: string[];
  raw: RawRow;
  itemRaws: RawRow[];
  cellIssues: Map<string, Issue[]>;
  focused: Set<string>;
  idPrefix: string;
}

function Cell({ cellKey, text, issues, focused, idPrefix }: { cellKey: string; text: string; issues: Issue[] | undefined; focused: boolean; idPrefix: string }) {
  const top = issues?.[0];
  const label = issues?.map((i) => `${i.code}: ${i.title}`).join(" · ");
  return (
    <td
      id={`${idPrefix}-${cellKey}`}
      className={cx("whitespace-nowrap px-3 py-2 align-top", top && `${severityClass(top.severity)} cell-hit`, focused && "cell-focus")}
      title={label}
    >
      {text === "" ? <span className="text-muted" aria-label="blank">—</span> : text}
      {top && <span className="sr-only"> (flagged: {label})</span>}
    </td>
  );
}

export function DataTables({ bookingHeaders, itemHeaders, raw, itemRaws, cellIssues, focused, idPrefix }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h4 className="mb-2 text-[13px] font-semibold text-muted">Bookings sheet · row {raw.rowNumber}</h4>
        <div className="overflow-x-auto rounded-2xl border hairline">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface-2 text-muted">
              <tr>{bookingHeaders.map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              <tr>
                {bookingHeaders.map((h) => {
                  const f = fieldForHeader(h, "booking");
                  const k = f ? `b:${f}` : `b:?${h}`;
                  return <Cell key={h} cellKey={k} text={raw.display[h] ?? ""} issues={cellIssues.get(k)} focused={focused.has(k)} idPrefix={idPrefix} />;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-[13px] font-semibold text-muted">Items sheet · {itemRaws.length ? `rows ${itemRaws.map((r) => r.rowNumber).join(", ")}` : "no rows for this booking"}</h4>
        {itemRaws.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border hairline">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-surface-2 text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Row</th>
                  {itemHeaders.map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {itemRaws.map((r, i) => (
                  <tr key={r.rowNumber} className="border-t hairline">
                    <td className="px-3 py-2 text-muted">{r.rowNumber}</td>
                    {itemHeaders.map((h) => {
                      const f = fieldForHeader(h, "item");
                      const k = f ? `i:${i}:${f}` : `i:${i}:?${h}`;
                      return <Cell key={h} cellKey={k} text={r.display[h] ?? ""} issues={cellIssues.get(k)} focused={focused.has(k)} idPrefix={idPrefix} />;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { AlertCircle, FileDown, Info, Link2, Search, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDDMMYYYY, RULES, type BookingStatus, type RuleId } from "@/lib/calculations";
import { useExplanations } from "@/lib/useExplanations";
import type { CheckedFile } from "@/lib/types";
import { cx, STATUS_ORDER } from "@/lib/ui";
import { BookingCard } from "./BookingCard";
import { CountUp } from "./Motion";

type Filter = "ALL" | BookingStatus;
const FILTERS: { id: Filter; label: string; cls?: string }[] = [
  { id: "ALL", label: "All" }, { id: "RED", label: "Red", cls: "sev-red" }, { id: "INCOMPLETE", label: "Incomplete", cls: "sev-grey" },
  { id: "AMBER", label: "Amber", cls: "sev-amber" }, { id: "GREEN", label: "Green", cls: "sev-green" },
];

/** Anchor for a booking card: the Booking ID (suffixed if the ID repeats). */
const anchorFor = (file: CheckedFile, i: number) => {
  const id = file.views[i].booking.bookingId || `row-${file.views[i].raw.rowNumber}`;
  const dup = file.views.slice(0, i).filter((v) => v.booking.bookingId === file.views[i].booking.bookingId).length;
  return dup ? `${id}-${dup + 1}` : id;
};

export function ResultsView({ file, saveState }: { file: CheckedFile; saveState: "saving" | "saved" | "failed" | "loaded" }) {
  const explanations = useExplanations(file.views);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [q, setQ] = useState("");
  const order = useMemo(() => file.views.map((_, i) => i).sort((a, b) => STATUS_ORDER[file.views[a].result.status] - STATUS_ORDER[file.views[b].result.status] || a - b), [file.views]);
  const [open, setOpen] = useState<Set<number>>(() => new Set(order.slice(0, 1)));
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Deep link (/results/[id]#BK-xxx): open and scroll to that booking.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return;
    const i = file.views.findIndex((_, k) => anchorFor(file, k) === hash);
    if (i < 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off sync from the URL hash on mount
    setOpen((s) => new Set(s).add(i));
    // Scroll after the card has expanded (and again once layout settles).
    [150, 700].forEach((ms) => window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }), ms));
  }, [file]);

  const s = file.summary;
  const checked = formatDDMMYYYY(file.views[0]?.result.checkedAgainstDate ?? null);
  const shown = order.filter((i) => {
    const v = file.views[i];
    if (filter !== "ALL" && v.result.status !== filter) return false;
    const needle = q.trim().toLowerCase();
    return !needle || v.booking.bookingId.toLowerCase().includes(needle) || (v.booking.sellerName ?? "").toLowerCase().includes(needle);
  });
  const aiCount = file.views.filter((v, i) => explanations.get(v.booking.bookingId + "#" + i)?.source === "ai").length;
  const maxFail = Math.max(1, ...Object.values(s.ruleFailCounts));

  async function fullPdf() {
    setPdfBusy(true);
    try {
      const { downloadFullReportPdf } = await import("@/lib/pdf");
      await downloadFullReportPdf(file, (v, i) => explanations.get(v.booking.bookingId + "#" + i)!);
    } finally { setPdfBusy(false); }
  }
  async function copyLink() {
    if (!file.uploadId) return;
    await navigator.clipboard.writeText(`${window.location.origin}/results/${file.uploadId}`).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 3000);
  }

  const stat = (label: string, n: number, cls?: string) => (
    <div className={cx(cls, "rounded-[20px] bg-surface p-5 text-center shadow-[var(--shadow)]")}>
      <CountUp value={n} className="block text-[44px] font-bold leading-none tracking-tight" />
      <span className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted">{cls && <span className="sev-dot" aria-hidden />}{label}</span>
    </div>
  );

  return (
    <div className="space-y-8" data-testid="results">
      {/* File-level notices & errors */}
      {(file.notices.length > 0 || file.fileIssues.length > 0) && (
        <div className="space-y-2">
          {file.notices.map((n, i) => (
            <p key={i} role={n.level === "error" ? "alert" : undefined} className={cx("flex items-start gap-2 rounded-2xl p-3 text-[14px]", n.level === "error" ? "sev-red" : n.level === "warning" ? "sev-amber" : "sev-blue")} style={{ background: "var(--sev-tint)" }}>
              {n.level === "info" ? <Info size={16} className="mt-0.5 flex-none" aria-hidden /> : <TriangleAlert size={16} className="mt-0.5 flex-none" aria-hidden />}{n.message}
            </p>
          ))}
          {file.fileIssues.map((iss, i) => (
            <div key={i} role="alert" className="sev-grey flex items-start gap-2 rounded-2xl p-3 text-[14px]" style={{ background: "var(--sev-tint)" }}>
              <AlertCircle size={16} className="mt-0.5 flex-none" aria-hidden />
              <span><span className="font-mono font-semibold">{iss.code}</span> {iss.whatIsWrong}{file.orphanRows[i] ? ` (Items sheet row ${file.orphanRows[i].rowNumber})` : ""} {iss.howToFix.join(" ")}</span>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="headline-md">Results</h3>
            <p className="text-[14px] text-muted">{file.fileName} · Checked against {checked} (UK date)</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={fullPdf} disabled={pdfBusy}><FileDown size={15} aria-hidden />{pdfBusy ? "Preparing…" : "Full report PDF"}</button>
            <span className={cx(!file.uploadId && "tip")}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink} disabled={!file.uploadId}><Link2 size={15} aria-hidden />{copied ? "Link copied" : "Copy results link"}</button>
              {!file.uploadId && <span role="tooltip" className="tip-body">{saveState === "saving" ? "Saving…" : "The database isn't reachable, so there's no shareable link. Use the PDF instead."}</span>}
            </span>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="summary">
          {stat("Total bookings", s.total)}
          {stat("Red", s.red, "sev-red")}
          {stat("Incomplete", s.incomplete, "sev-grey")}
          {stat("Amber", s.amber, "sev-amber")}
          {stat("Green", s.green, "sev-green")}
        </div>

        {/* Rule heat-strip */}
        <div className="mt-5 rounded-[20px] bg-surface p-4 shadow-[var(--shadow)]">
          <p className="mb-3 text-[13px] font-semibold text-muted">Bookings failing each rule</p>
          <ul className="grid grid-cols-5 gap-2 sm:grid-cols-10">
            {(Object.keys(RULES) as RuleId[]).map((id) => {
              const n = s.ruleFailCounts[id] ?? 0;
              const cls = RULES[id].severity === "Red" ? "sev-red" : "sev-amber";
              return (
                <li key={id} className={cx(cls, "tip")}>
                  <div tabIndex={0} className="rounded-xl p-2 text-center" style={{ background: n ? `color-mix(in srgb, var(--sev) ${12 + (n / maxFail) * 50}%, transparent)` : "var(--surface-2)" }} aria-label={`${id}: ${n} booking${n === 1 ? "" : "s"} failing — ${RULES[id].text}`}>
                    <span className="block font-mono text-[11px] font-semibold">{id}</span>
                    <span className="block text-[18px] font-bold">{n}</span>
                  </div>
                  <span role="tooltip" className="tip-body">{RULES[id].text} ({RULES[id].severity})</span>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
          <Sparkles size={13} aria-hidden />
          {aiCount ? `AI wrote ${aiCount} of ${file.views.length} explanations from the rule engine's facts.` : "Explanations are built straight from the rule engine's facts."}
          {file.r06.source === "ai" && ` AI double-checked ${file.r06.verdicts.length} possibly restricted item${file.r06.verdicts.length === 1 ? "" : "s"}.`}
          {file.r06.source === "unavailable" && " The AI restricted-goods check was unavailable, so possible matches are listed as tips to confirm."}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="radiogroup" aria-label="Filter by status" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
          {FILTERS.map((f) => {
            const n = f.id === "ALL" ? s.total : file.views.filter((v) => v.result.status === f.id).length;
            const on = filter === f.id;
            return (
              <button key={f.id} type="button" role="radio" aria-checked={on} onClick={() => setFilter(f.id)}
                className={cx(f.cls, "chip min-h-9 px-4 text-[13px] transition-colors", on ? "bg-fg text-bg" : "bg-surface-2 text-fg hover:bg-[var(--hairline)]")}>
                {f.cls && <span className="sev-dot" aria-hidden />}{f.label} <span className={on ? "opacity-70" : "text-muted"}>{n}</span>
              </button>
            );
          })}
        </div>
        <label className="relative block sm:w-72">
          <span className="sr-only">Search by Booking ID or seller</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Booking ID or seller" className="h-10 w-full rounded-full border hairline bg-surface pl-9 pr-4 text-[14px] outline-none focus:border-[var(--accent)]" />
        </label>
      </div>

      {/* Cards */}
      <div className="space-y-4">
        {shown.length === 0 && <p className="py-10 text-center text-muted">No bookings match this filter.</p>}
        {shown.map((i) => {
          const v = file.views[i];
          return (
            <BookingCard
              key={i} view={v} ex={explanations.get(v.booking.bookingId + "#" + i)!} uploadId={file.uploadId} saveState={saveState}
              bookingHeaders={file.bookingHeaders} itemHeaders={file.itemHeaders} r06={file.r06}
              open={open.has(i)} onToggle={() => setOpen((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
              anchorId={anchorFor(file, i)}
            />
          );
        })}
      </div>
    </div>
  );
}

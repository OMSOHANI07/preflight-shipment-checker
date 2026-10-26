"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, CircleCheck, FileDown, Lightbulb, Link2, Lock, Minus, Share2, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { RULES, type Issue, type RuleId } from "@/lib/calculations";
import { invoiceChecklist, nextSteps } from "@/lib/explain";
import { cellIssueMap, cellsForIssue } from "@/lib/highlight";
import type { Explanation } from "@/lib/schema";
import type { BookingView, R06Review } from "@/lib/types";
import { cx, severityClass, SEVERITY_LABEL, STATUS_MEANING } from "@/lib/ui";
import { CarrierCard } from "./CarrierCard";
import { DataTables } from "./DataTables";
import { StatusBadge, StatusRing } from "./Motion";

interface Props {
  view: BookingView;
  ex: Explanation;
  uploadId: string | null;
  saveState: "saving" | "saved" | "failed" | "loaded";
  bookingHeaders: string[];
  itemHeaders: string[];
  r06: R06Review;
  open: boolean;
  onToggle: () => void;
  anchorId: string;
}

/** Bold money, weights and plain numbers in a fix line so the corrected value stands out. */
function emphasise(text: string): ReactNode[] {
  return text.split(/(£[\d,]+(?:\.\d{2})?|\b\d[\d,]*(?:\.\d+)?(?: kg)?\b)/g).map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-fg">{part}</strong> : part));
}

function IssueRow({ issue, summary, onFocus }: { issue: Issue; summary: string | null; onFocus: () => void }) {
  return (
    <li className={cx(severityClass(issue.severity), "rounded-2xl border hairline p-4")}>
      <button type="button" onClick={onFocus} className="group w-full text-left" aria-label={`${issue.code} ${issue.title} — show the cells in the data tables`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip sev-chip font-mono">{issue.code}</span>
          <span className="text-[12px] font-semibold" style={{ color: "var(--sev-text)" }}>{SEVERITY_LABEL[issue.severity]}</span>
          {issue.sku && <span className="chip bg-surface-2 text-muted">{issue.sku}</span>}
          <span className="ml-auto text-[12px] text-accent-text group-hover:underline">Show cells ↓</span>
        </div>
        <h5 className="mt-2 text-[17px] font-semibold tracking-tight">{issue.title}</h5>
        {summary && summary !== issue.whatIsWrong && <p className="mt-1 text-[15px]">{summary}</p>}
        <p className="mt-1 text-[15px] text-muted">{issue.whatIsWrong}</p>
      </button>
      {issue.howToFix.length > 0 && (
        <div className="mt-3">
          <p className="text-[13px] font-semibold">How to fix</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px] text-muted">
            {issue.howToFix.map((f, i) => <li key={i}>{i === 0 ? emphasise(f) : f}</li>)}
          </ul>
        </div>
      )}
    </li>
  );
}

function RuleTable({ results }: { results: Record<RuleId, "pass" | "fail" | "not_evaluable"> }) {
  return (
    <div className="overflow-hidden rounded-2xl border hairline">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Rule results</caption>
        <tbody>
          {(Object.keys(RULES) as RuleId[]).map((id) => {
            const r = results[id];
            const cls = r === "pass" ? "sev-green" : r === "fail" ? (RULES[id].severity === "Red" ? "sev-red" : "sev-amber") : "sev-grey";
            return (
              <tr key={id} className="border-t hairline first:border-t-0">
                <th scope="row" className="w-14 px-3 py-2 text-left font-mono font-medium text-muted">{id}</th>
                <td className="px-3 py-2">{RULES[id].text}</td>
                <td className={cx(cls, "w-32 px-3 py-2 text-right font-semibold")} style={{ color: "var(--sev-text)" }}>
                  <span className="inline-flex items-center gap-1">
                    {r === "pass" ? <Check size={14} aria-hidden /> : r === "fail" ? <X size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
                    {r === "pass" ? "Pass" : r === "fail" ? "Fail" : "Not evaluable"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BookingCard({ view, ex, uploadId, saveState, bookingHeaders, itemHeaders, r06, open, onToggle, anchorId }: Props) {
  const { booking: b, result: r } = view;
  const reduce = useReducedMotion();
  const [focused, setFocused] = useState<Set<string>>(new Set());
  const [ack, setAck] = useState(false);
  const [confirm, setConfirm] = useState<{ state: "idle" | "busy" | "done" | "error"; ref?: string; saved?: boolean; msg?: string }>({ state: "idle" });
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const cellIssues = useMemo(() => cellIssueMap(r.issues, view.items), [r.issues, view.items]);
  const main = r.issues.filter((i) => i.severity !== "Advisory");
  const tips = r.issues.filter((i) => i.severity === "Advisory" && i.code !== "A-08");
  const aiNotes = r06.verdicts.filter((v) => v.bookingId === b.bookingId);
  const summaryFor = (i: Issue) => (ex.source === "ai" ? ex.issueSummaries[r.issues.indexOf(i)]?.summary ?? null : null);
  const idPrefix = `cells-${anchorId}`;

  const focusIssue = (issue: Issue) => {
    const keys = cellsForIssue(issue, view.items);
    setFocused(new Set(keys));
    const first = keys[0] && document.getElementById(`${idPrefix}-${keys[0]}`);
    (first || document.getElementById(`${idPrefix}-tables`))?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center", inline: "center" });
    window.setTimeout(() => setFocused(new Set()), 3000);
  };

  const blocked = r.status === "RED" || r.status === "INCOMPLETE";
  const canClick = !blocked && (r.status === "GREEN" || ack) && confirm.state !== "busy" && confirm.state !== "done";
  const blockedWhy = r.status === "RED" ? "Fix the Red issues first — this shipment must not go until they're fixed." : "Add the missing information first — some rules can't be checked yet.";

  async function doConfirm() {
    setConfirm({ state: "busy" });
    try {
      const res = await fetch("/api/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, bookingRowId: view.rowId, bookingId: b.bookingId, status: r.status, acknowledgedAmber: ack, carrierId: r.recommendation.recommended?.carrier.id ?? null }),
      });
      const data = (await res.json()) as { ok: boolean; reference?: string; saved?: boolean; error?: string };
      setConfirm(data.ok ? { state: "done", ref: data.reference, saved: data.saved } : { state: "error", msg: data.error ?? "Couldn't confirm." });
    } catch {
      setConfirm({ state: "error", msg: "Couldn't reach the server. Try again, or download the PDF." });
    }
  }

  async function share() {
    if (!uploadId) return;
    const url = `${window.location.origin}/results/${uploadId}#${encodeURIComponent(anchorId)}`;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse && navigator.share) {
      try { await navigator.share({ title: `Pre-Flight check · ${b.bookingId}`, url }); return; } catch { /* fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(url); setShareMsg("Link copied"); } catch { setShareMsg(url); }
    window.setTimeout(() => setShareMsg(null), 4000);
  }

  async function pdf() {
    setPdfBusy(true);
    try { const { downloadBookingPdf } = await import("@/lib/pdf"); await downloadBookingPdf(view, ex); } finally { setPdfBusy(false); }
  }

  const route = `${b.originCity ?? "—"} → ${b.destinationCity ?? "—"}`;
  const counts = { red: main.filter((i) => i.severity === "Red").length, data: main.filter((i) => i.severity === "Data").length, amber: main.filter((i) => i.severity === "Amber").length };
  const panelId = `${anchorId}-panel`;

  return (
    <article id={anchorId} className="card scroll-mt-32 overflow-hidden" aria-labelledby={`${anchorId}-title`}>
      <h3 className="m-0">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-surface-2/50 sm:p-6">
          <StatusRing status={r.status} size={52} />
          <span className="min-w-0 flex-1">
            <span id={`${anchorId}-title`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[19px] font-bold tracking-tight">{b.bookingId || "(no Booking ID)"}</span>
              <StatusBadge status={r.status} />
            </span>
            <span className="mt-0.5 block truncate text-[14px] text-muted">{b.sellerName ?? "Seller not given"} · {route}</span>
            <span className="mt-1 block text-[12px] text-muted">
              {STATUS_MEANING[r.status]}
              {counts.red > 0 && ` · ${counts.red} red`}{counts.data > 0 && ` · ${counts.data} missing`}{counts.amber > 0 && ` · ${counts.amber} amber`}
            </span>
          </span>
          <ChevronDown aria-hidden className={cx("flex-none text-muted transition-transform", open && "rotate-180")} />
        </button>
      </h3>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-8 border-t hairline p-5 sm:p-6">
              {/* Issues */}
              <section aria-label="Issues">
                <h4 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Issues</h4>
                {main.length ? (
                  <ul className="mt-3 space-y-3">{main.map((i, k) => <IssueRow key={`${i.code}-${k}`} issue={i} summary={summaryFor(i)} onFocus={() => focusIssue(i)} />)}</ul>
                ) : (
                  <p className="mt-3 flex items-center gap-2 text-[15px]"><CircleCheck size={18} className="text-[var(--green-text)]" aria-hidden /> No problems found against the 10 rules.</p>
                )}
                {(tips.length > 0 || aiNotes.length > 0) && (
                  <details className="mt-4 rounded-2xl bg-surface-2 p-4">
                    <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-semibold"><Lightbulb size={16} aria-hidden /> Tips ({tips.length + aiNotes.length}) — good practice, doesn&apos;t change the status</summary>
                    <ul className="mt-3 space-y-3 text-[14px]">
                      {aiNotes.map((n) => (
                        <li key={`ai-${n.itemIndex}`}><span className="chip sev-blue sev-chip mr-2">AI R-06 check</span>{n.sku ?? "Item"}: {n.restricted ? "restricted" : "not restricted"} — {n.reason}</li>
                      ))}
                      {tips.map((t, k) => (
                        <li key={`${t.code}-${k}`}>
                          <button type="button" className="text-left" onClick={() => focusIssue(t)}>
                            <span className="chip sev-blue sev-chip mr-2 font-mono">{t.code}</span><span className="font-semibold">{t.title}.</span>{" "}
                            <span className="text-muted">{t.whatIsWrong} {t.howToFix.join(" ")}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>

              {/* Rule table */}
              <section aria-label="Rule results">
                <h4 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">Rule by rule</h4>
                <RuleTable results={r.ruleResults} />
              </section>

              {/* Data tables */}
              <section aria-label="Your data" id={`${idPrefix}-tables`}>
                <h4 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">Your data — problem cells highlighted</h4>
                <DataTables bookingHeaders={bookingHeaders} itemHeaders={itemHeaders} raw={view.raw} itemRaws={view.itemRaws} cellIssues={cellIssues} focused={focused} idPrefix={idPrefix} />
              </section>

              {/* Carrier */}
              <CarrierCard booking={b} result={r} ex={ex} />

              {/* Confirmation */}
              <section aria-label="Confirmation" className="rounded-[22px] bg-surface-2 p-5 sm:p-6">
                <h4 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Confirmation</h4>
                <p className="mt-2 text-[17px] leading-relaxed">{ex.confirmation}</p>
                <h5 className="mt-5 text-[15px] font-semibold">What happens next</h5>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-[15px] text-muted">{nextSteps(b, r).map((s) => <li key={s}>{s}</li>)}</ol>
                <details className="mt-4">
                  <summary className="cursor-pointer text-[14px] text-accent-text">Commercial invoice checklist (UK export guidance)</summary>
                  <ul className="mt-3 divide-y divide-[var(--hairline)] text-[14px]">
                    {invoiceChecklist(b, view.items, r).map((c) => (
                      <li key={c.element} className="flex gap-3 py-2">
                        <span className={cx("chip sev-chip h-fit", c.status === "have" ? "sev-green" : c.status === "partial" ? "sev-amber" : "sev-grey")}>{c.status}</span>
                        <span><span className="font-medium">{c.element}.</span> <span className="text-muted">{c.detail}</span></span>
                      </li>
                    ))}
                  </ul>
                </details>
              </section>

              {/* Actions */}
              <section aria-label="Actions" className="space-y-4">
                {r.status === "AMBER" && confirm.state !== "done" && (
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border hairline p-4 text-[15px]">
                    <input type="checkbox" className="mt-1 size-5 accent-[var(--accent)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                    <span>I understand these warnings and want to book anyway. <span className="text-muted">(They&apos;ll be listed on the confirmation.)</span></span>
                  </label>
                )}
                {confirm.state === "done" ? (
                  <div role="status" className="sev-green flex items-start gap-3 rounded-2xl p-4" style={{ background: "var(--sev-tint)" }}>
                    <CircleCheck aria-hidden style={{ color: "var(--sev-text)" }} />
                    <div>
                      <p className="font-semibold">Booking confirmed — reference {confirm.ref}</p>
                      <p className="text-[14px] text-muted">{confirm.saved ? "Saved." : "Couldn't save to the database — keep this reference and download the PDF."} Any change to the file means checking and confirming again.</p>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  {confirm.state !== "done" && (
                    <span className={cx(blocked && "tip")}>
                      <button
                        type="button" className="btn btn-primary" onClick={doConfirm} disabled={!canClick}
                        aria-describedby={blocked ? `${anchorId}-why` : undefined}
                      >
                        {blocked ? <Lock size={16} aria-hidden /> : <Check size={16} aria-hidden />}
                        {confirm.state === "busy" ? "Confirming…" : "Confirm booking"}
                      </button>
                      {blocked && <span id={`${anchorId}-why`} role="tooltip" className="tip-body">{blockedWhy}</span>}
                    </span>
                  )}
                  <button type="button" className="btn btn-ghost" onClick={pdf} disabled={pdfBusy}><FileDown size={16} aria-hidden />{pdfBusy ? "Preparing…" : "Download PDF"}</button>
                  <span className={cx(!uploadId && "tip")}>
                    <button type="button" className="btn btn-ghost" onClick={share} disabled={!uploadId}>
                      {shareMsg ? <Link2 size={16} aria-hidden /> : <Share2 size={16} aria-hidden />}{shareMsg ?? "Share"}
                    </button>
                    {!uploadId && <span role="tooltip" className="tip-body">{saveState === "saving" ? "Saving your results so they can be shared…" : "Sharing needs the database, which isn't reachable right now. Download the PDF instead."}</span>}
                  </span>
                </div>
                {blocked && <p className="text-[13px] text-muted">{blockedWhy}</p>}
                {r.status === "AMBER" && !ack && confirm.state !== "done" && <p className="text-[13px] text-muted">Tick the box above to enable Confirm.</p>}
                {confirm.state === "error" && <p role="alert" className="text-[14px] text-[var(--red-text)]">{confirm.msg}</p>}
              </section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

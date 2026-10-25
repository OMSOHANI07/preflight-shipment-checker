"use client";

import { Sparkles, Truck } from "lucide-react";
import { gbp, type Booking, type BookingResult } from "@/lib/calculations";
import { longDate } from "@/lib/explain";
import type { Explanation } from "@/lib/schema";
import { cx } from "@/lib/ui";

export function CarrierCard({ booking, result, ex }: { booking: Booking; result: BookingResult; ex: Explanation }) {
  const rec = result.recommendation;
  const best = rec.recommended;
  const labelClass = rec.label === "Recommended" ? "sev-green" : rec.label === "No carrier fits" ? "sev-red" : "sev-amber";
  return (
    <section aria-label="Carrier recommendation" className="rounded-[22px] border hairline p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cx(labelClass, "chip sev-chip")}><span className="sev-dot" aria-hidden />{rec.label}</span>
        <span className="text-[12px] text-muted">Priority: {booking.sellerPriority ?? "not given — Balanced used"}</span>
      </div>

      {best ? (
        <>
          <div className="mt-4 flex items-start gap-3">
            <Truck aria-hidden className="mt-1 flex-none text-accent-text" size={26} />
            <div>
              <h4 className="text-[22px] font-bold tracking-tight">{best.carrier.carrier} <span className="font-semibold text-muted">· {best.carrier.service}</span></h4>
              <p className="text-[15px] text-muted">{ex.headline}</p>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["Cost", gbp(best.cost)],
              ["Transit", `${best.carrier.transitDays} working days`],
              ["On time", `${best.carrier.onTimePct}%`],
              ["Collection", longDate(best.collectionDate)],
              ["Est. delivery", longDate(best.etaDate)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-surface-2 p-3">
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className="mt-0.5 text-[15px] font-semibold leading-snug">{v}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="mt-4 text-[17px] font-semibold">No carrier on this route can take the shipment as entered.</p>
      )}

      <div className="mt-5 space-y-2 text-[15px]">
        <p><span className="font-semibold">Why: </span>{ex.reason}</p>
        {ex.tradeoff && <p><span className="font-semibold">Trade-off: </span>{ex.tradeoff}</p>}
        {ex.exclusions.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-muted">{ex.exclusions.map((e) => <li key={e}>{e}</li>)}</ul>
        )}
        {ex.caveat && <p className="text-muted">{ex.caveat}</p>}
        <p className="flex items-center gap-1.5 text-[12px] text-muted">
          {ex.source === "ai" ? <><Sparkles size={13} aria-hidden /> Explained by AI from the checked facts below — numbers come from the rule engine.</> : "Explanation built from the checked facts (AI text unavailable)."}
        </p>
      </div>

      <details className="mt-3 text-[14px]">
        <summary className="cursor-pointer text-accent-text">Facts behind this recommendation</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{rec.reasonFacts.map((f) => <li key={f}>{f}</li>)}</ul>
      </details>

      {rec.allOptions.length > 0 && (
        <div className="mt-5">
          <h5 className="mb-2 text-[13px] font-semibold text-muted">All options on this route</h5>
          <div className="grid gap-3 sm:grid-cols-3">
            {rec.allOptions.map((e) => {
              const isBest = best?.carrier.id === e.carrier.id;
              return (
                <div key={e.carrier.id} className={cx("rounded-2xl border p-4 text-[13px] transition-opacity", isBest ? "border-accent" : "hairline", !e.eligible && "opacity-55")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{e.carrier.carrier}</span>
                    {isBest && <span className="chip bg-accent text-white">Pick</span>}
                    {!e.eligible && <span className="chip bg-surface-2 text-muted">Not eligible</span>}
                  </div>
                  <p className="text-muted">{e.carrier.service}</p>
                  <dl className="mt-2 space-y-0.5">
                    <div className="flex justify-between"><dt className="text-muted">Cost</dt><dd className="font-medium">{gbp(e.cost)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Transit</dt><dd>{e.carrier.transitDays} days</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">On time</dt><dd>{e.carrier.onTimePct}%</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Max/pallet</dt><dd>{e.carrier.maxKgPerPallet} kg</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Arrives</dt><dd>{longDate(e.etaDate)}</dd></div>
                  </dl>
                  {!e.eligible && <p className="mt-2 text-muted">{e.ineligibleReasons.join("; ")}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

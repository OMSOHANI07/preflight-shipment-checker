"use client";

import { Check, ChevronUp, Circle, Sparkles } from "lucide-react";
import { useState } from "react";
import { formatDDMMYYYY, gbp, kg, type BookingResult } from "@/lib/calculations";
import type { ConversationState } from "@/lib/conversation/types";
import { cx, severityClass } from "@/lib/ui";
import { StatusBadge, StatusRing } from "../Motion";

const ITEM_CHANGES = ["quantity", "units per carton", "cartons", "unit price", "unit weight", "SKU", "HS code", "country of origin", "new product"];
type Row = { key: string; label: string; value: string | null; prov?: string; changeKey: string };

function FieldRow({ r, flash }: { r: Row; flash: boolean }) {
  return (
    <li className={cx("flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] transition-colors duration-700", flash && "bg-[var(--blue-tint)]")} data-field={r.key}>
      <span className="flex items-center gap-2 text-muted">
        {r.value != null ? <Check size={13} className="text-[var(--green-text)]" aria-label="filled" /> : <Circle size={13} aria-label="missing" />}
        {r.label}
      </span>
      <span className="text-right font-medium">
        {r.value ?? <span className="text-muted">—</span>}
        {r.prov === "derived" && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">calculated</span>}
      </span>
    </li>
  );
}

export function SummaryPanel({ state, result, changed }: { state: ConversationState; result: BookingResult | null; changed: Set<string> }) {
  const [open, setOpen] = useState(false);
  const b = state.booking, p = b.provenance ?? {};
  const rows: Row[] = [
    { key: "sellerName", label: "Seller", value: b.sellerName, changeKey: "seller" },
    { key: "route", label: "Route", value: b.originCity || b.destinationCity ? `${b.originCity ?? "?"} → ${b.destinationCity ?? "?"}${b.destinationCountry ? ` (${b.destinationCountry})` : ""}` : null, changeKey: "destination city" },
    { key: "destinationType", label: "Delivering to", value: b.destinationType, changeKey: "destination type" },
    { key: "readyToShipDate", label: "Ready", value: b.readyToShipDate ? formatDDMMYYYY(b.readyToShipDate) : null, changeKey: "ready date" },
    { key: "sellerPriority", label: "Priority", value: b.sellerPriority, prov: p.sellerPriority === "default" ? "derived" : undefined, changeKey: "priority" },
    { key: "pallets", label: "Pallets", value: b.pallets != null ? String(b.pallets) : null, changeKey: "pallets" },
    { key: "cartons", label: "Cartons", value: b.cartons != null ? String(b.cartons) : null, prov: p.cartons, changeKey: "total cartons" },
    { key: "totalDeclaredValue", label: "Declared value", value: b.totalDeclaredValue != null ? gbp(b.totalDeclaredValue) : null, prov: p.totalDeclaredValue, changeKey: "declared value" },
    { key: "totalGrossWeightKg", label: "Gross weight", value: b.totalGrossWeightKg != null ? kg(b.totalGrossWeightKg) : null, changeKey: "gross weight" },
    { key: "deliveryAppointmentBooked", label: "Appointment", value: b.deliveryAppointmentBooked == null ? null : b.deliveryAppointmentBooked ? "Booked" : "Not booked", changeKey: "delivery appointment" },
  ];
  const missing = rows.filter((r) => r.value == null).length + state.items.reduce((n, it) => n + ["sku", "description", "quantity", "unitsPerCarton", "cartons", "unitPrice", "unitWeightKg"].filter((f) => (it as unknown as Record<string, unknown>)[f] == null).length, 0) + (state.items.length ? 0 : 1);
  const issues = result?.issues.filter((i) => i.severity === "Red" || i.severity === "Amber" || (i.severity === "Data" && missing === 0)) ?? [];
  const best = result?.recommendation.recommended;

  const body = (
    <div className="space-y-5">
      <ul className="space-y-0.5">{rows.map((r) => <FieldRow key={r.key} r={r} flash={changed.has(r.changeKey)} />)}</ul>
      <div>
        <h4 className="mb-1.5 px-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Products</h4>
        {state.items.length === 0 ? <p className="px-2 text-[13px] text-muted">None yet</p> : (
          <div className="overflow-x-auto rounded-xl border hairline" tabIndex={0} role="region" aria-label="Products">
            <table className="w-full text-[12px]">
              <thead className="bg-surface-2 text-muted"><tr><th className="px-2 py-1.5 text-left font-medium">Product</th><th className="px-2 py-1.5 text-right font-medium">Units</th><th className="px-2 py-1.5 text-right font-medium">Cartons</th><th className="px-2 py-1.5 text-right font-medium">£/unit</th></tr></thead>
              <tbody>
                {state.items.map((it, i) => (
                  <tr key={i} className={cx("border-t hairline transition-colors duration-700", ITEM_CHANGES.some((c) => changed.has(c)) && i === state.items.length - 1 && "bg-[var(--blue-tint)]")}>
                    <td className="px-2 py-1.5"><span className="font-medium">{it.sku ?? "—"}</span> <span className="text-muted">{it.description ?? ""}</span></td>
                    <td className="px-2 py-1.5 text-right">{it.quantity?.toLocaleString("en-GB") ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{it.cartons ?? "—"}{it.prov.cartons === "derived" && <span className="sr-only"> (calculated)</span>}</td>
                    <td className="px-2 py-1.5 text-right">{it.unitPrice != null ? gbp(it.unitPrice) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {issues.length > 0 && (
        <div>
          <h4 className="mb-1.5 px-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Issues</h4>
          <ul className="space-y-1.5">
            {issues.slice(0, 6).map((i, k) => (
              <li key={k} className={cx(severityClass(i.severity), "flex gap-2 rounded-xl p-2 text-[12.5px]")} style={{ background: "var(--sev-tint)" }}>
                <span className="font-mono font-semibold" style={{ color: "var(--sev-text)" }}>{i.code}</span>
                <span>{i.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {best && (
        <div className="rounded-2xl border hairline p-3 text-[13px]">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-muted"><Sparkles size={13} aria-hidden /> {result?.recommendation.label}</p>
          <p className="mt-1 font-semibold">{best.carrier.carrier} · {best.carrier.service}</p>
          <p className="text-muted">{gbp(best.cost)} · {best.carrier.transitDays} working days · arrives {best.etaDate ? formatDDMMYYYY(best.etaDate) : "—"}</p>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* desktop: sticky side panel */}
      <aside className="card sticky top-32 hidden max-h-[calc(100vh-9rem)] overflow-y-auto p-4 lg:block" aria-label="Booking summary">
        <div className="mb-4 flex items-center gap-3">
          {result ? <StatusRing status={result.status} size={44} /> : <span className="size-11 rounded-full border-4 hairline" aria-hidden />}
          <div>
            <p className="text-[15px] font-semibold">Booking summary</p>
            <p className="text-[12px] text-muted">{result ? <StatusBadge status={result.status} /> : "Waiting for details"} <span className="ml-1">{missing} missing · {issues.length} issue{issues.length === 1 ? "" : "s"}</span></p>
          </div>
        </div>
        {body}
      </aside>
      {/* phone: bottom sheet */}
      <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto max-w-[640px] rounded-t-3xl border hairline bg-surface shadow-[var(--shadow-lg)]">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
            {result ? <StatusRing status={result.status} size={34} /> : <span className="size-8 rounded-full border-4 hairline" aria-hidden />}
            <span className="flex-1 text-[14px]"><span className="font-semibold">Summary</span> <span className="text-muted">· {missing} missing · {issues.length} issue{issues.length === 1 ? "" : "s"}</span></span>
            <ChevronUp size={18} className={cx("text-muted transition-transform", !open && "rotate-180")} aria-hidden />
          </button>
          {open && <div className="max-h-[60vh] overflow-y-auto px-3 pb-4">{body}</div>}
        </div>
      </div>
    </>
  );
}

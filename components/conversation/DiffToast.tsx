"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import type { TurnDiff } from "@/lib/conversation/types";

/** "Updated: pallets 3 → 4 · ✓ R-05 fixed · Carrier B → A · £660.00 → £720.00 · ETA Tue 10-11 → Thu 12-11" */
export function diffParts(d: TurnDiff): string[] {
  return [
    ...d.fields.map((f) => (f.from === "—" ? `${f.field}: ${f.to}` : `${f.field} ${f.from} → ${f.to}`)),
    ...d.cascade,
    ...d.fixed.map((r) => `✓ ${r} fixed`),
    ...d.newIssues.map((r) => `⚠ ${r}`),
    ...(d.status ? [`${d.status.from} → ${d.status.to}`] : []),
    ...(d.carrier ? [`${d.carrier.from ?? "none"} → ${d.carrier.to ?? "none"}`] : []),
    ...(d.cost ? [`${d.cost.from} → ${d.cost.to}`] : []),
    ...(d.eta ? [`ETA ${d.eta.from} → ${d.eta.to}`] : []),
  ];
}

export function DiffToast({ diff, onClose }: { diff: TurnDiff | null; onClose: () => void }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!diff) return;
    const t = window.setTimeout(onClose, 7000);
    return () => window.clearTimeout(t);
  }, [diff, onClose]);
  const parts = diff ? diffParts(diff) : [];
  return (
    <AnimatePresence>
      {diff && parts.length > 0 && (
        <motion.div role="status" aria-live="polite" data-testid="diff-toast"
          initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: 12 }}
          className="sev-blue flex items-start gap-3 rounded-2xl p-3 text-[13px] shadow-[var(--shadow)]" style={{ background: "var(--sev-tint)" }}>
          <p className="flex-1"><span className="font-semibold" style={{ color: "var(--sev-text)" }}>Updated: </span>{parts.join(" · ")}</p>
          <button type="button" onClick={onClose} aria-label="Dismiss" className="text-muted hover:text-fg"><X size={16} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Small presentation helpers shared by components and the PDF. */
import type { BookingStatus, Severity } from "@/lib/calculations";

export const STATUS_ORDER: Record<BookingStatus, number> = { RED: 0, INCOMPLETE: 1, AMBER: 2, GREEN: 3 };

export const statusClass = (s: BookingStatus) =>
  s === "RED" ? "sev-red" : s === "INCOMPLETE" ? "sev-grey" : s === "AMBER" ? "sev-amber" : "sev-green";
export const severityClass = (s: Severity) =>
  s === "Red" ? "sev-red" : s === "Data" ? "sev-grey" : s === "Amber" ? "sev-amber" : "sev-blue";

export const STATUS_LABEL: Record<BookingStatus, string> = { RED: "Red", INCOMPLETE: "Incomplete", AMBER: "Amber", GREEN: "Green" };
export const STATUS_MEANING: Record<BookingStatus, string> = {
  RED: "Blocked — must not ship until fixed",
  INCOMPLETE: "Missing or unreadable information",
  AMBER: "Risky — check before confirming",
  GREEN: "Ready to confirm",
};
export const SEVERITY_LABEL: Record<Severity, string> = { Red: "Red · blocking", Data: "Data · missing info", Amber: "Amber · warning", Advisory: "Tip" };

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

export const SEV_RANK: Record<Severity, number> = { Red: 0, Data: 1, Amber: 2, Advisory: 3 };

/** Small presentation helpers shared by components and the PDF. */
import type { BookingStatus, Severity } from "@/lib/calculations";

export const STATUS_ORDER: Record<BookingStatus, number> = { RED: 0, INCOMPLETE: 1, AMBER: 2, GREEN: 3 };

export const statusClass = (s: BookingStatus) =>
  s === "RED" ? "sev-red" : s === "INCOMPLETE" ? "sev-grey" : s === "AMBER" ? "sev-amber" : "sev-green";
export const severityClass = (s: Severity) =>
  s === "Red" ? "sev-red" : s === "Data" ? "sev-grey" : s === "Amber" ? "sev-amber" : "sev-blue";

/** What people see. Colours: red = can't ship yet, grey = details missing, yellow = check first, green = ready. */
export const STATUS_LABEL: Record<BookingStatus, string> = { RED: "Can't ship yet", INCOMPLETE: "Details missing", AMBER: "Check first", GREEN: "Ready to ship" };
export const STATUS_MEANING: Record<BookingStatus, string> = {
  RED: "Something has to be fixed before this can ship",
  INCOMPLETE: "Some details are missing or couldn't be read",
  AMBER: "It can ship, but look at the yellow points first",
  GREEN: "Everything checks out — ready to book",
};
export const SEVERITY_LABEL: Record<Severity, string> = { Red: "Must fix", Data: "Missing detail", Amber: "Worth a look", Advisory: "Tip" };
/** Label for one issue: guardrail blocks (G-01 prohibited goods, G-03 HS chapter) read "Can't ship". */
export const issueLabel = (i: { code: string; severity: Severity }) => (i.code.startsWith("G-") && i.severity === "Red" ? "Can't ship" : SEVERITY_LABEL[i.severity]);
/** Rule severity in plain words (rules are only ever red or yellow). */
export const RULE_KIND = (sev: "Red" | "Amber") => (sev === "Red" ? "must be fixed" : "worth a look");

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

export const SEV_RANK: Record<Severity, number> = { Red: 0, Data: 1, Amber: 2, Advisory: 3 };

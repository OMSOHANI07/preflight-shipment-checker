/**
 * Spreadsheet formula-injection guard (EDGE_CASES J): a value that starts with = + - @ (or a tab /
 * carriage return) would run as a formula when a CSV or Excel export is opened. Prefix it with an
 * apostrophe so it stays text. Use for every cell of any CSV/Excel export; the app's own exports are PDFs.
 */
export function safeCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/** One CSV line with every cell guarded and quoted. */
export const csvLine = (cells: unknown[]) => cells.map((c) => `"${safeCell(c).replace(/"/g, '""')}"`).join(",");

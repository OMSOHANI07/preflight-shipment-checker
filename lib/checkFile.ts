/**
 * Browser-side pipeline (prompt §5): parse → runFile() → R-06 AI batch for "possible"
 * items → runFile() again with the verdicts. Every pass/fail and number comes from
 * calculations.ts; the AI only answers restricted yes/no for flagged items.
 */
import { bookingKey, detectDangerousGoods, normaliseHs, runFile, type Item, type RuleId } from "@/lib/calculations";
import { parseWorkbook, type FileNotice, type RawRow } from "@/lib/parseExcel";
import type { R06Verdict } from "@/lib/schema";
import type { BookingView, CheckedFile, R06Review } from "@/lib/types";

export type Step = "read" | "check" | "carriers" | "done";
export type CheckOutcome = { ok: true; file: CheckedFile } | { ok: false; error: string; notices: FileNotice[] };

const R06_CLIENT_TIMEOUT_MS = 10_000;

async function fetchJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}


export async function checkWorkbook(data: ArrayBuffer, fileName: string, onStep: (s: Step) => void): Promise<CheckOutcome> {
  onStep("read");
  const parsed = parseWorkbook(data, fileName);
  if (parsed.fatal) return { ok: false, error: parsed.fatal, notices: parsed.notices };

  onStep("check");
  const now = new Date();
  // Items per booking in file order — the same grouping runFile() uses, so itemIndex lines up.
  const itemsFor = (bookingId: string) => parsed.items.map((it, k) => ({ it, k })).filter((x) => bookingKey(x.it.bookingId) === bookingKey(bookingId));

  // R-06 second opinion for "possible" items (one batched call per file).
  const possible: { key: string; bookingId: string; itemIndex: number; it: Item; matched: string[] }[] = [];
  const seen = new Set<string>();
  for (const b of parsed.bookings) {
    if (seen.has(bookingKey(b.bookingId))) continue;
    seen.add(bookingKey(b.bookingId));
    itemsFor(b.bookingId).forEach(({ it }, i) => {
      const dg = detectDangerousGoods(it);
      if (dg.verdict === "possible") possible.push({ key: `${b.bookingId}::${i}`, bookingId: b.bookingId, itemIndex: i, it, matched: dg.matched });
    });
  }
  let r06: R06Review = { source: "none", verdicts: [] };
  const byBooking: Record<string, Record<number, boolean>> = {};
  if (possible.length) {
    const res = await fetchJson<{ verdicts: R06Verdict[]; source: "ai" | "unavailable" }>("/api/r06", {
      items: possible.map((p) => ({
        key: p.key, sku: p.it.sku, description: p.it.description,
        hsCode: normaliseHs(p.it.hsCodeRaw).digits, matched: p.matched,
      })),
    }, R06_CLIENT_TIMEOUT_MS);
    const verdicts = res?.source === "ai" ? res.verdicts : [];
    r06 = { source: verdicts.length ? "ai" : "unavailable", verdicts: [] };
    for (const v of verdicts) {
      const p = possible.find((x) => x.key === v.key);
      if (!p) continue;
      (byBooking[p.bookingId] ??= {})[p.itemIndex] = v.restricted;
      r06.verdicts.push({ bookingId: p.bookingId, itemIndex: p.itemIndex, sku: p.it.sku, restricted: v.restricted, reason: v.reason });
    }
  }
  const run = runFile(parsed.bookings, parsed.items, { now, geminiR06VerdictsByBooking: byBooking });

  onStep("carriers");
  const views: BookingView[] = parsed.bookings.map((b, i) => {
    const its = itemsFor(b.bookingId);
    return {
      booking: b, items: its.map((x) => x.it), raw: parsed.bookingRows[i], itemRaws: its.map((x) => parsed.itemRows[x.k]),
      result: run.results[i], rowId: null,
    };
  });
  const bookingIds = new Set(parsed.bookings.map((b) => bookingKey(b.bookingId)));
  const orphanRows: RawRow[] = parsed.items.map((it, k) => ({ it, k })).filter((x) => !bookingIds.has(bookingKey(x.it.bookingId))).map((x) => parsed.itemRows[x.k]);

  const file: CheckedFile = {
    uploadId: null, fileName, checkedAt: now.toISOString(),
    bookingHeaders: parsed.bookingHeaders, itemHeaders: parsed.itemHeaders, notices: parsed.notices,
    usedExampleAsDemo: parsed.usedExampleAsDemo, fileIssues: run.fileIssues, orphanRows,
    summary: { ...run.summary, ruleFailCounts: run.summary.ruleFailCounts as Record<RuleId, number> },
    r06, views,
  };
  onStep("done");
  return { ok: true, file };
}

/** Save to Neon in the background; null if the DB is unavailable. */
export async function saveCheckedFile(file: CheckedFile): Promise<{ uploadId: string; rowIds: string[] } | null> {
  const { uploadId: _omit, ...body } = file;
  void _omit;
  const res = await fetchJson<{ saved: boolean; uploadId?: string; rowIds?: string[] }>("/api/uploads", {
    ...body, views: body.views.map(({ rowId: _r, ...v }) => { void _r; return v; }),
  }, 15_000);
  return res?.saved && res.uploadId && res.rowIds ? { uploadId: res.uploadId, rowIds: res.rowIds } : null;
}

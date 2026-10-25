"use client";

/**
 * Explanations for each booking: deterministic fallback immediately, replaced by Gemini
 * text when /api/explain answers. Cached per booking hash so re-renders never re-call.
 */
import { useEffect, useMemo, useState } from "react";
import { explanationKey, fallbackExplanation } from "@/lib/explain";
import type { Explanation } from "@/lib/schema";
import type { BookingView } from "@/lib/types";

const cache = new Map<string, Explanation>();
const inflight = new Set<string>();
const CHUNK = 6;

export function useExplanations(views: BookingView[]): Map<string, Explanation> {
  const keys = useMemo(() => views.map((v) => explanationKey(v.booking, v.result)), [views]);
  const [, bump] = useState(0);

  useEffect(() => {
    const todo = views.map((v, i) => ({ v, key: keys[i] })).filter((x) => !cache.has(x.key) && !inflight.has(x.key));
    if (!todo.length) return;
    todo.forEach((x) => inflight.add(x.key));
    // No cancel-on-cleanup: `views` changes identity when the upload is saved (row ids added),
    // and the keys are already in flight, so this request must still trigger the re-render.
    void (async () => {
      for (let i = 0; i < todo.length; i += CHUNK) {
        const chunk = todo.slice(i, i + CHUNK);
        try {
          const res = await fetch("/api/explain", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookings: chunk.map((x) => ({ booking: x.v.booking, items: x.v.items, result: x.v.result })) }),
          });
          if (res.ok) {
            const data = (await res.json()) as { explanations: { key: string; explanation: Explanation }[] };
            data.explanations.forEach((e, k) => cache.set(chunk[k].key, e.explanation));
          }
        } catch {
          /* fallback text stays */
        }
        chunk.forEach((x) => inflight.delete(x.key));
        bump((n) => n + 1);
      }
    })();
  }, [views, keys]);

  const out = new Map<string, Explanation>();
  views.forEach((v, i) => out.set(v.booking.bookingId + "#" + i, cache.get(keys[i]) ?? { ...fallbackExplanation(v.booking, v.items, v.result), source: "fallback" }));
  return out;
}

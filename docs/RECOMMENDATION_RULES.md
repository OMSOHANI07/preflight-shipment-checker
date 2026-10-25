# Carrier Recommendation Rules (for the Gemini API)

> **For Claude Code.** The ranking itself is computed in code by `recommend()` in `calculations.ts`.
> Gemini receives the result (`BookingResult.recommendation`) and turns it into a clear explanation, and in
> chat/voice it gathers the seller's requirements. Gemini must follow every rule in this file. Section 9 is a
> ready-to-paste system prompt.

---

## 1. The division of work

| Step | Who | Notes |
|---|---|---|
| Collect requirements (priority, dates, budget, etc.) | Gemini (chat/voice) | Questions in Section 3 and `QUESTIONS.md` |
| Turn answers into fields | Gemini → JSON → `normalise*()` in code | Gemini outputs raw values; code normalises |
| Filter, cost, ETA, rank, tie-break | **Code only** (`recommend()`) | Deterministic |
| Explain the pick, the trade-off, the exclusions | Gemini | Use **only** `reasonFacts` and the numbers in the result |
| Answer "what if" questions ("what if I add a pallet?") | Code re-runs `runAll()` on a copy; Gemini explains the diff | Never estimate in the model |

---

## 2. Fixed carrier rate card (Sheet 3)

| Carrier · Service | Germany £/pallet | France £/pallet | Netherlands £/pallet | Transit (working days) | On-time | Max kg/pallet |
|---|---|---|---|---|---|---|
| Carrier A · Road economy | 180 | 170 | 160 | 5 | 92% | 500 |
| Carrier B · Road standard | 220 | 210 | 200 | 3 | 95% | 750 |
| Carrier C · Road express | 340 | 330 | 320 | 2 | 98% | 400 |

Origin is always the United Kingdom; the price does not depend on the UK origin city.

Key facts Gemini can say (true for every route): A is always cheapest and slowest; C is always fastest and most
reliable but the most expensive and accepts the lightest pallets (400 kg); B accepts the heaviest pallets (750 kg).

---

## 3. Inputs used for recommendation

### 3.1 Required (from Sheet 1)

| Input | Used for |
|---|---|
| Destination country (from city) | Which 3 rate-card rows apply |
| Pallets | Cost = £/pallet × pallets; weight per pallet |
| Total gross weight (kg) | Weight per pallet vs each carrier's max (R-05) |
| Ready to ship date | Collection date and estimated delivery date |
| Seller priority | Ranking |

### 3.2 Optional requirements (ask in chat/voice; improve the recommendation)

| Input | Field | Type | Effect | When to ask |
|---|---|---|---|---|
| Must arrive by | `prefs.requiredDeliveryDate` | Date | **Hard constraint**: ETA ≤ date | Always offer once: "Does it need to arrive by a certain date?" |
| Delivery appointment date | `prefs.appointmentDate` | Date | **Hard constraint**: ETA ≤ appointment date | If appointment booked = Yes |
| Freight budget | `prefs.maxBudgetGbp` | £ | **Hard constraint**: cost ≤ budget | If priority = Cheapest or Balanced, or seller mentions money |
| High-value or fragile goods | `prefs.highValueOrFragile` | Yes/No | Balanced weights shift to reliability | If priority = Balanced, or average unit value is high |
| Carriers to avoid | `prefs.excludeCarriers` | List | Hard constraint | Only if the seller mentions it |
| Seller picks a carrier | `chosenCarrierId` | ID | That carrier is booked; R-05 is checked against it | When the seller says "go with B" |
| Open to more pallets? | (conversation only) | Yes/No | Lets Gemini propose the add-pallet option first | When R-05 fails |

If the seller has no priority: ask once ("cheapest, fastest, most reliable, or a balance?"). If they still don't
choose, use **Balanced** and say so.

**Translating requirements into priority:** "it's urgent / ASAP" → Fastest. "Customer is waiting for a
promotion launch / can't be late" → Most reliable. "Keep costs down" → Cheapest. "Whatever's sensible" →
Balanced. A specific date ("needs to be there by the 10th") is a **deadline**, not a priority — store it as
`requiredDeliveryDate` and keep asking about priority only if it's still unknown.

---

## 4. Calculations per carrier (done in code)

| Quantity | Formula |
|---|---|
| Freight cost | price per pallet × pallets |
| Weight per pallet | total gross weight ÷ pallets |
| Fits weight | weight per pallet ≤ max kg per pallet (equal passes) |
| Minimum pallets for this carrier | ⌈gross weight ÷ max kg per pallet⌉ |
| Cost if re-palletised | price per pallet × minimum pallets (only if more pallets are needed) |
| Collection date | ready date; if in the past → today; if Sat/Sun → next Monday |
| Estimated delivery (ETA) | collection date + transit days, counting Monday–Friday only |
| Meets deadline | ETA ≤ earliest of (required delivery date, appointment date) |
| Within budget | cost ≤ max budget |
| Late risk | 100 − on-time % |
| Cost per kg | cost ÷ gross weight |
| Cost per unit | cost ÷ total units |

---

## 5. Selection algorithm (`recommend()`)

1. **Route filter:** keep the 3 carriers for UK → destination country.
2. **Evaluate** each carrier (Section 4).
3. **Eligibility (hard constraints):** fits weight AND meets deadline (if any) AND within budget (if any) AND not excluded.
4. **Priority pick** (used for R-05 explanation): best carrier by the seller's priority among those meeting deadline/budget/exclusions, **ignoring weight**.
5. **Rank eligible carriers** by priority:
   - **Cheapest:** lowest freight cost.
   - **Fastest:** fewest transit days.
   - **Most reliable:** highest on-time %.
   - **Balanced:** highest score = 0.4 × cost score + 0.3 × speed score + 0.3 × reliability score, where each score is min–max normalised across the eligible carriers (1 = best, 0 = worst; 1 for all if they tie). High-value/fragile goods: 0.3 cost, 0.3 speed, 0.4 reliability.
6. **Tie-breakers (in order):** higher on-time % → lower cost → fewer transit days → carrier name A–Z.
7. **Runner-up** = second in the ranking (for the trade-off sentence).
8. **No eligible carrier — fallbacks, in order:**
   - Budget can't be met → ignore budget, keep weight + deadline; say "No option fits your budget; X is the best that meets everything else".
   - Deadline can't be met → recommend the **fastest carrier that fits weight**; say when it arrives and suggest an earlier ready date (code: `latestReadyDateFor()`).
   - Weight fits no carrier (> 750 kg/pallet) → "No carrier fits"; the fix is more pallets: `⌈gross ÷ 750⌉` for Carrier B (also show A and C minimums).
9. **Label:** "Recommended" (GREEN/AMBER); "Recommended once fixed" (RED/INCOMPLETE, or R-05 fails); "No carrier fits".

### 5.1 Reference outcomes (from the real rate card; verified in code)

| Case | Inputs | Result | Why |
|---|---|---|---|
| Template BK-001 | Frankfurt, Cheapest, 3 pallets, 620 kg, ready Thu 05-11-2026 | Carrier A, £540, ETA Thu 12-11-2026 | Cheapest; 206.67 kg/pallet fits all |
| Same, Balanced | — | Carrier B, £660 | Score B 0.65 > C 0.60 > A 0.40 |
| Same, Fastest or Most reliable | — | Carrier C, £1,020, ETA Mon 09-11-2026 | 2 days, 98% |
| Paris, Balanced, 2 pallets, 800 kg, ready Mon 02-11-2026 | — | Carrier B, £420, ETA Thu 05-11-2026 | Runner-up C: £240 more, 1 day faster, 3 points more reliable |
| Rotterdam, Cheapest, 4 pallets, 1,000 kg, must arrive by 05-11-2026, ready 02-11 | — | Carrier B, £800, arrives exactly on the deadline | A excluded: arrives 09-11 |
| Berlin, Fastest, 2 pallets, 900 kg | 450 kg/pallet | "Recommended once fixed": Carrier B £440; R-05 Red vs Carrier C (max 400) | Fix: 3 pallets keeps C (£1,020) or switch to B |
| Hamburg, Balanced + high-value, 2 pallets, 600 kg | — | Carrier C, £680 | Reliability weighted up: C 0.70 > B 0.625 |
| Amsterdam, Fastest, budget £500, 2 pallets, 500 kg | — | Carrier B, £400 | C excluded: £640 over budget |
| Any route, 3 pallets, 2,400 kg | 800 kg/pallet | "No carrier fits" | Needs ≥ 4 pallets (B), 5 (A) or 6 (C) |

---

## 6. How Gemini must explain a recommendation

### 6.1 Structure (keep it to 3–5 short sentences)

1. **The pick:** carrier + service, cost, arrival date.
2. **Why, tied to the priority:** one sentence using the priority's metric.
3. **Trade-off:** the runner-up in one sentence (cost / days / reliability differences).
4. **Exclusions (if any):** why a carrier the seller might expect was not chosen.
5. **Caveat (if any):** "once fixed", deadline met with no spare days, past ready date assumed today.

### 6.2 Templates

- **Cheapest:** "We recommend {Carrier} {Service} at {cost} for {n} pallets — the lowest price on this route. It arrives {ETA} ({days} working days, {ot}% on time). {Runner-up} would be {Δdays} faster for {Δcost} more."
- **Fastest:** "We recommend {Carrier} {Service}: {days} working days, arriving {ETA}, the quickest option. It costs {cost}. {Runner-up} saves {Δcost} but takes {Δdays} longer."
- **Most reliable:** "We recommend {Carrier} {Service}: {ot}% of its shipments arrive on the promised day — the best record on this route. Cost {cost}, arriving {ETA}."
- **Balanced:** "We recommend {Carrier} {Service} as the best all-round option: {cost}, {days} working days, {ot}% on time. Compared with {runner-up}, it {trade-off}."
- **With a deadline:** add "It arrives {spare} day(s) before your {deadline} deadline" or "It arrives exactly on your deadline, with no spare days."
- **R-05 conflict:** "{Priority pick} would suit your priority best, but your pallets weigh {w} kg each and it accepts up to {max} kg. You can either use {n} pallets and keep {priority pick} at {cost'}, or go with {recommended} at {cost}."
- **No carrier fits:** "None of the carriers can take {w} kg per pallet (the highest limit is 750 kg). Spread the load over at least {n} pallets and we'll recommend again."

### 6.3 Guardrails

- G-1. Use only numbers present in the result JSON (`reasonFacts`, `recommended`, `runnerUp`, `allOptions`). Never compute, round differently or invent figures.
- G-2. Never recommend a carrier that is not `recommended` unless the seller asks for alternatives; then list from `allOptions` with their `ineligibleReasons`.
- G-3. Never say a booking is ready to go if status is RED or INCOMPLETE — say "once the issues above are fixed".
- G-4. Dates as weekday + DD-MM-YYYY (e.g. "Thursday 12-11-2026"); money as £1,234.00; transit in "working days".
- G-5. Don't promise delivery — say "estimated delivery" / "should arrive".
- G-6. If the seller pushes back ("B is too expensive"), offer the next option by their stated concern and re-run with the new preference (e.g. switch priority to Cheapest or set a budget).
- G-7. Plain English, no jargon. If you mention "on-time rate", explain it once ("share of shipments that arrive on the promised day").
- G-8. One recommendation per booking; never more than one runner-up in the main text.

---

## 7. Mid-way changes that affect the recommendation

| Change | Recompute | Typical effect to explain |
|---|---|---|
| Destination country | All costs | Prices differ: Germany > France > Netherlands |
| Pallets | Cost, weight per pallet, eligibility | More pallets → higher cost but may unlock lighter-limit carriers (A, C) |
| Gross weight | Weight per pallet, eligibility | Heavier → A (500) and C (400) may drop out |
| Ready date | ETAs, deadline fit | Later ready date may make A or B miss the deadline |
| Priority | Ranking | Pick changes |
| Deadline / appointment date | Eligibility | Slow options may drop out |
| Budget | Eligibility | Expensive options may drop out |
| High-value flag | Balanced weights | Balanced may move from B to C |
| Seller chooses a carrier | R-05 vs that carrier | Confirm cost/ETA, or warn if it fails weight |

Always say what changed: "Adding a pallet brings each pallet down to 400 kg, so Carrier A can take it again.
At 4 pallets Carrier A costs £720 — note that Carrier B with your original 3 pallets was £660."

---

## 8. Data contract

### 8.1 Input Gemini receives (built by code)

```json
{
  "booking": { "bookingId": "BK-001", "destinationCity": "Frankfurt", "destinationCountry": "Germany",
               "pallets": 3, "totalGrossWeightKg": 620, "readyToShipDate": "2026-11-05",
               "sellerPriority": "Cheapest", "prefs": { "requiredDeliveryDate": null } },
  "status": "GREEN",
  "recommendation": {
    "label": "Recommended",
    "recommended": { "carrier": { "id": "A-DE", "carrier": "Carrier A", "service": "Road economy",
                     "transitDays": 5, "onTimePct": 92, "maxKgPerPallet": 500, "pricePerPallet": 180 },
                     "cost": 540, "collectionDate": "2026-11-05", "etaDate": "2026-11-12" },
    "runnerUp": { "carrier": { "id": "B-DE" }, "cost": 660, "etaDate": "2026-11-10" },
    "reasonFacts": [
      "Priority: Cheapest.",
      "Carrier A Road economy: £540.00 for 3 pallet(s) at £180.00 each; 5 working days; 92% on time; max 500 kg/pallet.",
      "Collection 05-11-2026, estimated delivery 12-11-2026.",
      "Runner-up Carrier B Road standard: £120.00 more, 2 days faster, 3 percentage points more reliable."
    ]
  }
}
```

### 8.2 Output Gemini must return (JSON only, no markdown fences)

```json
{
  "headline": "Carrier A Road economy — £540.00, arriving Thursday 12-11-2026",
  "reason": "It's the cheapest option to Germany for 3 pallets.",
  "tradeoff": "Carrier B would arrive 2 days sooner for £120.00 more.",
  "exclusions": [],
  "caveat": null
}
```

### 8.3 Requirement extraction (chat/voice) — Gemini returns

```json
{
  "sellerPriority": "Cheapest | Fastest | Most reliable | Balanced | null",
  "prefs": {
    "requiredDeliveryDate": "raw text or null (code parses)",
    "appointmentDate": "raw text or null",
    "maxBudgetGbp": "raw text or null",
    "highValueOrFragile": true,
    "excludeCarriers": []
  },
  "chosenCarrier": "Carrier B | null"
}
```

---

## 9. System prompt for Gemini (paste as-is)

```
You are the shipping assistant for a UK freight booking tool. Shipments go by road from the UK to
Germany, France or the Netherlands. Three services exist on every route:
Carrier A Road economy (cheapest, 5 working days, 92% on time, max 500 kg per pallet),
Carrier B Road standard (3 working days, 95% on time, max 750 kg per pallet),
Carrier C Road express (fastest, 2 working days, 98% on time, max 400 kg per pallet, most expensive).

Rules you must follow:
1. You never calculate costs, dates, weights or totals, and you never decide whether a rule passes.
   The application gives you a JSON result. Use only the numbers and facts in it.
2. When explaining a carrier recommendation: say the pick (carrier, service, cost, estimated delivery
   date), why it fits the seller's priority, the trade-off versus the runner-up, why any expected carrier
   was excluded, and any caveat. 3–5 short sentences, plain English.
3. If the status is RED or INCOMPLETE, say the carrier is "recommended once the issues are fixed".
4. Dates: weekday + DD-MM-YYYY. Money: £1,234.00. Transit: "working days". Say "estimated delivery".
5. When gathering requirements, ask one short question at a time and only for missing information.
   Priority options: Cheapest, Fastest, Most reliable, Balanced. A target date is a deadline, not a
   priority. If the seller has no preference, use Balanced and say so.
6. If the seller asks "what if…", ask the application to recalculate; never estimate.
7. Return JSON only when the application asks for JSON.
```

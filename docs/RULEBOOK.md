# Pre-Flight Shipment Checker — Master Rulebook

> **For Claude Code.** This is the single source of truth for every rule the app applies, for every input
> channel (Excel upload, chat, voice). Every rule here is implemented in `calculations.ts`; the function
> name is given for each rule. Formulas are also in `CALCULATIONS_FORMULAS.pdf`. Carrier logic is in
> `RECOMMENDATION_RULES.md`. Questions for chat/voice are in `QUESTIONS.md`.
>
> Sources: (1) the case brief, (2) the Excel template `Case2_Shipment_Booking_Test_Data_Format.xlsx`
> (Bookings, Items, Carrier options, Rulebook, Allowed values, Field guide, Glossary sheets), (3) the UK
> government guide *How to create an export (commercial) invoice* (business.gov.uk).

---

## Contents

1. Principles and rule tiers
2. Severity, status and what each status allows
3. Input channels and the common booking model
4. Field catalogue — every input, its format, allowed values and normalisation
5. Tier 2 — Input validation rules (V-01 … V-11)
6. Tier 1 — Official rulebook (R-01 … R-10), in full detail
7. Tier 3 — Advisory rules (A-01 … A-09) from the UK export invoice guide
8. Channel-specific rules (Excel, chat, voice)
9. Carrier and recommendation rules (summary)
10. Mid-way change rules — what changes when something is changed
11. Output rules — what the seller must see for every booking
12. Configuration decisions and why

---

## 1. Principles and rule tiers

| Tier | IDs | Source | Severity | Can block a booking? |
|---|---|---|---|---|
| 1 — Official | R-01 … R-10 | Sheet 4 of the template (judges test only these) | Red or Amber, exactly as Sheet 4 says | Red: yes. Amber: no (needs acknowledgement) |
| 2 — Input validation | V-01 … V-11 | Field guide sheet + Allowed values sheet | Data | Yes, until the data is complete and readable |
| 3 — Advisory | A-01 … A-09 | UK export invoice guidance + good practice | Advisory | Never. Shown as tips only |

**P-1. Official rules are never softened or hardened.** Severity is exactly Sheet 4. Advisory rules never change a
booking's status. This avoids flagging bookings the judges consider clean.

**P-2. No duplicates.** If an official rule covers a problem, report it under the official rule only.
Blank HS code → R-01 (not V-07). Blank country of origin → R-09 (not V-07).

**P-3. Code decides, Gemini explains.** All checks and numbers come from `calculations.ts`. Gemini only:
(a) extracts fields from chat/voice, (b) gives a second opinion on R-06 when keyword detection is
"possible", (c) phrases explanations using the facts in `BookingResult`. Gemini must never compute a
total, decide pass/fail, or invent a number.

**P-4. One engine for all channels.** Excel, chat and voice produce the same `Booking` + `Item[]` objects
and call the same `runAll()`. The same booking entered two ways must give identical results.

**P-5. Re-run everything on every change.** Any edit triggers a full `runAll()`, then `diffResults()` to
tell the seller what changed (Section 10). Never patch a single rule result.

**P-6. Every issue has three parts:** what is wrong (with the actual numbers), how serious it is, and how to
fix it (at least one concrete action, with the corrected value where it can be computed).

**P-7. Seller-stated values are checked, never silently corrected.** Values marked "as the seller states it"
(pallets, cartons, declared value, gross weight, HS code, quantity, item cartons) may be wrong. We flag
and suggest; we only change them when the seller agrees.

---

## 2. Severity, status and what each status allows

### 2.1 Severities

| Severity | Meaning (from the Glossary sheet) | Colour |
|---|---|---|
| Red | The shipment must not go until fixed | Red |
| Data | Information is missing or unreadable, so some rules can't be checked | Grey |
| Amber | Risky, should be fixed or checked | Amber |
| Advisory | Good practice from UK export guidance; optional | Blue |

### 2.2 Booking status (`aggregateStatus`)

Evaluated in this order — first match wins:

| Status | Condition | Confirm button | Carrier label |
|---|---|---|---|
| RED | Any Red issue | Disabled | "Recommended once fixed" |
| INCOMPLETE | No Red, but any Data issue | Disabled | "Recommended once fixed" |
| AMBER | Only Amber (and/or Advisory) issues | Enabled after the seller ticks "I understand these warnings" | "Recommended" |
| GREEN | No Red, Data or Amber issues | Enabled | "Recommended" |

### 2.3 Rule result per booking

Each of R-01 … R-10 shows one of: **pass**, **fail**, **not evaluable** (an input it needs is missing).
"Not evaluable" is never shown as pass.

### 2.4 Issue ordering

Red → Data → Amber → Advisory; within a severity by rule ID, then item order.

### 2.5 Always recommend

Every booking gets a carrier recommendation section, even RED or INCOMPLETE ones (labelled
"Recommended once fixed"). If no carrier can take the shipment, show "No carrier fits" and why.

---

## 3. Input channels and the common booking model

| Channel | How data arrives | Normalised by | Notes |
|---|---|---|---|
| Excel upload (Part 2) | Sheets "Bookings" and "Items"; header in row 2; grey example row 3; data from row 4 | `bookingFromRow`, `itemFromRow` | Skip the title row 1 and example row 3 *only if* it is the template's grey example (BK-001 Northfield Goods with MUG-01). Judges may also reuse BK-001 as a real ID — if the row is not grey-filled, treat it as data. |
| Chat (Part 1) | Free text → Gemini structured extraction → same fields | Same normalisers | Ask only for missing fields (`QUESTIONS.md`). |
| Voice (Part 1) | Speech → text (Web Speech API) → same as chat | Same normalisers + spoken number/date parsing | Read back numbers, dates and HS codes before saving. |

Common model (`Booking`, `Item` in `calculations.ts`). Each booking field also has a **provenance**:
`stated` (seller said it), `derived` (we calculated it and the seller confirmed), or `default` (fixed values
such as currency GBP and origin country UK). Provenance drives mid-way change behaviour (Section 10).

---

## 4. Field catalogue

### 4.1 Sheet 1 — Bookings

| # | Field | Required | Format | Allowed values | Normalisation accepted (chat/voice/Excel) | Rules that read it |
|---|---|---|---|---|---|---|
| B1 | Booking ID | Yes | Text, unique | e.g. BK-001 | Trim. In chat, auto-generate `BK-CHAT-<timestamp>` | V-01 |
| B2 | Seller name | Yes | Text | Any | Trim | V-02 |
| B3 | Origin city | Yes | Fixed list | London, Manchester, Birmingham, Leeds | Case-insensitive; "Brum" → Birmingham | V-02, V-03 |
| B4 | Origin country | Yes | Fixed | United Kingdom | UK, GB, Great Britain, Britain, England, Scotland, Wales, Northern Ireland → United Kingdom. In chat, default (never ask) | V-02, V-03 |
| B5 | Destination city | Yes | Fixed list | Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam, Rotterdam | "Frankfurt am Main" → Frankfurt; "Lyons" → Lyon | V-02, V-04 |
| B6 | Destination country | Yes | Fixed list | Germany, France, Netherlands | DE/Deutschland → Germany; FR → France; NL/Holland/The Netherlands → Netherlands. In chat, infer from city (don't ask) | V-02, V-03, V-04, carrier route |
| B7 | Destination type | Yes | Dropdown | Warehouse / Business address | Warehouse ← warehouse, fulfilment centre, FC, distribution centre, DC, depot, Amazon, 3PL. Business address ← shop, store, office, retail, showroom, business | R-08, A-04 |
| B8 | Ready to ship date | Yes | Date DD-MM-YYYY | Any date | DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD, Excel serial numbers, "tomorrow", "next Friday", "5th November". UK day-first order always. Invalid dates (31-02) rejected | R-10, ETA, A-05 |
| B9 | Seller priority | Yes | Dropdown | Cheapest / Fastest / Most reliable / Balanced | Cheapest ← cheap, lowest cost, budget, economy. Fastest ← fast, quick, ASAP, urgent, express. Most reliable ← reliable, on time, can't be late, safe. Balanced ← balanced, no preference, best value, don't mind | Recommendation, R-05 (chosen carrier) |
| B10 | Pallets | Yes | Whole number ≥ 1 | — | "3", "three", "3 pallets" | R-05, cost, V-05 |
| B11 | Cartons (booking total) | Yes | Whole number ≥ 1 | As stated | Numbers/words. In chat, may be derived from items and confirmed | R-04, V-05 |
| B12 | Total declared value | Yes | Number > 0, GBP | As stated | "£5,400", "5400 pounds", "five thousand four hundred". In chat, may be derived and confirmed | R-02, A-07 |
| B13 | Currency | Yes | Fixed | GBP | £, pound(s), sterling, quid → GBP. In chat, default (never ask) | V-03 |
| B14 | Total gross weight (kg) | Yes | Number > 0 | As stated | "620", "620 kg", "620 kilos". Never auto-derived (includes packaging) | R-05, R-07, A-03 |
| B15 | Delivery appointment booked | Yes | Yes / No | Yes, No | yes/yeah/booked/sorted → Yes; no/not yet/haven't → No | R-08, A-04 |

**Optional booking extras (chat/voice only, improve the recommendation; never required):**
required delivery date, delivery appointment date, maximum freight budget (GBP), high-value/fragile goods,
carriers to avoid, chosen carrier. See `RECOMMENDATION_RULES.md`.

### 4.2 Sheet 2 — Items

| # | Field | Required | Format | Allowed values | Normalisation | Rules that read it |
|---|---|---|---|---|---|---|
| I1 | Booking ID | Yes | Text | Must match a Booking ID on Sheet 1 | Trim | V-11 |
| I2 | SKU | Yes | Text | Any | Trim. In chat, auto-generate `ITEM-1`, `ITEM-2` if the seller has none, and say so | V-07, V-10 |
| I3 | Description | Yes | Text | Any | Trim | R-06, A-01 |
| I4 | HS code | No (blank allowed but fails R-01) | Number or text | ≥ 6 digits | **Read the raw cell; never convert to Number.** Strip spaces, dots, dashes ("6912.00" → 691200). Flag non-digit characters. 5-digit numeric cell → possible lost leading zero | R-01, R-06 hints, A-06 |
| I5 | Quantity (units) | Yes | Whole number ≥ 1 | As stated | Numbers/words ("a thousand and eighty", "1,080") | R-02, R-03, R-07 |
| I6 | Unit price | Yes | Number > 0, GBP | — | "£5", "5 pounds", "five pounds fifty" → 5.50 | R-02 |
| I7 | Units per carton | Yes | Whole number ≥ 1 | — | "12", "a dozen" | R-03 |
| I8 | Cartons (item) | Yes | Whole number ≥ 1 | As stated | Numbers/words | R-03, R-04 |
| I9 | Unit weight (kg) | Yes | Number > 0 | — | "0.5", "500 g" → 0.5 (convert grams ÷ 1000) | R-07 |
| I10 | Country of origin | Yes per Field guide (blank fails R-09) | Fixed list | United Kingdom, China, India, Vietnam, Turkey, Germany | Aliases as B4/B6 plus PRC, Türkiye, Viet Nam | R-09, A-02, V-09 |

### 4.3 Sheet 3 — Carrier options (fixed, hard-coded as `CARRIERS`)

| Carrier | Service | Route | £/pallet DE / FR / NL | Transit (days) | On-time | Max kg/pallet |
|---|---|---|---|---|---|---|
| Carrier A | Road economy | UK → DE/FR/NL | 180 / 170 / 160 | 5 | 92% | 500 |
| Carrier B | Road standard | UK → DE/FR/NL | 220 / 210 / 200 | 3 | 95% | 750 |
| Carrier C | Road express | UK → DE/FR/NL | 340 / 330 / 320 | 2 | 98% | 400 |

### 4.4 Sheet 4 — Rulebook (fixed, hard-coded as `RULES`) — detailed in Section 6.

---

## 5. Tier 2 — Input validation rules (severity: Data)

Implemented in `validateInputs()` and `orphanItemIssues()`.

| ID | Rule | Applies to | Triggers when | Message (template) | Fix |
|---|---|---|---|---|---|
| V-01 | Booking ID present and unique | Booking | Blank, or appears twice on Sheet 1 | "Booking ID BK-xxx appears more than once." | Give each booking a unique ID |
| V-02 | Every required booking field present | Booking | Any of B2–B15 blank/unreadable | "{Field} is blank or could not be read." | Provide it (chat: ask the question for that field) |
| V-03 | Value is in the allowed list | Booking | Origin not UK; origin city not in list; destination country not DE/FR/NL; currency not GBP | "Origin city 'Bristol' is not one of London, Manchester, Birmingham, Leeds." | Choose an allowed value |
| V-04 | Destination city matches destination country | Booking | e.g. Paris + Germany | "Paris is not a supported city in Germany (Berlin, Frankfurt, Hamburg)." | Correct the city or change the country |
| V-05 | Booking numbers are sensible | Booking | Pallets or cartons not a whole number ≥ 1; declared value or gross weight ≤ 0 | "Pallets is 2.5." | Enter a whole number / positive number |
| V-06 | Booking has at least one item | Booking | No Items rows with this Booking ID | "No rows on the Items sheet carry this Booking ID." | Add items |
| V-07 | Every required item field present | Item | SKU, description, quantity, unit price, units per carton, cartons or unit weight blank (HS → R-01; origin → R-09) | "{Field} is blank for item SKU." | Provide it |
| V-08 | Item numbers are sensible | Item | Quantity, units per carton, cartons not whole ≥ 1; unit price or unit weight ≤ 0 | "Units per carton is 0." | Enter a valid number |
| V-09 | Country of origin in allowed list | Item | Not one of the six | "'Japan' is not one of …" | Choose a listed country |
| V-10 | SKU not duplicated within a booking | Item | Same SKU on two rows of one booking | "SKU MUG-01 appears on several rows." | Merge rows or rename SKUs |
| V-11 | Item belongs to a real booking (file level) | Item | Booking ID not on Sheet 1 | "Booking ID BK-099 on the Items sheet doesn't exist on Bookings." | Fix the ID or add the booking |

**Data-issue effect:** booking status becomes INCOMPLETE (unless RED). Rules whose inputs are missing are
"not evaluable" (mapping in `RULE_INPUTS`). All other rules still run and are reported.

**Parsing edge cases (all channels):**

- Numbers with thousands separators, currency symbols or units are accepted ("£5,400.00", "620 kg").
- Dates: Excel may deliver a serial number (46331 = 05-11-2026) or a Date object — both accepted.
- HS code column: read the cell's raw value. If Excel stored it as a number, leading zeros are already gone.
- Header matching is case- and space-insensitive; extra columns are ignored; missing required columns → V-02 for every booking with a clear "column not found" note.
- Empty rows are skipped. Rows with only a Booking ID are treated as data with missing fields.

---

## 6. Tier 1 — Official rulebook (R-01 … R-10)

Each rule lists: statement (verbatim from Sheet 4), severity, inputs, exact test, edge cases, message, fix,
worked example, and which changes re-trigger it.

### R-01 — HS code ≥ 6 digits — **Red** — `checkR01()`

- **Statement:** Every item must have an HS code of at least 6 digits.
- **Why (UK guide):** the HS code sets the duty rate; misclassification makes the exporter legally liable.
- **Inputs:** item HS code (raw).
- **Test (per item):** `digits = raw with spaces, dots and dashes removed`; pass if `digits` contains only 0–9 **and** `length(digits) ≥ 6`.
- **Fails when:** blank; fewer than 6 digits; contains letters or other characters.
- **Edge cases:**
  - "6912.00" or "6912 00" → 691200 → pass.
  - 5-digit **numeric** cell (e.g. 90111) → fail, with the note "Excel may have removed a leading zero; if the code is 090111, format the column as Text and re-enter it". Config `HS_PAD_5_DIGIT_NUMERIC` (default false) can auto-pad instead.
  - 7–10 digits → pass (8 and 10 are the UK export / EU import lengths).
- **Message:** "MUG-01 (Ceramic coffee mug) has HS code 6912, which is only 4 digits (minimum 6)."
- **Fix:** add the full code from the UK Trade Tariff; if a leading zero was lost, re-enter as text.
- **Re-check when:** HS code changes; item added.

### R-02 — Declared value = Σ(quantity × unit price) within 1% — **Red** — `checkR02()`

- **Inputs:** booking total declared value; each item's quantity and unit price.
- **Calculation:** `computed = Σ round_to_pence(quantity × unit price)`; `diff = declared − computed`; `tolerance = 1% × computed`.
- **Test:** pass if `|diff| ≤ tolerance` (compared in pence). The base is the **computed** value (what the goods are actually worth).
- **Edge cases:** exactly 1% → pass; any item missing quantity or price → not evaluable; computed = 0 is impossible because V-08 requires price > 0.
- **Message:** "Declared value is £5,000.00 but the items add up to £5,400.00 (MUG-01: 1080 × £5.00 = £5,400.00). The declared value is £400.00 (7.41%) lower; the limit is 1% (£54.00)."
- **Fix:** set declared value to the computed total, **or** correct the item quantity/price that is wrong. Mention that under-declaring can cause a customs hold or penalty.
- **Advisory follow-up:** if 0 < |diff| ≤ 1% → A-07 (close but not exact).
- **Re-check when:** declared value, any quantity, any unit price changes; item added/removed.

### R-03 — Units per carton × cartons = quantity (per item) — **Red** — `checkR03()`

- **Inputs:** item units per carton, item cartons, item quantity.
- **Test:** `units per carton × cartons == quantity` exactly (no tolerance).
- **Fix options (show all that apply):**
  1. Quantity right → cartons = quantity ÷ units per carton (only if it divides evenly).
  2. If it doesn't divide evenly → cartons needed = ⌈quantity ÷ units per carton⌉, last carton holds `quantity mod units per carton` units; tell the seller the rule needs full cartons, so either quantity or units per carton is wrong.
  3. Cartons right → quantity = units per carton × cartons.
  4. Quantity and cartons right → units per carton = quantity ÷ cartons (if whole).
- **Message:** "MUG-01: 12 units per carton × 85 cartons = 1,020 units, but quantity is 1,080 (60 units more than fit)."
- **Why it matters:** the receiving warehouse counts units per carton; mismatches are reported as missing units.
- **Re-check when:** quantity, units per carton or item cartons change.

### R-04 — Booking cartons = Σ item cartons — **Red** — `checkR04()`

- **Inputs:** booking cartons; every item's cartons.
- **Test:** `booking cartons == Σ item cartons` exactly.
- **Message:** "Booking says 84 cartons, but the items add up to 90 (MUG-01: 60 + BOWL-02: 30). Difference: 6 cartons."
- **Fix:** set booking cartons to the sum, **or** add/correct the missing item.
- **Note:** R-03 and R-04 can fail together; report both (they are different errors).
- **Re-check when:** booking cartons or any item cartons change; item added/removed.

### R-05 — Weight per pallet ≤ chosen carrier's max — **Red** — `checkR05()`

- **Inputs:** total gross weight, pallets, destination country (route), the **chosen carrier**.
- **Calculation:** `weight per pallet = gross weight ÷ pallets` (2 dp).
- **Test:** pass if `weight per pallet ≤ chosen carrier's max kg per pallet` (exactly equal passes).
- **Which carrier is "chosen":**
  1. The carrier the seller explicitly picked (chat: "go with Carrier B"), else
  2. `R05_MODE = "priority_pick"` (default): the carrier the seller's priority would choose if weight were ignored. This surfaces the problem instead of hiding it — e.g. "Cheapest" wants Carrier A (max 500 kg), so 533 kg/pallet fails R-05 even though Carrier B (750 kg) could take it.
  3. Alternative `R05_MODE = "recommended"`: check against the best eligible carrier (R-05 then fails only if no carrier on the route fits).
- **Fix options (always computed):**
  - Add pallets: `minimum pallets = ⌈gross ÷ carrier max⌉`, with the new cost.
  - Switch to each carrier that fits, with its cost and arrival date.
  - If no carrier fits (> 750 kg/pallet), adding pallets is the only fix.
  - Double-check gross weight and pallet count for typos.
- **Message:** "1,600 kg ÷ 3 pallets = 533.33 kg per pallet, over Carrier A Road economy's limit of 500 kg (by 33.33 kg)."
- **Re-check when:** gross weight, pallets, destination country, seller priority, chosen carrier, deadline/budget preferences change.

### R-06 — No lithium batteries, aerosols or flammable liquids — **Red** — `checkR06()` + `detectDangerousGoods()`

- **Inputs:** item description, SKU, HS code.
- **Method (3 steps):**
  1. Remove negation phrases first ("non-flammable", "battery-free", "no batteries", "batteries not included", "non-aerosol", "pump spray", "alcohol-free", "water-based", "solvent-free").
  2. Match **definite** keywords or HS prefixes → Red immediately.
     - Lithium: lithium, Li-ion, LiPo, LiFePO4, power bank, 18650, CR2032, button cell, e-cigarette, vape, battery pack, rechargeable battery. HS 850650, 850760.
     - Aerosol: aerosol, spray can, spray paint, hairspray, deodorant/body spray, dry shampoo, compressed air/gas, pressurised, gas canister, butane, propane, CO2 cartridge, cream charger, shaving foam, cooking spray, fire extinguisher.
     - Flammable liquid: flammable, petrol, diesel, kerosene, paraffin, lamp oil, lighter fluid, methylated/white spirit, turpentine, acetone, nail polish/varnish (and remover), isopropyl, ethanol, solvent, thinners, lacquer, varnish, perfume, eau de parfum/toilette, cologne, aftershave, hand sanitiser, fuel, firelighter. HS 2207, 271012/271019, 360610, 381400, 330300.
  3. **Possible** keywords or HS hints (battery, rechargeable, cordless, Bluetooth speaker, phone, laptop, drone, e-scooter, spray, mist, foam, paint, essential oil, spirits/alcohol, glue, polish, cleaner, ink; HS 8506, 8507, 8517, 8471, 8518, 8543, 9613, 3208–3210, 3303, 3307, 3405, 3808) → ask Gemini: "Does this item contain a lithium battery, or is it an aerosol or a flammable liquid? Answer true/false with one-line reason." Gemini true → Red (message says "confirmed by AI review"). Gemini false → pass. Gemini unavailable → Advisory A-09 "please confirm".
- **Chat/voice:** for a "possible" item, ask the seller directly instead of (or as well as) Gemini: "Does the Bluetooth speaker have a built-in rechargeable battery?"
- **Message:** "PB-01 (Lithium-ion power bank 10000 mAh) looks like lithium batteries (matched: lithium, power bank). These can't go on this service."
- **Fix:** remove the item; or correct a misleading description; restricted goods need a specialist dangerous-goods service, which isn't offered.
- **Re-check when:** description, SKU or HS code changes; item added.

### R-07 — Gross weight ≥ Σ(unit weight × quantity) — **Amber** — `checkR07()`

- **Inputs:** total gross weight; each item's unit weight and quantity.
- **Calculation:** `net weight = Σ (unit weight × quantity)`.
- **Test:** pass if `gross ≥ net` (equal passes).
- **Message:** "Total gross weight is 500 kg, but the goods alone weigh 540 kg. Gross weight includes cartons and pallets, so it can't be lower — it's 40 kg short."
- **Fix:** re-weigh; gross must be at least the net; expect roughly net + 15 kg per pallet or more. Or correct unit weight/quantity. Warn that a corrected weight re-checks R-05.
- **Advisory follow-up:** gross ≥ net but `gross − net < 15 kg × pallets` → A-03.
- **Re-check when:** gross weight, any unit weight or quantity changes; item added/removed.

### R-08 — Warehouse delivery needs an appointment — **Amber** — `checkR08()`

- **Test:** fail if `destination type = Warehouse` and `appointment booked = No`.
- **Business address + No** → pass (A-04 tip only).
- **Message:** "This shipment goes to a warehouse in Frankfurt, but no delivery appointment is booked. Warehouses usually turn away trucks without a slot."
- **Fix:** book a slot for on/after the estimated delivery date, then set to Yes; or change destination type if it's really a shop/office.
- **Re-check when:** destination type or appointment status changes.

### R-09 — Every item has a country of origin — **Amber** — `checkR09()`

- **Test:** fail per item if country of origin is blank.
- **Note:** country of origin = where the product was made, **not** where it ships from. Don't default it to UK in chat — ask.
- **Message:** "MUG-01 has no country of origin. Customs needs to know where it was made to set the duty."
- **Fix:** add one of the six allowed countries.
- **Advisory follow-up:** non-UK origin → A-02.
- **Re-check when:** country of origin changes; item added.

### R-10 — Ready-to-ship date not in the past — **Amber** — `checkR10()`

- **Reference date:** today in UK time (Europe/London), at the moment of checking. Show it: "Checked against 25-10-2026".
- **Test:** fail if `ready date < today`. Today passes.
- **ETA effect:** for estimates, a past ready date is treated as today (and moved to Monday if a weekend).
- **Message:** "Ready to ship date is 01-10-2026, 24 days before today (25-10-2026)."
- **Fix:** enter the real date the goods will be ready, today or later.
- **Re-check when:** ready date changes; also re-run if the session crosses midnight.

---

## 7. Tier 3 — Advisory rules (from the UK export invoice guide + good practice)

Advisory issues **never** change status and are shown in a separate collapsible "Tips" section.

| ID | Rule | Trigger | Message | Source |
|---|---|---|---|---|
| A-01 | Plain-English description | Description shorter than 8 characters or generic ("goods", "items", "samples", "parts", "misc") | "'Goods' doesn't say what the product is." | UK guide: HS code **and a plain English description** |
| A-02 | Non-UK origin may pay EU duty | Country of origin ≠ United Kingdom | "Made in China — goods must originate in the UK/EU to get zero tariff under the UK–EU Trade and Cooperation Agreement, so duty may be charged." | UK guide: country of origin; origin declarations may be needed |
| A-03 | Gross weight should include packaging | `0 ≤ gross − net < 15 kg × pallets` | "Gross weight is only 4 kg more than the goods; 3 pallets plus cartons usually weigh at least 45 kg." | UK guide: gross **and** net weight; packages |
| A-04 | Tell a business address when to expect pallets | Business address and no appointment | "Share the estimated delivery date with the receiver." | Good practice |
| A-05 | Weekend ready date | Ready date is Saturday/Sunday (business-day mode) | "07-11-2026 is a Saturday; collection will be on 09-11-2026." | Good practice |
| A-06 | Full commodity code | HS code exactly 6 digits | "Passes our check, but UK export declarations use 8 digits and EU import 10." | UK guide: HS codes are especially important |
| A-07 | Declared value close but not exact | 0 < \|diff\| ≤ 1% | "Differs by £12.00 (0.22%) — within 1%. Set to exactly £5,400.00 for a clean invoice." | UK guide: invoice must tally exactly with bank documents |
| A-08 | Commercial invoice checklist | Always (once per booking, on the confirmation) | Lists what the invoice needs beyond our data | UK guide: the 15 items (below) |
| A-09 | Please confirm the item isn't restricted | R-06 "possible" match and no Gemini/seller verdict | "'Bluetooth speaker' can indicate a lithium battery — please confirm." | Rulebook R-06 safety net |

### 7.1 A-08 — UK commercial invoice checklist (from the gov.uk guide) and how the app handles each

| # | Invoice element (gov.uk) | Do we have it? | App behaviour |
|---|---|---|---|
| 1 | Invoice number with date of issue | No | Generate a draft invoice number `INV-<BookingID>-<DDMMYYYY>` on the confirmation PDF |
| 2 | Seller and buyer: full name, address, contact | Seller name only | Optional chat question: buyer name/address; otherwise listed as "to add" |
| 3 | Consignee (final recipient) if different from buyer | Destination city/type only | Optional question: "Is the receiver the same as the buyer?" |
| 4 | Number and date of related paperwork (proforma, PO, contract) | No | Optional question: PO number |
| 5 | Unit price, payment method, currency, discounts/extra charges | Unit price, currency | Payment method/discounts listed as "to add" |
| 6 | Weight and number of goods: quantity, gross and net weight, number/weight/type of packages | Yes — quantity, gross, net (calculated), cartons, pallets | Pre-filled on the PDF |
| 7 | HS code + plain English description | Yes | Checked by R-01, A-01, A-06 |
| 8 | Incoterms agreed with the buyer | No | Optional question; default text "Incoterms: to be agreed" |
| 9 | Identifying marks/numbers on packaging (e.g. 1 of 6) | Derivable | PDF shows "Cartons marked 1 of N … N of N" using total cartons |
| 10 | Country of origin of the goods | Yes | R-09, A-02 |
| 11 | Transport details (means and route) | Yes (carrier) | "Road freight, {origin city} → {destination city}, {carrier} {service}" |
| 12 | Total value of the goods | Yes | R-02 |
| 13 | Additional charges (freight, insurance, certification) | Freight cost | Show freight from recommendation; insurance "to add" |
| 14 | Additional language versions | No | Note: usually English is fine; check with buyer |
| 15 | Certification (Chamber of Commerce/embassy) if needed | No | Note: check market requirements |

---

## 8. Channel-specific rules

### 8.1 Excel upload (Part 2)

- E-1. Accept `.xlsx`/`.xls`. Read sheets by name "Bookings" and "Items" (case-insensitive); if not found, use the first two sheets and say so.
- E-2. Header row = the row containing "Booking ID". Skip the grey example row only when it is the template example.
- E-3. Read HS code cells raw (string or number) — never coerce.
- E-4. Group items by Booking ID; report orphans (V-11) and bookings with no items (V-06).
- E-5. Run `runFile()`; show a summary (total, Red, Incomplete, Amber, Green, failures per rule), then one card per booking.
- E-6. Highlight the exact cells (`issue.fields`) in a table view of each sheet.
- E-7. Inline edit of a cell (optional) = a mid-way change: re-run and show the diff.
- E-8. Run the R-06 Gemini second opinion in one batched call for all "possible" items in the file.

### 8.2 Chat (Part 1)

- C-1. **Ask only for what is missing.** After every seller message: extract → normalise → validate → list missing required fields → ask the next group (order in `QUESTIONS.md`).
- C-2. **Never ask for:** origin country (UK), currency (GBP), destination country if the city is known, booking ID.
- C-3. **Derive, then confirm (never silently):** item cartons from quantity ÷ units per carton; quantity from cartons × units per carton; booking cartons = Σ item cartons; declared value = Σ line values. Mark provenance `derived` once the seller confirms.
- C-4. **Never derive:** gross weight (it includes packaging), pallets, HS code, country of origin, appointment status, priority. Offer help instead (e.g. minimum gross weight, suggested minimum pallets for each carrier).
- C-5. **Stated vs derived conflicts:** if the seller states a total (e.g. "90 cartons") and the items sum to 84, keep the stated value and let R-04 flag it — ask which is right.
- C-6. **Validate each answer immediately.** If invalid (not allowed, not a number, past date), say why and re-ask once with the allowed options; on a second failure, offer buttons.
- C-7. **Live summary panel:** current fields, status, issues, recommendation — updated after every message.
- C-8. **Ambiguity:** never guess between two plausible values; ask ("Did you mean 15 or 50?").
- C-9. **Final read-back** before confirmation: one paragraph summary + issues + recommended carrier; seller says "confirm" or changes something.

### 8.3 Voice (Part 1)

All chat rules plus:

- VO-1. Spoken numbers: "one thousand and eighty", "a dozen", "five pounds fifty", "six-twenty kilos" — parse, then read back ("1,080 units — right?").
- VO-2. HS codes: read back digit by digit in pairs ("69 12 00").
- VO-3. Dates: resolve relative dates against today (UK) and read back with the weekday ("Thursday 5 November 2026").
- VO-4. Grams → kg ("500 grams" → 0.5 kg); "kilos" → kg; "quid" → GBP.
- VO-5. Keep voice prompts short — one question per turn; use the voice variant in `QUESTIONS.md`.
- VO-6. If speech recognition confidence is low or the value fails validation, re-ask with the allowed options spoken.
- VO-7. If the browser has no speech support, show a message and offer the Chat tab.

---

## 9. Carrier and recommendation rules (summary — full detail in `RECOMMENDATION_RULES.md`)

1. Route filter: carriers for UK → destination country (3 options).
2. Per carrier compute cost (£/pallet × pallets), ETA, weight per pallet vs max, minimum pallets.
3. Hard constraints: fits weight (R-05), meets required delivery/appointment date, within budget, not excluded.
4. Rank eligible carriers by seller priority: Cheapest = lowest cost; Fastest = fewest transit days; Most reliable = highest on-time %; Balanced = weighted score (cost 0.4, speed 0.3, reliability 0.3; reliability 0.4/cost 0.3 when goods are high-value or fragile).
5. Tie-breakers: on-time ↓, cost ↑, transit ↑, carrier name.
6. If nothing is eligible: relax budget first, then deadline (recommend fastest that fits weight); if weight fails everywhere → "No carrier fits" + add-pallets fix.
7. Always state reason facts and the runner-up trade-off.

ETA assumptions (config): collection on the ready date (today if the ready date is past; next Monday if a weekend);
transit counted in **working days (Mon–Fri)**, no bank holidays.

---

## 10. Mid-way change rules

### 10.1 General procedure (every channel)

1. Apply the change to the booking state (store old and new value).
2. If the changed value has dependents whose provenance is `derived`, update them **and tell the seller**
   (e.g. item quantity changed → derived item cartons recomputed → derived booking cartons recomputed).
3. If a dependent is `stated`, **do not change it** — re-run rules; if it now mismatches, the rule flags it and
   we ask "Should I update total cartons to 96 too?".
4. Run `runAll()` on the full booking.
5. Run `diffResults()` and show: fields changed, totals changed, issues now failing, issues now fixed, status
   change, recommendation change, cost change, ETA change.
6. Update the live summary, issue list, recommendation and confirmation. Any previous confirmation is void;
   the seller must confirm again.

### 10.2 Change-impact matrix

| Field changed | Calculations re-run | Rules re-checked | Recommendation impact | What to tell the seller |
|---|---|---|---|---|
| Seller name | — | V-02 | None | Updated on confirmation |
| Origin city | — | V-02, V-03 | None (same rates from all UK cities) | Collection city updated |
| Destination city | City→country inference | V-04 (+ all below if country changes) | Only if country changes | New destination |
| Destination country | Route carriers, cost, ETA, weight fit | V-03, V-04, R-05 | Prices change (DE > FR > NL); may change pick | New prices and recommended carrier |
| Destination type | — | R-08, A-04 | None | Appointment now (not) required |
| Ready to ship date | Collection date, all ETAs, deadline check | R-10, A-05 | May change if a deadline/appointment date is set | New collection and delivery dates |
| Seller priority | Ranking, priority pick, Balanced score | R-05 (chosen carrier may change) | Recommended carrier may change | New pick and why |
| Pallets | Weight per pallet, all costs, min pallets, cartons per pallet | R-05, V-05, A-03 | Costs change; carriers may become (in)eligible; budget check | New per-pallet weight, cost, pick |
| Booking cartons | — | R-04, V-05 | None | Match/mismatch with items |
| Total declared value | Diff and % | R-02, A-07 | None | Match/mismatch with items |
| Currency | — | V-03 | None | Must be GBP |
| Total gross weight | Weight per pallet, cost per kg, packaging weight, min pallets | R-05, R-07, A-03 | Carriers may become (in)eligible | New per-pallet weight and fit |
| Delivery appointment booked | — | R-08, A-04 | None | Warning cleared/added |
| Appointment date / required delivery date | Deadline fit per carrier | — | Carriers may become (in)eligible | Which carriers arrive in time |
| Budget / excluded carriers / high-value flag | Eligibility, Balanced weights | — | May change pick | New pick and why |
| Chosen carrier (seller picks) | Cost, ETA | R-05 against that carrier | Becomes the booked carrier | Confirm cost/ETA; warn if it fails R-05 |
| Item SKU | Labels | V-10 | None | — |
| Item description | DG detection (+ Gemini if possible) | R-06, A-01, A-09 | None | Restricted-goods status |
| Item HS code | — | R-01, R-06 (HS hints), A-06 | None | Code accepted / still short |
| Item quantity | Line value, net weight, units, cost per unit; derived cartons | R-02, R-03, R-07 (+ R-04 if item cartons derived) | None directly | New totals; ask whether cartons/declared value change too |
| Item unit price | Line value, Σ value | R-02, A-07 | None | New computed value vs declared |
| Item units per carton | Packed units; derived cartons | R-03 (+ R-04 if cartons derived) | None | Carton maths |
| Item cartons | Packed units, Σ cartons, cartons per pallet | R-03, R-04 | None | Carton totals |
| Item unit weight | Net weight, packaging weight | R-07, A-03 | None | Net vs gross |
| Item country of origin | — | R-09, A-02, V-09 | None | Origin/duty note |
| Add item | All sums | R-01, R-03, R-06, R-09 for the item; R-02, R-04, R-07 for totals | None directly | Totals changed; booking cartons/value may now mismatch |
| Remove item | All sums | R-02, R-04, R-07; V-06 if none left | None directly | Totals changed |

### 10.3 Worked example — "add a pallet"

Booking: Frankfurt, Cheapest, 3 pallets, 1,600 kg. Before: 533.33 kg/pallet → R-05 Red against Carrier A (max 500);
recommended Carrier B £660 ("Recommended once fixed"). Seller: "add a pallet".
After: 4 pallets → 400 kg/pallet → R-05 passes; Carrier A eligible again: 4 × £180 = £720 vs B 4 × £220 = £880 →
recommendation changes B → A; status RED → GREEN; ETA 10-11 → 12-11. Tell the seller exactly this, including that
B at 3 pallets (£660) was cheaper than A at 4 pallets (£720) — the seller may prefer to keep 3 pallets with B.

---

## 11. Output rules — for every booking

1. **Status badge** (RED / INCOMPLETE / AMBER / GREEN) and "Checked against {today}".
2. **Issues**, ordered (Section 2.4): rule ID, severity, what is wrong (numbers), how to fix (options), highlighted fields.
3. **Rule table:** R-01 … R-10 with pass / fail / not evaluable.
4. **Recommended carrier** with label, cost, transit, on-time %, collection date, estimated delivery date, reason (from `reasonFacts`), runner-up trade-off, and why other carriers were excluded.
5. **Confirmation** in plain English — e.g. "Your 3 pallets (90 cartons of ceramic mugs, £5,400) will be collected from Manchester on Thursday 05-11-2026 by Carrier A Road economy and should arrive at the Frankfurt warehouse on Thursday 12-11-2026. Freight: £540."
6. **What happens next:** (a) fix Red issues (if any); (b) book/confirm the delivery appointment for on/after the ETA; (c) complete the commercial invoice (A-08 checklist) and attach it; (d) label every carton "1 of N"; (e) have pallets ready for collection; (f) share the ETA with the receiver.
7. **Actions:** Confirm (rules in 2.2), Download PDF, Share.

---

## 12. Configuration decisions and why

| Setting | Default | Why |
|---|---|---|
| `VALUE_TOLERANCE_PCT` | 1 | Sheet 4 R-02 |
| R-02 base | Computed item total | The goods' real worth is the reference |
| `HS_MIN_DIGITS` | 6 | Sheet 4 R-01 |
| `HS_PAD_5_DIGIT_NUMERIC` | false | Don't silently change seller data (P-7); explain the leading-zero risk instead |
| `TRANSIT_DAY_MODE` | business | Road freight transit is normally quoted in working days |
| `R05_MODE` | priority_pick | Surfaces an overweight problem against the carrier the seller would want, with switch/add-pallet fixes |
| `BALANCED_WEIGHTS` | cost 0.4, speed 0.3, reliability 0.3 | Cost is real money; speed and reliability partly overlap. Gives the middle "Road standard" option for typical bookings |
| `MIN_TARE_PER_PALLET_KG` | 15 | Conservative empty pallet + wrap weight, for advisory A-03 only |
| Timezone for "today" | Europe/London | All shipments start in the UK |
| Equal-to-limit values | Pass | "must not exceed" / "at least" / "within" are inclusive |

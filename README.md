# Pre-Flight Shipment Checker

**Catch it before it ships.** Upload a workbook of UK → EU shipment bookings. Every booking is checked against the 10-rule rulebook (plus UK export-invoice tips). Each mistake is explained with its numbers and a fix, a carrier is picked for the seller's priority, and you get a plain-English confirmation.

Built for **Ops Hackathon – Case 2: Conversational Shipment Booking & "Pre-Flight" Error Checker**.

- **Live app:** https://preflight-shipment-checker-omega.vercel.app (public, no login)
- **Version:** V1 — File Upload works fully. The Conversation tab (Chat and Voice) is visible but disabled, marked "Coming in V2".

## How judges test (2 minutes)

1. Open the live link. No account is needed.
2. In **Checker**, click **Use sample file**. It loads a 16-booking stress workbook: one booking breaks each rule R-01…R-10, plus combinations, a missing field, an overweight-for-every-carrier case, a 5-digit numeric HS code, an orphan item and a "Bluetooth speaker".
   Or drop your own `.xlsx` / `.xls` in the template format. **Download template** is in the hero.
3. Read the summary: totals, Red / Incomplete / Amber / Green, and how many bookings fail each rule. Filter by status or search by Booking ID or seller.
4. Open any booking card. It shows:
   - issues with the rule ID, how serious it is, the numbers and how to fix it;
   - **Show cells**, which highlights the exact spreadsheet cells;
   - the rule-by-rule table;
   - the carrier recommendation with its reason, runner-up and every option;
   - the confirmation, the next steps and the commercial-invoice checklist.
5. **Confirm booking** is locked for Red and Incomplete. Amber needs "I understand these warnings" ticked first. Green confirms directly and gives a reference number.
6. **Download PDF** (one booking) or **Full report PDF** (all bookings). **Share** / **Copy results link** opens `/results/<id>#BK-xxx` for anyone.

Uploading the original template gives BK-001 GREEN, Carrier A Road economy, £540.00. That file contains only the grey example row, so it is checked as a demo. In any file that also has real rows, the grey example row is skipped.

## Architecture

```
Browser                                               Server (Vercel, Next.js route handlers)
───────                                               ───────────────────────────────────────
Excel ─► lib/parseExcel.ts (SheetJS, raw cells)
          │  Booking[] + Item[]
          ▼
       lib/calculations.ts  runFile()  ◄── the ONLY source of pass/fail and numbers
          │  "possible" restricted items ─────────────►  POST /api/r06      Gemini yes/no (8 s, Zod) → else A-09 tip
          ▼  runFile() again with the verdicts
       Results UI (cards, highlights, PDF)
          │  BookingResult facts ─────────────────────►  POST /api/explain  Gemini wording (8 s, Zod, numbers-grounded check)
          │                                               └ fallback: deterministic text from lib/explain.ts
          ├─ save ────────────────────────────────────►  POST /api/uploads  → Neon (uploads, bookings, items)
          └─ confirm ─────────────────────────────────►  POST /api/confirm  → re-checks status rules → Neon (confirmations)
/results/[uploadId]  ◄── server-rendered from Neon (public share link)
```

- **Code decides, Gemini explains.** Every rule, total, cost, ETA and ranking comes from `lib/calculations.ts`. Gemini only (a) gives a restricted yes/no on items keyword detection marks as "possible", and (b) rephrases facts the engine already produced. Gemini output is schema-validated, and any £ amount or date not found in the input facts is rejected.
- **Works when things are down.** If Gemini fails, explanations fall back to deterministic text. If Neon fails, everything still works except the share link, and the PDFs still download. Carriers and rules fall back to the `CARRIERS` / `RULES` constants.
- **Today** for R-10 is the current date in Europe/London. Every result shows "Checked against DD-MM-YYYY".

## Rules

| Rule | Check | Severity |
|---|---|---|
| R-01 | Every item has an HS code of at least 6 digits | Red |
| R-02 | Declared value = Σ(quantity × unit price), within 1% | Red |
| R-03 | Units per carton × cartons = quantity (per item) | Red |
| R-04 | Booking cartons = Σ item cartons | Red |
| R-05 | Gross weight ÷ pallets ≤ chosen carrier's max per pallet | Red |
| R-06 | No lithium batteries, aerosols or flammable liquids | Red |
| R-07 | Gross weight ≥ Σ(unit weight × quantity) | Amber |
| R-08 | Warehouse deliveries have an appointment booked | Amber |
| R-09 | Every item has a country of origin | Amber |
| R-10 | Ready-to-ship date is not in the past | Amber |

Plus input checks V-01…V-11, which make a booking **Incomplete**, and tips A-01…A-09 from the UK government export-invoice guide. Tips never change a booking's status. The full spec is in [`docs/RULEBOOK.md`](docs/RULEBOOK.md), [`docs/RECOMMENDATION_RULES.md`](docs/RECOMMENDATION_RULES.md) and [`docs/CALCULATIONS_FORMULAS.pdf`](docs/CALCULATIONS_FORMULAS.pdf).

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run db:migrate && npm run db:seed   # optional: Neon tables + carriers/rules
npm run dev
```

### Environment variables

| Name | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | No (fallback text without it) | Google AI Studio key. Used server-side only. |
| `GEMINI_MODEL` | No | Overrides the model. If empty, the newest stable `gemini-X.Y-flash` from the key's model list is used. |
| `DATABASE_URL` | No (no share links without it) | Neon Postgres connection string |

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Vitest: engine, Excel parser and the stress workbook (53 tests) |
| `npm run e2e` | Playwright smoke test (run `npm run build` first). Add `E2E_BASE_URL=https://…` to test a deployment. |
| `npm run make:stress` | Regenerates `public/samples/stress-test.xlsx` from the real template |
| `npm run db:generate` / `db:migrate` / `db:seed` | Drizzle migrations and the idempotent seed |
| `npm run lint` / `typecheck` | ESLint / tsc |

## Project map

```
lib/calculations.ts    rule engine (spec, used as-is; see "Changes to the engine")
lib/parseExcel.ts      header detection, grey example row, raw HS codes, Excel date serials
lib/checkFile.ts       browser pipeline: parse → check → AI R-06 → re-check
lib/explain.ts         confirmation, next steps, invoice checklist, fallback explanations
lib/gemini.ts          server-only Gemini client (8 s time-box, JSON mode, model discovery)
lib/pdf.ts             per-booking and full-report PDFs (jsPDF + autotable)
app/api/*              r06, explain, uploads, confirm
db/                    Drizzle schema, migrations, seed
components/            page sections, booking card, carrier card, data tables
scripts/               stress-workbook generator and its expectations
tests/, e2e/           Vitest and Playwright
```

## Design notes

The page borrows the *feel* of a product page: a big, tight hero headline; calm grey subheads; alternating light and dark full-width sections; a translucent sticky nav with a product sub-nav; pill buttons; large rounded cards; and scroll-reveal motion. It uses no third-party brand assets. Colour is used only for status (Red #ff3b30, Amber #ff9f0a, Green #34c759, Incomplete #8e8e93, Tips blue), with darker text variants for WCAG AA contrast.

It works from 360 px phones up, in light and dark mode, follows `prefers-reduced-motion`, and supports the keyboard (visible focus rings, tooltips that open on focus). The hero illustration is an original SVG.

## Changes to the engine

`lib/calculations.ts` is the provided spec, with one fix. `runFile()` passed one `geminiR06Verdicts` map, keyed by item index, to **every** booking. A file-level AI verdict for item #0 of one booking would therefore also mark item #0 of every other booking as restricted. The new `geminiR06VerdictsByBooking` option scopes verdicts to their booking. A test covers it in `tests/calculations.test.ts`.

_Estimates only — costs and delivery dates come from the fixed hackathon rate card._

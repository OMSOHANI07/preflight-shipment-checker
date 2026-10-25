# Pre-Flight Shipment Checker — Spec Pack Index

Read in this order, alongside the earlier `PreFlight_Shipment_Checker_Build_Plan.pdf`:

| File | What it is | Where it goes in the repo |
|---|---|---|
| `RULEBOOK.md` | Master rulebook: official rules R-01…R-10, input validation V-01…V-11, advisory A-01…A-09 (UK export invoice guide), field catalogue, channel rules (Excel / chat / voice), mid-way change rules, output rules | `/docs/RULEBOOK.md` |
| `calculations.ts` | Hard-coded, pure TypeScript: constants (carriers, rules, allowed values), parsers, every formula, every rule check, status, recommendation engine, `runAll()`, `runFile()`, `diffResults()` | `/lib/calculations.ts` |
| `calculations.test.ts` | Vitest tests (16, all passing) | `/tests/calculations.test.ts` (fix the import path) |
| `CALCULATIONS_FORMULAS.pdf` | Every formula with worked examples, dependency graph and change-impact table | `/docs/` |
| `RECOMMENDATION_RULES.md` | Carrier recommendation rules, explanation templates, guardrails, JSON contracts, Gemini system prompt | `/docs/` and the system prompt into `/lib/prompts.ts` |
| `QUESTIONS.md` | Chat & voice question bank, order, re-ask texts, rule clarification questions, mid-way change handling, example conversations, JSON question list | `/docs/` and the JSON into `/lib/questions.json` |

## Non-negotiables

1. All checks and numbers come from `calculations.ts`. Gemini extracts, explains and gives an R-06 second opinion — nothing else.
2. Excel, chat and voice all build `Booking` + `Item[]` and call `runAll()`.
3. On any change: `runAll()` again, then `diffResults()`; tell the seller what changed; earlier confirmation is void.
4. RED and INCOMPLETE block confirmation; AMBER needs acknowledgement; every booking shows a carrier recommendation.
5. Read the HS code cell raw from Excel — never convert it to a number.
6. Tests pin "today" with `{ now }`; production uses the real UK date.

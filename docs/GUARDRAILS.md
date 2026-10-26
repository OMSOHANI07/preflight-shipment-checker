# Guardrails — Ship Eazy

Three layers of guardrails, implemented in `lib/guardrails.ts` (pure; tested in `tests/guardrails.test.ts`).
`lib/calculations.ts` is unchanged: the app uses `runAllWithGuardrails()` / `runFileWithGuardrails()`
instead of `runAll()` / `runFile()` (file upload, chat, voice tools and the `/api/confirm` re-check).

| Layer | What it stops | Where |
|---|---|---|
| 1. Goods | Illegal or prohibited goods being booked; restricted goods shipped without paperwork | Every booking (file, chat, voice) |
| 2. Codes and paperwork | HS codes that don't exist or don't match the product; suspiciously low values | Every booking |
| 3. Conversation | Requests to cheat customs, prohibited-goods requests, prompt injection, abuse, personal data | Chat and voice messages |

## 1. Issue codes

| Code | Name | Severity | Effect |
|---|---|---|---|
| G-01 | Prohibited goods | **Red** | Booking blocked (can't confirm). Label "Can't ship" |
| G-02 | Restricted goods | Advisory | Tip explaining the licence/certificate needed |
| G-03 | HS code chapter doesn't exist (00, 77, 98, 99) | **Red** (`GUARD_CONFIG.INVALID_CHAPTER_SEVERITY`) | Booking blocked until corrected |
| G-04 | HS code chapter doesn't match the description | Advisory | e.g. "HS 691200 is ceramics, but this sounds like clothing (61/62)" |
| G-05 | Value looks too low for the product | Advisory | Possible under-valuation warning |

They sit beside the official R-01 … R-10 and never change an R-rule's result. Only G-01 and G-03 can change
a status (to RED).

**Edge-case file:** only EC-08 (HS `000000`) changes, GREEN → RED (G-03). EC-03 and EC-68 gain a G-04 tip
(5-digit `90111` reads as chapter 90; for the coffee in EC-03 the tip suggests `090111`). In the app the
summary is **Red 22, Incomplete 15, Amber 7, Green 32**. Engine-only `runFile` tests keep the old numbers.

## 2. Layer 1 — Goods

**Prohibited (G-01):** weapons (HS 93); ammunition, explosives, fireworks (HS 3601–3604); illegal drugs;
counterfeit goods; protected wildlife; cash and bullion (HS 7108, 4907); radioactive / highly toxic (HS 2844);
human remains; live animals (HS 01).

**Restricted (G-02, tip):** alcohol (HS 2203–2208), tobacco/vapes/nicotine (HS 24), medicines and CBD (HS 30),
knives and air guns (HS 8211), meat/fish/dairy/eggs/honey (HS 02, 03, 04, 16), plants/seeds/soil (HS 06, 1209),
art and antiques (HS 97), military/dual-use, replica/imitation weapons. Lithium batteries, aerosols and
flammable liquids stay under the official R-06.

**Matching:** description (word boundaries) and HS prefix; prohibited beats restricted. Negations are
removed first (`SCREEN_NEGATIONS`: glue gun, gunmetal, cashmere, ivory colour, faux fur, fake plants, wine
glasses, plant pots, milk chocolate, egg cups, Android tablets, toy/foam sword, bullet journal, party poppers,
puppy pads, wiper blades …). Category negations ("alcohol-free", "nicotine-free") skip the category. There is
deliberately no negation for "genuine" or "authentic". In chat, a prohibited product is never created.

## 3. Layer 2 — Codes and paperwork

| Check | Rule | Severity |
|---|---|---|
| Digits | R-01: at least 6 digits (official) | Red |
| Chapter exists | G-03: first two digits 01–97, not 77 | Red |
| Chapter fits the product | G-04: description → product group (tableware, clothing, footwear, bags, toys, furniture, lighting, electronics, cosmetics, books, stationery, coffee/tea, chocolate, jewellery, watches, home textiles, rugs, tools, glassware, sport, instruments, bicycles, vehicle parts, candles); chapter must be one the group allows | Advisory |
| Leading zero | A 5-digit code that fits with a "0" in front: the G-04 tip suggests it ("It may be 090111") | Advisory |
| Value | G-05: unit price below a floor for high-value goods (laptops £50, smartphones/tablets £20, screens £30, gold/diamond jewellery £20) | Advisory |

The assistant never invents an HS code.

## 4. Layer 3 — Conversation (chat and voice)

`screenMessage()` runs at the start of every turn, before Gemini (in `runTurn`, so `/api/chat` and the
ElevenLabs voice tools both go through it).

| Flag | What happens | Booking changes? |
|---|---|---|
| `customs_evasion` | Fixed refusal, then the pending question again | No |
| `prohibited_request` | Fixed refusal; no item created (also if the extraction produces a prohibited item) | No |
| `prompt_injection` | Fixed reply first, then the rest of the message is handled normally (status only comes from code) | Only legitimate fields |
| `abuse` | Calm one-liner, then continue | Fields processed normally |
| `personal_data` | Fixed reply; the message is redacted before it's stored | No |

Fixed replies (`GUARDRAIL_REPLIES`) are never reworded by Gemini. The "Guardrails — always follow" block
(`GEMINI_GUARDRAILS`) is in both the extraction and the reply system prompts.

**Limits:** message ≤ 1,000 characters · `/api/chat` rate-limited per IP · max 50 items per chat booking ·
Gemini time-boxed with fallback · Gemini output validated against FACTS before display.

**Logging:** flag names counted per day (`[guardrail] YYYY-MM-DD flag count=n`); never message text, seller
names or values.

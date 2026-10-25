# Conversation Question Bank — Chat & Voice

> **For Claude Code.** Questions the assistant asks to build a complete booking (Sheet 1) and its items
> (Sheet 2) in the Conversation tab (Chat and Voice sub-tabs). Field rules and allowed values are in
> `RULEBOOK.md` §4; parsers are in `calculations.ts` §4. A machine-readable version is in §9.

---

## 1. Conversation principles

1. **Extract first, ask second.** After every seller message, Gemini extracts every field it can (JSON), code normalises and validates, then the assistant asks only for what is still missing.
2. **One topic per turn.** Chat may group 2–3 closely related fields in one question; voice asks **one** field per turn.
3. **Never ask** for: origin country (always United Kingdom), currency (always GBP), destination country when the city is known, Booking ID (auto-generated), anything the seller already gave.
4. **Derive, then confirm** (never silently fill): item cartons, item quantity, booking cartons, declared value. Say the maths: "1,080 mugs at 12 per carton is 90 cartons — right?"
5. **Never derive:** gross weight, pallets, HS code, country of origin, appointment status, priority.
6. **Validate every answer immediately.** If invalid: say why in one sentence and re-ask with the allowed options. After two failures, show tappable options (chat) or read the options (voice).
7. **Read back** numbers, dates and codes in voice (and in chat when they were derived or ambiguous).
8. **Accept changes at any time** (§6). Re-run all checks after every change and say what changed.
9. **Show checks as you go:** when a rule fails mid-conversation, tell the seller straight away (short), and keep collecting. Don't wait for the end.
10. **End with a full review and an explicit "confirm".**

---

## 2. Question order (state machine)

```
START ─► G1 Sender & route ─► G2 Timing & priority ─► G3 Items (loop per product)
      ─► G4 Shipment totals ─► G5 Delivery appointment ─► G6 Optional preferences
      ─► G7 Review (all checks + recommendation) ─► CONFIRM / CHANGE ─► DONE
```

Skip any question whose field is already filled. If the seller volunteers information for a later group,
store it and skip that question later. The order may be changed by the seller at any time.

---

## 3. Opening

| ID | Chat | Voice |
|---|---|---|
| Q-00 | "Hi! Tell me about the shipment you'd like to send — where it's going, what's in it, and when it'll be ready. I'll ask for anything I still need and check it for mistakes before it leaves." | "Hi! Tell me about your shipment — where it's going, what's in it, and when it's ready." |

---

## 4. Question bank

Columns: **Ask when** = the condition to ask; **Accepts** = what the parser understands; **If invalid** = re-ask text.

### G1 — Sender and route

| ID | Field | Chat question | Voice question | Ask when | Accepts | If invalid |
|---|---|---|---|---|---|---|
| Q-01 | Seller name | "What's the name of the business sending the goods?" | "What's your business name?" | Missing | Any text | — |
| Q-02 | Origin city | "Where are the goods being collected from — London, Manchester, Birmingham or Leeds?" | "Collecting from London, Manchester, Birmingham or Leeds?" | Missing | City names, "Brum" | "We collect from London, Manchester, Birmingham or Leeds only. Which is closest to the goods?" |
| Q-03 | Destination city (+ country inferred) | "Which city is it going to? We deliver to Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam and Rotterdam." | "Which city is it going to?" | Missing | City names; "Frankfurt am Main" | "We deliver to Berlin, Frankfurt or Hamburg in Germany, Paris or Lyon in France, and Amsterdam or Rotterdam in the Netherlands. Which one?" |
| Q-03b | Destination country | "Is that in Germany, France or the Netherlands?" | same | Only if a country was given without a city, or city/country conflict (V-04) | Country names, DE/FR/NL, Holland | — |
| Q-04 | Destination type | "Is it being delivered to a warehouse (like a fulfilment or distribution centre) or a business address (like a shop or office)?" | "Is it a warehouse, or a business address like a shop or office?" | Missing | warehouse, fulfilment centre, FC, DC, Amazon, 3PL / shop, office, store, business | "Just to check — is it a warehouse or a business address?" |

### G2 — Timing and priority

| ID | Field | Chat question | Voice question | Ask when | Accepts | If invalid |
|---|---|---|---|---|---|---|
| Q-05 | Ready to ship date | "When will the goods be packed and ready for collection? (DD-MM-YYYY, or e.g. 'next Thursday')" | "What date will the goods be ready for collection?" | Missing | DD-MM-YYYY, DD/MM/YYYY, '5th November', 'tomorrow', 'next Friday', 'in 3 days' | Unreadable: "Sorry, I didn't catch the date — could you give it as day, month and year?" Past date: "That date has already passed (today is {today}). When will they actually be ready?" — if the seller insists, keep it and let R-10 flag Amber |
| Q-05r | Read-back | "That's {Weekday DD-MM-YYYY} — correct?" | "{Weekday, day month year} — is that right?" | Any relative or spoken date | yes/no | — |
| Q-06 | Seller priority | "What matters most for this shipment: **cheapest**, **fastest**, **most reliable** (best on-time record), or a **balance** of all three?" | "What matters most — cheapest, fastest, most reliable, or a balance?" | Missing | cheap/budget/economy · fast/ASAP/urgent/express · reliable/on time/can't be late · balanced/no preference/don't mind | "Pick one: cheapest, fastest, most reliable, or balanced." No answer after 2 tries → use Balanced and say so |
| Q-07 | Required delivery date (optional) | "Does it need to arrive by a particular date?" | "Does it need to arrive by a certain date?" | Once, after Q-06 | Date or "no" | — |

### G3 — Items (loop for each product)

Start with Q-08; repeat Q-08…Q-17 per product; end the loop with Q-18.

| ID | Field | Chat question | Voice question | Ask when | Accepts | If invalid / follow-up |
|---|---|---|---|---|---|---|
| Q-08 | Description | "What's the product? A short plain description, e.g. 'Ceramic coffee mug, 350 ml'." | "What's the product?" | New item | Any text | Vague ("goods", "stuff", "samples"): "Customs needs a plain description — what is it and what's it made of?" (A-01) |
| Q-08s | R-06 safety check | "Quick safety check: does the {product} contain a lithium battery, or is it an aerosol or a flammable liquid?" | same | `detectDangerousGoods` = possible | yes/no | Yes → R-06 Red: "I'm afraid lithium batteries, aerosols and flammable liquids can't go on this service. Shall I remove the {product}?" Definite match → skip the question, tell them directly |
| Q-09 | SKU | "Do you have a product code (SKU) for it? If not, I'll call it ITEM-{n}." | "Do you have a product code for it?" | Missing | Any text / "no" | No → auto `ITEM-{n}` and say so |
| Q-10 | Quantity | "How many units of {product} in total?" | "How many units in total?" | Missing (and not derivable) | Numbers, words, "1.2k", "a dozen" | Not a whole number: "Units should be a whole number — how many individual {product}s?" Read back in voice |
| Q-11 | Units per carton | "How many units are packed in each carton?" | "How many in each carton?" | Missing (and not derivable) | Whole number | — |
| Q-12 | Item cartons | **Derive:** "That's {qty} ÷ {upc} = {cartons} cartons of {product} — correct?" · If not divisible: "{qty} doesn't split evenly into cartons of {upc} ({full} full cartons and {rest} left over). How many cartons are there, and are any part-filled?" · If not derivable: "How many cartons of {product}?" | "So {cartons} cartons — right?" | Missing | Whole number / yes | If the stated value conflicts with the maths → keep it; R-03 flags; ask "Which is right: {qty} units, {cartons} cartons, or {upc} per carton?" |
| Q-13 | Unit price | "What's the price of one {product}, in pounds?" | "What's the price of one unit, in pounds?" | Missing | "£5", "5 pounds", "five pounds fifty", "5.50" | Other currency: "All prices need to be in GBP — what's the price in pounds?" |
| Q-14 | Unit weight | "How much does one {product} weigh, in kg? (grams is fine too)" | "How much does one unit weigh?" | Missing | kg or grams (converted) | — |
| Q-15 | HS code | "Do you know the HS code (customs code) for {product}? It should be at least 6 digits — e.g. 691200 for ceramic tableware." | "Do you know the customs HS code? It's at least six digits." | Missing | Digits with or without spaces/dots | Short: "That's only {n} digits; customs needs at least 6. Do you have the full code?" Unknown: "No problem — you can look it up on the UK Trade Tariff. I'll flag it as missing for now." (R-01 Red). **Never guess the code.** Voice read-back in pairs: "69-12-00?" |
| Q-16 | Country of origin | "Where was {product} made? (Not where it ships from.) UK, China, India, Vietnam, Turkey or Germany?" | "Which country was it made in?" | Missing | Country names/aliases | Not in list: "For this service the country of origin must be one of: UK, China, India, Vietnam, Turkey or Germany." Unknown → leave blank, R-09 Amber, tell them |
| Q-17 | Item summary | "Got it: {cartons} cartons × {upc} {product} = {qty} units at {price} = {value}; {net} kg net." | (short) "Got it — {qty} {product}, {cartons} cartons." | After each item | — | — |
| Q-18 | More items? | "Is there any other product in this shipment?" | "Any other products?" | After each item | yes/no or a new product description | Yes → Q-08 |

### G4 — Shipment totals

| ID | Field | Chat question | Voice question | Ask when | Accepts | If invalid / follow-up |
|---|---|---|---|---|---|---|
| Q-19 | Booking cartons | **Derive:** "So the shipment has {Σcartons} cartons in total — correct?" | "{Σcartons} cartons in total — right?" | Missing | yes / number | If the seller states a different number → keep it; R-04 flags; ask "Is a product missing, or should the total be {Σcartons}?" |
| Q-20 | Total declared value | **Derive:** "The goods add up to {Σvalue}. Is that the value on your invoice?" | "That's {Σvalue} in total — is that what's on your invoice?" | Missing | yes / amount | Different amount → keep it; R-02 checks the 1% tolerance and explains |
| Q-21 | Pallets | "How many pallets will it be on?" + help: "Carriers accept up to 400 kg (C), 500 kg (A) or 750 kg (B) per pallet." | "How many pallets?" | Missing | Whole number | Not whole: "Pallets have to be a whole number — how many?" |
| Q-22 | Total gross weight | "What's the total gross weight in kg — goods plus cartons and pallets? The goods alone are about {net} kg, so it should be more than that." | "What's the total weight, including cartons and pallets, in kilos?" | Missing | kg, "kilos", tonnes ×1000 | Less than net → R-07 Amber; say: "That's less than the goods alone ({net} kg). Could you double-check?" (keep the value if they insist) |
| Q-22w | Weight help (if the seller doesn't know) | "No worries — the goods weigh {net} kg; with cartons and {pallets} pallets it's usually at least {net + 15×pallets} kg. Can you weigh the loaded pallets, or give your best estimate?" | short version | "I don't know" | number | Never auto-fill |

### G5 — Delivery appointment

| ID | Field | Chat question | Voice question | Ask when | Accepts | If invalid / follow-up |
|---|---|---|---|---|---|---|
| Q-23 | Appointment booked | Warehouse: "Have you booked a delivery appointment (time slot) at the warehouse?" · Business address: "Have you arranged a delivery time with the receiver?" | "Have you booked a delivery slot?" | Missing | yes/no | Warehouse + No → R-08 Amber: "Warehouses usually turn away trucks without a slot. You can still book, but I'd book a slot for on or after {ETA}." |
| Q-24 | Appointment date (optional) | "What date is the slot?" | "What date is the slot?" | Appointment = Yes | Date | ETA after slot → explain which carriers arrive in time |

### G6 — Optional preferences (ask at most two, only if useful)

| ID | Field | Chat question | Ask when |
|---|---|---|---|
| Q-25 | Budget | "Is there a maximum you'd like to spend on freight?" | Priority Cheapest/Balanced, or the seller mentions money |
| Q-26 | High-value / fragile | "Are the goods especially valuable or fragile?" | Priority Balanced |
| Q-27 | Carrier choice | "Would you like to go with {recommended}, or see the other options?" | At review |
| Q-28 | Invoice extras (A-08) | "For the commercial invoice: do you have the buyer's name and address, a PO number, and agreed Incoterms? You can add them later." | At review, once; never blocks |

### G7 — Review and confirmation

| ID | Step | Chat text |
|---|---|---|
| Q-29 | Review | Summary card (all fields) + status + issues (what, severity, fix) + recommendation. Then: "Would you like to fix anything, or confirm?" |
| Q-30 | Red block | "There are {n} issues that must be fixed before this can go: {list}. Which would you like to fix first?" |
| Q-31 | Amber acknowledgement | "There are {n} warnings: {list}. You can still book — do you want to fix them, or confirm anyway?" |
| Q-32 | Confirm | "Booked! {confirmation sentence}. Next steps: {list}. You can download the PDF." |

---

## 5. Clarification questions when a rule fails

Ask these right after the failure is detected (chat: short; voice: one sentence).

| Rule | Question |
|---|---|
| R-01 | "The HS code for {product} is {code} — only {n} digits. Do you have the full code (at least 6 digits)?" / If 5 digits from a file: "Could the code be 0{code}? Spreadsheets sometimes drop a leading zero." |
| R-02 | "Your declared value is {declared}, but the products add up to {computed} ({pct}% different). Which is right — the total, or one of the prices or quantities?" |
| R-03 | "{upc} per carton × {cartons} cartons is {packed}, but you said {qty} units. Which is right?" (offer the 2–3 corrected options as buttons) |
| R-04 | "The products add up to {Σcartons} cartons, but the shipment total is {cartons}. Is a product missing, or should the total be {Σcartons}?" |
| R-05 | "{gross} kg on {pallets} pallets is {w} kg per pallet — {carrier} only takes {max} kg. Would you rather use {minP} pallets and keep {carrier} ({cost'}), or switch to {alt} ({costAlt})?" |
| R-06 | "{product} looks like {category}, which can't be shipped on this service. Shall I remove it, or is the description wrong?" |
| R-07 | "The products alone weigh {net} kg, but the total gross weight is {gross} kg. Could you re-check the weight?" |
| R-08 | "It's going to a warehouse without a booked slot. Do you want to book one first (I'd aim for {ETA} or later), or carry on?" |
| R-09 | "Where was {product} made? Customs needs the country of manufacture." |
| R-10 | "{date} has already passed. When will the goods really be ready?" |
| V-04 | "{city} isn't in {country}. Did you mean {city} in {inferred country}, or a different city?" |
| Ambiguous number | "Did you say {a} or {b}?" (e.g. fifteen vs fifty) |

---

## 6. Handling mid-conversation changes

### 6.1 Recognise change requests

Trigger phrases (Gemini classifies intent = `change`): "actually…", "change…", "make it…", "add a pallet",
"one more pallet", "remove the…", "it's 4 pallets not 3", "different date", "switch to Paris", "add another
product", "they're 10 per carton", "go with Carrier B", "drop the power banks".

### 6.2 Response pattern (always the same)

1. **Confirm the change** in one line: "Updated: pallets 3 → 4."
2. **Cascade** derived values and say so: "Booking cartons updated to 96 (you added 6 cartons of bowls)." For **stated** values, ask instead: "You told me the total was 90 cartons — should I change it to 96?"
3. **Re-run** all checks (`runAll`) and report the diff (`diffResults`):
   - "✓ Fixed: R-05 (now 400 kg per pallet)."
   - "⚠ New: R-04 — total cartons no longer match."
   - "Recommendation: Carrier B → Carrier A (£720, arriving Thursday 12-11-2026)."
4. **Void** any earlier confirmation: "I'll need you to confirm again with the changes."
5. **Continue** where the conversation was (or go to review if everything is filled).

### 6.3 Change cases and the follow-up to ask

| Change | Follow-up question |
|---|---|
| "Add a pallet" | None (pallets +1). Report weight per pallet, cost, carrier change |
| Quantity of an item changes | "Does the number of cartons change too? At {upc} per carton that's {new cartons}." Then booking cartons/value per provenance |
| Units per carton changes | "So that's {qty ÷ upc} cartons now?" |
| Item cartons change | Booking cartons (derived → update; stated → ask) |
| Unit price changes | Declared value (derived → update; stated → ask "Should the declared value become {new}?") |
| Add a product | Run the G3 loop for it; then Q-19/Q-20 again |
| Remove a product | "Removed {product}. Total is now {cartons} cartons, {value}." If the last product → ask for products again |
| Destination city changes | Re-infer country; if the country changes: "Prices change — new recommendation: …" |
| Destination type changes | Ask Q-23 if now Warehouse and appointment unknown |
| Ready date changes | Read back; new ETAs; deadline check |
| Priority changes | New recommendation + why |
| Gross weight changes | R-05/R-07 re-check; carrier eligibility |
| Seller picks a carrier | If it fails weight: "Carrier C only takes 400 kg per pallet — yours are 450 kg. Use 3 pallets, or another carrier?" |
| Undo ("go back", "undo that") | Restore the previous value; re-run; report |

---

## 7. Example conversations

### 7.1 Vague seller (chat)

> **Seller:** Need to send 3 pallets of mugs to Frankfurt next week, cheapest option.
> **Assistant:** Great — 3 pallets of mugs to Frankfurt (Germany), cheapest option. Which business is sending them, and are they being collected from London, Manchester, Birmingham or Leeds?
> **Seller:** Northfield Goods, Manchester.
> **Assistant:** Thanks. What exact date will they be ready for collection? "Next week" could be any day from Monday 26-10 to Friday 30-10.
> **Seller:** Thursday.
> **Assistant:** Thursday 29-10-2026 — correct? And is it going to a warehouse or a business address?
> **Seller:** yes, an Amazon warehouse
> **Assistant:** Now the mugs: how many units in total, and how many per carton?
> **Seller:** 1080, 12 a box
> **Assistant:** That's 1,080 ÷ 12 = 90 cartons — right? What's the price per mug in pounds, and how much does one weigh?
> **Seller:** yep. £5, half a kilo
> **Assistant:** Do you know the HS code? It's at least 6 digits (ceramic tableware is usually 6912…). And where were the mugs made?
> **Seller:** 691200, made in UK
> **Assistant:** Got it: 90 cartons × 12 mugs = 1,080 units at £5.00 = £5,400.00; 540 kg net. Any other products?
> **Seller:** no
> **Assistant:** So 90 cartons and £5,400.00 declared — correct? What's the total gross weight including cartons and pallets? It should be more than 540 kg.
> **Seller:** 620
> **Assistant:** Have you booked a delivery slot at the Amazon warehouse?
> **Seller:** not yet
> **Assistant:** *(review card)* Status **AMBER** — 1 warning: R-08 no delivery appointment… Recommended: **Carrier A Road economy, £540.00**, collected Thursday 29-10-2026, estimated delivery Thursday 05-11-2026… Fix the warning, or confirm anyway?

### 7.2 Mid-way change

> **Seller:** Actually the total weight is 1,600 kg.
> **Assistant:** Updated: gross weight 620 → 1,600 kg. That's 533.33 kg per pallet — Carrier A only takes 500 kg (**R-05, Red**). You can use 4 pallets and keep Carrier A (£720.00), or switch to Carrier B with 3 pallets (£660.00, 2 days faster). Which would you prefer?
> **Seller:** add a pallet then
> **Assistant:** Updated: pallets 3 → 4. Now 400 kg per pallet — ✓ R-05 fixed. Recommendation: Carrier A, £720.00 (note: Carrier B on 3 pallets was £660.00). Status: AMBER (R-08 still open). Confirm, or anything else to change?

### 7.3 Voice

> **Assistant:** What date will the goods be ready for collection?
> **Seller:** The fifth of November.
> **Assistant:** Thursday the fifth of November 2026 — is that right?
> **Seller:** Yes.
> **Assistant:** Do you know the customs HS code? It's at least six digits.
> **Seller:** Six nine one two zero zero.
> **Assistant:** 69-12-00 — correct?

---

## 8. Required-field checklist (what "complete" means)

Booking complete when B2–B15 are filled (B4 and B13 defaulted) and there is ≥ 1 item.
Item complete when SKU (or auto), description, quantity, unit price, units per carton, cartons and unit weight
are filled. HS code and country of origin may stay blank — the booking is still "complete" but R-01 (Red) /
R-09 (Amber) will flag them.

---

## 9. Machine-readable question list

```json
{
  "order": ["G1", "G2", "G3", "G4", "G5", "G6", "G7"],
  "neverAsk": ["originCountry", "currency", "bookingId"],
  "defaults": { "originCountry": "United Kingdom", "currency": "GBP" },
  "inferences": [
    { "field": "destinationCountry", "from": "destinationCity", "fn": "CITY_TO_COUNTRY" },
    { "field": "item.cartons", "from": ["quantity", "unitsPerCarton"], "fn": "itemExactCartons", "confirm": true },
    { "field": "item.quantity", "from": ["cartons", "unitsPerCarton"], "fn": "deriveItemField", "confirm": true },
    { "field": "cartons", "from": "items", "fn": "deriveBookingTotals.cartons", "confirm": true },
    { "field": "totalDeclaredValue", "from": "items", "fn": "deriveBookingTotals.totalDeclaredValue", "confirm": true }
  ],
  "neverDerive": ["totalGrossWeightKg", "pallets", "hsCodeRaw", "countryOfOrigin", "deliveryAppointmentBooked", "sellerPriority"],
  "questions": [
    { "id": "Q-01", "group": "G1", "field": "sellerName", "required": true, "chat": "What's the name of the business sending the goods?", "voice": "What's your business name?", "parser": "text" },
    { "id": "Q-02", "group": "G1", "field": "originCity", "required": true, "chat": "Where are the goods being collected from — London, Manchester, Birmingham or Leeds?", "voice": "Collecting from London, Manchester, Birmingham or Leeds?", "parser": "normaliseCity", "options": ["London", "Manchester", "Birmingham", "Leeds"] },
    { "id": "Q-03", "group": "G1", "field": "destinationCity", "required": true, "chat": "Which city is it going to? We deliver to Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam and Rotterdam.", "voice": "Which city is it going to?", "parser": "normaliseCity", "options": ["Berlin", "Frankfurt", "Hamburg", "Paris", "Lyon", "Amsterdam", "Rotterdam"] },
    { "id": "Q-04", "group": "G1", "field": "destinationType", "required": true, "chat": "Is it being delivered to a warehouse (like a fulfilment or distribution centre) or a business address (like a shop or office)?", "voice": "Is it a warehouse, or a business address like a shop or office?", "parser": "normaliseDestinationType", "options": ["Warehouse", "Business address"] },
    { "id": "Q-05", "group": "G2", "field": "readyToShipDate", "required": true, "chat": "When will the goods be packed and ready for collection?", "voice": "What date will the goods be ready for collection?", "parser": "parseDate", "readBack": true },
    { "id": "Q-06", "group": "G2", "field": "sellerPriority", "required": true, "chat": "What matters most: cheapest, fastest, most reliable, or a balance of all three?", "voice": "What matters most — cheapest, fastest, most reliable, or a balance?", "parser": "normalisePriority", "options": ["Cheapest", "Fastest", "Most reliable", "Balanced"], "fallback": "Balanced" },
    { "id": "Q-07", "group": "G2", "field": "prefs.requiredDeliveryDate", "required": false, "chat": "Does it need to arrive by a particular date?", "voice": "Does it need to arrive by a certain date?", "parser": "parseDate", "askOnce": true },
    { "id": "Q-08", "group": "G3", "field": "item.description", "required": true, "chat": "What's the product? A short plain description.", "voice": "What's the product?", "parser": "text", "afterParse": "detectDangerousGoods" },
    { "id": "Q-08s", "group": "G3", "field": "item.dgConfirm", "required": false, "chat": "Quick safety check: does the {product} contain a lithium battery, or is it an aerosol or a flammable liquid?", "voice": "Does it contain a lithium battery, or is it an aerosol or flammable liquid?", "parser": "normaliseYesNo", "askIf": "dg.verdict == 'possible'" },
    { "id": "Q-09", "group": "G3", "field": "item.sku", "required": true, "chat": "Do you have a product code (SKU)? If not, I'll call it ITEM-{n}.", "voice": "Do you have a product code for it?", "parser": "text", "fallback": "ITEM-{n}" },
    { "id": "Q-10", "group": "G3", "field": "item.quantity", "required": true, "chat": "How many units of {product} in total?", "voice": "How many units in total?", "parser": "parseNumber", "integer": true, "readBack": "voice" },
    { "id": "Q-11", "group": "G3", "field": "item.unitsPerCarton", "required": true, "chat": "How many units are packed in each carton?", "voice": "How many in each carton?", "parser": "parseNumber", "integer": true },
    { "id": "Q-12", "group": "G3", "field": "item.cartons", "required": true, "chat": "That's {qty} ÷ {upc} = {cartons} cartons of {product} — correct?", "voice": "So {cartons} cartons — right?", "parser": "parseNumber", "integer": true, "derive": "itemExactCartons" },
    { "id": "Q-13", "group": "G3", "field": "item.unitPrice", "required": true, "chat": "What's the price of one {product}, in pounds?", "voice": "What's the price of one unit, in pounds?", "parser": "parseNumber" },
    { "id": "Q-14", "group": "G3", "field": "item.unitWeightKg", "required": true, "chat": "How much does one {product} weigh, in kg? (grams is fine too)", "voice": "How much does one unit weigh?", "parser": "parseNumber", "units": { "g": 0.001, "kg": 1 } },
    { "id": "Q-15", "group": "G3", "field": "item.hsCodeRaw", "required": false, "rule": "R-01", "chat": "Do you know the HS code (customs code) for {product}? At least 6 digits.", "voice": "Do you know the customs HS code? It's at least six digits.", "parser": "normaliseHs", "readBack": "pairs", "neverGuess": true },
    { "id": "Q-16", "group": "G3", "field": "item.countryOfOrigin", "required": false, "rule": "R-09", "chat": "Where was {product} made? (Not where it ships from.)", "voice": "Which country was it made in?", "parser": "normaliseCountry", "options": ["United Kingdom", "China", "India", "Vietnam", "Turkey", "Germany"] },
    { "id": "Q-18", "group": "G3", "field": "loop.moreItems", "required": true, "chat": "Is there any other product in this shipment?", "voice": "Any other products?", "parser": "normaliseYesNo" },
    { "id": "Q-19", "group": "G4", "field": "cartons", "required": true, "chat": "So the shipment has {sumCartons} cartons in total — correct?", "voice": "{sumCartons} cartons in total — right?", "parser": "parseNumber", "derive": "deriveBookingTotals.cartons" },
    { "id": "Q-20", "group": "G4", "field": "totalDeclaredValue", "required": true, "chat": "The goods add up to {sumValue}. Is that the value on your invoice?", "voice": "That's {sumValue} in total — is that what's on your invoice?", "parser": "parseNumber", "derive": "deriveBookingTotals.totalDeclaredValue" },
    { "id": "Q-21", "group": "G4", "field": "pallets", "required": true, "chat": "How many pallets will it be on?", "voice": "How many pallets?", "parser": "parseNumber", "integer": true },
    { "id": "Q-22", "group": "G4", "field": "totalGrossWeightKg", "required": true, "chat": "What's the total gross weight in kg — goods plus cartons and pallets? The goods alone are about {net} kg.", "voice": "What's the total weight, including cartons and pallets, in kilos?", "parser": "parseNumber", "neverAutofill": true },
    { "id": "Q-23", "group": "G5", "field": "deliveryAppointmentBooked", "required": true, "chat": "Have you booked a delivery appointment (time slot) at the warehouse?", "voice": "Have you booked a delivery slot?", "parser": "normaliseYesNo" },
    { "id": "Q-24", "group": "G5", "field": "prefs.appointmentDate", "required": false, "chat": "What date is the slot?", "voice": "What date is the slot?", "parser": "parseDate", "askIf": "deliveryAppointmentBooked == true" },
    { "id": "Q-25", "group": "G6", "field": "prefs.maxBudgetGbp", "required": false, "chat": "Is there a maximum you'd like to spend on freight?", "parser": "parseNumber", "askIf": "sellerPriority in ['Cheapest','Balanced']" },
    { "id": "Q-26", "group": "G6", "field": "prefs.highValueOrFragile", "required": false, "chat": "Are the goods especially valuable or fragile?", "parser": "normaliseYesNo", "askIf": "sellerPriority == 'Balanced'" },
    { "id": "Q-29", "group": "G7", "field": "review", "required": true, "chat": "Here's your booking. Would you like to fix anything, or confirm?", "voice": "Shall I read the summary, or do you want to confirm?" }
  ]
}
```

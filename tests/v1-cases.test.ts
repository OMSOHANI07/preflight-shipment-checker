/**
 * V1 case matrix — every rule, boundary, input check, tip, status, recommendation
 * reference outcome (RECOMMENDATION_RULES §5.1) and parser edge case from the spec.
 * "Today" is pinned to Sunday 25-10-2026 (UK).  Each describe() is a report category.
 */
import { describe, expect, it } from "vitest";
import * as C from "@/lib/calculations";
import { confirmationDraft, explanationKey, fallbackExplanation, invoiceChecklist, nextSteps, numbersAreGrounded } from "@/lib/explain";

const now = new Date("2026-10-25T10:00:00Z");
const base: C.Booking = {
  bookingId: "BK-001", sellerName: "Northfield Goods", originCity: "Manchester", originCountry: "United Kingdom",
  destinationCity: "Frankfurt", destinationCountry: "Germany", destinationType: "Warehouse", readyToShipDate: "2026-11-05",
  sellerPriority: "Cheapest", pallets: 3, cartons: 90, totalDeclaredValue: 5400, currency: "GBP",
  totalGrossWeightKg: 620, deliveryAppointmentBooked: true,
};
const mug: C.Item = {
  bookingId: "BK-001", sku: "MUG-01", description: "Ceramic coffee mug, 350 ml", hsCodeRaw: 69120000, quantity: 1080,
  unitPrice: 5, unitsPerCarton: 12, cartons: 90, unitWeightKg: 0.5, countryOfOrigin: "United Kingdom",
};
const run = (b: Partial<C.Booking> = {}, items: C.Item[] = [mug], opts: C.RunOptions = {}) => C.runAll({ ...base, ...b }, items, { now, ...opts });
const item = (over: Partial<C.Item>) => ({ ...mug, ...over });
const codes = (r: C.BookingResult, sev?: C.Severity) => r.issues.filter((i) => (sev ? i.severity === sev : i.severity !== "Advisory")).map((i) => i.code);
const tips = (r: C.BookingResult) => codes(r, "Advisory");
const issue = (r: C.BookingResult, code: string) => r.issues.find((i) => i.code === code);
const rec = (r: C.BookingResult) => r.recommendation;

describe("R-01 HS code", () => {
  it("blank HS code fails (reported as R-01, not V-07)", () => { const r = run({}, [item({ hsCodeRaw: null })]); expect(codes(r)).toEqual(["R-01"]); });
  it("4-digit code fails with the digit count", () => expect(issue(run({}, [item({ hsCodeRaw: "6912" })]), "R-01")?.whatIsWrong).toMatch(/only 4 digits \(minimum 6\)/));
  it("5-digit numeric cell suggests a lost leading zero", () => expect(issue(run({}, [item({ hsCodeRaw: 90111 })]), "R-01")?.howToFix[0]).toMatch(/090111/));
  it("letters in the code fail", () => expect(codes(run({}, [item({ hsCodeRaw: "69AB00" })]))).toContain("R-01"));
  it("'6912.00', '6912 00' and '69-12-00' pass", () => {
    for (const hs of ["6912.00", "6912 00", "69-12-00"]) expect(codes(run({}, [item({ hsCodeRaw: hs })]))).not.toContain("R-01");
  });
  it("exactly 6 digits passes and adds tip A-06", () => { const r = run({}, [item({ hsCodeRaw: 691200 })]); expect(codes(r)).toEqual([]); expect(tips(r)).toContain("A-06"); });
  it("8 and 10 digits pass without A-06", () => {
    for (const hs of [69120000, "6912000010"]) { const r = run({}, [item({ hsCodeRaw: hs })]); expect(codes(r)).toEqual([]); expect(tips(r)).not.toContain("A-06"); }
  });
});

describe("R-02 Declared value", () => {
  it("exact match passes", () => expect(codes(run())).toEqual([]));
  it("+1.00% passes, +1.02% fails", () => { expect(codes(run({ totalDeclaredValue: 5454 }))).toEqual([]); expect(codes(run({ totalDeclaredValue: 5455 }))).toEqual(["R-02"]); });
  it("−1.00% passes, −1.02% fails", () => { expect(codes(run({ totalDeclaredValue: 5346 }))).toEqual([]); expect(codes(run({ totalDeclaredValue: 5345 }))).toEqual(["R-02"]); });
  it("message shows declared, computed, gap and the 1% limit", () => {
    expect(issue(run({ totalDeclaredValue: 5000 }), "R-02")?.whatIsWrong).toBe(
      "Declared value is £5,000.00 but the items add up to £5,400.00 (MUG-01: 1080 × £5.00 = £5,400.00). The declared value is £400.00 (7.407%) lower; the limit is 1% (£54.00).");
  });
  it("first fix gives the corrected value", () => expect(issue(run({ totalDeclaredValue: 5000 }), "R-02")?.howToFix[0]).toBe("Change the total declared value to £5,400.00."));
  it("sums money in pence across items (no floating-point drift)", () => {
    const items = [item({ quantity: 3, unitPrice: 0.1, unitsPerCarton: 3, cartons: 1 }), item({ sku: "B", quantity: 7, unitPrice: 0.7, unitsPerCarton: 7, cartons: 1 })];
    const r = run({ totalDeclaredValue: 5.2, cartons: 2, totalGrossWeightKg: 50 }, items);
    expect(r.totals.sumItemValue).toBe(5.2);
    expect(codes(r)).not.toContain("R-02");
  });
  it("missing unit price makes R-02 not evaluable", () => expect(run({}, [item({ unitPrice: null })]).ruleResults["R-02"]).toBe("not_evaluable"));
});

describe("R-03 Units per carton × cartons", () => {
  it("12 × 85 ≠ 1,080 fails with all fix options", () => {
    const i = issue(run({ cartons: 85 }, [item({ cartons: 85 })]), "R-03")!;
    expect(i.whatIsWrong).toMatch(/12 units per carton × 85 cartons = 1020 units, but quantity is 1080/);
    expect(i.howToFix.join(" ")).toMatch(/cartons should be 90.*quantity should be 1020/);
  });
  it("quantity that doesn't divide evenly explains the part-filled carton", () => {
    const i = issue(run({ cartons: 90 }, [item({ quantity: 1085 })]), "R-03")!;
    expect(i.howToFix[0]).toMatch(/91 cartons with 5 units in the last one/);
  });
  it("checked per item: only the bad item is flagged", () => {
    const r = run({ cartons: 100 }, [mug, item({ sku: "BOWL-02", quantity: 50, unitsPerCarton: 6, cartons: 10 })]);
    expect(r.issues.filter((i) => i.code === "R-03").map((i) => i.sku)).toEqual(["BOWL-02"]);
  });
});

describe("R-04 Booking cartons", () => {
  it("84 vs 90 fails with the difference", () => expect(issue(run({ cartons: 84 }), "R-04")?.whatIsWrong).toMatch(/Booking says 84 cartons, but the items add up to 90 .* Difference: 6 cartons/));
  it("sums cartons across items", () => {
    const r = run({ cartons: 95, totalDeclaredValue: 5460 }, [mug, item({ sku: "BOWL-02", quantity: 12, unitsPerCarton: 6, cartons: 2 })]);
    expect(issue(r, "R-04")?.whatIsWrong).toMatch(/add up to 92 \(MUG-01: 90 \+ BOWL-02: 2\)/);
  });
  it("R-03 and R-04 can fail together", () => expect(codes(run({ cartons: 84 }, [item({ cartons: 85 })]))).toEqual(["R-03", "R-04"]));
});

describe("R-05 Weight per pallet", () => {
  it("533.33 kg/pallet fails against Cheapest's Carrier A (500 kg)", () => {
    const r = run({ totalGrossWeightKg: 1600 });
    expect(issue(r, "R-05")?.whatIsWrong).toMatch(/1600 kg ÷ 3 pallets = 533.33 kg per pallet, over Carrier A Road economy's limit of 500 kg/);
    expect(issue(r, "R-05")?.howToFix[0]).toMatch(/at least 4 pallets.*£720.00/);
  });
  it("exactly at the limit passes (500 kg on A)", () => expect(codes(run({ totalGrossWeightKg: 1500 }))).toEqual([]));
  it("same weight passes for Balanced (priority pick is B, 750 kg)", () => expect(codes(run({ totalGrossWeightKg: 1600, sellerPriority: "Balanced" }))).toEqual([]));
  it("seller-chosen carrier is checked (C at 500 kg/pallet fails)", () => {
    const r = run({ totalGrossWeightKg: 1500, chosenCarrierId: "C-DE" });
    expect(issue(r, "R-05")?.numbers?.carrier).toBe("C-DE");
  });
  it("adding a pallet fixes it (mid-way change)", () => {
    const b1 = { ...base, totalGrossWeightKg: 1600 }, b2 = { ...b1, pallets: 4 };
    const d = C.diffResults(b1, [mug], C.runAll(b1, [mug], { now }), b2, [mug], C.runAll(b2, [mug], { now }));
    expect(d.nowPassing).toContain("R-05");
    expect(d.statusChange).toEqual({ from: "RED", to: "GREEN" });
    expect(d.costChange).toEqual({ from: 660, to: 720 });
  });
  it("over 750 kg/pallet: no carrier fits, only fix is more pallets", () => {
    const r = run({ totalGrossWeightKg: 2400 });
    expect(rec(r).label).toBe("No carrier fits");
    expect(issue(r, "R-05")?.howToFix.join(" ")).toMatch(/No carrier on this route accepts 800 kg per pallet/);
  });
});

describe("R-06 Restricted goods", () => {
  const dg = (description: string, hsCodeRaw: C.Item["hsCodeRaw"] = 69120000) => run({}, [item({ description, hsCodeRaw })]);
  it("lithium keywords are Red", () => { for (const d of ["Lithium-ion power bank 10000 mAh", "LiPo battery pack", "Vape pen kit", "CR2032 button cell"]) expect(codes(dg(d))).toContain("R-06"); });
  it("aerosols are Red", () => { for (const d of ["Hairspray 250ml", "Deodorant body spray", "Spray paint can", "Butane gas canister"]) expect(codes(dg(d))).toContain("R-06"); });
  it("flammable liquids are Red", () => { for (const d of ["Perfume 50ml eau de parfum", "Nail polish remover (acetone)", "Hand sanitiser gel", "Lighter fluid"]) expect(codes(dg(d))).toContain("R-06"); });
  it("restricted HS code alone is Red (850760)", () => expect(codes(dg("Portable charger", 850760))).toContain("R-06"));
  it("negations don't trigger: non-flammable, battery-free, alcohol-free", () => {
    for (const d of ["Non-flammable cleaning wipes", "Battery-free kitchen scale", "Alcohol-free mouthwash", "Water-based wall paint"]) expect(codes(dg(d))).not.toContain("R-06");
  });
  it("whole-word matching: 'ginger biscuits' is not 'gin'", () => expect(C.detectDangerousGoods(item({ description: "Ginger biscuits" })).verdict).toBe("none"));
  it("possible match without AI → tip A-09, status unchanged", () => { const r = dg("Cordless drill"); expect(codes(r)).toEqual([]); expect(tips(r)).toContain("A-09"); expect(r.status).toBe("GREEN"); });
  it("possible match + AI says restricted → Red, message says AI-confirmed", () => {
    const r = run({}, [item({ description: "Bluetooth speaker" })], { geminiR06Verdicts: { 0: true } });
    expect(issue(r, "R-06")?.whatIsWrong).toMatch(/confirmed by AI review/);
  });
  it("possible match + AI says safe → pass, no A-09", () => {
    const r = run({}, [item({ description: "Bluetooth speaker" })], { geminiR06Verdicts: { 0: false } });
    expect(codes(r)).toEqual([]); expect(tips(r)).not.toContain("A-09");
  });
});

describe("R-07 Gross weight", () => {
  it("gross 500 kg < goods 540 kg is Amber, 40 kg short", () => {
    const r = run({ totalGrossWeightKg: 500 });
    expect(r.status).toBe("AMBER");
    expect(issue(r, "R-07")?.whatIsWrong).toMatch(/it's 40 kg short/);
  });
  it("gross equal to goods passes, with tip A-03", () => { const r = run({ totalGrossWeightKg: 540 }); expect(codes(r)).toEqual([]); expect(tips(r)).toContain("A-03"); });
  it("fix suggests net + 15 kg per pallet", () => expect(issue(run({ totalGrossWeightKg: 500 }), "R-07")?.howToFix[0]).toMatch(/at least 540 kg.*roughly 585 kg/));
});

describe("R-08 Delivery appointment", () => {
  it("Warehouse + no appointment is Amber", () => expect(codes(run({ deliveryAppointmentBooked: false }))).toEqual(["R-08"]));
  it("Business address + no appointment passes with tip A-04", () => {
    const r = run({ destinationType: "Business address", deliveryAppointmentBooked: false });
    expect(codes(r)).toEqual([]); expect(tips(r)).toContain("A-04");
  });
  it("Warehouse + appointment booked passes", () => expect(run().ruleResults["R-08"]).toBe("pass"));
});

describe("R-09 Country of origin", () => {
  it("blank origin is Amber (reported as R-09, not V-07)", () => expect(codes(run({}, [item({ countryOfOrigin: null })]))).toEqual(["R-09"]));
  it("non-UK origin passes with duty tip A-02", () => { const r = run({}, [item({ countryOfOrigin: "China" })]); expect(codes(r)).toEqual([]); expect(tips(r)).toContain("A-02"); });
});

describe("R-10 Ready date", () => {
  it("yesterday fails, with days in the past", () => expect(issue(run({ readyToShipDate: "2026-10-24" }), "R-10")?.whatIsWrong).toMatch(/1 day before today \(25-10-2026\)/));
  it("today passes", () => expect(codes(run({ readyToShipDate: "2026-10-25" }))).toEqual([]));
  it("past ready date: estimates start from today (Sunday → Monday 26-10)", () => {
    const r = run({ readyToShipDate: "2026-10-01" });
    expect(rec(r).recommended?.collectionDate).toBe("2026-10-26");
    expect(rec(r).recommended?.etaDate).toBe("2026-11-02");
  });
  it("every result records the date it was checked against", () => expect(run().checkedAgainstDate).toBe("2026-10-25"));
});

describe("V-01…V-11 Input validation", () => {
  it("V-01 duplicate Booking ID", () => {
    const f = C.runFile([base, { ...base }], [mug], { now });
    expect(f.results.every((r) => r.issues.some((i) => i.code === "V-01"))).toBe(true);
  });
  it("V-01 blank Booking ID", () => expect(codes(run({ bookingId: "" }))).toContain("V-01"));
  it("V-02 missing seller name → INCOMPLETE", () => { const r = run({ sellerName: null }); expect(codes(r)).toEqual(["V-02"]); expect(r.status).toBe("INCOMPLETE"); });
  it("V-03 origin city, origin country, destination country, currency not allowed", () => {
    expect(codes(run({ originCity: "Bristol" }))).toContain("V-03");
    expect(codes(run({ originCountry: "France" }))).toContain("V-03");
    expect(codes(run({ destinationCountry: "Spain" as C.DestinationCountry }))).toContain("V-03");
    expect(codes(run({ currency: "EUR" }))).toContain("V-03");
  });
  it("V-04 city doesn't match country (Paris + Germany)", () => expect(issue(run({ destinationCity: "Paris" }), "V-04")?.whatIsWrong).toMatch(/Paris is not a supported city in Germany/));
  it("V-05 pallets 2.5 and declared value 0", () => { expect(codes(run({ pallets: 2.5 }))).toContain("V-05"); expect(codes(run({ totalDeclaredValue: 0 }))).toContain("V-05"); });
  it("V-06 booking with no items", () => { const r = run({}, []); expect(codes(r)).toContain("V-06"); expect(r.status).toBe("INCOMPLETE"); });
  it("V-07 missing unit price", () => expect(issue(run({}, [item({ unitPrice: null })]), "V-07")?.title).toMatch(/Unit price missing/));
  it("V-08 units per carton 0", () => expect(codes(run({}, [item({ unitsPerCarton: 0 })]))).toContain("V-08"));
  it("V-09 country of origin not in the list (Japan)", () => expect(codes(run({}, [item({ countryOfOrigin: "Japan" })]))).toContain("V-09"));
  it("V-10 same SKU twice in one booking", () => expect(codes(run({ cartons: 91, totalDeclaredValue: 5405 }, [mug, item({ quantity: 1, unitsPerCarton: 1, cartons: 1 })]))).toContain("V-10"));
  it("V-11 item for a booking that doesn't exist", () => expect(C.runFile([base], [mug, item({ bookingId: "BK-099" })], { now }).fileIssues[0].whatIsWrong).toMatch(/BK-099/));
  it("rules missing inputs are 'not evaluable', never 'pass'", () => {
    const r = run({ totalGrossWeightKg: null });
    expect(r.ruleResults["R-05"]).toBe("not_evaluable");
    expect(r.ruleResults["R-07"]).toBe("not_evaluable");
  });
});

describe("A-01…A-09 Tips (never change status)", () => {
  it("A-01 vague description 'Goods'", () => expect(tips(run({}, [item({ description: "Goods" })]))).toContain("A-01"));
  it("A-05 Saturday ready date → collection Monday 09-11-2026", () => {
    const r = run({ readyToShipDate: "2026-11-07" });
    expect(issue(r, "A-05")?.whatIsWrong).toMatch(/07-11-2026 is a Saturday; collection will be on 09-11-2026/);
    expect(rec(r).recommended?.etaDate).toBe("2026-11-16");
  });
  it("A-07 within 1% but not exact", () => expect(issue(run({ totalDeclaredValue: 5412 }), "A-07")?.whatIsWrong).toMatch(/£12.00 \(0.222%\)/));
  it("A-08 invoice checklist is always present", () => expect(tips(run())).toContain("A-08"));
  it("a booking with several tips is still GREEN", () => {
    const r = run({ readyToShipDate: "2026-11-07", totalGrossWeightKg: 540 }, [item({ countryOfOrigin: "China", hsCodeRaw: 691200 })]);
    expect(tips(r)).toEqual(expect.arrayContaining(["A-02", "A-03", "A-05", "A-06", "A-08"]));
    expect(r.status).toBe("GREEN");
  });
});

describe("Status & confirmation", () => {
  it("GREEN: confirm directly", () => { const r = run(); expect([r.status, r.canConfirm, r.needsAmberAcknowledgement]).toEqual(["GREEN", true, false]); });
  it("AMBER: confirm after acknowledgement", () => { const r = run({ deliveryAppointmentBooked: false }); expect([r.status, r.canConfirm, r.needsAmberAcknowledgement]).toEqual(["AMBER", true, true]); });
  it("RED: confirm blocked", () => { const r = run({ cartons: 84 }); expect([r.status, r.canConfirm]).toEqual(["RED", false]); });
  it("INCOMPLETE: confirm blocked", () => { const r = run({ pallets: null }); expect([r.status, r.canConfirm]).toEqual(["INCOMPLETE", false]); });
  it("Red beats missing data; missing data beats Amber", () => {
    expect(run({ cartons: 84, sellerName: null }).status).toBe("RED");
    expect(run({ sellerName: null, deliveryAppointmentBooked: false }).status).toBe("INCOMPLETE");
  });
  it("issues are ordered Red → Data → Amber → Advisory", () => {
    const sev = run({ cartons: 84, sellerName: null, deliveryAppointmentBooked: false }).issues.map((i) => i.severity);
    const order = { Red: 0, Data: 1, Amber: 2, Advisory: 3 };
    expect(sev).toEqual([...sev].sort((a, b) => order[a] - order[b]));
  });
  it("every booking gets a recommendation section, even when RED", () => expect(rec(run({ cartons: 84 })).recommended?.carrier.id).toBe("A-DE"));
  it("runFile summary counts statuses and rule failures", () => {
    const f = C.runFile([base, { ...base, bookingId: "BK-2", cartons: 84 }, { ...base, bookingId: "BK-3", deliveryAppointmentBooked: false }],
      [mug, item({ bookingId: "BK-2" }), item({ bookingId: "BK-3" })], { now });
    expect(f.summary).toMatchObject({ total: 3, red: 1, amber: 1, green: 1, incomplete: 0 });
    expect(f.summary.ruleFailCounts["R-04"]).toBe(1);
  });
});

describe("Carrier recommendation (spec §5.1)", () => {
  it("BK-001 Cheapest → Carrier A £540, ETA Thu 12-11-2026", () => {
    const r = rec(run());
    expect([r.recommended?.carrier.id, r.recommended?.cost, r.recommended?.etaDate, r.label]).toEqual(["A-DE", 540, "2026-11-12", "Recommended"]);
  });
  it("Balanced → Carrier B £660 (score 0.65 > C 0.60 > A 0.40)", () => {
    const r = rec(run({ sellerPriority: "Balanced" }));
    expect([r.recommended?.carrier.id, r.recommended?.cost, r.recommended?.score]).toEqual(["B-DE", 660, 0.65]);
  });
  it("Fastest and Most reliable → Carrier C £1,020, ETA Mon 09-11-2026", () => {
    for (const p of ["Fastest", "Most reliable"] as const) {
      const r = rec(run({ sellerPriority: p }));
      expect([r.recommended?.carrier.id, r.recommended?.cost, r.recommended?.etaDate]).toEqual(["C-DE", 1020, "2026-11-09"]);
    }
  });
  it("Paris, Balanced, 2 pallets, 800 kg → B £420, ETA Thu 05-11; runner-up C", () => {
    const r = rec(run({ destinationCity: "Paris", destinationCountry: "France", sellerPriority: "Balanced", pallets: 2, totalGrossWeightKg: 800, readyToShipDate: "2026-11-02" }));
    expect([r.recommended?.carrier.id, r.recommended?.cost, r.recommended?.etaDate]).toEqual(["B-FR", 420, "2026-11-05"]);
    expect(r.reasonFacts.find((f) => f.startsWith("Runner-up"))).toBe("Runner-up Carrier C Road express: £240.00 more, 1 day faster, 3 percentage points more reliable.");
  });
  it("Rotterdam, Cheapest, must arrive by 05-11 → B £800 exactly on the deadline; A excluded", () => {
    const r = rec(run({ destinationCity: "Rotterdam", destinationCountry: "Netherlands", pallets: 4, totalGrossWeightKg: 1000, readyToShipDate: "2026-11-02", prefs: { requiredDeliveryDate: "2026-11-05" } }));
    expect([r.recommended?.carrier.id, r.recommended?.cost]).toEqual(["B-NL", 800]);
    expect(r.reasonFacts.join(" ")).toMatch(/Arrives exactly on your 05-11-2026 deadline/);
    expect(r.allOptions.find((e) => e.carrier.id === "A-NL")?.ineligibleReasons[0]).toMatch(/arrives 09-11-2026, after 05-11-2026/);
  });
  it("Berlin, Fastest, 450 kg/pallet → B £440 'once fixed'; R-05 against C", () => {
    const r = run({ destinationCity: "Berlin", sellerPriority: "Fastest", pallets: 2, totalGrossWeightKg: 900 });
    expect([rec(r).recommended?.carrier.id, rec(r).recommended?.cost, rec(r).label]).toEqual(["B-DE", 440, "Recommended once fixed"]);
    expect(issue(r, "R-05")?.howToFix[0]).toMatch(/at least 3 pallets.*£1,020.00/);
  });
  it("Hamburg, Balanced + high-value → C £680 (reliability weighted up)", () => {
    const r = rec(run({ destinationCity: "Hamburg", sellerPriority: "Balanced", pallets: 2, totalGrossWeightKg: 600, prefs: { highValueOrFragile: true } }));
    expect([r.recommended?.carrier.id, r.recommended?.cost, r.recommended?.score]).toEqual(["C-DE", 680, 0.7]);
  });
  it("Amsterdam, Fastest, £500 budget → B £400; C over budget", () => {
    const r = rec(run({ destinationCity: "Amsterdam", destinationCountry: "Netherlands", sellerPriority: "Fastest", pallets: 2, totalGrossWeightKg: 500, prefs: { maxBudgetGbp: 500 } }));
    expect([r.recommended?.carrier.id, r.recommended?.cost]).toEqual(["B-NL", 400]);
    expect(r.allOptions.find((e) => e.carrier.id === "C-NL")?.ineligibleReasons[0]).toMatch(/over the £500.00 budget/);
  });
  it("No budget can be met → best that meets everything else, says so", () => {
    const r = rec(run({ prefs: { maxBudgetGbp: 100 } }));
    expect(r.recommended?.carrier.id).toBe("A-DE");
    expect(r.fallbackReason).toMatch(/No option fits your budget/);
  });
  it("No carrier meets the deadline → fastest that fits, says when it arrives", () => {
    const r = rec(run({ readyToShipDate: "2026-11-02", prefs: { requiredDeliveryDate: "2026-11-03" } }));
    expect(r.recommended?.carrier.id).toBe("C-DE");
    expect(r.fallbackReason).toMatch(/No option arrives by 03-11-2026; the fastest that can take your pallets arrives 04-11-2026/);
  });
  it("Missing priority → Balanced, and the reason says so", () => {
    const r = run({ sellerPriority: null });
    expect(rec(r).recommended?.carrier.id).toBe("B-DE");
    expect(rec(r).reasonFacts[0]).toBe("Seller priority not given — used Balanced.");
  });
  it("Prices follow the route: Germany > France > Netherlands", () => {
    const cost = (city: string, country: C.DestinationCountry) => rec(run({ destinationCity: city, destinationCountry: country })).recommended?.cost;
    expect([cost("Frankfurt", "Germany"), cost("Paris", "France"), cost("Amsterdam", "Netherlands")]).toEqual([540, 510, 480]);
  });
});

describe("Parsing & normalisation", () => {
  it("country, city, priority, type, yes/no and currency aliases", () => {
    expect(["Holland", "NL", "Deutschland", "GB", "Türkiye", "Viet Nam"].map(C.normaliseCountry)).toEqual(["Netherlands", "Netherlands", "Germany", "United Kingdom", "Turkey", "Vietnam"]);
    expect(["Brum", "Frankfurt am Main", "Lyons", "  paris "].map(C.normaliseCity)).toEqual(["Birmingham", "Frankfurt", "Lyon", "Paris"]);
    expect(["ASAP", "lowest cost", "can't be late", "best value"].map(C.normalisePriority)).toEqual(["Fastest", "Cheapest", "Most reliable", "Balanced"]);
    expect(["Amazon FC", "3PL", "shop", "Head office"].map(C.normaliseDestinationType)).toEqual(["Warehouse", "Warehouse", "Business address", "Business address"]);
    expect(["Yes", "yeah", "booked", "No", "not yet"].map(C.normaliseYesNo)).toEqual([true, true, true, false, false]);
    expect(["£", "sterling", "GBP", "eur"].map(C.normaliseCurrency)).toEqual(["GBP", "GBP", "GBP", "EUR"]);
  });
  it("numbers with symbols, separators, units and words", () => {
    expect(["£5,400.00", "620 kg", "1.2k", "one thousand and eighty", "a dozen"].map(C.parseNumber)).toEqual([5400, 620, 1200, 1080, 12]);
  });
  it("dates: DD-MM-YYYY, slashes, dots, ISO, Excel serial; invalid rejected", () => {
    expect(["05-11-2026", "05/11/2026", "5.11.2026", "2026-11-05", 46331].map(C.parseDate)).toEqual(Array(5).fill("2026-11-05"));
    expect([C.parseDate("31-02-2026"), C.parseDate("not a date")]).toEqual([null, null]);
  });
  it("UK day-first: 03-04-2026 is 3 April", () => expect(C.parseDate("03-04-2026")).toBe("2026-04-03"));
  it("HS code normalisation keeps text and flags lost zeros", () => {
    expect(C.normaliseHs("0902.10").digits).toBe("090210");
    expect(C.normaliseHs(90111)).toMatchObject({ digitCount: 5, possibleLostLeadingZero: true });
  });
});

describe("Explanations & confirmation", () => {
  const ok = run();
  const ex = fallbackExplanation(base, [mug], ok);
  it("confirmation matches the spec sentence (RULEBOOK §11.5)", () => {
    expect(confirmationDraft(base, [mug], ok)).toBe("Your 3 pallets (90 cartons of ceramic coffee mug, 350 ml, £5,400.00) will be collected from Manchester on Thursday 05-11-2026 by Carrier A Road economy and should arrive at the Frankfurt warehouse on Thursday 12-11-2026 (estimated delivery). Freight: £540.00.");
  });
  it("blocked bookings say 'once the issues above are fixed'", () => expect(confirmationDraft(base, [mug], run({ cartons: 84 }))).toMatch(/^Once the issues above are fixed/));
  it("no-carrier bookings say they can't be booked yet", () => expect(confirmationDraft({ ...base, totalGrossWeightKg: 2400 }, [mug], run({ totalGrossWeightKg: 2400 }))).toMatch(/can't be booked yet.*800 kg per pallet/));
  it("headline names carrier, cost and weekday date", () => expect(ex.headline).toBe("Carrier A Road economy — £540.00, arriving Thursday 12-11-2026"));
  it("next steps cover appointment, invoice, labels, collection, receiver (§11.6)", () => {
    expect(nextSteps(base, ok).join(" ")).toMatch(/delivery appointment[\s\S]*commercial invoice[\s\S]*1 of 90[\s\S]*collection[\s\S]*receiver/);
  });
  it("invoice checklist has all 15 gov.uk elements with a draft invoice number", () => {
    const list = invoiceChecklist(base, [mug], ok);
    expect(list).toHaveLength(15);
    expect(list[0].detail).toMatch(/INV-BK-001-25102026/);
  });
  it("AI guardrail: rejects a £ amount or date not in the facts", () => {
    const facts = JSON.stringify(ex);
    expect(numbersAreGrounded("Carrier A costs £540.00 and arrives 12-11-2026.", facts)).toBe(true);
    expect(numbersAreGrounded("Carrier A costs £499.00.", facts)).toBe(false);
    expect(numbersAreGrounded("Arrives 13-11-2026.", facts)).toBe(false);
  });
  it("explanation cache key changes when the facts change", () => {
    expect(explanationKey(base, ok)).toBe(explanationKey(base, run()));
    expect(explanationKey(base, ok)).not.toBe(explanationKey({ ...base, pallets: 4 }, run({ pallets: 4 })));
  });
});

describe("Explanations with missing data", () => {
  it("missing pallets: no '? pallets' or 'Freight: —' in the text", () => {
    const b = { ...base, pallets: null };
    const r = run({ pallets: null });
    const ex = fallbackExplanation(b, [mug], r);
    const all = [ex.headline, ex.reason, ex.confirmation].join(" ");
    expect(all).not.toMatch(/\?|—,|: —|Freight: —/);
    expect(ex.confirmation).toMatch(/^Once the issues above are fixed, your shipment \(90 cartons/);
    expect(ex.confirmation).toMatch(/Freight will be priced once the number of pallets is added\.$/);
    expect(ex.headline).toBe("Carrier A Road economy — arriving Thursday 12-11-2026 (priced once the pallet count is added)");
  });
  it("missing destination: says why carriers can't be compared", () => {
    const b = { ...base, destinationCountry: null, destinationCity: null };
    const r = run({ destinationCountry: null, destinationCity: null });
    expect(confirmationDraft(b, [mug], r)).toMatch(/can't be booked yet: Destination country is missing/);
  });
});

describe("Edge-case fixes (Edge_Case_Test_Data.xlsx)", () => {
  it("money: line value rounds quantity × price, not the price (1000 × £0.333 = £333.00)", () => {
    const r = run({ cartons: 100, totalDeclaredValue: 333, totalGrossWeightKg: 600 }, [item({ quantity: 1000, unitPrice: 0.333, unitsPerCarton: 10, cartons: 100 })]);
    expect(r.totals.sumItemValue).toBe(333);
    expect(tips(r)).not.toContain("A-07");
  });
  it("money: negative quantity doesn't produce a negative % or a 'close enough' tip", () => {
    const r = run({}, [item({ quantity: -1080 })]);
    expect(r.totals.declaredValueDiffPct).toBe(200);
    expect(codes(r)).toContain("R-02");
    expect(tips(r)).not.toContain("A-07");
  });
  it("dates: a trailing time is ignored", () => {
    expect(["15-12-2026 09:30", "2026-12-15T09:30:00Z", "15/12/2026 9:30 am"].map(C.parseDate)).toEqual(Array(3).fill("2026-12-15"));
  });
  it("numbers: decimal comma vs thousands comma", () => {
    expect(["5,00", "12,5", "£5,50", "1,080", "5,400.00"].map(C.parseNumber)).toEqual([5, 12.5, 5.5, 1080, 5400]);
  });
  it("numbers: spreadsheet float noise is removed, real decimals kept", () => {
    expect([1080.0000000001, 0.333, 2.5].map(C.parseNumber)).toEqual([1080, 0.333, 2.5]);
  });
  it("IDs: items match bookings ignoring case and spaces", () => {
    const f = C.runFile([base], [item({ bookingId: " bk-001 " })], { now });
    expect(f.fileIssues).toEqual([]);
    expect(f.results[0].status).toBe("GREEN");
  });
  it("R-06: '-free' is a negation (perfume-free, propellant-free)", () => {
    for (const d of ["Perfume-free hand cream 50 ml", "Propellant-free pump spray"]) expect(C.detectDangerousGoods(item({ description: d })).verdict).not.toBe("definite");
  });
  it("R-06: lithium grease is a lubricant, not a battery", () => {
    expect(C.detectDangerousGoods(item({ description: "Lithium grease, 400 g tube", hsCodeRaw: 340319 })).verdict).toBe("none");
    expect(C.detectDangerousGoods(item({ description: "Lithium battery pack" })).verdict).toBe("definite");
  });
  it("R-06: a keyword only in the SKU code is 'possible', not Red", () => {
    const r = run({}, [item({ sku: "LIPO-BALM-01", description: "Lip balm, 10 g" })]);
    expect(codes(r)).not.toContain("R-06");
    expect(tips(r)).toContain("A-09");
  });
  it("A-10: understated gross weight hiding an overweight pallet is pointed out", () => {
    const r = run({ totalGrossWeightKg: 1200 }, [item({ unitWeightKg: 1.5 })]);
    expect(codes(r)).toEqual(["R-07"]);
    expect(issue(r, "A-10")?.whatIsWrong).toMatch(/1,620 kg — 540 kg per pallet, over Carrier A Road economy's 500 kg limit/);
    expect(r.status).toBe("AMBER");
  });
});

describe("Edge-case follow-ups: clearer messages", () => {
  const row = (over: Record<string, unknown>) => C.bookingFromRow({
    "Booking ID": "BK-1", "Seller name": "A", "Origin city": "Leeds", "Origin country": "UK", "Destination city": "Paris", "Destination country": "France",
    "Destination type": "Warehouse", "Ready to ship date": "15-12-2026", "Seller priority": "Cheapest", Pallets: 3, Cartons: 90,
    "Total declared value": 5400, Currency: "GBP", "Total gross weight (kg)": 620, "Delivery appointment booked": "Yes", ...over,
  });
  it("US month-first date: says so and suggests the day-first date", () => {
    const b = row({ "Ready to ship date": "12/15/2026" });
    expect(issue(C.runAll(b, [mug], { now }), "V-02")?.whatIsWrong).toBe('Ready to ship date "12/15/2026" could not be read. It looks like month-first (US) order, but dates are read day-first (DD-MM-YYYY). Did you mean 15-12-2026?');
  });
  it("impossible date: names the month that's too short", () => {
    expect(C.explainUnreadableDate("31-02-2027")).toBe("31-02-2027 isn't a real date: February doesn't have 31 days.");
  });
  it("blank vs unreadable are worded differently", () => {
    expect(issue(C.runAll(row({ "Total gross weight (kg)": null }), [mug], { now }), "V-02")?.whatIsWrong).toBe("Total gross weight (kg) is blank.");
    expect(issue(C.runAll(row({ Pallets: "lots" }), [mug], { now }), "V-02")?.whatIsWrong).toBe('Pallets "lots" could not be read.');
  });
  it("unreadable item number shows the text as written", () => {
    const it = C.itemFromRow({ "Booking ID": "BK-001", SKU: "MUG-01", Description: "Mug", "HS code": 691200, "Quantity (units)": 1080, "Unit price": "five-ish", "Units per carton": 12, Cartons: 90, "Unit weight (kg)": 0.5, "Country of origin": "UK" });
    expect(issue(run({}, [it]), "V-07")?.whatIsWrong).toBe('Unit price "five-ish" could not be read for item MUG-01.');
  });
  it("HS code in scientific notation explains what Excel did", () => {
    expect(issue(run({}, [item({ hsCodeRaw: "6.912E+05" })]), "R-01")?.whatIsWrong).toMatch(/Excel turned it into scientific notation/);
  });
  it("all-zero HS code passes R-01 but gets tip A-11 (and not A-06)", () => {
    const r = run({}, [item({ hsCodeRaw: "000000" })]);
    expect(codes(r)).toEqual([]);
    expect(tips(r)).toContain("A-11");
    expect(tips(r)).not.toContain("A-06");
  });
  it("a very long description is shortened in the confirmation", () => {
    const long = "Hand-glazed stoneware coffee mug with reinforced handle, 350 ml capacity, dishwasher and microwave safe, ".repeat(3);
    const it = item({ description: long });
    expect(confirmationDraft(base, [it], run({}, [it]))).toMatch(/90 cartons of hand-glazed stoneware coffee mug with reinforced handle, 350 ml…, £5,400\.00/);
  });
  it("unreadable markers never show up as changed fields in a mid-way diff", () => {
    const b1 = { ...base, unreadable: { pallets: "lots" } }, b2 = { ...base };
    expect(C.diffResults(b1, [mug], run(), b2, [mug], run()).fieldChanges).toEqual([]);
  });
});

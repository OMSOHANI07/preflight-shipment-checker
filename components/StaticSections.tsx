import { ClipboardCheck, FileSpreadsheet, Truck } from "lucide-react";
import { DESTINATION_COUNTRIES, gbp, type Carrier, type RuleId } from "@/lib/calculations";
import { Reveal } from "./Motion";

const STEPS = [
  { icon: FileSpreadsheet, title: "Upload", body: "Drop your Bookings & Items workbook in the template format. Nothing to sign up for." },
  { icon: ClipboardCheck, title: "Check", body: "All 10 rules run on every booking — with the exact numbers, how serious each problem is and how to fix it." },
  { icon: Truck, title: "Book", body: "A carrier picked for your priority, with the reason, the runner-up, and a confirmation you can download." },
];

export function HowItWorks() {
  return (
    <section id="how" className="section-glass px-4 py-24 sm:px-6" aria-labelledby="how-title">
      <div className="mx-auto max-w-[1080px]">
        <Reveal>
          <p className="eyebrow text-center">How it works</p>
          <h2 id="how-title" className="headline-lg mx-auto mt-2 max-w-[760px] text-center">Three steps. No surprises at customs.</h2>
        </Reveal>
        <ol className="mt-14 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Reveal delay={i * 0.08} className="card h-full p-8 transition-transform duration-300 hover:scale-[1.015]">
                <span className="text-[13px] font-semibold text-muted">Step {i + 1}</span>
                <s.icon size={36} strokeWidth={1.6} className="mt-5 text-accent-text" aria-hidden />
                <h3 className="mt-5 text-[28px] font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[17px] text-muted">{s.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The rules as a person would say them. */
const PLAIN: Record<RuleId, string> = {
  "R-01": "Every product needs its customs code (the HS code), at least 6 digits long — without it, goods can sit at the border.",
  "R-02": "The total value you declare has to match what your products add up to.",
  "R-03": "The units have to fit the cartons — say 12 mugs a box and 90 boxes, and that's 1,080 mugs.",
  "R-04": "The carton count on the booking has to match the cartons of each product added together.",
  "R-05": "Each pallet has to be light enough for the carrier you pick.",
  "R-06": "No lithium batteries, aerosols or flammable liquids — the road carriers won't take them.",
  "R-07": "The total weight should be at least what the goods themselves weigh.",
  "R-08": "Warehouses usually turn lorries away without a booked delivery slot.",
  "R-09": "Say where each product was made — customs will ask.",
  "R-10": "The ready date shouldn't already be in the past.",
};

/** Guardrails (docs/GUARDRAILS.md), as a person would say them. */
const SAFETY: { code: string; text: string; kind: "stop" | "tip" }[] = [
  { code: "G-01", kind: "stop", text: "We don't carry prohibited goods: weapons, ammunition, explosives and fireworks, illegal drugs, counterfeits, protected wildlife, cash or bullion, radioactive or toxic substances, human remains or live animals." },
  { code: "G-03", kind: "stop", text: "The HS code has to start with a real chapter — 01 to 97 (77 isn't used)." },
  { code: "G-02", kind: "tip", text: "Restricted goods — alcohol, tobacco and vapes, medicines and CBD, knives, meat and dairy, plants and seeds, art and antiques, military items — get a tip on the licences and certificates they need." },
  { code: "G-04", kind: "tip", text: "We check the HS code fits the product, and spot a leading zero Excel dropped." },
  { code: "G-05", kind: "tip", text: "We flag prices that look too low for the product, which customs may treat as under-valuation." },
];

export function RulesGrid({ rules }: { rules: { id: RuleId; text: string; severity: "Red" | "Amber" }[] }) {
  const groups = [
    { key: "stop", title: "Has to be fixed before it can ship", note: "We won't let these through.", box: "rules-box-red", items: rules.filter((r) => r.severity === "Red") },
    { key: "look", title: "Worth a second look", note: "You can still book — we'll just ask you to confirm.", box: "rules-box-yellow", items: rules.filter((r) => r.severity !== "Red") },
  ];
  return (
    <section id="rules" className="section-dark section-glass-dark px-4 py-24 sm:px-6" aria-labelledby="rules-title">
      <div className="mx-auto max-w-[1080px]">
        <Reveal>
          <p className="eyebrow text-center">What we check</p>
          <h2 id="rules-title" className="headline-lg mx-auto mt-2 max-w-[820px] text-center">The things that go wrong, in plain English.</h2>
          <p className="lede mx-auto mt-4 max-w-[640px] text-center">Every booking is checked for all ten, every time.</p>
        </Reveal>
        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {groups.map((g, gi) => (
            <Reveal key={g.key} delay={gi * 0.08} className={`${g.box} h-full rounded-[28px] p-7 sm:p-8`}>
              <div className="flex items-center gap-3">
                <span className="rules-swatch size-4 shrink-0 rounded-[5px]" aria-hidden />
                <h3 className="text-[22px] font-bold tracking-tight">{g.title}</h3>
              </div>
              <p className="mt-1 pl-7 text-[15px] text-muted">{g.note}</p>
              <ul className="mt-6 space-y-3">
                {g.items.map((r) => (
                  <li key={r.id} className="rules-item rounded-2xl px-4 py-3 text-[16px] leading-snug">{PLAIN[r.id] ?? r.text}</li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-12">
          <h3 className="text-center text-[22px] font-bold tracking-tight">Plus safety checks</h3>
          <p className="mx-auto mt-1 max-w-[560px] text-center text-[15px] text-muted">On every booking — file, chat or voice. Chat and voice also refuse requests to under-declare, hide or mislabel goods.</p>
          <ul className="mx-auto mt-6 grid max-w-[920px] gap-3 sm:grid-cols-2" data-testid="safety-checks">
            {SAFETY.map((g) => (
              <li key={g.code} className={`${g.kind === "stop" ? "rules-box-red" : "rules-box-tip"} flex gap-3 rounded-2xl px-4 py-3 text-[15px] leading-snug`}>
                <span className="rules-swatch mt-1 size-3 shrink-0 rounded-[4px]" aria-hidden />
                <span><span className="sr-only">{g.kind === "stop" ? "Can't ship: " : "Tip: "}</span>{g.text}</span>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal>
          <p className="mt-10 text-center text-[15px] text-muted">
            We also share tips from the UK government&apos;s export invoice guide, and give you a checklist for the commercial invoice.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

const COUNTRY_SHORT: Record<string, string> = { Germany: "Germany", France: "France", Netherlands: "Netherlands" };

export function CarriersCompare({ carriers }: { carriers: readonly Carrier[] }) {
  const services = ["Carrier A", "Carrier B", "Carrier C"].map((name) => carriers.filter((c) => c.carrier === name));
  return (
    <section id="carriers" className="section-glass px-4 py-24 sm:px-6" aria-labelledby="carriers-title">
      <div className="mx-auto max-w-[1080px]">
        <Reveal>
          <p className="eyebrow text-center">Carriers</p>
          <h2 id="carriers-title" className="headline-lg mx-auto mt-2 max-w-[760px] text-center">Which service is right for you?</h2>
          <p className="lede mx-auto mt-4 max-w-[600px] text-center">Same three road services from the UK to Germany, France and the Netherlands.</p>
        </Reveal>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {services.map((rows, i) => {
            const c = rows[0];
            if (!c) return null;
            const tag = i === 0 ? "Lowest price" : i === 1 ? "Heaviest pallets" : "Fastest & most reliable";
            return (
              <Reveal key={c.carrier} delay={i * 0.08} className="card flex h-full flex-col p-8 text-center">
                <p className="text-[13px] font-semibold text-accent-text">{tag}</p>
                <h3 className="mt-2 text-[28px] font-bold tracking-tight">{c.carrier}</h3>
                <p className="text-[17px] text-muted">{c.service}</p>
                <dl className="mt-8 space-y-6 text-[15px]">
                  <div>
                    <dt className="text-muted">Price per pallet</dt>
                    <dd className="mt-1 space-y-0.5">
                      {DESTINATION_COUNTRIES.map((country) => {
                        const r = rows.find((x) => x.destinationCountry === country);
                        return <div key={country}><span className="text-[22px] font-semibold">{r ? gbp(r.pricePerPallet).replace(".00", "") : "—"}</span> <span className="text-muted">{COUNTRY_SHORT[country]}</span></div>;
                      })}
                    </dd>
                  </div>
                  <div className="border-t hairline pt-6"><dt className="text-muted">Transit</dt><dd className="mt-1 text-[22px] font-semibold">{c.transitDays} working days</dd></div>
                  <div className="border-t hairline pt-6"><dt className="text-muted">On time</dt><dd className="mt-1 text-[22px] font-semibold">{c.onTimePct}%</dd></div>
                  <div className="border-t hairline pt-6"><dt className="text-muted">Max per pallet</dt><dd className="mt-1 text-[22px] font-semibold">{c.maxKgPerPallet} kg</dd></div>
                </dl>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="section-glass border-t hairline px-4 py-10 text-[12px] text-muted sm:px-6">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-2 sm:flex-row sm:justify-between">
        <p>Ship Eazy · Ops Hackathon, Case 2 — conversational shipment booking and error checker.</p>
        <p>
          Costs and delivery dates are estimates only ·{" "}
          <a className="underline hover:text-fg" href="https://github.com/OMSOHANI07/preflight-shipment-checker" target="_blank" rel="noreferrer">GitHub</a>
        </p>
      </div>
    </footer>
  );
}

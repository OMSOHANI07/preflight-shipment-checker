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
    <section id="how" className="bg-bg-alt px-4 py-24 sm:px-6" aria-labelledby="how-title">
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

export function RulesGrid({ rules }: { rules: { id: RuleId; text: string; severity: "Red" | "Amber" }[] }) {
  return (
    <section id="rules" className="section-dark px-4 py-24 sm:px-6" aria-labelledby="rules-title">
      <div className="mx-auto max-w-[1080px]">
        <Reveal>
          <p className="eyebrow text-center">What we check</p>
          <h2 id="rules-title" className="headline-lg mx-auto mt-2 max-w-[820px] text-center">Ten rules. Every booking. Every time.</h2>
          <p className="lede mx-auto mt-4 max-w-[640px] text-center">Red stops a shipment until it&apos;s fixed. Amber is a risk you acknowledge before you confirm.</p>
        </Reveal>
        <ul className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {rules.map((r, i) => (
            <li key={r.id}>
              <Reveal delay={(i % 5) * 0.05} className={`${r.severity === "Red" ? "sev-red" : "sev-amber"} h-full rounded-[20px] bg-surface p-5`}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-muted">{r.id}</span>
                  <span className="chip sev-chip"><span className="sev-dot" aria-hidden />{r.severity}</span>
                </div>
                <p className="mt-3 text-[15px] leading-snug">{r.text}</p>
              </Reveal>
            </li>
          ))}
        </ul>
        <Reveal>
          <p className="mt-10 text-center text-[15px] text-muted">
            Plus tips from the UK government export invoice guide — HS code length, country of origin, packaging weight and a full commercial-invoice checklist.
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
    <section id="carriers" className="px-4 py-24 sm:px-6" aria-labelledby="carriers-title">
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
    <footer className="border-t hairline bg-bg-alt px-4 py-10 text-[12px] text-muted sm:px-6">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-2 sm:flex-row sm:justify-between">
        <p>Ops Hackathon · Case 2 — Conversational Shipment Booking &amp; “Pre-Flight” Error Checker.</p>
        <p>
          Costs and delivery dates are estimates only ·{" "}
          <a className="underline hover:text-fg" href="https://github.com/OMSOHANI07/preflight-shipment-checker" target="_blank" rel="noreferrer">GitHub</a>
        </p>
      </div>
    </footer>
  );
}

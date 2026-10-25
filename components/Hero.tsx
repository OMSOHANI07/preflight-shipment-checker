"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Download } from "lucide-react";
import { HeroIllustration } from "./HeroIllustration";

export function Hero() {
  const reduce = useReducedMotion();
  const up = (d: number) => (reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, delay: d, ease: [0.22, 1, 0.36, 1] as const } });
  return (
    <section className="overflow-hidden px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24" aria-labelledby="hero-title">
      <motion.p className="eyebrow" {...up(0)}>Pre-Flight Shipment Checker</motion.p>
      <motion.h1 id="hero-title" className="headline-xl mx-auto mt-3 max-w-[900px]" {...up(0.08)}>
        Catch it before it ships.
      </motion.h1>
      <motion.p className="lede mx-auto mt-5 max-w-[680px]" {...up(0.16)}>
        Upload your bookings. We check every carton, code and kilo against the rulebook, then pick the right carrier.
      </motion.p>
      <motion.div className="mt-8 flex flex-wrap items-center justify-center gap-3" {...up(0.24)}>
        <a href="#app" className="btn btn-primary">Check a file</a>
        <a href="/samples/template.xlsx" download="Case2_Shipment_Booking_Test_Data_Format.xlsx" className="btn btn-secondary">
          <Download size={17} aria-hidden /> Download template
        </a>
      </motion.div>
      <motion.div className="mx-auto mt-14 max-w-[960px]" {...up(0.32)}>
        <HeroIllustration />
      </motion.div>
    </section>
  );
}

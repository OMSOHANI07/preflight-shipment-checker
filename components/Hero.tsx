"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Download } from "lucide-react";
import { HeroScene } from "./HeroScene";

const BRAND = "PRE-FLIGHT";

export function Hero() {
  const reduce = useReducedMotion();
  const up = (d: number) => (reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, delay: d, ease: [0.22, 1, 0.36, 1] as const } });
  return (
    <section className="relative isolate flex min-h-[calc(100svh-48px)] flex-col items-center overflow-hidden px-4 pt-[11vh] text-center sm:px-6" aria-labelledby="hero-title">
      <HeroScene />

      <div className="relative z-10 flex flex-col items-center">
        {/* the brand rises letter by letter, then a slow shine runs across it */}
        <p className="brand-word select-none text-[clamp(44px,11vw,128px)] font-black leading-none tracking-[0.06em]">
          <span className="sr-only">Pre-Flight</span>
          {BRAND.split("").map((ch, i) => (
            <motion.span key={i} aria-hidden className="inline-block"
              {...(reduce ? {} : { initial: { opacity: 0, y: 60, filter: "blur(10px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, transition: { duration: 0.8, delay: 0.1 + i * 0.06, ease: [0.22, 1, 0.36, 1] as const } })}>
              {ch}
            </motion.span>
          ))}
        </p>
        <motion.p className="hero-ink mt-3 text-[13px] font-semibold uppercase tracking-[0.18em] opacity-85 sm:text-[14px] sm:tracking-[0.35em]" {...up(0.7)}>
          Shipment checker · UK → Europe
        </motion.p>
        <motion.h1 id="hero-title" className="hero-ink mt-7 max-w-[820px] text-[clamp(30px,4.6vw,54px)] font-bold leading-[1.08] tracking-tight" {...up(0.85)}>
          Catch it before it ships.
        </motion.h1>
        <motion.p className="hero-ink mx-auto mt-4 max-w-[620px] text-[clamp(16px,1.8vw,20px)] font-medium leading-snug opacity-90" {...up(1)}>
          Upload your bookings or just tell us about the shipment. We check every carton, code and kilo, then pick the right carrier.
        </motion.p>
        <motion.div className="mt-8 flex flex-wrap items-center justify-center gap-3" {...up(1.15)}>
          <a href="#app" className="btn btn-primary">Check a file</a>
          <a href="/samples/template.xlsx" download="Case2_Shipment_Booking_Test_Data_Format.xlsx" className="btn btn-glass">
            <Download size={17} aria-hidden /> Download template
          </a>
        </motion.div>
      </div>

      <a href="#how" className="scroll-cue hero-ink absolute bottom-[9vh] z-10 flex flex-col items-center text-[12px] font-medium sm:bottom-[12vh]" aria-label="Scroll to how it works">
        <ChevronDown size={22} aria-hidden />
      </a>
    </section>
  );
}

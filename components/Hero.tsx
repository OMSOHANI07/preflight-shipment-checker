"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { PHOTOS } from "./PageBackdrop";

const BRAND = "PRE-FLIGHT";
const CAPTIONS = ["By sea", "Through the port", "By road and air"];

export function Hero() {
  const reduce = useReducedMotion();
  const [shot, setShot] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = window.setInterval(() => setShot((s) => (s + 1) % PHOTOS.length), 6000);
    return () => window.clearInterval(t);
  }, [reduce]);
  const up = (d: number) => (reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, delay: d, ease: [0.22, 1, 0.36, 1] as const } });

  return (
    <section id="top" className="hero relative isolate flex min-h-[calc(100svh-48px)] items-center overflow-hidden px-4 py-16 sm:px-6" aria-labelledby="hero-title">
      {/* phones: the photo itself is the background (it's portrait, so it fits a phone screen) */}
      <div aria-hidden className="absolute inset-0 -z-10 lg:hidden">
        {PHOTOS.map((p, i) => (
          <div key={p.id} className="kenburns absolute inset-0 bg-cover bg-center transition-opacity duration-[1500ms]" style={{ backgroundImage: `url(/images/${p.id}.webp)`, opacity: i === shot ? 1 : 0 }} />
        ))}
      </div>
      <div aria-hidden className="hero-shade absolute inset-0 -z-10" />

      <div className="mx-auto grid w-full max-w-[1180px] items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
        <div className="text-center lg:text-left">
          <p className="brand-word select-none whitespace-nowrap text-[clamp(44px,12vw,64px)] font-black leading-none tracking-[0.05em] lg:text-[clamp(56px,6.4vw,96px)]">
            <span className="sr-only">Pre-Flight</span>
            {BRAND.split("").map((ch, i) => (
              <motion.span key={i} aria-hidden className="inline-block"
                {...(reduce ? {} : { initial: { opacity: 0, y: 60, filter: "blur(10px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, transition: { duration: 0.8, delay: 0.1 + i * 0.06, ease: [0.22, 1, 0.36, 1] as const } })}>
                {ch}
              </motion.span>
            ))}
          </p>
          <motion.p className="hero-ink mt-3 text-[13px] font-semibold uppercase tracking-[0.18em] opacity-85 sm:text-[14px] sm:tracking-[0.3em]" {...up(0.7)}>
            Shipment checker · UK → Europe
          </motion.p>
          <motion.h1 id="hero-title" className="hero-ink mt-7 text-[clamp(32px,4.4vw,56px)] font-bold leading-[1.06] tracking-tight" {...up(0.85)}>
            Catch it before it ships.
          </motion.h1>
          <motion.p className="hero-ink mx-auto mt-4 max-w-[560px] text-[clamp(16px,1.6vw,20px)] font-medium leading-snug opacity-90 lg:mx-0" {...up(1)}>
            Upload your bookings or just tell us about the shipment. We check every carton, code and kilo, then pick the right carrier.
          </motion.p>
          <motion.div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start" {...up(1.15)}>
            <a href="#app" className="btn btn-primary">Check a file</a>
            <a href="/samples/template.xlsx" download="Case2_Shipment_Booking_Test_Data_Format.xlsx" className="btn btn-glass">
              <Download size={17} aria-hidden /> Download template
            </a>
          </motion.div>
        </div>

        {/* desktop: a tall window onto the photos, sharp at their real size */}
        <motion.figure className="relative mx-auto hidden aspect-[415/740] w-full max-w-[380px] lg:block" {...up(0.4)}>
          <div className="photo-window relative h-full w-full overflow-hidden rounded-[36px]">
            {PHOTOS.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- small local photos; CSS handles the motion
              <img key={p.id} src={`/images/${p.id}.webp`} alt={i === shot ? p.alt : ""} aria-hidden={i !== shot}
                className="kenburns absolute inset-0 h-full w-full object-cover transition-opacity duration-[1500ms]" style={{ opacity: i === shot ? 1 : 0 }} />
            ))}
            <div aria-hidden className="glint-sweep absolute inset-0" />
          </div>
          <figcaption className="hero-ink mt-4 flex items-center justify-center gap-3 text-[13px] font-medium">
            <AnimatePresence mode="wait">
              <motion.span key={shot} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>{CAPTIONS[shot]}</motion.span>
            </AnimatePresence>
            <span className="flex gap-1.5" aria-hidden>
              {PHOTOS.map((p, i) => <span key={p.id} className={`h-1.5 rounded-full bg-white transition-all ${i === shot ? "w-5 opacity-100" : "w-1.5 opacity-50"}`} />)}
            </span>
          </figcaption>
        </motion.figure>
      </div>

      <a href="#how" className="scroll-cue hero-ink absolute bottom-6 left-1/2 z-10 -translate-x-1/2" aria-label="Scroll to how it works">
        <ChevronDown size={24} aria-hidden />
      </a>
    </section>
  );
}

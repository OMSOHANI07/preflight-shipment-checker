"use client";

/**
 * A fixed photo backdrop behind the whole page. The photo cross-fades to match the section in view
 * (sea → port → road), drifts slowly (Ken Burns), and a plane now and then crosses the sky.
 * The photos are small, so this layer uses pre-blurred copies; a scrim keeps text readable.
 */
import { useEffect, useState } from "react";

export const PHOTOS = [
  { id: "sea", alt: "A container ship at sea at sunset with a plane overhead" },
  { id: "port", alt: "Lorries at a container port at sunset with a plane taking off" },
  { id: "road", alt: "A ship, a lorry and a plane at dusk" },
] as const;

/** Which photo each section shows. */
const SECTION_PHOTO: Record<string, number> = { top: 0, how: 1, app: 2, rules: 0, carriers: 1 };

export function PageBackdrop() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const els = Object.keys(SECTION_PHOTO).map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (seen) setActive(SECTION_PHOTO[seen.target.id] ?? 0);
    }, { threshold: [0.25, 0.5] });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  return (
    <div aria-hidden className="page-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {PHOTOS.map((p, i) => (
        <div key={p.id} className="backdrop-photo absolute inset-[-8%] bg-cover bg-center transition-opacity duration-[1600ms] ease-out"
          style={{ backgroundImage: `url(/images/${p.id}-blur.webp)`, opacity: i === active ? 1 : 0, animationDelay: `${-i * 9}s` }} />
      ))}
      <div className="backdrop-scrim absolute inset-0" />
      {/* sky traffic */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <g className="sky-plane">
          <path d="M-240 6 H-2" stroke="url(#trail)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M0 4 L46 2 Q56 3 58 6 Q56 9 46 9 L0 8 Z M22 6 L10 -10 H16 L34 5 Z M22 7 L12 20 H18 L34 8 Z M0 4 L-6 -6 H0 L8 4 Z" fill="var(--sky-plane)" />
          <circle className="blink" cx="12" cy="-9" r="1.8" fill="#ff453a" />
        </g>
        <defs>
          <linearGradient id="trail" x1="0" x2="1">
            <stop offset="0" stopColor="var(--sky-trail)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--sky-trail)" stopOpacity="0.8" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

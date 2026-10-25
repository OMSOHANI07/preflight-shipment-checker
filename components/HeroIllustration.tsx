"use client";

import { useReducedMotion } from "framer-motion";

/** Original SVG: pallets roll along a road through a scanning checkpoint; cleared ones get a tick. */
function Pallet({ tone }: { tone: string }) {
  return (
    <g>
      {/* cartons */}
      <rect x="0" y="0" width="34" height="26" rx="3" fill={tone} opacity="0.95" />
      <rect x="36" y="0" width="34" height="26" rx="3" fill={tone} opacity="0.8" />
      <rect x="18" y="-26" width="34" height="24" rx="3" fill={tone} opacity="0.7" />
      <path d="M17 0v26M53 0v26M35 -26v24" stroke="rgba(0,0,0,.12)" strokeWidth="1.5" />
      {/* pallet base */}
      <rect x="-4" y="28" width="78" height="6" rx="2" fill="#a0784a" />
      <rect x="0" y="34" width="10" height="6" fill="#8a6640" />
      <rect x="30" y="34" width="10" height="6" fill="#8a6640" />
      <rect x="60" y="34" width="10" height="6" fill="#8a6640" />
    </g>
  );
}

export function HeroIllustration() {
  const reduce = useReducedMotion();
  const tones = ["#c8a27a", "#b9946c", "#d4b38e"];
  return (
    <svg viewBox="0 0 720 260" className="h-auto w-full" role="img" aria-label="Illustration: pallets moving through a checkpoint that scans and clears them">
      <defs>
        <linearGradient id="road" x1="0" x2="1">
          <stop offset="0" stopColor="var(--hairline)" stopOpacity="0" />
          <stop offset="0.15" stopColor="var(--hairline)" />
          <stop offset="0.85" stopColor="var(--hairline)" />
          <stop offset="1" stopColor="var(--hairline)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* road */}
      <rect x="0" y="214" width="720" height="4" rx="2" fill="url(#road)" />
      <g stroke="var(--hairline)" strokeWidth="2" strokeDasharray="14 12">
        <line x1="40" y1="236" x2="680" y2="236" />
      </g>

      {/* checkpoint gate */}
      <g transform="translate(330 70)">
        <rect x="-6" y="0" width="12" height="146" rx="6" fill="var(--surface-2)" stroke="var(--hairline)" />
        <rect x="114" y="0" width="12" height="146" rx="6" fill="var(--surface-2)" stroke="var(--hairline)" />
        <rect x="-10" y="-14" width="140" height="24" rx="12" fill="var(--surface)" stroke="var(--hairline)" />
        <circle cx="12" cy="-2" r="4" fill="var(--red)" />
        <circle cx="26" cy="-2" r="4" fill="var(--amber)" />
        <circle cx="40" cy="-2" r="4" fill="var(--green)" />
        <text x="104" y="2" textAnchor="end" fontSize="10" fontWeight="600" fill="var(--muted)" fontFamily="inherit">R-01…R-10</text>
        <polygon className={reduce ? undefined : "scan-beam"} points="6,10 114,10 122,144 -2,144" fill="url(#beam)" />
      </g>

      {/* pallets */}
      {reduce ? (
        <>
          <g transform="translate(120 172)"><Pallet tone={tones[0]} /></g>
          <g transform="translate(355 172)"><Pallet tone={tones[1]} /></g>
          <g transform="translate(560 172)"><Pallet tone={tones[2]} /></g>
        </>
      ) : (
        tones.map((t, i) => (
          <g key={i} transform="translate(0 172)">
            <g className="pallet" style={{ animationDelay: `${-i * 3}s`, transformBox: "view-box" }}>
              <Pallet tone={t} />
            </g>
          </g>
        ))
      )}

      {/* cleared badge after the gate */}
      <g transform="translate(560 96)">
        <circle r="20" fill="var(--green-tint)" />
        <circle r="13" fill="var(--green)" />
        <path d="M-6 0l4 4 8-9" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform="translate(150 96)">
        <circle r="20" fill="var(--amber-tint)" />
        <text y="5" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--amber-text)" fontFamily="inherit">?</text>
      </g>
    </svg>
  );
}

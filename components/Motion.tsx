"use client";

import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BookingStatus } from "@/lib/calculations";
import { statusClass, STATUS_LABEL } from "@/lib/ui";
import { AlertTriangle, Check, CircleHelp, X } from "lucide-react";

/** Fade/slide-up once when scrolled into view. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

/** Number that counts up when it enters the viewport. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(0, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(Math.round(v)) });
    return () => c.stop();
  }, [inView, value, reduce]);
  return <span ref={ref} className={className}>{reduce ? value : shown}</span>;
}

/** Animated status ring with an icon. */
export function StatusRing({ status, size = 56 }: { status: BookingStatus; size?: number }) {
  const reduce = useReducedMotion();
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const Icon = status === "RED" ? X : status === "INCOMPLETE" ? CircleHelp : status === "AMBER" ? AlertTriangle : Check;
  return (
    <span className={`${statusClass(status)} relative inline-flex items-center justify-center flex-none`} style={{ width: size, height: size }} role="img" aria-label={`Status: ${STATUS_LABEL[status]}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sev-tint)" strokeWidth={4} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sev)" strokeWidth={4} strokeLinecap="round"
          strokeDasharray={c}
          initial={reduce ? false : { strokeDashoffset: c }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <Icon aria-hidden size={size * 0.4} strokeWidth={2.6} style={{ color: "var(--sev-text)" }} />
    </span>
  );
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span className={`${statusClass(status)} sev-chip chip`}>
      <span className="sev-dot" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

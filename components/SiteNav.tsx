import Link from "next/link";
import { Ship } from "lucide-react";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#app", label: "Checker" },
  { href: "/#rules", label: "Rules" },
  { href: "/#carriers", label: "Carriers" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b hairline backdrop-blur-xl backdrop-saturate-150" style={{ background: "var(--nav-bg)" }}>
      <nav className="mx-auto flex h-12 max-w-[1080px] items-center justify-between px-4 sm:px-6" aria-label="Main">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Ship size={18} aria-hidden />
          Ship Eazy
        </Link>
        <ul className="flex items-center gap-4 text-[13px] text-muted sm:gap-7">
          {LINKS.map((l, i) => (
            <li key={l.href} className={i === 0 || i === 3 ? "hidden sm:block" : undefined}>
              <a href={l.href} className="transition-colors hover:text-fg">{l.label}</a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

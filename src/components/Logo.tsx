import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight" aria-label="CoachGG — accueil">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#151c2c" stroke="#2b3650" />
        <path d="M9 21 L15 11 L19 17 L23 13" fill="none" stroke="#4c9dff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="23" cy="13" r="2.2" fill="#34d399" />
      </svg>
      <span>CoachGG</span>
    </Link>
  );
}

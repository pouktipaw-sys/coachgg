import Link from "next/link";

/** Emblème CoachGG : hexagone néon (violet → magenta) avec une courbe de progression et un point cyan. */
export function LogoMark({ size = 32, uid = "x" }: { size?: number; uid?: string }) {
  // Identifiants SVG uniques par emplacement : un logo masqué (display:none) ne doit pas « voler » le dégradé des autres.
  const g = `cgg-g-${uid}`;
  const f = `cgg-glow-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#922eff" />
          <stop offset="1" stopColor="#d34aff" />
        </linearGradient>
        <filter id={f} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d="M20 2.5 35 11v18L20 37.5 5 29V11z" fill="#120d24" stroke={`url(#${g})`} strokeWidth="2.2" />
      <path d="M11.5 25.5 17.5 17l4.5 5.5 6.5-8.5" fill="none" stroke={`url(#${g})`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${f})`} />
      <circle cx="28.5" cy="14" r="2.6" fill="#59d5ff" filter={`url(#${f})`} />
    </svg>
  );
}

export function Logo({ href = "/", uid = "x" }: { href?: string; uid?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="CoachGG — accueil">
      <LogoMark uid={uid} />
      <span className="font-display text-lg font-bold tracking-wide">
        Coach<span className="text-gradient">GG</span>
      </span>
    </Link>
  );
}

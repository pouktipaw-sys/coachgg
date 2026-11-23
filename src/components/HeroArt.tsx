// Illustration originale (SVG) des sections « hero » : emblème hextech néon, couloirs de la Faille stylisés,
// lame et éclats lumineux. Décorative uniquement (aria-hidden). Aucun visuel Riot n'est utilisé.
export function HeroArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 320" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="ha-core" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#d34aff" stopOpacity="0.9" />
          <stop offset="0.45" stopColor="#922eff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#922eff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ha-line" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#922eff" />
          <stop offset="0.6" stopColor="#d34aff" />
          <stop offset="1" stopColor="#59d5ff" />
        </linearGradient>
        <linearGradient id="ha-blade" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#59d5ff" stopOpacity="0.15" />
          <stop offset="0.5" stopColor="#f5f2ff" />
          <stop offset="1" stopColor="#d34aff" stopOpacity="0.4" />
        </linearGradient>
        <filter id="ha-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Halo central */}
      <circle cx="230" cy="160" r="150" fill="url(#ha-core)" />
      {/* Carte stylisée : trois couloirs et la rivière */}
      <g stroke="#30234b" strokeWidth="1.2" fill="none" opacity="0.9">
        <path d="M95 270 L95 70 L295 70" />
        <path d="M95 270 L365 270 L365 70" />
        <path d="M95 270 L365 70" />
        <path d="M95 70 L365 270" strokeDasharray="3 6" stroke="#59d5ff" opacity="0.45" />
      </g>
      {/* Anneaux hexagonaux */}
      <g transform="translate(230 160)" fill="none" filter="url(#ha-glow)">
        <path d="M0 -96 83 -48 83 48 0 96 -83 48 -83 -48Z" stroke="url(#ha-line)" strokeWidth="2.4" opacity="0.95" />
        <path d="M0 -70 61 -35 61 35 0 70 -61 35 -61 -35Z" stroke="#922eff" strokeWidth="1.4" opacity="0.7" />
        <path d="M0 -44 38 -22 38 22 0 44 -38 22 -38 -22Z" stroke="#d34aff" strokeWidth="1.2" opacity="0.6" />
      </g>
      {/* Courbe de progression qui traverse l'emblème */}
      <path d="M140 222 L196 168 L232 196 L318 104" fill="none" stroke="url(#ha-line)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" filter="url(#ha-glow)" />
      <circle cx="318" cy="104" r="7" fill="#59d5ff" filter="url(#ha-glow)" />
      {/* Lame */}
      <g transform="rotate(-38 250 160)" filter="url(#ha-glow)">
        <path d="M250 28 L262 190 L250 206 L238 190 Z" fill="url(#ha-blade)" opacity="0.85" />
        <rect x="226" y="200" width="48" height="7" rx="3.5" fill="#922eff" />
        <rect x="246" y="207" width="8" height="34" rx="3" fill="#30234b" stroke="#922eff" />
      </g>
      {/* Éclats */}
      <g fill="#f5f2ff" filter="url(#ha-glow)">
        <circle cx="120" cy="96" r="2" />
        <circle cx="352" cy="230" r="2.4" fill="#d34aff" />
        <circle cx="300" cy="44" r="1.6" fill="#59d5ff" />
        <circle cx="160" cy="262" r="1.8" fill="#c48bff" />
        <circle cx="384" cy="132" r="1.4" />
      </g>
    </svg>
  );
}

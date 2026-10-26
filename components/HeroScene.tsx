/**
 * Original SVG: a container ship sails across a sunset sea while a plane crosses the sky.
 * Pure SVG + CSS keyframes (transforms and opacity only); colours come from --scene-* tokens so it
 * turns into a dusk/night scene in dark mode. Decorative: hidden from screen readers.
 */

const W = 1440;
const SUN_X = 860;

/** A seamless wave band: whole wavelengths over 2×W so a −W translate loops without a seam. */
function wavePath(y: number, amp: number, wl: number, bottom = 800) {
  let d = `M0 ${y}`;
  for (let x = 0; x < W * 2; x += wl) d += ` Q${x + wl / 4} ${y - amp} ${x + wl / 2} ${y} T${x + wl} ${y}`;
  return `${d} L${W * 2} ${bottom} L0 ${bottom} Z`;
}

const CONTAINERS = ["#ff3b30", "#ff9f0a", "#34c759", "#0a84ff", "#ffd60a", "#8e8e93", "#ff6b5e", "#30b0c7"];

function Ship() {
  // hull 0…420 wide, deck at y=0, waterline at y=44; bow on the right
  const stacks = [];
  for (let col = 0; col < 9; col++) {
    const h = [3, 2, 3, 3, 2, 3, 2, 3, 2][col];
    for (let row = 0; row < h; row++) {
      stacks.push(<rect key={`${col}-${row}`} x={96 + col * 30} y={-16 - row * 15} width="28" height="14" rx="1.5" fill={CONTAINERS[(col * 3 + row * 5) % CONTAINERS.length]} />);
    }
  }
  return (
    <g className="ship-bob">
      {/* wake behind the stern */}
      <g className="ship-wake">
        <ellipse cx="-30" cy="46" rx="70" ry="4" fill="var(--scene-foam)" opacity="0.55" />
        <ellipse cx="-120" cy="48" rx="90" ry="3" fill="var(--scene-foam)" opacity="0.35" />
        <ellipse cx="-230" cy="50" rx="110" ry="2.5" fill="var(--scene-foam)" opacity="0.2" />
      </g>
      {/* containers, toned down as if backlit by the sun */}
      <g style={{ filter: "saturate(0.75) brightness(0.8)" }}>{stacks}</g>
      {/* bridge and funnel at the stern */}
      <rect x="22" y="-58" width="54" height="58" rx="3" fill="var(--scene-hull-top)" />
      <rect x="16" y="-66" width="66" height="10" rx="2" fill="var(--scene-hull-top)" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} className="ship-window" style={{ animationDelay: `${i * 0.7}s` }} x={22 + i * 12} y="-62" width="8" height="4" rx="1" fill="var(--scene-window)" />)}
      {[0, 1, 2].map((i) => <rect key={i} x="30" y={-46 + i * 12} width="38" height="3" rx="1" fill="var(--scene-window)" opacity="0.55" />)}
      <rect x="40" y="-88" width="18" height="24" rx="2" fill="var(--scene-hull-top)" />
      <rect x="40" y="-84" width="18" height="5" fill="#ff3b30" />
      {/* smoke */}
      {[0, 1, 2].map((i) => <circle key={i} className="ship-smoke" style={{ animationDelay: `${i * 1.6}s` }} cx="49" cy="-94" r="7" fill="var(--scene-smoke)" />)}
      {/* mast + lights */}
      <path d="M392 0 V-40" stroke="var(--scene-hull-top)" strokeWidth="3" />
      <circle className="blink" cx="392" cy="-42" r="3" fill="#ffffff" />
      <circle className="blink" style={{ animationDelay: "0.9s" }} cx="48" cy="-92" r="2.5" fill="#ff453a" />
      {/* hull */}
      <path d="M0 0 H404 Q430 2 438 0 L414 44 H26 Q10 40 0 0 Z" fill="var(--scene-hull)" />
      <path d="M8 30 H426 L414 44 H26 Q14 40 8 30 Z" fill="#c8312b" opacity="0.85" />
      <path d="M0 0 H438" stroke="var(--scene-hull-top)" strokeWidth="3" />
      <text x="330" y="22" fontSize="11" fontWeight="700" letterSpacing="2" fill="var(--scene-foam)" opacity="0.7">PRE-FLIGHT</text>
    </g>
  );
}

function Plane() {
  return (
    <g className="plane">
      {/* contrail fades out behind the tail */}
      <path d="M-260 6 H-2" stroke="url(#contrail)" strokeWidth="3" strokeLinecap="round" />
      <path d="M0 4 L46 2 Q56 3 58 6 Q56 9 46 9 L0 8 Z" fill="var(--scene-plane)" />
      <path d="M22 6 L10 -10 H16 L34 5 Z M22 7 L12 20 H18 L34 8 Z" fill="var(--scene-plane)" />
      <path d="M0 4 L-6 -6 H0 L8 4 Z" fill="var(--scene-plane)" />
      <circle className="blink" cx="12" cy="-9" r="1.8" fill="#ff453a" />
    </g>
  );
}

function Port() {
  // far-off harbour on the horizon: cranes and sheds
  return (
    <g fill="var(--scene-far)" opacity="0.85">
      <rect x="40" y="538" width="120" height="22" />
      <rect x="170" y="530" width="60" height="30" />
      <rect x="236" y="544" width="90" height="16" />
      {[90, 200, 300].map((x, i) => (
        <g key={x} transform={`translate(${x} ${508 - i * 4})`}>
          <path d="M0 52 V0 M14 52 V0 M-2 0 H70 M0 8 L58 0" stroke="var(--scene-far)" strokeWidth="3" fill="none" />
          <rect x="44" y="0" width="4" height="18" />
        </g>
      ))}
      <rect x="1270" y="534" width="14" height="26" />
      <path d="M1268 534 L1277 516 L1286 534 Z" />
      <circle className="lighthouse" cx="1277" cy="524" r="3" fill="#ffe6a8" />
    </g>
  );
}

export function HeroScene() {
  const stars = Array.from({ length: 46 }, (_, i) => ({ x: (i * 397) % W, y: (i * 151) % 360 + 10, r: (i % 3) * 0.5 + 0.6, d: (i % 7) * 0.6 }));
  return (
    <div aria-hidden className="hero-scene pointer-events-none absolute inset-0">
      <svg viewBox="0 0 1440 800" preserveAspectRatio="xMidYMax slice" className="h-full w-full">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--scene-sky-top)" />
            <stop offset="0.45" stopColor="var(--scene-sky-mid)" />
            <stop offset="0.6" stopColor="var(--scene-sky-low)" />
            <stop offset="0.7" stopColor="var(--scene-horizon)" />
          </linearGradient>
          <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--scene-sea-top)" />
            <stop offset="1" stopColor="var(--scene-sea-deep)" />
          </linearGradient>
          <radialGradient id="sunglow">
            <stop offset="0" stopColor="var(--scene-sun-glow)" />
            <stop offset="1" stopColor="var(--scene-sun-glow)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="contrail" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.7" />
          </linearGradient>
          <filter id="soft" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="7" /></filter>
          <clipPath id="above-horizon"><rect width="1440" height="560" /></clipPath>
        </defs>

        <rect width="1440" height="800" fill="url(#sky)" />
        <g className="scene-stars">
          {stars.map((s, i) => <circle key={i} className="star" style={{ animationDelay: `${s.d}s` }} cx={s.x} cy={s.y} r={s.r} fill="#fff" />)}
        </g>

        {/* sun, slowly settling, half under the horizon */}
        <g clipPath="url(#above-horizon)">
          <circle className="sun-glow" cx={SUN_X} cy="560" r="260" fill="url(#sunglow)" />
          <circle className="sun" cx={SUN_X} cy="560" r="78" fill="var(--scene-sun)" />
        </g>

        {/* drifting clouds */}
        <g className="cloud cloud-a" fill="var(--scene-cloud)" filter="url(#soft)">
          <ellipse cx="300" cy="180" rx="140" ry="14" /><ellipse cx="360" cy="168" rx="80" ry="12" />
        </g>
        <g className="cloud cloud-b" fill="var(--scene-cloud)" filter="url(#soft)">
          <ellipse cx="1100" cy="250" rx="180" ry="12" /><ellipse cx="1040" cy="240" rx="90" ry="10" />
        </g>
        <g className="cloud cloud-c" fill="var(--scene-cloud)" opacity="0.7" filter="url(#soft)">
          <ellipse cx="700" cy="120" rx="120" ry="9" />
        </g>

        {/* birds */}
        <g className="birds" fill="none" stroke="var(--scene-far)" strokeWidth="2" strokeLinecap="round">
          <path className="wing" d="M0 0 Q6 -6 12 0 Q18 -6 24 0" />
          <path className="wing" style={{ animationDelay: "0.3s" }} d="M34 12 Q39 7 44 12 Q49 7 54 12" />
        </g>

        <g transform="translate(0 170)"><Plane /></g>

        <Port />

        {/* sea */}
        <rect y="560" width="1440" height="240" fill="url(#sea)" />
        <g>
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} className="glint" style={{ animationDelay: `${(i % 5) * 0.45}s` }}
              x={SUN_X - (90 - i * 5) / 2 + ((i * 37) % 30) - 15} y={568 + i * 15} width={90 - i * 5} height="3" rx="1.5" fill="var(--scene-sun)" />
          ))}
        </g>

        <g className="wave wave-back"><path d={wavePath(600, 6, 180)} fill="var(--scene-wave-1)" opacity="0.7" /></g>

        <g className="ship-sail"><g transform="translate(0 640) scale(0.72)"><Ship /></g></g>

        <g className="wave wave-mid"><path d={wavePath(650, 10, 240)} fill="var(--scene-wave-2)" opacity="0.85" /></g>
        <g className="wave wave-front"><path d={wavePath(735, 14, 360)} fill="var(--scene-wave-3)" /></g>
        {/* the page itself rises out of the sea */}
        <g className="wave wave-page"><path d={wavePath(778, 10, 480)} fill="var(--bg-alt)" /></g>
      </svg>
    </div>
  );
}

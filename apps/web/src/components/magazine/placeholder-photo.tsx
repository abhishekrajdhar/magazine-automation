import * as React from "react";
import { mulberry32 } from "@/lib/utils/random";
import type { AdCreative } from "@/lib/demo/assets";

/**
 * Procedural stand-in for event photography. Deterministic per seed, drawn as
 * duotone scenes (stage, panel, audience, portrait…) so layouts read
 * realistically without pretending to be real photographs.
 */

const palettes = [
  { sky: ["#0d1b3a", "#1f3c7a"], stage: "#0a1226", glow: "#6aa8ff", warm: "#e9b872", figure: "#0a0f1c" },
  { sky: ["#2a1630", "#6b2f4a"], stage: "#160b1a", glow: "#ff9e7a", warm: "#ffd29a", figure: "#120812" },
  { sky: ["#0e2a2a", "#1d5a57"], stage: "#071717", glow: "#7fe0d0", warm: "#f3d48b", figure: "#061010" },
  { sky: ["#1c1f2b", "#3b4560"], stage: "#0e1018", glow: "#b6c6ff", warm: "#f0c27a", figure: "#0b0c12" },
  { sky: ["#2b1d0e", "#6b4520"], stage: "#160f07", glow: "#ffcf86", warm: "#ffe3b3", figure: "#120c05" },
];

interface Props {
  seed: number;
  tag: string;
  className?: string;
  style?: React.CSSProperties;
  /** Show a small "Placeholder" label (used in libraries, hidden on composed pages). */
  label?: boolean;
  preserveAspectRatio?: string;
}

function Figure({ x, y, s, color, seated = false }: { x: number; y: number; s: number; color: string; seated?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={color}>
      <circle cx="0" cy="-58" r="11" />
      <path d={seated ? "M-16 -44 Q0 -50 16 -44 L20 -10 L28 -8 L28 0 L-10 0 L-14 -10 Z" : "M-17 -44 Q0 -50 17 -44 L21 0 L-21 0 Z"} />
    </g>
  );
}

function Heads({ y, count, seed, color, scale = 1 }: { y: number; count: number; seed: number; color: string; scale?: number }) {
  // Each child owns its generator so React's double render in dev stays deterministic.
  const rand = mulberry32(seed);
  return (
    <g fill={color}>
      {Array.from({ length: count }, (_, i) => {
        const x = (i / count) * 420 - 10 + rand() * 18;
        const r = (9 + rand() * 4) * scale;
        return (
          <g key={i}>
            <circle cx={x} cy={y - r * 1.6 + rand() * 4} r={r} />
            <rect x={x - r * 1.5} y={y - r * 0.6} width={r * 3} height={r * 3} rx={r} />
          </g>
        );
      })}
    </g>
  );
}

export function PlaceholderPhoto({ seed, tag, className, style, label, preserveAspectRatio = "xMidYMid slice" }: Props) {
  const rand = mulberry32(seed);
  const pal = palettes[seed % palettes.length];
  const id = `pp${seed}`;
  const screenHue = rand() > 0.5;

  let scene: React.ReactNode;
  switch (tag) {
    case "portrait": {
      const bg = ["#d9dde6", "#e6e0d6", "#d6e2df", "#e3dbe6"][seed % 4];
      const tone = ["#3b4252", "#4a3f35", "#2f3e3c", "#433a4a"][seed % 4];
      scene = (
        <>
          <rect width="400" height="300" fill={bg} />
          <rect width="400" height="300" fill={`url(#${id}v)`} />
          <g fill={tone}>
            <ellipse cx="200" cy="120" rx="46" ry="54" />
            <path d="M92 300 Q100 196 200 186 Q300 196 308 300 Z" />
          </g>
          <path d="M176 186 L200 230 L224 186" fill="#f4f1ea" opacity="0.85" />
        </>
      );
      break;
    }
    case "audience":
      scene = (
        <>
          <rect width="400" height="300" fill={`url(#${id}s)`} />
          <rect x="110" y="40" width="180" height="90" rx="3" fill={pal.glow} opacity="0.55" />
          <rect x="60" y="150" width="280" height="14" fill={pal.stage} opacity="0.8" />
          <Heads y={230} count={14} seed={seed * 3 + 1} color={pal.figure} />
          <Heads y={275} count={11} seed={seed * 3 + 2} color={pal.figure} scale={1.35} />
          <Heads y={315} count={9} seed={seed * 3 + 3} color={pal.figure} scale={1.7} />
        </>
      );
      break;
    case "panel":
      scene = (
        <>
          <rect width="400" height="300" fill={`url(#${id}s)`} />
          <rect x="30" y="34" width="340" height="120" rx="2" fill={pal.glow} opacity="0.35" />
          <rect x="30" y="34" width="340" height="120" rx="2" fill={`url(#${id}g)`} />
          <rect x="0" y="210" width="400" height="90" fill={pal.stage} />
          {[0, 1, 2, 3].map((i) => (
            <Figure key={i} x={90 + i * 74 + rand() * 6} y={212} s={0.95} color={pal.figure} seated />
          ))}
          <rect x="70" y="205" width="260" height="6" fill={pal.warm} opacity="0.5" />
        </>
      );
      break;
    case "speaker":
      scene = (
        <>
          <rect width="400" height="300" fill={`url(#${id}s)`} />
          {Array.from({ length: 7 }, (_, i) => (
            <circle key={i} cx={40 + rand() * 320} cy={30 + rand() * 120} r={10 + rand() * 26} fill={pal.glow} opacity={0.08 + rand() * 0.14} />
          ))}
          <Figure x={screenHue ? 230 : 170} y={250} s={2.6} color={pal.figure} />
          <path d={`M${screenHue ? 150 : 210} 300 L${screenHue ? 170 : 230} 198 L${screenHue ? 238 : 298} 198 L${screenHue ? 258 : 318} 300 Z`} fill={pal.stage} />
          <rect x={screenHue ? 182 : 242} y="190" width="44" height="8" fill={pal.warm} opacity="0.6" />
        </>
      );
      break;
    case "award":
      scene = (
        <>
          <rect width="400" height="300" fill={`url(#${id}s)`} />
          {Array.from({ length: 30 }, (_, i) => (
            <rect key={i} x={rand() * 400} y={rand() * 170} width="3" height="7" fill={i % 2 ? pal.warm : pal.glow} opacity="0.7" transform={`rotate(${rand() * 90} ${rand() * 400} ${rand() * 170})`} />
          ))}
          <rect x="0" y="230" width="400" height="70" fill={pal.stage} />
          {[0, 1, 2, 3, 4].map((i) => (
            <Figure key={i} x={80 + i * 60} y={240} s={1.15} color={pal.figure} />
          ))}
          <path d="M196 150 L212 150 L208 176 L200 180 L192 176 Z" fill={pal.warm} />
        </>
      );
      break;
    case "networking":
    case "exhibition":
    case "venue":
      scene = (
        <>
          <rect width="400" height="300" fill={tag === "venue" ? `url(#${id}d)` : `url(#${id}s)`} />
          {tag !== "networking" &&
            [0, 1, 2].map((i) => (
              <g key={i}>
                <rect x={20 + i * 130} y={70 + rand() * 20} width="110" height="90" fill={pal.stage} opacity="0.65" />
                <rect x={30 + i * 130} y={84 + rand() * 20} width="90" height="24" fill={pal.glow} opacity="0.45" />
              </g>
            ))}
          <rect x="0" y="235" width="400" height="65" fill={pal.stage} opacity="0.45" />
          {Array.from({ length: tag === "networking" ? 6 : 8 }, (_, i) => (
            <Figure key={i} x={30 + i * (tag === "networking" ? 62 : 48) + rand() * 20} y={262 + rand() * 18} s={tag === "networking" ? 1.9 : 1.2} color={pal.figure} />
          ))}
        </>
      );
      break;
    default:
      scene = (
        <>
          <rect width="400" height="300" fill={`url(#${id}s)`} />
          <rect x="70" y="30" width="260" height="130" rx="2" fill={pal.glow} opacity="0.5" />
          <rect x="70" y="30" width="260" height="130" rx="2" fill={`url(#${id}g)`} />
          <rect x="0" y="200" width="400" height="100" fill={pal.stage} />
          <path d="M180 200 L188 150 L212 150 L220 200 Z" fill={pal.figure} />
          <Figure x={200} y={150} s={0.8} color={pal.figure} />
          {Array.from({ length: 5 }, (_, i) => (
            <path key={i} d={`M${40 + i * 80} 0 L${20 + i * 80 + rand() * 40} 200 L${60 + i * 80 + rand() * 40} 200 Z`} fill={pal.warm} opacity="0.06" />
          ))}
        </>
      );
  }

  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio={preserveAspectRatio} className={className} style={style} role="img" aria-label={`Placeholder image (${tag})`}>
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={pal.sky[1]} />
          <stop offset="1" stopColor={pal.sky[0]} />
        </linearGradient>
        <linearGradient id={`${id}d`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c8d2e0" />
          <stop offset="1" stopColor={pal.sky[1]} />
        </linearGradient>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}v`} cx="0.5" cy="0.4" r="0.8">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.18" />
        </radialGradient>
      </defs>
      {scene}
      <rect width="400" height="300" fill={`url(#${id}v)`} />
      {label && (
        <g>
          <rect x="8" y="270" width="76" height="20" rx="3" fill="#000" opacity="0.45" />
          <text x="46" y="284" textAnchor="middle" fontSize="10" fontFamily="system-ui, sans-serif" fill="#fff">
            Placeholder
          </text>
        </g>
      )}
    </svg>
  );
}

/** Advertisement slot placeholder, drawn from the booked advertiser's details. */
export function AdPlaceholder({ creative, className }: { creative: AdCreative; className?: string }) {
  return (
    <div className={className} style={{ background: creative.ground, color: creative.ink, position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "11% 10% 9%", fontFamily: "var(--font-inter)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 28, height: 28, background: creative.accent, transform: "rotate(45deg)", borderRadius: 3 }} />
        <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>{creative.brand}</div>
      </div>
      <div>
        <div style={{ width: 54, height: 4, background: creative.accent, marginBottom: 18 }} />
        <div style={{ fontFamily: "var(--font-source-serif)", fontSize: 44, lineHeight: 1.04, fontWeight: 600, letterSpacing: "-0.02em" }}>{creative.tagline}</div>
        <div style={{ marginTop: 16, fontSize: 12, opacity: 0.8, letterSpacing: "0.02em" }}>{creative.body}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, opacity: 0.55, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        <span>Advertisement</span>
        <span>Ad placeholder · creative not yet supplied</span>
      </div>
    </div>
  );
}

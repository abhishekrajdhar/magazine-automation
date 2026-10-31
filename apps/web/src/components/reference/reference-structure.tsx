import * as React from "react";
import type { LayoutBlock, ReferencePage } from "@/lib/domain/types";

/** Colour key for detected block roles, used by overlays and legends. */
export const ROLE_COLORS: Record<string, string> = {
  image: "#2f80ed",
  headline: "#d9402f",
  deck: "#e07b39",
  kicker: "#b7791f",
  body: "#4a5568",
  pullquote: "#8e44ad",
  caption: "#16a085",
  folio: "#7f8c8d",
  byline: "#a0522d",
  stat: "#c0392b",
  question: "#2c3e50",
  subhead: "#d35400",
};

interface Props {
  page: Pick<ReferencePage, "blocks" | "widthPt" | "heightPt">;
  width: number;
  /** Tint blocks by role instead of drawing a neutral wireframe. */
  overlay?: boolean;
  highlightRole?: string | null;
  className?: string;
}

/**
 * Renders the layout structure detected on a reference page: image regions,
 * text blocks drawn as lines at their detected size, rules and folios.
 */
export function ReferenceStructure({ page, width, overlay, highlightRole, className }: Props) {
  const W = page.widthPt;
  const H = page.heightPt;
  const height = (width * H) / W;
  const id = React.useId().replace(/:/g, "");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width} height={height} className={className} role="img" aria-label="Detected page structure">
      <defs>
        <pattern id={`${id}h`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#e8ecf3" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#c9d1de" strokeWidth="3" />
        </pattern>
        <clipPath id={`${id}c`}>
          <rect width={W} height={H} />
        </clipPath>
      </defs>
      <rect width={W} height={H} fill="#fff" />
      <g clipPath={`url(#${id}c)`}>
        {page.blocks.map((b) => (
          <Block key={b.id} b={b} W={W} H={H} hatch={`url(#${id}h)`} overlay={overlay} dim={!!highlightRole && (b.role ?? b.kind) !== highlightRole} />
        ))}
      </g>
    </svg>
  );
}

function Block({ b, W, H, hatch, overlay, dim }: { b: LayoutBlock; W: number; H: number; hatch: string; overlay?: boolean; dim: boolean }) {
  const x = b.x * W;
  const y = b.y * H;
  const w = b.w * W;
  const h = b.h * H;
  const role = b.role ?? b.kind;
  const color = ROLE_COLORS[role] ?? "#4a5568";
  const opacity = dim ? 0.18 : 1;

  if (b.kind === "image") {
    return (
      <g opacity={opacity}>
        <rect x={x} y={y} width={w} height={h} fill={overlay ? `${ROLE_COLORS.image}22` : hatch} stroke={overlay ? ROLE_COLORS.image : "#b8c2d3"} strokeWidth={overlay ? 1.5 : 0.75} />
        <path d={`M${x + w / 2 - 10} ${y + h / 2 + 7} l7 -9 l5 6 l4 -4 l8 7 z`} fill={overlay ? ROLE_COLORS.image : "#9aa6ba"} />
      </g>
    );
  }
  if (b.kind === "rule" || b.kind === "shape") {
    return <rect x={x} y={y} width={w} height={Math.max(1, h)} fill={overlay ? color : "#14213d"} opacity={opacity} />;
  }

  const size = b.fontSize ?? 9;
  const lineGap = Math.max(size * 1.3, 4);
  const barH = role === "headline" || role === "stat" ? size * 0.72 : Math.max(1.4, size * 0.42);
  const lines = Math.max(1, Math.floor(h / lineGap));
  const fill = overlay ? color : role === "headline" || role === "stat" ? "#14213d" : role === "kicker" || role === "pullquote" ? (b.color ?? "#1e4fc2") : "#9aa3b2";
  return (
    <g opacity={opacity}>
      {overlay && <rect x={x - 1} y={y - 1} width={w + 2} height={h + 2} fill={`${color}12`} stroke={color} strokeWidth="0.75" strokeDasharray="3 2" />}
      {Array.from({ length: Math.min(lines, 80) }, (_, i) => {
        const last = i === lines - 1 && lines > 1;
        const lw = last ? w * (0.45 + ((i * 37) % 40) / 100) : role === "headline" ? w * (i === lines - 1 ? 0.6 : 0.96) : w;
        return <rect key={i} x={x} y={y + i * lineGap + (lineGap - barH) / 2} width={Math.max(4, lw)} height={barH} rx={barH / 2} fill={fill} opacity={role === "body" || role === "caption" ? 0.75 : 1} />;
      })}
    </g>
  );
}

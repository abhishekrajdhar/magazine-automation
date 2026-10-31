import type { DesignProfile } from "@/lib/domain/types";

export interface LiveArea {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Odd page numbers are right-hand (recto) pages. */
  recto: boolean;
}

export function liveArea(profile: DesignProfile, pageNumber: number): LiveArea {
  const { top, bottom, inside, outside } = profile.margins;
  const recto = pageNumber % 2 === 1;
  const left = recto ? inside : outside;
  const right = recto ? outside : inside;
  return {
    x: left,
    y: top,
    w: profile.page.widthPt - left - right,
    h: profile.page.heightPt - top - bottom,
    recto,
  };
}

export interface ColumnGrid {
  starts: number[];
  ends: number[];
  colWidth: number;
}

export function columnGrid(profile: DesignProfile, la: LiveArea): ColumnGrid {
  const n = Math.max(1, profile.grid.columns);
  const g = profile.grid.gutterPt;
  const colWidth = (la.w - g * (n - 1)) / n;
  const starts = Array.from({ length: n }, (_, i) => la.x + i * (colWidth + g));
  return { starts, ends: starts.map((s) => s + colWidth), colWidth };
}

function nearestIndex(values: number[], target: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (Math.abs(values[i] - target) < Math.abs(values[best] - target)) best = i;
  }
  return best;
}

/**
 * Snap a horizontal span (fractions of the live area) to the profile's column
 * grid, so one template adapts to 2-, 3- or 4-column references.
 */
export function snapToColumns(profile: DesignProfile, la: LiveArea, fx: number, fw: number): { x: number; w: number; columns: number } {
  const grid = columnGrid(profile, la);
  const rawStart = la.x + fx * la.w;
  const rawEnd = la.x + (fx + fw) * la.w;
  const si = nearestIndex(grid.starts, rawStart);
  let ei = nearestIndex(grid.ends, rawEnd);
  if (ei < si) ei = si;
  return { x: grid.starts[si], w: grid.ends[ei] - grid.starts[si], columns: ei - si + 1 };
}

/** Rough words-that-fit estimate used to paginate article text before rendering. */
export function estimateWordCapacity(w: number, h: number, columns: number, gutter: number, fontSize: number, leading: number): number {
  const cols = Math.max(1, columns);
  const colWidth = (w - gutter * (cols - 1)) / cols;
  if (colWidth <= 0 || h <= 0) return 0;
  const charsPerLine = colWidth / (fontSize * 0.48);
  const lines = Math.floor(h / leading);
  const words = (cols * lines * charsPerLine) / 6.0;
  // Paragraph breaks, subheads and widows eat roughly a tenth of the space.
  return Math.max(0, Math.floor(words * 0.88));
}

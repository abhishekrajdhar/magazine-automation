"use client";

import * as React from "react";
import type { ActivityItem } from "@/lib/domain/types";

const DAYS = 14;

/** Single-series bar chart of workspace events per day, derived from the activity log. */
export function ActivityChart({ activity }: { activity: ActivityItem[] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const data = React.useMemo(() => {
    const latest = activity.reduce((m, a) => Math.max(m, new Date(a.at).getTime()), Date.now());
    const end = new Date(latest);
    end.setHours(0, 0, 0, 0);
    return Array.from({ length: DAYS }, (_, i) => {
      const day = new Date(end);
      day.setDate(end.getDate() - (DAYS - 1 - i));
      const next = new Date(day);
      next.setDate(day.getDate() + 1);
      const items = activity.filter((a) => {
        const t = new Date(a.at).getTime();
        return t >= day.getTime() && t < next.getTime();
      });
      return { day, count: items.length, items };
    });
  }, [activity]);

  const max = Math.max(4, ...data.map((d) => d.count));
  const W = 320;
  const H = 120;
  const pad = { l: 18, r: 4, t: 8, b: 18 };
  const slot = (W - pad.l - pad.r) / DAYS;
  const barW = Math.min(14, slot - 4);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const total = data.reduce((n, d) => n + d.count, 0);
  const ticks = [0, Math.round(max / 2), max];

  return (
    <div className="relative">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="tabular text-xl font-semibold tracking-[-0.02em]">{total}</span>
        <span className="text-xs text-ink-3">events in the last 14 days</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Bar chart: ${total} workspace events over the last 14 days`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray={t === 0 ? undefined : "2 3"} />
            <text x={pad.l - 5} y={y(t) + 3} textAnchor="end" fontSize="8" fill="var(--color-ink-4)">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * slot + (slot - barW) / 2;
          const h = Math.max(0, y(0) - y(d.count));
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
              {d.count > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(d.count) + r} Q${x},${y(d.count)} ${x + r},${y(d.count)} H${x + barW - r} Q${x + barW},${y(d.count)} ${x + barW},${y(d.count) + r} V${y(0)} Z`}
                  fill="var(--color-accent)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {(i % 3 === 1 || i === DAYS - 1) && (
                <text x={x + barW / 2} y={H - 5} textAnchor="middle" fontSize="8" fill="var(--color-ink-4)">
                  {d.day.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-md border border-line bg-surface p-2.5 text-xs shadow-md"
          style={{ left: `${Math.min(55, Math.max(0, ((hover + 0.5) / DAYS) * 100 - 20))}%`, top: 34 }}
        >
          <div className="flex justify-between font-medium text-ink">
            <span>{data[hover].day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
            <span className="tabular">{data[hover].count} events</span>
          </div>
          {data[hover].items.slice(0, 3).map((a) => (
            <p key={a.id} className="mt-1 truncate text-ink-3">
              {a.verb} {a.target}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

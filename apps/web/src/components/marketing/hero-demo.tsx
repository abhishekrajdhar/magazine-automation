"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, CircleCheck, Quote } from "lucide-react";
import { SourceGlyph } from "@/components/shell/logo";
import { PageView } from "@/components/magazine/page-view";
import { formatDuration } from "@/lib/utils/format";
import { useDemoPreview } from "./demo-preview";

/** Product demonstration: recordings → sourced quotes → a composed spread. */
export function HeroDemo() {
  const demo = useDemoPreview();
  const lines = React.useMemo(() => demo.segments.filter((s) => s.videoId === "v01").slice(2, 7), [demo.segments]);
  const [active, setActive] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % lines.length), 2600);
    return () => clearInterval(t);
  }, [lines.length]);

  const stage = React.useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = React.useState(800);
  React.useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStageWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(0.47, (stageWidth - 32) / (2 * demo.profile.page.widthPt));
  const spread = [5, 6];

  return (
    <div className="relative mx-auto max-w-[1160px] rounded-xl border border-line bg-surface p-2 shadow-[0_40px_80px_-30px_rgba(14,23,38,0.35)]">
      <div className="flex items-center gap-1.5 px-2 pb-2 pt-1">
        <span className="size-2.5 rounded-full bg-[#e5e2da]" />
        <span className="size-2.5 rounded-full bg-[#e5e2da]" />
        <span className="size-2.5 rounded-full bg-[#e5e2da]" />
        <span className="ml-3 text-[11px] text-ink-4">PressFlow · National eGovernance Summit 2026 Special (demo workspace)</span>
      </div>
      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-line lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col border-b border-line bg-subtle lg:border-b-0 lg:border-r">
          <div className="border-b border-line px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-4">Recordings</p>
          </div>
          <ul className="divide-y divide-line">
            {demo.videos.slice(0, 3).map((v, i) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                <SourceGlyph type={v.sourceType} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">{v.title.split("—")[1]?.trim() ?? v.title}</p>
                  <p className="text-[11px] text-ink-4">{formatDuration(v.durationSec)} · transcript ready</p>
                </div>
                {i === 0 && <span className="size-1.5 rounded-full bg-success-dot" />}
              </li>
            ))}
          </ul>
          <div className="border-y border-line px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-4">Transcript · Inaugural session</p>
          </div>
          <div className="flex-1 space-y-1 px-2 py-2">
            {lines.map((l, i) => (
              <div key={l.id} className={`rounded-md px-2 py-1.5 transition-colors duration-500 ${i === active ? "bg-accent-soft" : ""}`}>
                <p className="flex items-center gap-1.5 text-[10px] text-ink-4">
                  <span className="tabular font-mono">{formatDuration(l.start)}</span> · {l.speakerLabel}
                </p>
                <p className={`mt-0.5 line-clamp-2 text-[11.5px] leading-snug ${i === active ? "text-ink" : "text-ink-3"}`}>{l.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div ref={stage} className="canvas-backdrop relative flex min-h-[260px] items-center justify-center overflow-hidden p-4 sm:min-h-[460px] sm:p-6">
          <div className="flex shadow-page">
            {spread.map((i) => (
              <PageView key={i} page={demo.pages[i]} profile={demo.profile} assets={demo.assets} ctx={demo.ctx(i)} scale={scale} />
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35 }}
              className="absolute bottom-5 right-5 hidden w-[290px] rounded-lg border border-line bg-surface/95 p-3 shadow-md backdrop-blur md:block"
            >
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-success">
                <CircleCheck className="size-3.5" /> Quote verified against transcript
              </p>
              <p className="mt-1.5 flex gap-1.5 font-serif text-[13px] leading-snug text-ink">
                <Quote className="mt-0.5 size-3 shrink-0 text-accent" />
                {lines[active]?.text.split(". ")[0]}.
              </p>
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-4">
                {lines[active]?.speakerLabel} · {formatDuration(lines[active]?.start)} <ArrowRight className="size-3" /> page 6
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

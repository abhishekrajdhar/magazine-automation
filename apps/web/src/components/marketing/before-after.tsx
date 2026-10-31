"use client";

import * as React from "react";
import { MoveHorizontal } from "lucide-react";
import { PageView } from "@/components/magazine/page-view";
import { ReferenceStructure } from "@/components/reference/reference-structure";
import { useDemoPreview } from "./demo-preview";

/** Drag to compare the reference page's detected structure with the generated page. */
export function BeforeAfter() {
  const demo = useDemoPreview();
  const [pos, setPos] = React.useState(52);
  const box = React.useRef<HTMLDivElement>(null);
  const width = 420;
  const scale = width / demo.profile.page.widthPt;
  const height = demo.profile.page.heightPt * scale;
  const reference = demo.referencePages.find((p) => p.pageNumber === 6)!;

  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div className="flex flex-col items-center">
      <div
        ref={box}
        className="relative touch-none select-none overflow-hidden rounded-[2px] shadow-page"
        style={{ width, height, maxWidth: "100%" }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          move(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && move(e.clientX)}
        role="slider"
        aria-label="Compare reference structure and generated page"
        aria-valuenow={Math.round(pos)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 4));
          if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 4));
        }}
      >
        <div className="absolute inset-0">
          <PageView page={demo.pages[5]} profile={demo.profile} assets={demo.assets} ctx={demo.ctx(5)} scale={scale} />
        </div>
        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <ReferenceStructure page={reference} width={width} overlay />
        </div>
        <div className="absolute inset-y-0 w-px bg-white shadow-[0_0_0_1px_rgba(14,23,38,0.25)]" style={{ left: `${pos}%` }}>
          <div className="absolute top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-ink shadow-md">
            <MoveHorizontal className="size-4" />
          </div>
        </div>
        <span className="absolute left-3 top-3 rounded bg-navy/85 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-white">Reference structure · p.6</span>
        <span className="absolute right-3 top-3 rounded bg-white/90 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-ink">Generated · p.6</span>
      </div>
      <p className="mt-4 max-w-md text-center text-xs text-ink-4">Drag to compare. Left: layout blocks detected on the reference. Right: the new page composed into the reconstructed template — live text and frames, rendered in your browser.</p>
    </div>
  );
}

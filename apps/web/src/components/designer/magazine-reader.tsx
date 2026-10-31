"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useProjectData } from "@/lib/store/hooks";
import { PageView } from "@/components/magazine/page-view";
import { Button } from "@/components/ui/button";

/** Full-screen spread-by-spread preview of the whole issue. */
export function MagazineReader({ open, onOpenChange, startIndex = 0 }: { open: boolean; onOpenChange: (o: boolean) => void; startIndex?: number }) {
  const data = useProjectData();
  const { pages, profile, assetsById } = data;
  const spreads = React.useMemo(() => {
    const out: number[][] = [[0]];
    for (let i = 1; i < pages.length; i += 2) out.push(i + 1 < pages.length ? [i, i + 1] : [i]);
    return out;
  }, [pages.length]);
  const startSpread = Math.max(0, spreads.findIndex((s) => s.includes(startIndex)));
  const [spread, setSpread] = React.useState(startSpread);
  const [size, setSize] = React.useState({ w: 1200, h: 800 });
  React.useEffect(() => {
    if (open) setSpread(startSpread);
  }, [open, startSpread]);
  React.useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setSpread((s) => Math.min(spreads.length - 1, s + 1));
      if (e.key === "ArrowLeft") setSpread((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, spreads.length]);
  if (!profile) return null;
  const scale = Math.min((size.h - 140) / profile.page.heightPt, (size.w - 160) / (profile.page.widthPt * 2));
  const current = spreads[spread] ?? [];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#1b1f27]" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col outline-none">
          <DialogPrimitive.Title className="sr-only">Issue preview</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Spread-by-spread preview. Use the arrow keys to turn pages.</DialogPrimitive.Description>
          <div className="flex h-12 items-center justify-between px-4 text-white/80">
            <span className="text-sm">{data.project?.title}</span>
            <span className="tabular text-sm">
              {current.map((i) => i + 1).join("–")} / {pages.length}
            </span>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10 hover:text-white" aria-label="Close preview">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="relative flex flex-1 items-center justify-center">
            <Button variant="ghost" size="icon" className="absolute left-4 text-white hover:bg-white/10 hover:text-white" disabled={spread === 0} onClick={() => setSpread((s) => s - 1)} aria-label="Previous spread">
              <ChevronLeft />
            </Button>
            <div className="flex shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]">
              {current.length === 1 && current[0] === 0 && <div style={{ width: profile.page.widthPt * scale }} />}
              {current.map((i) => (
                <PageView key={pages[i].id} page={pages[i]} profile={profile} assets={assetsById} ctx={data.ctxFor(i)} scale={scale} localUrls={data.localUrls} />
              ))}
            </div>
            <Button variant="ghost" size="icon" className="absolute right-4 text-white hover:bg-white/10 hover:text-white" disabled={spread >= spreads.length - 1} onClick={() => setSpread((s) => s + 1)} aria-label="Next spread">
              <ChevronRight />
            </Button>
          </div>
          <div className="scroll-thin flex h-20 shrink-0 items-center gap-1 overflow-x-auto px-4 pb-3">
            {spreads.map((s, i) => (
              <button key={i} onClick={() => setSpread(i)} className={`tabular shrink-0 rounded px-2 py-1 text-xs ${i === spread ? "bg-white text-ink" : "text-white/60 hover:bg-white/10"}`}>
                {s.map((x) => x + 1).join("–")}
              </button>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

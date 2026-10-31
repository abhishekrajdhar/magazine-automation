"use client";

import * as React from "react";
import type { Asset, DesignProfile, MagazinePage, PageElement } from "@/lib/domain/types";
import { PageView, type RenderContext } from "@/components/magazine/page-view";
import { textCss } from "@/components/magazine/text-style";
import { columnGrid, liveArea } from "@/lib/templates/geometry";
import { cn } from "@/lib/utils/cn";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN = 12;

interface Props {
  page: MagazinePage;
  profile: DesignProfile;
  assets: Record<string, Asset>;
  ctx: RenderContext;
  scale: number;
  localUrls?: Record<string, string>;
  selectedId: string | null;
  showGuides: boolean;
  showBleed: boolean;
  onSelect: (id: string | null) => void;
  /** Called once when a drag/resize starts so the change is one undo step. */
  onBeginChange: () => void;
  onChange: (id: string, patch: Partial<PageElement>) => void;
  onOverset: (id: string, overset: boolean) => void;
  editingText: string | null;
  setEditingText: (id: string | null) => void;
  cropping: string | null;
  setCropping: (id: string | null) => void;
}

/** Edges the selection snaps to: trim, live area, column edges and centre. */
function snapLines(profile: DesignProfile, pageNumber: number) {
  const la = liveArea(profile, pageNumber);
  const grid = columnGrid(profile, la);
  const W = profile.page.widthPt;
  const H = profile.page.heightPt;
  return {
    x: [0, W, W / 2, la.x, la.x + la.w, ...grid.starts, ...grid.ends],
    y: [0, H, H / 2, la.y, la.y + la.h],
  };
}

function snap(value: number, size: number, lines: number[], tolerance: number): { value: number; line?: number } {
  let best: { value: number; line?: number; d: number } = { value, d: tolerance };
  for (const l of lines) {
    for (const [edge, offset] of [[value, 0], [value + size, size], [value + size / 2, size / 2]] as const) {
      const d = Math.abs(edge - l);
      if (d < best.d) best = { value: l - offset, line: l, d };
    }
  }
  return { value: best.value, line: best.line };
}

export function EditorCanvas(props: Props) {
  const { page, profile, assets, ctx, scale, localUrls, selectedId, showGuides, showBleed, onSelect, onBeginChange, onChange, onOverset, editingText, setEditingText, cropping, setCropping } = props;
  const [guides, setGuides] = React.useState<{ x?: number; y?: number }>({});
  const selected = page.elements.find((e) => e.id === selectedId);
  const lines = React.useMemo(() => snapLines(profile, ctx.pageNumber), [profile, ctx.pageNumber]);
  const bleed = showBleed ? profile.page.bleedPt : 0;

  const startDrag = (e: React.PointerEvent, el: PageElement, handle?: Handle) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    onSelect(el.id);
    if (el.locked || editingText === el.id) return;
    const start = { px: e.clientX, py: e.clientY, x: el.x, y: el.y, w: el.w, h: el.h, offsetX: el.crop?.offsetX ?? 0, offsetY: el.crop?.offsetY ?? 0 };
    let began = false;
    const tolerance = 5 / scale;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.px) / scale;
      const dy = (ev.clientY - start.py) / scale;
      if (!began) {
        if (Math.abs(dx) + Math.abs(dy) < 2 / scale) return;
        began = true;
        onBeginChange();
      }
      if (cropping === el.id && !handle) {
        // Panning inside the frame moves the image's focal point.
        onChange(el.id, { crop: { scale: el.crop?.scale ?? 1, offsetX: Math.max(-1, Math.min(1, start.offsetX - dx / (el.w / 2))), offsetY: Math.max(-1, Math.min(1, start.offsetY - dy / (el.h / 2))) } });
        return;
      }
      if (!handle) {
        const sx = ev.altKey ? { value: start.x + dx } : snap(start.x + dx, start.w, lines.x, tolerance);
        const sy = ev.altKey ? { value: start.y + dy } : snap(start.y + dy, start.h, lines.y, tolerance);
        setGuides({ x: "line" in sx ? sx.line : undefined, y: "line" in sy ? sy.line : undefined });
        onChange(el.id, { x: round(sx.value), y: round(sy.value) });
        return;
      }
      let { x, y, w, h } = start;
      if (handle.includes("e")) w = Math.max(MIN, start.w + dx);
      if (handle.includes("s")) h = Math.max(MIN, start.h + dy);
      if (handle.includes("w")) {
        w = Math.max(MIN, start.w - dx);
        x = start.x + (start.w - w);
      }
      if (handle.includes("n")) {
        h = Math.max(MIN, start.h - dy);
        y = start.y + (start.h - h);
      }
      if (!ev.altKey) {
        const right = snap(x + w, 0, lines.x, tolerance);
        if (handle.includes("e") && right.line !== undefined) w = right.line - x;
        const bottom = snap(y + h, 0, lines.y, tolerance);
        if (handle.includes("s") && bottom.line !== undefined) h = bottom.line - y;
        setGuides({ x: handle.includes("e") ? right.line : undefined, y: handle.includes("s") ? bottom.line : undefined });
      }
      onChange(el.id, { x: round(x), y: round(y), w: round(w), h: round(h) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuides({});
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const overlay = (
    <div className="pointer-events-none absolute inset-0" style={{ left: bleed * scale, top: bleed * scale }}>
      {guides.x !== undefined && <div className="absolute top-0 h-full w-px bg-[#ec4899]" style={{ left: guides.x * scale, height: profile.page.heightPt * scale }} />}
      {guides.y !== undefined && <div className="absolute left-0 h-px bg-[#ec4899]" style={{ top: guides.y * scale, width: profile.page.widthPt * scale }} />}
      {selected && !selected.hidden && editingText !== selected.id && (
        <div
          className={cn("absolute", cropping === selected.id ? "outline-2 outline-dashed outline-[#f59e0b]" : "outline-[1.5px] outline-accent outline")}
          style={{ left: selected.x * scale, top: selected.y * scale, width: selected.w * scale, height: selected.h * scale }}
        >
          {!selected.locked &&
            cropping !== selected.id &&
            HANDLES.map((h) => (
              <span
                key={h}
                onPointerDown={(e) => startDrag(e, selected, h)}
                className="pointer-events-auto absolute size-2 -translate-x-1/2 -translate-y-1/2 border border-accent bg-white"
                style={{
                  left: h.includes("w") ? 0 : h.includes("e") ? "100%" : "50%",
                  top: h.includes("n") ? 0 : h.includes("s") ? "100%" : "50%",
                  cursor: `${h}-resize`,
                }}
              />
            ))}
          <span className="absolute -top-5 left-0 whitespace-nowrap rounded-sm bg-accent px-1 py-px text-[10px] font-medium text-white">
            {selected.name}
            {selected.locked ? " · locked" : ""}
            {cropping === selected.id ? " · drag to reposition, scroll to zoom" : ""}
          </span>
        </div>
      )}
      {selected && editingText === selected.id && <InlineTextEditor el={selected} profile={profile} scale={scale} onCommit={(text) => { onBeginChange(); onChange(selected.id, { text }); setEditingText(null); }} onCancel={() => setEditingText(null)} />}
    </div>
  );

  return (
    <div
      onWheel={(e) => {
        if (!selected || cropping !== selected.id) return;
        e.preventDefault();
        const next = Math.max(1, Math.min(3, (selected.crop?.scale ?? 1) - e.deltaY * 0.002));
        onChange(selected.id, { crop: { offsetX: selected.crop?.offsetX ?? 0, offsetY: selected.crop?.offsetY ?? 0, scale: round(next) } });
      }}
    >
      <PageView
        page={page}
        profile={profile}
        assets={assets}
        ctx={ctx}
        scale={scale}
        localUrls={localUrls}
        showGuides={showGuides}
        showBleed={showBleed}
        showOverset
        onOverset={onOverset}
        onElementPointerDown={startDrag}
        onElementDoubleClick={(el) => {
          if (el.locked) return;
          if (el.kind === "text" && !el.dynamic) setEditingText(el.id);
          if (el.kind === "image" && el.role !== "ad") setCropping(el.id);
        }}
        overlay={overlay}
        className="bg-white shadow-page"
      />
    </div>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

function InlineTextEditor({ el, profile, scale, onCommit, onCancel }: { el: PageElement; profile: DesignProfile; scale: number; onCommit: (t: string) => void; onCancel: () => void }) {
  const [value, setValue] = React.useState(el.text ?? "");
  const css = textCss(profile, el);
  const size = Number(css.fontSize) * scale;
  return (
    <textarea
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onCommit(value);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="pointer-events-auto absolute resize-none border-0 bg-white/95 p-0 outline outline-2 outline-accent"
      style={{
        left: el.x * scale,
        top: el.y * scale,
        width: Math.max(el.w * scale, 160),
        height: Math.max(el.h * scale, 60),
        fontFamily: css.fontFamily,
        fontSize: Math.max(11, size),
        lineHeight: 1.35,
        fontWeight: css.fontWeight,
        color: css.color,
        zIndex: 30,
      }}
      aria-label={`Edit ${el.name}`}
    />
  );
}

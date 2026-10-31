"use client";

import * as React from "react";
import type { Asset, DesignProfile, MagazinePage, PageElement } from "@/lib/domain/types";
import { adCreatives } from "@/lib/demo/assets";
import { liveArea, columnGrid } from "@/lib/templates/geometry";
import { cn } from "@/lib/utils/cn";
import { AdPlaceholder, PlaceholderPhoto } from "./placeholder-photo";
import { effectiveStyle, fontStack, isOverset, textCss } from "./text-style";

export interface TocEntry {
  page: number;
  kicker: string;
  title: string;
}

export interface RenderContext {
  pageNumber: number;
  magazineName: string;
  issueLabel: string;
  section?: string;
  toc?: TocEntry[];
}

export interface PageViewProps {
  page: MagazinePage;
  profile: DesignProfile;
  assets: Record<string, Asset>;
  ctx: RenderContext;
  scale: number;
  showGuides?: boolean;
  showBleed?: boolean;
  showOverset?: boolean;
  hiddenElementId?: string | null;
  localUrls?: Record<string, string>;
  onElementPointerDown?: (e: React.PointerEvent, el: PageElement) => void;
  onElementDoubleClick?: (el: PageElement) => void;
  onOverset?: (elementId: string, overset: boolean) => void;
  overlay?: React.ReactNode;
  className?: string;
}

export function PageView({
  page,
  profile,
  assets,
  ctx,
  scale,
  showGuides,
  showBleed,
  showOverset,
  hiddenElementId,
  localUrls,
  onElementPointerDown,
  onElementDoubleClick,
  onOverset,
  overlay,
  className,
}: PageViewProps) {
  const W = profile.page.widthPt;
  const H = profile.page.heightPt;
  const bleed = showBleed ? profile.page.bleedPt : 0;
  const elements = React.useMemo(() => [...page.elements].sort((a, b) => a.z - b.z), [page.elements]);

  return (
    <div
      className={cn("relative select-none", className)}
      style={{ width: (W + bleed * 2) * scale, height: (H + bleed * 2) * scale }}
      data-page-id={page.id}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: W + bleed * 2, height: H + bleed * 2, transform: `scale(${scale})`, overflow: "hidden", background: showBleed ? "#fff" : undefined }}
      >
        <div className="absolute overflow-hidden" style={{ left: bleed, top: bleed, width: W, height: H, background: profile.colors.paper, overflow: showBleed ? "visible" : "hidden" }}>
          {elements.map((el) =>
            el.hidden || el.id === hiddenElementId ? null : (
              <ElementView
                key={el.id}
                el={el}
                profile={profile}
                assets={assets}
                ctx={ctx}
                localUrls={localUrls}
                showOverset={showOverset}
                onOverset={onOverset}
                onPointerDown={onElementPointerDown}
                onDoubleClick={onElementDoubleClick}
              />
            ),
          )}
          {showGuides && <Guides profile={profile} pageNumber={ctx.pageNumber} />}
        </div>
        {showBleed && (
          <div className="pointer-events-none absolute" style={{ left: bleed, top: bleed, width: W, height: H, outline: "0.75px solid rgb(14 23 38 / 0.35)" }} />
        )}
      </div>
      {overlay}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface ElementViewProps {
  el: PageElement;
  profile: DesignProfile;
  assets: Record<string, Asset>;
  ctx: RenderContext;
  localUrls?: Record<string, string>;
  showOverset?: boolean;
  onOverset?: (elementId: string, overset: boolean) => void;
  onPointerDown?: (e: React.PointerEvent, el: PageElement) => void;
  onDoubleClick?: (el: PageElement) => void;
}

const ElementView = React.memo(function ElementView({ el, profile, assets, ctx, localUrls, showOverset, onOverset, onPointerDown, onDoubleClick }: ElementViewProps) {
  const box: React.CSSProperties = { position: "absolute", left: el.x, top: el.y, width: el.w, height: el.h, opacity: el.opacity };
  const handlers = {
    onPointerDown: onPointerDown ? (e: React.PointerEvent) => onPointerDown(e, el) : undefined,
    onDoubleClick: onDoubleClick ? () => onDoubleClick(el) : undefined,
  };

  if (el.kind === "shape" || el.kind === "rule") {
    return <div style={{ ...box, background: el.fill, borderRadius: el.radius }} {...handlers} data-el={el.id} />;
  }

  if (el.kind === "image") {
    return (
      <div style={{ ...box, overflow: "hidden", background: "#e9ebef", borderRadius: profile.images.cornerRadius || undefined }} {...handlers} data-el={el.id}>
        <ImageContent el={el} asset={el.assetId ? assets[el.assetId] : undefined} localUrl={el.assetId ? localUrls?.[el.assetId] : undefined} />
      </div>
    );
  }

  return <TextFrame el={el} profile={profile} ctx={ctx} box={box} showOverset={showOverset} onOverset={onOverset} handlers={handlers} />;
});

function ImageContent({ el, asset, localUrl }: { el: PageElement; asset?: Asset; localUrl?: string }) {
  const crop = el.crop ?? { scale: 1, offsetX: 0, offsetY: 0 };
  if (!asset) {
    return (
      <div className="flex h-full w-full items-center justify-center" style={{ background: "repeating-linear-gradient(45deg,#eef0f3 0 6px,#e4e7ec 6px 12px)" }}>
        <span style={{ fontFamily: "var(--font-inter)", fontSize: 9, color: "#8a94a6", letterSpacing: "0.04em" }}>{el.assetId ? "Missing asset" : "Empty image frame"}</span>
      </div>
    );
  }
  if (asset.kind === "ad" && adCreatives[asset.id] && !asset.url) {
    return <AdPlaceholder creative={adCreatives[asset.id]} />;
  }
  const origin = `${50 + crop.offsetX * 50}% ${50 + crop.offsetY * 50}%`;
  const src = asset.url ?? localUrl;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={asset.caption ?? ""} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: origin, transform: `scale(${crop.scale})`, transformOrigin: origin }} />;
  }
  const ax = crop.offsetX < -0.33 ? "xMin" : crop.offsetX > 0.33 ? "xMax" : "xMid";
  const ay = crop.offsetY < -0.33 ? "YMin" : crop.offsetY > 0.33 ? "YMax" : "YMid";
  return (
    <div style={{ width: "100%", height: "100%", transform: `scale(${crop.scale})`, transformOrigin: origin }}>
      <PlaceholderPhoto seed={asset.seed} tag={asset.tags[0] ?? "stage"} preserveAspectRatio={`${ax}${ay} slice`} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface TextFrameProps {
  el: PageElement;
  profile: DesignProfile;
  ctx: RenderContext;
  box: React.CSSProperties;
  showOverset?: boolean;
  onOverset?: (elementId: string, overset: boolean) => void;
  handlers: { onPointerDown?: (e: React.PointerEvent) => void; onDoubleClick?: () => void };
}

function TextFrame({ el, profile, ctx, box, showOverset, onOverset, handlers }: TextFrameProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [overset, setOverset] = React.useState(false);
  const css = textCss(profile, el);

  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const over = isOverset(node, el.columns);
      setOverset((prev) => (prev === over ? prev : over));
      onOverset?.(el.id, over);
    };
    measure();
    // Fonts load asynchronously; re-measure once they settle.
    if (typeof document !== "undefined" && "fonts" in document) document.fonts.ready.then(measure).catch(() => undefined);
  });

  let content: React.ReactNode;
  if (el.dynamic === "folio") content = <Folio profile={profile} ctx={ctx} align={(el.style?.align as string) ?? "right"} />;
  else if (el.dynamic === "toc") content = <TocList profile={profile} entries={ctx.toc ?? []} />;
  else content = <Paragraphs el={el} profile={profile} />;

  return (
    <div style={{ ...box }} {...handlers} data-el={el.id}>
      <div ref={ref} className="pf-frame" data-columns={el.columns && el.columns > 1 ? el.columns : undefined} style={{ ...css, width: "100%", height: "100%", overflow: "hidden" }}>
        {content}
      </div>
      {showOverset && overset && (
        <div title="Overset text" style={{ position: "absolute", right: -5, bottom: -5, width: 10, height: 10, background: "#fff", border: "1px solid #d9402f", color: "#d9402f", fontSize: 10, lineHeight: "8px", textAlign: "center", fontFamily: "var(--font-inter)", fontWeight: 700 }}>
          +
        </div>
      )}
    </div>
  );
}

function Paragraphs({ el, profile }: { el: PageElement; profile: DesignProfile }) {
  const text = el.text ?? "";
  if (!text.trim()) return null;
  const role = el.styleRole ?? "body";
  const t = profile.typography;
  const paras = text.split(/\n{2,}/);
  const base = effectiveStyle(profile, el);

  if (role === "pullquote") {
    const style = profile.pullQuote.style;
    return (
      <div style={{ borderTop: style === "rule_above" ? `2px solid ${profile.colors.accent}` : undefined, paddingTop: style === "rule_above" ? 8 : undefined, background: style === "boxed" ? profile.colors.palette[3] : undefined, padding: style === "boxed" ? 10 : undefined }}>
        {style === "quote_mark" && <div style={{ fontFamily: fontStack(t.pullquote.previewFont, "serif"), fontSize: base.size * 2.6, lineHeight: 0.8, color: profile.colors.accent }}>“</div>}
        {paras.map((p, i) =>
          p.startsWith("— ") ? (
            <p key={i} style={{ marginTop: 6, fontFamily: fontStack(t.caption.previewFont, t.caption.classification), fontSize: t.caption.size + 0.5, lineHeight: `${t.caption.leading}px`, fontStyle: "normal", fontWeight: 600, color: profile.colors.muted, letterSpacing: "0.02em", textIndent: 0 }}>
              {p}
            </p>
          ) : (
            <p key={i}>{p}</p>
          ),
        )}
      </div>
    );
  }

  if (role === "caption" && paras.length === 2 && el.name === "Name & designation") {
    return (
      <>
        <p style={{ fontWeight: 700, color: profile.colors.ink, fontSize: base.size + 1 }}>{paras[0]}</p>
        <p style={{ marginTop: 2 }}>{paras[1]}</p>
      </>
    );
  }

  return (
    <>
      {paras.map((raw, i) => {
        if (raw.startsWith("^ ")) {
          const body = raw.slice(2);
          return (
            <p key={i} style={{ textIndent: 0 }}>
              <span style={{ float: "left", fontFamily: fontStack(t.headline.previewFont, t.headline.classification), fontWeight: 700, fontSize: base.leading * 3.05, lineHeight: `${base.leading * 2.6}px`, marginRight: 4, marginTop: 2, color: profile.colors.accent }}>{body[0]}</span>
              {body.slice(1)}
            </p>
          );
        }
        if (raw.startsWith("## ")) return <p key={i} className="pf-sub" style={{ fontFamily: fontStack(t.subhead.previewFont, t.subhead.classification), color: t.subhead.color, fontSize: t.subhead.size, breakAfter: "avoid" }}>{raw.slice(3)}</p>;
        if (raw.startsWith("Q: ")) return <p key={i} className="pf-q" style={{ ["--pf-q-font" as string]: fontStack(t.question.previewFont, t.question.classification), color: t.question.color, breakAfter: "avoid" }}>{raw.slice(3)}</p>;
        if (raw.startsWith("• ")) return <p key={i} style={{ textIndent: "-0.8em", paddingLeft: "0.8em", marginTop: 3, textAlign: "left" }}>{raw}</p>;
        if (raw.startsWith("> ")) return <p key={i} style={{ fontStyle: "italic", textIndent: 0, margin: "4px 0", color: profile.colors.accent }}>{raw.slice(2)}</p>;
        const afterHeading = i > 0 && (paras[i - 1].startsWith("## ") || paras[i - 1].startsWith("Q: "));
        return (
          <p key={i} className={afterHeading ? "pf-a" : undefined} style={role !== "body" && i > 0 ? { marginTop: role === "deck" ? 6 : 3 } : undefined}>
            {raw}
          </p>
        );
      })}
    </>
  );
}

function Folio({ profile, ctx, align }: { profile: DesignProfile; ctx: RenderContext; align: string }) {
  const meta = [profile.folio.showMagazineName ? `${ctx.magazineName} · ${ctx.issueLabel}` : null, profile.folio.showSection && ctx.section ? ctx.section : null].filter(Boolean).join("   ·   ");
  const num = <span style={{ fontWeight: 700, color: profile.colors.ink }}>{ctx.pageNumber}</span>;
  return (
    <p style={{ textAlign: align as React.CSSProperties["textAlign"], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {align === "left" ? (
        <>
          {num}
          <span style={{ margin: "0 8px", opacity: 0.35 }}>|</span>
          <span style={{ color: profile.colors.muted, fontWeight: 500 }}>{meta}</span>
        </>
      ) : (
        <>
          <span style={{ color: profile.colors.muted, fontWeight: 500 }}>{meta}</span>
          <span style={{ margin: "0 8px", opacity: 0.35 }}>|</span>
          {num}
        </>
      )}
    </p>
  );
}

function TocList({ profile, entries }: { profile: DesignProfile; entries: TocEntry[] }) {
  const t = profile.typography;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {entries.map((e) => (
        <div key={`${e.page}-${e.title}`} style={{ display: "grid", gridTemplateColumns: "34px minmax(0, 1fr)", gap: 10, padding: "7px 0", borderBottom: `0.5px solid ${profile.colors.rule}` }}>
          <div style={{ fontFamily: fontStack(t.headline.previewFont, t.headline.classification), fontWeight: 700, fontSize: 19, lineHeight: "20px", color: profile.colors.accent }}>{String(e.page).padStart(2, "0")}</div>
          <div>
            <div style={{ fontFamily: fontStack(t.kicker.previewFont, t.kicker.classification), fontSize: t.kicker.size - 0.5, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, color: profile.colors.muted, lineHeight: "11px" }}>{e.kicker}</div>
            <div style={{ fontFamily: fontStack(t.headline.previewFont, t.headline.classification), fontWeight: 600, fontSize: 11.5, lineHeight: "14px", color: profile.colors.ink, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Guides({ profile, pageNumber }: { profile: DesignProfile; pageNumber: number }) {
  const la = liveArea(profile, pageNumber);
  const grid = columnGrid(profile, la);
  return (
    <div className="pointer-events-none absolute inset-0">
      <div style={{ position: "absolute", left: la.x, top: la.y, width: la.w, height: la.h, outline: "0.6px solid rgb(219 39 119 / 0.55)" }} />
      {grid.starts.map((s, i) => (
        <div key={i} style={{ position: "absolute", left: s, top: la.y, width: grid.colWidth, height: la.h, background: "rgb(124 108 242 / 0.05)", borderLeft: "0.5px solid rgb(124 108 242 / 0.45)", borderRight: "0.5px solid rgb(124 108 242 / 0.45)" }} />
      ))}
    </div>
  );
}

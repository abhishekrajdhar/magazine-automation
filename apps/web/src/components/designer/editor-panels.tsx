"use client";

import * as React from "react";
import Link from "next/link";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Copy, Eye, EyeOff, Image as ImageIcon, Lock, LockOpen, Minimize2, RotateCcw, Search, Shapes, Square, Trash2, Type } from "lucide-react";
import type { Asset, DesignProfile, MagazinePage, PageElement, TextRole } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/display";
import { Select } from "@/components/ui/overlays";
import { Segmented, Slider, Switch, Tooltip } from "@/components/ui/primitives";
import { PlaceholderPhoto } from "@/components/magazine/placeholder-photo";
import { PREVIEW_FONTS, effectiveStyle, isOverset } from "@/components/magazine/text-style";
import { cn } from "@/lib/utils/cn";

const TEXT_ROLES: TextRole[] = ["headline", "deck", "kicker", "byline", "body", "subhead", "pullquote", "caption", "question", "stat", "folio"];

/** Effective resolution of an image at its placed size. */
export function effectivePpi(asset: Asset, el: PageElement): number {
  const scale = el.crop?.scale ?? 1;
  const frameRatio = el.w / el.h;
  const imgRatio = asset.widthPx / asset.heightPx;
  // Cover fit: the limiting dimension fills the frame.
  const pxAcross = imgRatio > frameRatio ? asset.heightPx * frameRatio : asset.widthPx;
  return Math.round(pxAcross / scale / (el.w / 72));
}

/**
 * Shrink a text frame's type until it fits, measured on the rendered DOM.
 * Returns the new size/leading, or null if it can't fit within 85% of the original.
 */
export function fitTextInDom(pageId: string, el: PageElement, profile: DesignProfile): { size: number; leading: number } | null {
  const node = document.querySelector<HTMLElement>(`[data-page-id="${pageId}"] [data-el="${el.id}"] .pf-frame`);
  if (!node) return null;
  const base = effectiveStyle(profile, el);
  const overflows = () => isOverset(node, el.columns);
  const original = { fs: node.style.fontSize, lh: node.style.lineHeight };
  let result: { size: number; leading: number } | null = null;
  for (let f = 1; f >= 0.85; f -= 0.01) {
    node.style.fontSize = `${base.size * f}px`;
    node.style.lineHeight = `${base.leading * f}px`;
    if (!overflows()) {
      result = { size: Math.round(base.size * f * 100) / 100, leading: Math.round(base.leading * f * 100) / 100 };
      break;
    }
  }
  node.style.fontSize = original.fs;
  node.style.lineHeight = original.lh;
  return result;
}

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(Math.round(value * 10) / 10)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) onChange(n);
    else setDraft(String(value));
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-3">{label}</span>
      <Input inputSize="sm" type="number" step={step} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(); }} />
    </label>
  );
}

const Section = ({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <section className="border-b border-line px-4 py-3.5">
    <div className="mb-2.5 flex items-center justify-between">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">{title}</p>
      {action}
    </div>
    {children}
  </section>
);

interface ElementPanelProps {
  el: PageElement;
  page: MagazinePage;
  profile: DesignProfile;
  assets: Record<string, Asset>;
  overset: boolean;
  onChange: (patch: Partial<PageElement>, history?: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onReplaceImage: () => void;
  onZ: (dir: 1 | -1) => void;
  onFit: () => void;
}

export function ElementPanel({ el, profile, assets, overset, onChange, onDelete, onDuplicate, onReplaceImage, onZ, onFit }: ElementPanelProps) {
  const style = el.kind === "text" ? effectiveStyle(profile, el) : null;
  const asset = el.assetId ? assets[el.assetId] : undefined;
  const ppi = asset && el.kind === "image" && asset.kind !== "ad" ? effectivePpi(asset, el) : null;
  const setStyle = (patch: NonNullable<PageElement["style"]>) => onChange({ style: { ...el.style, ...patch } });

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="flex size-7 items-center justify-center rounded-md bg-sunken text-ink-3 [&_svg]:size-3.5">{el.kind === "text" ? <Type /> : el.kind === "image" ? <ImageIcon /> : <Square />}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{el.name}</p>
          <p className="text-[11px] text-ink-4">{el.kind}{el.dynamic ? ` · generated (${el.dynamic})` : ""}</p>
        </div>
        <Tooltip content={el.locked ? "Unlock" : "Lock"}>
          <Button variant="ghost" size="icon-xs" onClick={() => onChange({ locked: !el.locked })} aria-label={el.locked ? "Unlock element" : "Lock element"}>
            {el.locked ? <Lock className="text-accent" /> : <LockOpen />}
          </Button>
        </Tooltip>
      </div>

      <Section title="Position & size">
        <div className="grid grid-cols-4 gap-2">
          <Num label="X" value={el.x} onChange={(v) => onChange({ x: v })} />
          <Num label="Y" value={el.y} onChange={(v) => onChange({ y: v })} />
          <Num label="W" value={el.w} onChange={(v) => onChange({ w: Math.max(12, v) })} />
          <Num label="H" value={el.h} onChange={(v) => onChange({ h: Math.max(12, v) })} />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1">
          <Button variant="secondary" size="xs" onClick={() => onZ(1)}><ArrowUpToLine /> Forward</Button>
          <Button variant="secondary" size="xs" onClick={() => onZ(-1)}><ArrowDownToLine /> Backward</Button>
          <Button variant="secondary" size="xs" onClick={onDuplicate}><Copy /> Duplicate</Button>
          <Button variant="danger-ghost" size="xs" onClick={onDelete} disabled={el.locked}><Trash2 /> Delete</Button>
        </div>
      </Section>

      {el.kind === "text" && style && (
        <>
          {!el.dynamic && (
            <Section title="Content" action={overset ? <Badge tone="danger">Overset</Badge> : <Badge tone="success">Fits</Badge>}>
              <Textarea rows={6} className="font-mono text-[12px]" value={el.text ?? ""} onChange={(e) => onChange({ text: e.target.value }, false)} onKeyDown={(e) => e.stopPropagation()} aria-label="Frame text" />
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">Paragraphs are separated by a blank line. “## ” subhead · “Q: ” question · “^ ” drop-cap lead.</p>
              {overset && (
                <div className="mt-2.5 rounded-md border border-danger/25 bg-danger-soft p-2.5 text-xs text-danger">
                  Text doesn&apos;t fit this frame.
                  <div className="mt-2 flex gap-1.5">
                    <Button size="xs" variant="secondary" onClick={onFit}><Minimize2 /> Fit text (≤15%)</Button>
                    <Button size="xs" variant="ghost" onClick={() => onChange({ h: Math.round(el.h * 1.1) })}>Grow frame 10%</Button>
                  </div>
                </div>
              )}
            </Section>
          )}
          <Section title="Typography" action={el.style && Object.keys(el.style).length > 0 ? <Button variant="ghost" size="xs" onClick={() => onChange({ style: undefined })}><RotateCcw /> Reset to profile</Button> : undefined}>
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-[11px] text-ink-3">Paragraph style</span>
                <Select size="sm" value={el.styleRole ?? "body"} onValueChange={(v) => onChange({ styleRole: v })} options={TEXT_ROLES.map((r) => ({ value: r, label: `PF ${r[0].toUpperCase()}${r.slice(1)}` }))} />
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-[11px] text-ink-3">Preview font</span>
                <Select size="sm" value={style.previewFont} onValueChange={(v) => setStyle({ previewFont: v })} options={PREVIEW_FONTS.map((f) => ({ value: f.name, label: f.name }))} />
              </label>
              <Num label="Size (pt)" step={0.5} value={style.size} onChange={(v) => setStyle({ size: Math.max(4, v) })} />
              <Num label="Leading (pt)" step={0.5} value={style.leading} onChange={(v) => setStyle({ leading: Math.max(4, v) })} />
              <Num label="Weight" step={100} value={style.weight} onChange={(v) => setStyle({ weight: v })} />
              <Num label="Tracking (‰)" step={5} value={style.tracking} onChange={(v) => setStyle({ tracking: v })} />
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <Segmented
                size="sm"
                value={(el.style?.align as string) ?? (el.styleRole === "body" ? "justify" : "left")}
                onChange={(v) => setStyle({ align: v as "left" })}
                options={[
                  { value: "left", label: "", icon: <AlignLeft />, title: "Left" },
                  { value: "center", label: "", icon: <AlignCenter />, title: "Centre" },
                  { value: "right", label: "", icon: <AlignRight />, title: "Right" },
                  { value: "justify", label: "", icon: <AlignJustify />, title: "Justify" },
                ]}
              />
              <label className="flex items-center gap-1.5 text-xs text-ink-3">
                <input type="color" value={style.color} onChange={(e) => setStyle({ color: e.target.value.toUpperCase() })} className="size-6 cursor-pointer rounded border border-line" aria-label="Text colour" />
              </label>
            </div>
            <div className="mt-2.5 flex gap-4 text-xs text-ink-3">
              <label className="flex items-center gap-1.5"><Switch checked={!!style.uppercase} onCheckedChange={(c) => setStyle({ uppercase: c })} /> Caps</label>
              <label className="flex items-center gap-1.5"><Switch checked={!!style.italic} onCheckedChange={(c) => setStyle({ italic: c })} /> Italic</label>
            </div>
          </Section>
          <Section title="Columns">
            <div className="grid grid-cols-2 gap-2">
              <Num label="Columns" value={el.columns ?? 1} onChange={(v) => onChange({ columns: Math.max(1, Math.min(6, Math.round(v))) })} />
              <Num label="Gutter (pt)" value={el.gutter ?? profile.grid.gutterPt} onChange={(v) => onChange({ gutter: Math.max(0, v) })} />
            </div>
          </Section>
        </>
      )}

      {el.kind === "image" && (
        <>
          <Section title="Image">
            {asset ? (
              <div className="flex gap-3">
                <div className="h-16 w-20 shrink-0 overflow-hidden rounded-sm border border-line">
                  {asset.kind === "ad" ? <div className="flex h-full items-center justify-center bg-sunken text-[10px] text-ink-3">Ad</div> : asset.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <PlaceholderPhoto seed={asset.seed} tag={asset.tags[0] ?? "stage"} className="h-full w-full" />
                  )}
                </div>
                <div className="min-w-0 text-xs">
                  <p className="truncate font-medium text-ink">{asset.fileName}</p>
                  <p className="text-ink-3">{asset.widthPx} × {asset.heightPx} px</p>
                  {ppi !== null && <p className={cn("font-medium", ppi < 150 ? "text-danger" : ppi < 200 ? "text-warning" : "text-success")}>{ppi} ppi effective {ppi < 200 ? "· low for print" : ""}</p>}
                  {asset.simulated && <p className="text-[#8a5a00]">Placeholder imagery</p>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-3">Empty frame.</p>
            )}
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={onReplaceImage}>
              <ImageIcon /> {asset ? "Replace image" : "Place image"}
            </Button>
          </Section>
          {asset && asset.kind !== "ad" && (
            <Section title="Crop" action={<Button variant="ghost" size="xs" onClick={() => onChange({ crop: { scale: 1, offsetX: 0, offsetY: 0 } })}><RotateCcw /> Reset</Button>}>
              <div className="flex flex-col gap-3">
                {(
                  [
                    ["Zoom", "scale", 1, 3, 0.05],
                    ["Horizontal focus", "offsetX", -1, 1, 0.05],
                    ["Vertical focus", "offsetY", -1, 1, 0.05],
                  ] as const
                ).map(([label, key, min, max, step]) => (
                  <div key={key}>
                    <div className="flex justify-between text-[11px] text-ink-3">
                      <Label className="text-[11px] font-normal text-ink-3">{label}</Label>
                      <span className="tabular">{(el.crop?.[key] ?? (key === "scale" ? 1 : 0)).toFixed(2)}</span>
                    </div>
                    <Slider className="mt-1.5" min={min} max={max} step={step} value={[el.crop?.[key] ?? (key === "scale" ? 1 : 0)]} onValueChange={([v]) => onChange({ crop: { scale: el.crop?.scale ?? 1, offsetX: el.crop?.offsetX ?? 0, offsetY: el.crop?.offsetY ?? 0, [key]: v } }, false)} />
                  </div>
                ))}
                <p className="text-[11px] text-ink-4">Tip: double-click the image to drag it inside the frame; scroll to zoom.</p>
              </div>
            </Section>
          )}
        </>
      )}

      {(el.kind === "shape" || el.kind === "rule") && (
        <Section title="Fill">
          <div className="flex items-center gap-3">
            <input type="color" value={el.fill ?? "#000000"} onChange={(e) => onChange({ fill: e.target.value.toUpperCase() })} className="size-8 cursor-pointer rounded border border-line" aria-label="Fill colour" />
            <div className="flex-1">
              <div className="flex justify-between text-[11px] text-ink-3"><span>Opacity</span><span className="tabular">{Math.round((el.opacity ?? 1) * 100)}%</span></div>
              <Slider className="mt-1.5" min={0} max={1} step={0.05} value={[el.opacity ?? 1]} onValueChange={([v]) => onChange({ opacity: v }, false)} />
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function LayersList({ page, selectedId, onSelect, onToggle }: { page: MagazinePage; selectedId: string | null; onSelect: (id: string) => void; onToggle: (id: string, patch: Partial<PageElement>) => void }) {
  const items = [...page.elements].sort((a, b) => b.z - a.z);
  return (
    <ul className="flex flex-col p-1.5">
      {items.map((el) => (
        <li key={el.id}>
          <div className={cn("group flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-hover", selectedId === el.id && "bg-accent-soft text-accent-ink hover:bg-accent-soft")}>
            <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onSelect(el.id)}>
              <span className="text-ink-4 [&_svg]:size-3.5">{el.kind === "text" ? <Type /> : el.kind === "image" ? <ImageIcon /> : <Shapes />}</span>
              <span className={cn("truncate", el.hidden && "text-ink-4 line-through")}>{el.name}</span>
            </button>
            <button className="text-ink-4 opacity-0 hover:text-ink group-hover:opacity-100 [&_svg]:size-3.5" onClick={() => onToggle(el.id, { hidden: !el.hidden })} aria-label={el.hidden ? "Show" : "Hide"}>
              {el.hidden ? <EyeOff /> : <Eye />}
            </button>
            <button className={cn("text-ink-4 hover:text-ink [&_svg]:size-3.5", !el.locked && "opacity-0 group-hover:opacity-100")} onClick={() => onToggle(el.id, { locked: !el.locked })} aria-label={el.locked ? "Unlock" : "Lock"}>
              {el.locked ? <Lock /> : <LockOpen />}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AssetPicker({ assets, onPick, sessionHint }: { assets: Asset[]; onPick: (a: Asset) => void; sessionHint?: string[] }) {
  const [q, setQ] = React.useState("");
  const [onlySession, setOnlySession] = React.useState(!!sessionHint?.length);
  const list = assets
    .filter((a) => a.kind !== "ad")
    .filter((a) => !onlySession || !sessionHint?.length || (a.sessionId && sessionHint.includes(a.sessionId)) || a.kind === "portrait")
    .filter((a) => !q || `${a.caption} ${a.fileName} ${a.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-2">
      <Input inputSize="sm" leading={<Search />} placeholder="Search photographs…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Search photographs" />
      {sessionHint?.length ? (
        <label className="flex items-center gap-1.5 text-xs text-ink-3">
          <Switch checked={onlySession} onCheckedChange={setOnlySession} /> This article&apos;s sessions only
        </label>
      ) : null}
      <div className="grid grid-cols-3 gap-1.5">
        {list.slice(0, 90).map((a) => (
          <button key={a.id} onClick={() => onPick(a)} className="group relative aspect-[4/3] overflow-hidden rounded-sm ring-accent hover:ring-2" title={a.caption}>
            {a.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.url} alt={a.caption ?? ""} className="h-full w-full object-cover" />
            ) : (
              <PlaceholderPhoto seed={a.seed} tag={a.tags[0] ?? "stage"} className="h-full w-full" />
            )}
            {a.widthPx < 2000 && <span className="absolute bottom-0.5 right-0.5 rounded bg-warning-dot px-1 text-[8px] font-bold text-white">LOW</span>}
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="py-4 text-center text-xs text-ink-3">No photographs match.</p>}
      <p className="text-[11px] text-ink-4">
        Manage the library in <Link href="/app/media?tab=photos" className="text-accent hover:underline">Event Media</Link>.
      </p>
    </div>
  );
}

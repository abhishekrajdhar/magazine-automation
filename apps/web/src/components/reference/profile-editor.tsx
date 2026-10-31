"use client";

import * as React from "react";
import { PenLine } from "lucide-react";
import type { DesignProfile, TextRole } from "@/lib/domain/types";
import { useWorkspace } from "@/lib/store/workspace";
import { Badge, Panel, PanelHeader } from "@/components/ui/display";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/overlays";
import { Progress, Switch, Tooltip } from "@/components/ui/primitives";
import { fontStack, PREVIEW_FONTS } from "@/components/magazine/text-style";
import { cn } from "@/lib/utils/cn";

const ROLE_ORDER: TextRole[] = ["headline", "deck", "kicker", "byline", "body", "subhead", "pullquote", "caption", "question", "stat", "folio"];
const ROLE_LABEL: Record<TextRole, string> = {
  headline: "Headline",
  deck: "Standfirst",
  kicker: "Kicker",
  byline: "Byline",
  body: "Body",
  subhead: "Subhead",
  pullquote: "Pull quote",
  caption: "Caption",
  question: "Q&A question",
  stat: "Figure",
  folio: "Folio",
};
const SPECIMEN: Record<TextRole, string> = {
  headline: "Building the Rails",
  deck: "How states are moving services online",
  kicker: "Event report",
  byline: "By Kavya Iyer",
  body: "The rails are built; the question is what runs on them.",
  subhead: "From pilots to platforms",
  pullquote: "Trust compounds.",
  caption: "Delegates at the inaugural session",
  question: "What should a smaller city do first?",
  stat: "286",
  folio: "12 | eGov · November 2026",
};

const mm = (pt: number) => `${Math.round((pt / 72) * 25.4 * 10) / 10} mm`;

function NumberField({ label, value, onCommit, step = 0.5, min = 0, suffix = "pt", overridden, hint }: { label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number; suffix?: string; overridden?: boolean; hint?: string }) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n >= min && n !== value) onCommit(Math.round(n * 100) / 100);
    else setDraft(String(value));
  };
  return (
    <div className="flex flex-col gap-1">
      <Label className="flex items-center gap-1 text-xs font-normal text-ink-3">
        {label}
        {overridden && (
          <Tooltip content="Corrected by a person">
            <PenLine className="size-3 text-accent" />
          </Tooltip>
        )}
      </Label>
      <Input inputSize="sm" type="number" step={step} min={min} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} trailing={<span className="pr-1.5 text-[11px] text-ink-4">{suffix}</span>} />
      {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
    </div>
  );
}

export function ProfileEditor({ profile, readOnly }: { profile: DesignProfile; readOnly?: boolean }) {
  const updateProfile = useWorkspace((s) => s.updateProfile);
  const set = (path: string, value: unknown) => !readOnly && updateProfile(profile.id, path, value);
  const ov = (path: string) => profile.overrides.includes(path);

  return (
    <div className={cn("flex flex-col gap-5", readOnly && "pointer-events-none opacity-70")}>
      <Panel>
        <PanelHeader title="Page & grid" description={`${mm(profile.page.widthPt)} × ${mm(profile.page.heightPt)} · ${profile.page.orientation}`} actions={<ConfidencePill value={profile.confidence.grid ?? profile.confidence.overall} />} />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <NumberField label="Trim width" value={profile.page.widthPt} onCommit={(v) => set("page.widthPt", v)} overridden={ov("page.widthPt")} hint={mm(profile.page.widthPt)} />
          <NumberField label="Trim height" value={profile.page.heightPt} onCommit={(v) => set("page.heightPt", v)} overridden={ov("page.heightPt")} hint={mm(profile.page.heightPt)} />
          <NumberField label="Bleed" value={profile.page.bleedPt} onCommit={(v) => set("page.bleedPt", v)} overridden={ov("page.bleedPt")} hint={mm(profile.page.bleedPt)} />
          <NumberField label="Baseline" value={profile.grid.baselinePt} step={0.25} onCommit={(v) => set("grid.baselinePt", v)} overridden={ov("grid.baselinePt")} />
          <NumberField label="Margin top" value={profile.margins.top} onCommit={(v) => set("margins.top", v)} overridden={ov("margins.top")} />
          <NumberField label="Margin bottom" value={profile.margins.bottom} onCommit={(v) => set("margins.bottom", v)} overridden={ov("margins.bottom")} />
          <NumberField label="Inside (spine)" value={profile.margins.inside} onCommit={(v) => set("margins.inside", v)} overridden={ov("margins.inside")} />
          <NumberField label="Outside" value={profile.margins.outside} onCommit={(v) => set("margins.outside", v)} overridden={ov("margins.outside")} />
          <NumberField label="Columns" value={profile.grid.columns} step={1} min={1} suffix="" onCommit={(v) => set("grid.columns", Math.max(1, Math.min(6, Math.round(v))))} overridden={ov("grid.columns")} />
          <NumberField label="Gutter" value={profile.grid.gutterPt} onCommit={(v) => set("grid.gutterPt", v)} overridden={ov("grid.gutterPt")} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Typography" description="Font names are read from the PDF and are never guaranteed. Previews use the substitute shown." actions={<ConfidencePill value={profile.confidence.typography ?? profile.confidence.overall} />} />
        <div className="divide-y divide-line">
          {ROLE_ORDER.map((role) => {
            const st = profile.typography[role];
            if (!st) return null;
            const base = `typography.${role}`;
            return (
              <div key={role} className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[150px_1fr]">
                <div>
                  <p className="text-sm font-medium">{ROLE_LABEL[role]}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3" title={st.detectedFont}>
                    {st.detectedFont ?? "not detected"}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-4">{Math.round(st.confidence * 100)}% confidence</p>
                </div>
                <div className="min-w-0">
                  <div className="truncate" style={{ fontFamily: fontStack(st.previewFont, st.classification), fontSize: Math.min(st.size, 30), lineHeight: 1.2, fontWeight: st.weight, letterSpacing: `${st.tracking / 1000}em`, color: st.color, textTransform: st.uppercase ? "uppercase" : undefined, fontStyle: st.italic ? "italic" : undefined }}>
                    {SPECIMEN[role]}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="col-span-2 flex flex-col gap-1 sm:col-span-4">
                      <Label className="text-xs font-normal text-ink-3">Preview font</Label>
                      <Select size="sm" value={st.previewFont} onValueChange={(v) => set(`${base}.previewFont`, v)} options={PREVIEW_FONTS.map((f) => ({ value: f.name, label: f.name }))} aria-label={`${ROLE_LABEL[role]} preview font`} />
                    </div>
                    <NumberField label="Size" value={st.size} onCommit={(v) => set(`${base}.size`, v)} overridden={ov(`${base}.size`)} />
                    <NumberField label="Leading" value={st.leading} onCommit={(v) => set(`${base}.leading`, v)} overridden={ov(`${base}.leading`)} />
                    <NumberField label="Weight" value={st.weight} step={100} min={100} suffix="" onCommit={(v) => set(`${base}.weight`, v)} overridden={ov(`${base}.weight`)} />
                    <NumberField label="Tracking" value={st.tracking} step={5} min={-200} suffix="‰" onCommit={(v) => set(`${base}.tracking`, v)} overridden={ov(`${base}.tracking`)} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-ink-3">
                    <label className="flex items-center gap-1.5">
                      <input type="color" value={st.color} onChange={(e) => set(`${base}.color`, e.target.value.toUpperCase())} className="size-5 cursor-pointer rounded border border-line" aria-label={`${ROLE_LABEL[role]} colour`} />
                      <span className="font-mono">{st.color}</span>
                    </label>
                    <label className="flex items-center gap-1.5">
                      <Switch checked={!!st.uppercase} onCheckedChange={(c) => set(`${base}.uppercase`, c)} /> Caps
                    </label>
                    <label className="flex items-center gap-1.5">
                      <Switch checked={!!st.italic} onCheckedChange={(c) => set(`${base}.italic`, c)} /> Italic
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Colour" actions={<ConfidencePill value={profile.confidence.colors ?? profile.confidence.overall} />} />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
          {(["ink", "paper", "accent", "accentAlt", "muted", "rule"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2.5 rounded-md border border-line px-2.5 py-2">
              <input type="color" value={profile.colors[k]} onChange={(e) => set(`colors.${k}`, e.target.value.toUpperCase())} className="size-7 cursor-pointer rounded border border-line" />
              <span className="min-w-0">
                <span className="block text-sm capitalize">{k === "accentAlt" ? "Second accent" : k}</span>
                <span className="block font-mono text-[11px] text-ink-3">{profile.colors[k]}</span>
              </span>
              {ov(`colors.${k}`) && <PenLine className="ml-auto size-3 text-accent" />}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <span className="text-xs text-ink-3">Detected palette</span>
          {profile.colors.palette.map((c) => (
            <Tooltip key={c} content={c}>
              <span className="size-6 rounded border border-black/10" style={{ background: c }} />
            </Tooltip>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Page furniture" />
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-normal text-ink-3">Folio position</Label>
            <Select size="sm" value={profile.folio.position} onValueChange={(v) => set("folio.position", v)} options={[{ value: "bottom_outside", label: "Bottom, outside edge" }, { value: "bottom_center", label: "Bottom, centred" }, { value: "top_outside", label: "Top, outside edge" }]} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-normal text-ink-3">Pull-quote style</Label>
            <Select size="sm" value={profile.pullQuote.style} onValueChange={(v) => set("pullQuote.style", v)} options={[{ value: "rule_above", label: "Rule above" }, { value: "quote_mark", label: "Large quote mark" }, { value: "boxed", label: "Tinted box" }]} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-normal text-ink-3">Caption placement</Label>
            <Select size="sm" value={profile.images.captionPlacement} onValueChange={(v) => set("images.captionPlacement", v)} options={[{ value: "below", label: "Below image" }, { value: "overlay", label: "Over image" }, { value: "side", label: "Beside image" }]} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={profile.folio.showMagazineName} onCheckedChange={(c) => set("folio.showMagazineName", c)} /> Magazine name in folio
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={profile.folio.showSection} onCheckedChange={(c) => set("folio.showSection", c)} /> Section in folio
          </label>
          <NumberField label="Image corner radius" value={profile.images.cornerRadius} onCommit={(v) => set("images.cornerRadius", v)} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Analysis confidence" description="Low-confidence properties are worth checking against the PDF." />
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
          {Object.entries(profile.confidence).map(([k, v]) => (
            <div key={k}>
              <div className="flex justify-between text-xs">
                <span className="capitalize text-ink-2">{k.replace(/([A-Z])/g, " $1")}</span>
                <span className={cn("tabular", v < 0.7 ? "text-warning" : "text-ink-3")}>{Math.round(v * 100)}%</span>
              </div>
              <Progress className="mt-1" value={v * 100} tone={v < 0.7 ? "warning" : "success"} />
            </div>
          ))}
        </div>
        {profile.overrides.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-3">
            <span className="text-xs text-ink-3">Corrected by people:</span>
            {profile.overrides.map((o) => (
              <Badge key={o} tone="accent" className="font-mono">
                {o}
              </Badge>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  return <Badge tone={value < 0.7 ? "warning" : "success"}>{Math.round(value * 100)}% confidence</Badge>;
}

"use client";

import { Check, Copy, Shuffle, Sparkles } from "lucide-react";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/overlays";
import { Checkbox, Switch } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/display";
import { articleTypeLabel } from "@/lib/domain/status";
import type { ArticleType, DesignMode, GenerationConfig } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";

const MODES: { value: DesignMode; title: string; body: string; icon: typeof Copy; recommended?: boolean }[] = [
  { value: "exact_reference", title: "Exact reference-style reproduction", body: "Reuse the reference's grid, type, colours and page archetypes as closely as the analysis allows.", icon: Copy, recommended: true },
  { value: "adapted_reference", title: "Adapted reference", body: "Keep the type and palette; let the planner vary page structures for this event's content.", icon: Shuffle },
  { value: "house_style", title: "PressFlow house style", body: "Built-in templates with the profile's typography. For publications without a reference.", icon: Sparkles },
];

const ARTICLE_TYPES = Object.keys(articleTypeLabel) as ArticleType[];

export function ConfigStep({ value, onChange }: { value: GenerationConfig; onChange: (v: GenerationConfig) => void }) {
  const set = <K extends keyof GenerationConfig>(k: K, v: GenerationConfig[K]) => onChange({ ...value, [k]: v });
  const toggleType = (t: ArticleType) => set("articleTypes", value.articleTypes.includes(t) ? value.articleTypes.filter((x) => x !== t) : [...value.articleTypes, t]);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="text-sm font-semibold">Design mode</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          {MODES.map((m) => {
            const active = value.designMode === m.value;
            return (
              <button
                key={m.value}
                onClick={() => set("designMode", m.value)}
                className={cn("relative flex flex-col gap-2 rounded-lg border bg-surface p-4 text-left transition-colors", active ? "border-accent ring-2 ring-accent/15" : "border-line hover:border-line-strong")}
                aria-pressed={active}
              >
                <div className="flex items-center justify-between">
                  <m.icon className={cn("size-4", active ? "text-accent" : "text-ink-3")} />
                  {active ? <Check className="size-4 text-accent" /> : m.recommended ? <Badge tone="accent">Default</Badge> : null}
                </div>
                <p className="text-sm font-medium">{m.title}</p>
                <p className="text-xs leading-relaxed text-ink-3">{m.body}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3">
        <Field label="Target page count" htmlFor="cfg-pages" hint="Multiples of 4.">
          <Input id="cfg-pages" type="number" min={4} step={4} value={value.targetPageCount} onChange={(e) => set("targetPageCount", Number(e.target.value))} />
        </Field>
        <Field label="Content style" htmlFor="cfg-style">
          <Select id="cfg-style" value={value.contentStyle} onValueChange={(v) => set("contentStyle", v)} options={[{ value: "news", label: "News — tight, factual" }, { value: "feature", label: "Feature — narrative" }, { value: "analytical", label: "Analytical — context and implications" }, { value: "conversational", label: "Conversational — Q&A led" }]} />
        </Field>
        <Field label="Editorial tone" htmlFor="cfg-tone">
          <Select id="cfg-tone" value={value.editorialTone} onValueChange={(v) => set("editorialTone", v)} options={[{ value: "authoritative", label: "Authoritative" }, { value: "neutral", label: "Neutral" }, { value: "analytical", label: "Analytical" }, { value: "celebratory", label: "Celebratory" }]} />
        </Field>
        <Field label="Language" htmlFor="cfg-lang">
          <Select id="cfg-lang" value={value.language} onValueChange={(v) => set("language", v)} options={[{ value: "en", label: "English" }, { value: "hi", label: "Hindi" }, { value: "en-hi", label: "English with Hindi quotations" }]} />
        </Field>
        <Field label="Image selection" htmlFor="cfg-img">
          <Select id="cfg-img" value={value.imagePreference} onValueChange={(v) => set("imagePreference", v)} options={[{ value: "speakers_first", label: "Speakers first" }, { value: "stage_wide", label: "Wide stage shots" }, { value: "balanced", label: "Balanced mix" }, { value: "audience", label: "Audience & atmosphere" }]} />
        </Field>
        <Field label="Advertisement pages" htmlFor="cfg-ads" hint={value.includeAdvertisements ? "Reserved slots; creatives are added later." : "Disabled"}>
          <Input id="cfg-ads" type="number" min={0} max={40} disabled={!value.includeAdvertisements} value={value.adPageCount} onChange={(e) => set("adPageCount", Math.max(0, Number(e.target.value)))} />
        </Field>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Sections</h3>
          <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {(
              [
                ["includeToc", "Table of contents", "Generated from the flatplan and kept in sync."],
                ["includeEditorial", "Editorial", "Editor's note drafted for review."],
                ["includeEventReports", "Event reports", "Session-by-session coverage."],
                ["includeInterviews", "Interviews", "Q&A edited from speakers' own words."],
                ["includeAdvertisements", "Advertisements", "Reserve ad positions in the flatplan."],
              ] as const
            ).map(([key, label, hint]) => (
              <label key={key} className="flex cursor-pointer items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{label}</span>
                  <span className="block text-xs text-ink-3">{hint}</span>
                </span>
                <Switch checked={value[key]} onCheckedChange={(c) => set(key, c)} aria-label={label} />
              </label>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Article types to draft</h3>
          <div className="mt-3 grid grid-cols-1 gap-1 rounded-lg border border-line bg-surface p-2 sm:grid-cols-2">
            {ARTICLE_TYPES.map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 hover:bg-subtle">
                <Checkbox checked={value.articleTypes.includes(t)} onCheckedChange={() => toggleType(t)} />
                <span className="text-sm">{articleTypeLabel[t]}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-3">Drafts are generated only from facts an editor has approved, and every draft needs approval before it can be exported.</p>
        </div>
      </section>
    </div>
  );
}

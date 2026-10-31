"use client";

import * as React from "react";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/overlays";

export interface ProjectDetails {
  title: string;
  eventName: string;
  category: string;
  issueNumber: string;
  publicationDate: string;
  publisher: string;
  targetPageCount: number;
  description: string;
}

export const CATEGORIES = ["Government Technology", "Healthcare", "Education", "Banking & Finance", "Urban Development", "Agriculture", "Industry & Manufacturing", "Other"];

export function validateDetails(d: ProjectDetails): Partial<Record<keyof ProjectDetails, string>> {
  const e: Partial<Record<keyof ProjectDetails, string>> = {};
  if (d.title.trim().length < 3) e.title = "Give the magazine issue a title (at least 3 characters).";
  if (d.eventName.trim().length < 3) e.eventName = "Enter the event this issue covers.";
  if (!d.category) e.category = "Choose a publication category.";
  if (!d.issueNumber.trim()) e.issueNumber = "Enter the volume/issue, e.g. Vol. 22 · Issue 11.";
  if (!d.publicationDate || Number.isNaN(new Date(d.publicationDate).getTime())) e.publicationDate = "Choose a publication date.";
  if (!d.publisher.trim()) e.publisher = "Enter the publishing organisation.";
  if (!Number.isInteger(d.targetPageCount) || d.targetPageCount < 4 || d.targetPageCount > 200) e.targetPageCount = "Between 4 and 200 pages.";
  else if (d.targetPageCount % 4 !== 0) e.targetPageCount = "Printed magazines are bound in multiples of 4 pages.";
  if (d.description.length > 600) e.description = "Keep the description under 600 characters.";
  return e;
}

export function ProjectFields({ value, onChange, errors }: { value: ProjectDetails; onChange: (v: ProjectDetails) => void; errors: Partial<Record<keyof ProjectDetails, string>> }) {
  const set = <K extends keyof ProjectDetails>(k: K, v: ProjectDetails[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
      <Field label="Magazine title" htmlFor="title" error={errors.title} className="md:col-span-2" hint="As it will appear on the cover and in exports.">
        <Input id="title" value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="eGov — National eGovernance Summit 2026 Special" aria-invalid={!!errors.title} />
      </Field>
      <Field label="Event name" htmlFor="event" error={errors.eventName}>
        <Input id="event" value={value.eventName} onChange={(e) => set("eventName", e.target.value)} placeholder="National eGovernance Summit 2026" aria-invalid={!!errors.eventName} />
      </Field>
      <Field label="Publication category" htmlFor="category" error={errors.category}>
        <Select id="category" value={value.category || undefined} onValueChange={(v) => set("category", v)} placeholder="Choose a category" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
      </Field>
      <Field label="Issue number" htmlFor="issue" error={errors.issueNumber}>
        <Input id="issue" value={value.issueNumber} onChange={(e) => set("issueNumber", e.target.value)} placeholder="Vol. 22 · Issue 11" aria-invalid={!!errors.issueNumber} />
      </Field>
      <Field label="Publication date" htmlFor="pubdate" error={errors.publicationDate}>
        <Input id="pubdate" type="date" value={value.publicationDate} onChange={(e) => set("publicationDate", e.target.value)} aria-invalid={!!errors.publicationDate} />
      </Field>
      <Field label="Organisation" htmlFor="publisher" error={errors.publisher}>
        <Input id="publisher" value={value.publisher} onChange={(e) => set("publisher", e.target.value)} placeholder="Elets Technomedia Pvt. Ltd." aria-invalid={!!errors.publisher} />
      </Field>
      <Field label="Target page count" htmlFor="pages" error={errors.targetPageCount} hint="Multiples of 4 for saddle-stitched print.">
        <Input id="pages" type="number" min={4} max={200} step={4} value={value.targetPageCount} onChange={(e) => set("targetPageCount", Number(e.target.value))} aria-invalid={!!errors.targetPageCount} />
      </Field>
      <Field label="Description" htmlFor="desc" error={errors.description} optional className="md:col-span-2">
        <Textarea id="desc" value={value.description} onChange={(e) => set("description", e.target.value)} placeholder="What this issue covers, for the editorial team." rows={3} />
      </Field>
    </div>
  );
}

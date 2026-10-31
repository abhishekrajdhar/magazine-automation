"use client";

import * as React from "react";
import { BookOpen, Check, FileText, FileUp, Layers, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, SimulatedBadge } from "@/components/ui/display";
import { Segmented } from "@/components/ui/primitives";
import { ReferenceStructure } from "@/components/reference/reference-structure";
import { isPdf, openPdf, renderPdfPage, summarisePdf } from "@/lib/pdf/preview";
import { formatBytes, formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { DraftReference } from "./types";

const MAX_PDF = 500 * 1024 ** 2;
const SAMPLE_URL = "/samples/pressflow-sample-reference.pdf";

export function ReferenceStep({ value, onChange, apiOnline, uploadOnly }: { value: DraftReference; onChange: (v: DraftReference) => void; apiOnline: boolean; uploadOnly?: boolean }) {
  const references = useWorkspace((s) => s.references);
  const referencePages = useWorkspace((s) => s.referencePages);
  const profiles = useWorkspace((s) => s.designProfiles);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const inddInput = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [sampleAvailable, setSampleAvailable] = React.useState(false);

  React.useEffect(() => {
    fetch(SAMPLE_URL, { method: "HEAD" })
      .then((r) => setSampleAvailable(r.ok && (r.headers.get("content-type") ?? "").includes("pdf")))
      .catch(() => setSampleAvailable(false));
  }, []);

  const load = async (source: File | string, meta: { fileName: string; fileSize: number }) => {
    onChange({ ...value, mode: "upload", status: "loading", fileName: meta.fileName, fileSize: meta.fileSize, file: typeof source === "string" ? undefined : source, sampleUrl: typeof source === "string" ? source : undefined, error: undefined, thumbs: [] });
    try {
      const doc = await openPdf(source);
      const summary = await summarisePdf(doc);
      const thumbs: string[] = [];
      for (let i = 1; i <= Math.min(6, doc.numPages); i += 1) thumbs.push(await renderPdfPage(doc, i, 150));
      onChange({ ...value, mode: "upload", status: "ready", fileName: meta.fileName, fileSize: meta.fileSize, file: typeof source === "string" ? undefined : source, sampleUrl: typeof source === "string" ? source : undefined, pageCount: summary.pageCount, sizeLabel: summary.sizeLabel, thumbs, libraryId: undefined, inddFile: value.inddFile });
      await doc.destroy();
    } catch (err) {
      onChange({ ...value, mode: "upload", status: "error", error: `This PDF couldn't be opened (${(err as Error).message}). It may be encrypted or damaged.` });
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_PDF) return toast.error("Reference PDFs can be up to 500 MB.");
    if (!(await isPdf(file))) return toast.error(`${file.name} isn't a PDF.`);
    await load(file, { fileName: file.name, fileSize: file.size });
  };

  const useSample = async () => {
    const res = await fetch(SAMPLE_URL);
    const blob = await res.blob();
    await load(new File([blob], "pressflow-sample-reference.pdf", { type: "application/pdf" }), { fileName: "pressflow-sample-reference.pdf", fileSize: blob.size });
  };

  return (
    <div className="flex flex-col gap-5">
      {!uploadOnly && <Segmented
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        options={[
          { value: "upload", label: "Upload a PDF", icon: <FileUp /> },
          { value: "library", label: `From library (${references.length})`, icon: <BookOpen /> },
        ]}
      />}

      {value.mode === "upload" ? (
        value.status === "empty" || value.status === "error" ? (
          <div
            className={cn("flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors", dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-subtle")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files[0]);
            }}
          >
            <FileText className="size-7 text-ink-3" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium">Drop a previous issue as PDF</p>
            <p className="mt-1 max-w-sm text-xs text-ink-3">Use the print or high-quality export of a magazine whose design this issue should follow. Up to 500 MB.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
                Choose PDF
              </Button>
              {sampleAvailable && (
                <Button variant="ghost" size="sm" onClick={useSample}>
                  Use sample reference PDF
                </Button>
              )}
            </div>
            {value.error && <p className="mt-4 text-xs text-danger">{value.error}</p>}
            <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <FileText className="size-5 text-ink-3" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{value.fileName}</p>
                <p className="text-xs text-ink-3">
                  {value.status === "loading" ? "Reading PDF…" : `${value.pageCount} pages · ${value.sizeLabel} · ${formatBytes(value.fileSize)}`}
                </p>
              </div>
              <Badge tone={value.status === "ready" ? "success" : "accent"} dot>
                {value.status === "loading" ? <Loader2 className="animate-spin" /> : <Check />}
                {value.status === "loading" ? "Reading" : "Preview ready"}
              </Badge>
              <Badge tone={apiOnline ? "neutral" : "warning"}>{apiOnline ? "Analysis runs after creation" : "Analysis needs the API"}</Badge>
              <Button variant="ghost" size="icon-sm" onClick={() => onChange({ mode: "upload", status: "empty" })} aria-label="Remove PDF">
                <X />
              </Button>
            </div>
            <div className="scroll-thin flex gap-3 overflow-x-auto p-4">
              {value.status === "loading"
                ? Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-[212px] w-[150px] shrink-0" />)
                : value.thumbs?.map((t, i) => (
                    <figure key={i} className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t} alt={`Page ${i + 1}`} className="w-[150px] border border-line shadow-sm" />
                      <figcaption className="mt-1 text-center text-[11px] text-ink-4">p.{i + 1}</figcaption>
                    </figure>
                  ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-line bg-subtle px-4 py-3 text-xs text-ink-3">
              <Layers className="size-4" />
              <span className="flex-1">Have the original InDesign package? Adding the .indd or .idml gives exact style names and masters.</span>
              {value.inddFile ? (
                <Badge tone="accent">
                  {value.inddFile.name}
                  <button onClick={() => onChange({ ...value, inddFile: undefined })} aria-label="Remove design source">
                    <X />
                  </button>
                </Badge>
              ) : (
                <Button variant="secondary" size="xs" onClick={() => inddInput.current?.click()}>
                  Add .indd / .idml
                </Button>
              )}
              <input
                ref={inddInput}
                type="file"
                accept=".indd,.idml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && /\.(indd|idml)$/i.test(f.name)) onChange({ ...value, inddFile: f });
                  else if (f) toast.error("Choose an .indd or .idml file.");
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        )
      ) : references.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState compact icon={<BookOpen />} title="No references yet" description="Upload a PDF to add it to the library." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {references.map((r) => {
            const selected = value.libraryId === r.id;
            const profile = profiles.find((d) => d.id === r.designProfileId);
            const pages = referencePages.filter((p) => p.referenceId === r.id).slice(0, 3);
            return (
              <button
                key={r.id}
                onClick={() => onChange({ mode: "library", status: "ready", libraryId: r.id })}
                className={cn("flex gap-4 rounded-lg border bg-surface p-4 text-left transition-colors", selected ? "border-accent ring-2 ring-accent/15" : "border-line hover:border-line-strong")}
              >
                <div className="flex shrink-0 gap-1">
                  {pages.map((p) => (
                    <ReferenceStructure key={p.id} page={p} width={46} className="border border-line" />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    {r.isDemo && <SimulatedBadge label="Demo" />}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {r.pageCount} pages · added {formatDate(r.uploadedAt)}
                  </p>
                  {profile && (
                    <p className="mt-2 text-xs text-ink-2">
                      {profile.grid.columns}-column grid · {profile.typography.body.size}/{profile.typography.body.leading} pt body · profile {profile.status}
                    </p>
                  )}
                </div>
                {selected && <Check className="size-4 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

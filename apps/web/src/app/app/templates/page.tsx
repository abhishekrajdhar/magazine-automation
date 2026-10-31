"use client";

import * as React from "react";
import Link from "next/link";
import { LibraryBig, Shapes, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { useProjectData } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/display";
import { Dialog, DialogContent, useConfirm } from "@/components/ui/overlays";
import { Segmented } from "@/components/ui/primitives";
import { TemplatePreview } from "@/components/designer/template-preview";
import { ROLE_COLORS } from "@/components/reference/reference-structure";
import { templateSpecs } from "@/lib/templates/specs";
import { resolveSlots, resolveTemplate } from "@/lib/templates/compose";
import { pageTypeLabel } from "@/lib/templates/derive";
import type { PageType } from "@/lib/domain/types";

interface Row {
  id: string;
  name: string;
  pageType: PageType;
  description: string;
  source: "builtin" | "reference";
  position?: string;
}

export default function TemplatesPage() {
  const confirm = useConfirm();
  const data = useProjectData();
  const { profile, pages } = data;
  const derived = useWorkspace((s) => s.templates);
  const removeTemplate = useWorkspace((s) => s.removeTemplate);
  const [source, setSource] = React.useState<"all" | "builtin" | "reference">("all");
  const [type, setType] = React.useState<PageType | "all">("all");
  const [open, setOpen] = React.useState<Row | null>(null);

  const rows: Row[] = [
    ...templateSpecs.map((t) => ({ id: t.id, name: t.name, pageType: t.pageType, description: t.description, source: "builtin" as const, position: t.position })),
    ...derived.map((t) => ({ id: t.id, name: t.name, pageType: t.pageType, description: t.description, source: "reference" as const })),
  ];
  const types = Array.from(new Set(rows.map((r) => r.pageType)));
  const list = rows.filter((r) => (source === "all" || r.source === source) && (type === "all" || r.pageType === type));
  const usage = (id: string) => pages.filter((p) => p.templateId === id).length;

  if (!profile) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-16">
        <Panel>
          <EmptyState icon={<Shapes />} title="No design profile" description="Templates are previewed against the active project's design profile." action={<Button variant="primary" asChild><Link href="/app/references">Reference Library</Link></Button>} />
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-7">
      <PageHeader
        title="Templates"
        description={`Page archetypes, shown on the ${profile.grid.columns}-column grid of “${profile.name}”. Built-in templates snap to any reference grid; reconstructed ones copy a specific reference page.`}
        actions={
          <Button variant="secondary" asChild>
            <Link href="/app/references">
              <LibraryBig /> Reconstruct from a reference page
            </Link>
          </Button>
        }
      />
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Segmented value={source} onChange={setSource} options={[{ value: "all", label: `All ${rows.length}` }, { value: "builtin", label: "Built-in" }, { value: "reference", label: `From references ${derived.length}` }]} />
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setType("all")} className={`h-7 rounded-full border px-3 text-xs ${type === "all" ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2"}`}>
            All types
          </button>
          {types.map((t) => (
            <button key={t} onClick={() => setType(t)} className={`h-7 rounded-full border px-3 text-xs ${type === t ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2"}`}>
              {pageTypeLabel(t)}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {list.map((t) => (
          <button key={t.id} onClick={() => setOpen(t)} className="group flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-left shadow-xs transition-shadow hover:shadow-md">
            <div className="canvas-backdrop flex justify-center py-5">
              <TemplatePreview templateId={t.id} profile={profile} width={120} />
            </div>
            <div className="flex flex-1 flex-col gap-1.5 border-t border-line p-3">
              <p className="text-sm font-medium leading-snug group-hover:text-accent">{t.name}</p>
              <div className="mt-auto flex flex-wrap items-center gap-1">
                <Badge tone={t.source === "reference" ? "accent" : "neutral"}>{t.source === "reference" ? "Reference" : "Built-in"}</Badge>
                {t.position && t.position !== "single" && <Badge tone="outline">{t.position}</Badge>}
                {usage(t.id) > 0 && <span className="ml-auto text-[11px] text-ink-3">{usage(t.id)} pages</span>}
              </div>
            </div>
          </button>
        ))}
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <DialogContent
            title={open.name}
            description={open.description}
            size="lg"
            footer={
              open.source === "reference" ? (
                <Button
                  variant="danger-ghost"
                  onClick={async () => {
                    if (usage(open.id) > 0) return toast.error(`In use on ${usage(open.id)} pages — change their template first.`);
                    if (await confirm({ title: "Delete this template?", confirmLabel: "Delete", tone: "danger" })) {
                      removeTemplate(open.id);
                      setOpen(null);
                    }
                  }}
                >
                  <Trash2 /> Delete template
                </Button>
              ) : undefined
            }
          >
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-[auto_1fr]">
              <div className="flex gap-2">
                <div className="flex flex-col items-center gap-1">
                  <TemplatePreview templateId={open.id} profile={profile} pageNumber={2} width={150} />
                  <span className="text-[11px] text-ink-4">Left page</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <TemplatePreview templateId={open.id} profile={profile} pageNumber={1} width={150} />
                  <span className="text-[11px] text-ink-4">Right page</span>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-4">Frames</p>
                <ul className="mt-2 divide-y divide-line text-sm">
                  {(() => {
                    const tpl = resolveTemplate(open.id, derived);
                    return tpl
                      ? resolveSlots(tpl, profile, 1).map((s) => (
                          <li key={s.id} className="flex items-center gap-2 py-1.5">
                            <span className="size-2 rounded-full" style={{ background: ROLE_COLORS[s.role === "hero_image" || s.role === "portrait" ? "image" : s.role] ?? "#9aa1ae" }} />
                            <span className="flex-1 capitalize">{s.role.replace("_", " ")}</span>
                            <span className="tabular font-mono text-[11px] text-ink-3">
                              {Math.round(s.w)}×{Math.round(s.h)} pt{s.columns > 1 ? ` · ${s.columns} col` : ""}
                            </span>
                          </li>
                        ))
                      : null;
                  })()}
                </ul>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

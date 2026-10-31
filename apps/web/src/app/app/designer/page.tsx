"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CircleCheck, CircleDashed, Copy, FilePlus2, Lock, LockOpen, PanelsTopLeft, PencilRuler, Redo2, ShieldCheck, Sparkles, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { useProjectData } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, Panel, PanelHeader } from "@/components/ui/display";
import { Dialog, DialogContent, Select, useConfirm } from "@/components/ui/overlays";
import { Slider, Switch, Tooltip } from "@/components/ui/primitives";
import { PageThumb } from "@/components/magazine/page-thumb";
import { designStatus } from "@/lib/domain/status";
import type { DesignStatus, MagazinePage, PageType } from "@/lib/domain/types";
import { pageTypeLabel } from "@/lib/templates/derive";
import { specsForPageType, templateSpecs } from "@/lib/templates/specs";
import { recommendFlatplan, type Recommendation } from "@/lib/planner/recommend";
import { cn } from "@/lib/utils/cn";

const PAGE_TYPES: PageType[] = ["cover", "toc", "editorial", "event_report", "two_column_article", "interview", "photo_gallery", "speaker_profile", "infographic", "full_page_image", "advertisement"];

export default function FlatplanPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const data = useProjectData();
  const { project, profile, pages, articles, assetsById } = data;
  const reorderPages = useWorkspace((s) => s.reorderPages);
  const updatePage = useWorkspace((s) => s.updatePage);
  const changeTemplate = useWorkspace((s) => s.changeTemplate);
  const assignArticle = useWorkspace((s) => s.assignArticle);
  const duplicatePage = useWorkspace((s) => s.duplicatePage);
  const removePage = useWorkspace((s) => s.removePage);
  const insertPage = useWorkspace((s) => s.insertPage);
  const regeneratePages = useWorkspace((s) => s.regeneratePages);
  const undo = useWorkspace((s) => s.undo);
  const redo = useWorkspace((s) => s.redo);
  const history = useWorkspace((s) => (project ? s.history[project.id] : undefined));
  const templates = useWorkspace((s) => s.templates);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [size, setSize] = React.useState(104);
  const [activeDrag, setActiveDrag] = React.useState<string | null>(null);
  const [showSpreads, setShowSpreads] = React.useState(true);
  const [recommendation, setRecommendation] = React.useState<Recommendation | null>(null);
  const [adding, setAdding] = React.useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!project || (e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(project.id);
        else undo(project.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, undo, redo]);

  if (!project) return null;
  if (!profile) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-16">
        <Panel>
          <EmptyState icon={<PanelsTopLeft />} title="No approved design profile" description="Choose or analyse a reference magazine for this project. Pages are composed from its design profile." action={<Button variant="primary" asChild><Link href="/app/references">Reference Library</Link></Button>} />
        </Panel>
      </div>
    );
  }

  const page = pages.find((p) => p.id === selected);
  const pageIndex = page ? pages.indexOf(page) : -1;
  const adIds = data.assets.filter((a) => a.kind === "ad").map((a) => a.id);

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    if (!e.over || e.active.id === e.over.id) return;
    const from = pages.findIndex((p) => p.id === e.active.id);
    const to = pages.findIndex((p) => p.id === e.over!.id);
    if (pages[from]?.locked) return toast.error("This page is locked. Unlock it to move it.");
    reorderPages(project.id, from, to);
    toast.success(`Moved to page ${to + 1}`, { description: "Contents and folios update automatically.", action: { label: "Undo", onClick: () => undo(project.id) } });
  };

  // Spread layout: page 1 sits alone on the right; then left/right pairs.
  const spreads: (MagazinePage | null)[][] = [[null, pages[0] ?? null]];
  for (let i = 1; i < pages.length; i += 2) spreads.push([pages[i], pages[i + 1] ?? null]);
  const counts = {
    approved: pages.filter((p) => p.editorialStatus === "approved").length,
    designed: pages.filter((p) => p.designStatus === "approved" || p.designStatus === "ready").length,
    locked: pages.filter((p) => p.locked).length,
  };

  const thumb = (p: MagazinePage) => (
    <SortablePage
      key={p.id}
      page={p}
      index={pages.indexOf(p)}
      selected={selected === p.id}
      onSelect={() => setSelected(p.id)}
      onOpen={() => router.push(`/app/designer/editor?page=${p.id}`)}
      width={size}
      render={<PageThumb page={p} profile={profile} assets={assetsById} ctx={data.ctxFor(pages.indexOf(p))} width={size} localUrls={data.localUrls} />}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-48px-29px)] min-h-[560px] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
        <div className="min-w-0">
          <h1 className="text-md font-semibold">Flatplan</h1>
          <p className="text-xs text-ink-3">
            {pages.length} of {project.targetPageCount} pages · {counts.approved} editorially approved · {counts.designed} signed off · {counts.locked} locked
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Tooltip content="Undo" shortcut="⌘Z">
            <Button variant="ghost" size="icon-sm" disabled={!history?.past.length} onClick={() => undo(project.id)} aria-label="Undo">
              <Undo2 />
            </Button>
          </Tooltip>
          <Tooltip content="Redo" shortcut="⇧⌘Z">
            <Button variant="ghost" size="icon-sm" disabled={!history?.future.length} onClick={() => redo(project.id)} aria-label="Redo">
              <Redo2 />
            </Button>
          </Tooltip>
          <label className="hidden items-center gap-2 text-xs text-ink-3 md:flex">
            <Switch checked={showSpreads} onCheckedChange={setShowSpreads} /> Spreads
          </label>
          <div className="hidden w-28 items-center md:flex" title="Thumbnail size">
            <Slider min={72} max={180} step={4} value={[size]} onValueChange={([v]) => setSize(v)} aria-label="Thumbnail size" />
          </div>
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <FilePlus2 /> Add page
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setRecommendation(recommendFlatplan(project, articles, profile, adIds, pages))}>
            <Sparkles /> Recommend sequence
          </Button>
          <Button variant="primary" size="sm" asChild>
            <Link href="/app/designer/preflight">
              <ShieldCheck /> Preflight
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="canvas-backdrop scroll-thin min-h-0 flex-1 overflow-y-auto p-6" onClick={() => setSelected(null)}>
          {pages.length === 0 ? (
            <Panel className="mx-auto max-w-lg">
              <EmptyState icon={<PanelsTopLeft />} title="The flatplan is empty" description="Generate a recommended sequence from your approved articles, or add pages one by one." action={<Button variant="primary" onClick={(e) => { e.stopPropagation(); setRecommendation(recommendFlatplan(project, articles, profile, adIds, pages)); }}><Sparkles /> Recommend sequence</Button>} />
            </Panel>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(e) => setActiveDrag(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveDrag(null)}>
              <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
                {showSpreads ? (
                  <div className="flex flex-wrap gap-x-7 gap-y-6">
                    {spreads.map((pair, si) => (
                      <div key={si} className="flex">
                        {pair.map((p, j) => (p ? thumb(p) : <div key={`blank-${j}`} style={{ width: size }} />))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-4">{pages.map(thumb)}</div>
                )}
              </SortableContext>
              <DragOverlay>
                {activeDrag && pages.find((p) => p.id === activeDrag) ? (
                  <div className="rotate-2 opacity-90">
                    <PageThumb page={pages.find((p) => p.id === activeDrag)!} profile={profile} assets={assetsById} ctx={data.ctxFor(pages.findIndex((p) => p.id === activeDrag))} width={size} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>

        {page && (
          <aside className="scroll-thin w-[320px] shrink-0 overflow-y-auto border-l border-line bg-surface" onClick={(e) => e.stopPropagation()}>
            <PanelHeader
              title={`Page ${pageIndex + 1}`}
              description={pageIndex === 0 ? "Front cover" : pageIndex % 2 === 1 ? "Left-hand page" : "Right-hand page"}
              actions={
                <Tooltip content={page.locked ? "Unlock page" : "Lock page — prevents moves and re-flows"}>
                  <Button variant="ghost" size="icon-sm" onClick={() => updatePage(page.id, { locked: !page.locked })} aria-label={page.locked ? "Unlock page" : "Lock page"}>
                    {page.locked ? <Lock className="text-accent" /> : <LockOpen />}
                  </Button>
                </Tooltip>
              }
            />
            <div className="flex flex-col gap-4 p-4">
              <Field label="Label" htmlFor="pg-label">
                <input id="pg-label" className="h-8 rounded-md border border-line px-2.5 text-sm" value={page.label} onChange={(e) => updatePage(page.id, { label: e.target.value }, { history: false })} />
              </Field>
              <Field label="Page type">
                <Select
                  value={page.pageType}
                  disabled={page.locked}
                  onValueChange={(t) => {
                    const tpl = specsForPageType(t)[0];
                    updatePage(page.id, { pageType: t });
                    if (tpl) changeTemplate(page.id, tpl.id);
                  }}
                  options={PAGE_TYPES.map((t) => ({ value: t, label: pageTypeLabel(t) }))}
                />
              </Field>
              <Field label="Template" hint="Re-composes the page; text re-flows across the article's pages.">
                <Select
                  value={page.templateId}
                  disabled={page.locked}
                  onValueChange={(id) => {
                    changeTemplate(page.id, id);
                    toast.success("Template applied");
                  }}
                  options={[
                    ...specsForPageType(page.pageType).map((t) => ({ value: t.id, label: t.name })),
                    ...templateSpecs.filter((t) => !specsForPageType(page.pageType).includes(t) && t.id === page.templateId).map((t) => ({ value: t.id, label: t.name })),
                    ...templates.filter((t) => t.pageType === page.pageType || t.id === page.templateId).map((t) => ({ value: t.id, label: `${t.name} (reference)` })),
                  ]}
                />
              </Field>
              {!["cover", "toc", "advertisement", "full_page_image"].includes(page.pageType) && (
                <Field label="Article">
                  <Select
                    value={page.articleId ?? "none"}
                    disabled={page.locked}
                    onValueChange={(id) => assignArticle(page.id, id === "none" ? undefined : id)}
                    options={[{ value: "none", label: "No article" }, ...articles.map((a) => ({ value: a.id, label: a.headline.replace(/[“”]/g, "").slice(0, 60), description: a.status === "approved" ? "Approved" : "Not approved" }))]}
                  />
                </Field>
              )}
              <Field label="Design status">
                <Select value={page.designStatus} onValueChange={(v: DesignStatus) => updatePage(page.id, { designStatus: v })} options={(Object.keys(designStatus) as DesignStatus[]).map((k) => ({ value: k, label: designStatus[k].label }))} />
              </Field>
              <div className="flex items-center justify-between rounded-md bg-subtle px-3 py-2 text-sm">
                <span className="text-ink-3">Editorial</span>
                {page.editorialStatus === "approved" ? (
                  <Badge tone="success" icon={<CircleCheck />}>
                    Approved
                  </Badge>
                ) : (
                  <Badge tone="warning" icon={<CircleDashed />}>
                    Awaiting approval
                  </Badge>
                )}
              </div>
              <Field label="Notes" optional>
                <Textarea rows={3} value={page.notes ?? ""} onChange={(e) => updatePage(page.id, { notes: e.target.value }, { history: false })} placeholder="For the designer or sub-editor" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="primary" className="col-span-2" asChild>
                  <Link href={`/app/designer/editor?page=${page.id}`}>
                    <PencilRuler /> Open in page editor
                  </Link>
                </Button>
                <Button variant="secondary" size="sm" onClick={() => duplicatePage(page.id)}>
                  <Copy /> Duplicate
                </Button>
                <Button
                  variant="danger-ghost"
                  size="sm"
                  disabled={page.locked}
                  onClick={async () => {
                    if (await confirm({ title: `Remove page ${pageIndex + 1}?`, description: page.articleId ? "The article's text re-flows into its remaining pages. You can undo this." : "You can undo this.", confirmLabel: "Remove page", tone: "danger" })) {
                      removePage(page.id);
                      setSelected(null);
                    }
                  }}
                >
                  <Trash2 /> Remove
                </Button>
              </div>
            </div>
          </aside>
        )}
      </div>

      <AddPageDialog
        open={adding}
        onOpenChange={setAdding}
        articles={articles}
        pageCount={pages.length}
        defaultIndex={pageIndex >= 0 ? pageIndex + 1 : pages.length}
        onAdd={(index, type, templateId, articleId) => {
          const id = insertPage(project.id, index, type, templateId, articleId);
          setSelected(id);
          toast.success(`Page added at position ${index + 1}`);
        }}
      />

      <Dialog open={!!recommendation} onOpenChange={(o) => !o && setRecommendation(null)}>
        {recommendation && (
          <DialogContent
            title="Recommended sequence"
            description="Rule-based planner (not an AI model): editorial weight, article length against template capacity, available images and the reference's structure."
            size="lg"
            footer={
              <>
                <Button variant="secondary" onClick={() => setRecommendation(null)}>
                  Keep current flatplan
                </Button>
                <Button
                  variant="primary"
                  onClick={async () => {
                    if (pages.some((p) => p.locked) && !(await confirm({ title: "Replace the flatplan?", description: `${counts.locked} locked pages will be replaced too. You can undo this from the toolbar.`, confirmLabel: "Replace", tone: "danger" }))) return;
                    regeneratePages(project.id, recommendation.plan);
                    setRecommendation(null);
                    toast.success(`Flatplan rebuilt with ${recommendation.plan.length} pages`, { action: { label: "Undo", onClick: () => undo(project.id) } });
                  }}
                >
                  Apply {recommendation.plan.length}-page plan
                </Button>
              </>
            }
          >
            <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {recommendation.rationale.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <ol className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              {recommendation.plan.map((p, i) => (
                <li key={i} className="flex items-center gap-2 border-b border-line py-1.5 text-sm">
                  <span className="tabular w-6 text-right text-xs text-ink-4">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  <span className="shrink-0 text-xs text-ink-4">{pageTypeLabel(p.pageType)}</span>
                </li>
              ))}
            </ol>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function SortablePage({ page, index, selected, onSelect, onOpen, width, render }: { page: MagazinePage; index: number; selected: boolean; onSelect: () => void; onOpen: () => void; width: number; render: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id, disabled: page.locked });
  const ds = designStatus[page.designStatus];
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, width }}
      className={cn("group relative select-none", isDragging && "opacity-30")}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <div className={cn("relative outline-offset-2 transition-[outline]", selected ? "outline outline-2 outline-accent" : "hover:outline hover:outline-1 hover:outline-ink-4", !page.locked && "cursor-grab active:cursor-grabbing")}>
        {render}
        {page.locked && (
          <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded bg-white/90 text-ink shadow-sm">
            <Lock className="size-3" />
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="tabular text-xs font-semibold text-ink">{index + 1}</span>
        <span className={cn("size-1.5 shrink-0 rounded-full", page.editorialStatus === "approved" ? "bg-success-dot" : "bg-warning-dot")} title={page.editorialStatus === "approved" ? "Editorial approved" : "Awaiting editorial approval"} />
        <span className={cn("size-1.5 shrink-0 rounded-full", ds.tone === "success" ? "bg-success-dot" : ds.tone === "warning" ? "bg-warning-dot" : ds.tone === "accent" ? "bg-accent" : "bg-ink-4")} title={`Design: ${ds.label}`} />
        <span className="min-w-0 truncate text-[11px] text-ink-3" title={page.label}>
          {page.label}
        </span>
      </div>
    </div>
  );
}

function AddPageDialog({ open, onOpenChange, articles, pageCount, defaultIndex, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; articles: { id: string; headline: string }[]; pageCount: number; defaultIndex: number; onAdd: (index: number, type: PageType, templateId: string, articleId?: string) => void }) {
  const [type, setType] = React.useState<PageType>("two_column_article");
  const [templateId, setTemplateId] = React.useState(specsForPageType("two_column_article")[0].id);
  const [articleId, setArticleId] = React.useState("none");
  const [position, setPosition] = React.useState(defaultIndex);
  React.useEffect(() => setPosition(defaultIndex), [defaultIndex, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add page"
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onAdd(Math.max(0, Math.min(pageCount, position)), type, templateId, articleId === "none" ? undefined : articleId);
                onOpenChange(false);
              }}
            >
              Add page
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Page type">
            <Select
              value={type}
              onValueChange={(t) => {
                setType(t);
                setTemplateId(specsForPageType(t)[0]?.id ?? "tpl_article_image");
              }}
              options={PAGE_TYPES.map((t) => ({ value: t, label: pageTypeLabel(t) }))}
            />
          </Field>
          <Field label="Template">
            <Select value={templateId} onValueChange={setTemplateId} options={specsForPageType(type).map((t) => ({ value: t.id, label: t.name, description: t.description }))} />
          </Field>
          <Field label="Article" optional>
            <Select value={articleId} onValueChange={setArticleId} options={[{ value: "none", label: "No article" }, ...articles.map((a) => ({ value: a.id, label: a.headline.replace(/[“”]/g, "").slice(0, 60) }))]} />
          </Field>
          <Field label="Insert as page" hint={`1 – ${pageCount + 1}`}>
            <input type="number" min={1} max={pageCount + 1} value={position + 1} onChange={(e) => setPosition(Number(e.target.value) - 1)} className="h-8 rounded-md border border-line px-2.5 text-sm" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

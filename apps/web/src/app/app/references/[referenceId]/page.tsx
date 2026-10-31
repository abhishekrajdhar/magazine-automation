"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { BadgeCheck, CircleAlert, FileSearch, Layers, LibraryBig, PanelsTopLeft, RefreshCw, ScanSearch, Shapes, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader, SimulatedBadge } from "@/components/ui/display";
import { Dialog, DialogContent, Select, useConfirm } from "@/components/ui/overlays";
import { Segmented, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { ReferencePageThumb } from "@/components/reference/reference-thumb";
import { ROLE_COLORS } from "@/components/reference/reference-structure";
import { ProfileEditor } from "@/components/reference/profile-editor";
import { PageView } from "@/components/magazine/page-view";
import { deriveTemplate, pageTypeLabel } from "@/lib/templates/derive";
import { composeMagazine } from "@/lib/templates/compose";
import { assetMap, buildToc, renderContext } from "@/lib/magazine/context";
import { referenceStatus } from "@/lib/domain/status";
import type { PageType, ReferencePage } from "@/lib/domain/types";
import { useApiStatus } from "@/lib/api/use-api-status";
import { live } from "@/lib/api/live";
import { cn } from "@/lib/utils/cn";
import { formatBytes, formatDate, formatDateTime } from "@/lib/utils/format";

const PAGE_TYPES: PageType[] = ["cover", "editorial", "toc", "interview", "event_report", "two_column_article", "full_page_image", "photo_gallery", "advertisement", "infographic", "speaker_profile"];

export default function ReferenceDetailPage() {
  const { referenceId } = useParams<{ referenceId: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const reference = useWorkspace((s) => s.references.find((r) => r.id === referenceId));
  const allPages = useWorkspace((s) => s.referencePages);
  const profile = useWorkspace((s) => s.designProfiles.find((d) => d.id === reference?.designProfileId));
  const localUrl = useWorkspace((s) => s.localFiles[referenceId]?.url);
  const projects = useWorkspace((s) => s.projects);
  const templates = useWorkspace((s) => s.templates);
  const approveProfile = useWorkspace((s) => s.approveProfile);
  const addTemplate = useWorkspace((s) => s.addTemplate);
  const reflowProject = useWorkspace((s) => s.reflowProject);
  const mode = useWorkspace((s) => s.mode);
  const api = useApiStatus();
  const [filter, setFilter] = React.useState<"all" | PageType | "low">("all");
  const [inspecting, setInspecting] = React.useState<ReferencePage | null>(null);
  const pages = React.useMemo(() => allPages.filter((p) => p.referenceId === referenceId).sort((a, b) => a.pageNumber - b.pageNumber), [allPages, referenceId]);
  const apiLive = mode === "live" && api.online;

  if (!reference) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-16">
        <Panel>
          <EmptyState icon={<LibraryBig />} title="Reference not found" action={<Button asChild variant="secondary"><Link href="/app/references">Reference Library</Link></Button>} />
        </Panel>
      </div>
    );
  }

  const counts = PAGE_TYPES.map((t) => [t, pages.filter((p) => p.layoutType === t).length] as const).filter(([, n]) => n > 0);
  const lowConfidence = pages.filter((p) => p.confidence < 0.7).length;
  const visible = pages.filter((p) => filter === "all" || (filter === "low" ? p.confidence < 0.7 : p.layoutType === filter));
  const usedBy = projects.filter((p) => p.referenceId === reference.id || (profile && p.designProfileId === profile.id));
  const derived = templates.filter((t) => t.id.startsWith(`tpl_ref_${reference.id}_`));

  const derive = (page: ReferencePage) => {
    const t = deriveTemplate(page, reference.title);
    addTemplate(t);
    toast.success(`Template reconstructed from p.${page.pageNumber}`, { description: `${t.slots.length} frames · ${t.columns}-column text`, action: { label: "View templates", onClick: () => router.push("/app/templates") } });
  };

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-7">
      <PageHeader
        meta={
          <>
            <Badge tone={referenceStatus[reference.status].tone} dot>
              {referenceStatus[reference.status].label}
            </Badge>
            <Badge tone="outline" icon={<ScanSearch />}>
              {reference.analysis.analyser === "demo_seed" ? "Seeded demo profile" : reference.analysis.analyser === "pymupdf+vision" ? "PyMuPDF + vision model" : "PyMuPDF layout analysis"}
            </Badge>
            {reference.isDemo && <SimulatedBadge label="Demo" title="Seeded profile. The source PDF isn't bundled, so pages show detected structure only." />}
          </>
        }
        title={reference.title}
        description={`${reference.pageCount} pages · ${reference.fileName} · ${formatBytes(reference.fileSizeBytes)} · uploaded ${formatDate(reference.uploadedAt)}${reference.analysis.completedAt ? ` · analysed ${formatDateTime(reference.analysis.completedAt)}` : ""}`}
        actions={
          profile && (
            <>
              {usedBy.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (!(await confirm({ title: "Re-flow pages with this profile?", description: `Unlocked pages in ${usedBy.length} project${usedBy.length > 1 ? "s" : ""} are re-composed with the current grid, margins and type. Manual frame edits on unlocked pages are replaced. Locked pages are untouched.`, confirmLabel: "Re-flow pages" }))) return;
                    const n = usedBy.reduce((sum, p) => sum + reflowProject(p.id), 0);
                    toast.success(`Re-flowed ${n} unlocked pages`, { description: "Undo is available in the designer." });
                  }}
                >
                  <RefreshCw /> Apply to project pages
                </Button>
              )}
              <Button
                variant={profile.status === "approved" ? "subtle" : "primary"}
                disabled={profile.status === "approved"}
                onClick={async () => {
                  if (apiLive) await live.approveProfile(profile.id).catch((e) => toast.error((e as Error).message));
                  approveProfile(profile.id);
                  toast.success("Design profile approved", { description: "It can now drive page composition." });
                }}
              >
                <BadgeCheck /> {profile.status === "approved" ? `Approved · v${profile.version}` : "Approve design profile"}
              </Button>
            </>
          )
        }
      />

      {!profile && (
        <div className="mt-5 flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="font-medium">Not analysed yet</p>
            <p className="mt-0.5 text-ink-3">{reference.analysis.message ?? "Run the analysis to extract the design profile."}</p>
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={!apiLive}
            onClick={async () => {
              try {
                await live.analyseReference(reference.id);
                useWorkspace.getState().updateReference(reference.id, { status: "analysing" });
                toast.success("Analysis queued");
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            <ScanSearch /> Analyse
          </Button>
        </div>
      )}

      <Tabs defaultValue={pages.length ? "pages" : "profile"} className="mt-6">
        <TabsList>
          <TabsTrigger value="pages">
            <FileSearch /> Pages <Badge>{pages.length || reference.pageCount}</Badge>
          </TabsTrigger>
          <TabsTrigger value="profile" disabled={!profile}>
            <Layers /> Design profile
          </TabsTrigger>
          <TabsTrigger value="templates">
            <Shapes /> Reconstructed templates <Badge>{derived.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pages" className="pt-5">
          {pages.length === 0 ? (
            localUrl ? (
              <LocalPdfPages url={localUrl} count={reference.pageCount} />
            ) : (
              <Panel>
                <EmptyState icon={<FileSearch />} title="No page analysis" description="Pages appear here once the reference is analysed." />
              </Panel>
            )
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-1.5">
                <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All pages" count={pages.length} />
                {lowConfidence > 0 && <FilterChip active={filter === "low"} onClick={() => setFilter("low")} label="Needs a check" count={lowConfidence} warn />}
                {counts.map(([t, n]) => (
                  <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)} label={pageTypeLabel(t)} count={n} />
                ))}
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-5">
                {visible.map((p) => (
                  <button key={p.id} onClick={() => setInspecting(p)} className="group flex flex-col items-center gap-2 text-left">
                    <div className={cn("relative shadow-page transition-transform group-hover:-translate-y-0.5", p.confidence < 0.7 && "ring-2 ring-warning-dot/60")}>
                      <ReferencePageThumb page={p} width={124} pdfUrl={localUrl} />
                      {p.corrected && <span className="absolute right-1 top-1 rounded bg-accent px-1 text-[9px] font-semibold uppercase text-white">Corrected</span>}
                    </div>
                    <div className="flex w-full items-center justify-between gap-1 px-0.5">
                      <span className="tabular text-xs font-medium text-ink-2">p.{p.pageNumber}</span>
                      <span className={cn("truncate text-[11px]", p.confidence < 0.7 ? "text-warning" : "text-ink-4")}>
                        {pageTypeLabel(p.layoutType)} · {Math.round(p.confidence * 100)}%
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="profile" className="pt-5">
          {profile && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_480px]">
              <ProfileEditor profile={profile} />
              <ProfilePreview profileId={profile.id} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="templates" className="pt-5">
          {derived.length === 0 ? (
            <Panel>
              <EmptyState icon={<Shapes />} title="No templates reconstructed yet" description="Open any page and choose “Reconstruct template” to turn its detected frames into an editable template." />
            </Panel>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {derived.map((t) => {
                const page = pages.find((p) => p.pageNumber === t.referencePageNumber);
                return (
                  <Panel key={t.id} className="flex gap-3 p-3">
                    {page && <ReferencePageThumb page={page} width={70} pdfUrl={localUrl} className="shrink-0 border border-line" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="mt-1 text-xs text-ink-3">{t.description}</p>
                      <Button variant="link" size="xs" asChild className="mt-1">
                        <Link href="/app/templates">Open in Templates</Link>
                      </Button>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <PageInspector
        page={inspecting}
        pdfUrl={localUrl}
        onClose={() => setInspecting(null)}
        onDerive={derive}
        apiLive={apiLive}
        onNavigate={(dir) => {
          if (!inspecting) return;
          const i = visible.findIndex((p) => p.id === inspecting.id);
          const next = visible[i + dir];
          if (next) setInspecting(next);
        }}
      />
    </div>
  );
}

function FilterChip({ active, onClick, label, count, warn }: { active: boolean; onClick: () => void; label: string; count: number; warn?: boolean }) {
  return (
    <button onClick={onClick} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors", active ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong", warn && !active && "border-warning-dot/50 text-warning")}>
      {warn && <TriangleAlert className="size-3" />}
      {label}
      <span className={cn("tabular", active ? "text-white/70" : "text-ink-4")}>{count}</span>
    </button>
  );
}

function LocalPdfPages({ url, count }: { url: string; count: number }) {
  const pseudo = (n: number): ReferencePage => ({ id: `lp${n}`, referenceId: "", pageNumber: n, layoutType: "two_column_article", confidence: 0, widthPt: 595.28, heightPt: 841.89, blocks: [], properties: { columns: 0, dominantColors: [], textCoverage: 0, imageCoverage: 0, fonts: [] }, corrected: false });
  return (
    <div>
      <p className="mb-4 text-sm text-ink-3">Rendered in your browser from the uploaded PDF. Layout types and design properties appear once the API analyses it.</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-4">
        {Array.from({ length: Math.min(count, 60) }, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="shadow-page">
              <ReferencePageThumb page={pseudo(i + 1)} width={124} pdfUrl={url} />
            </div>
            <span className="tabular text-xs text-ink-3">p.{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageInspector({ page, pdfUrl, onClose, onDerive, onNavigate, apiLive }: { page: ReferencePage | null; pdfUrl?: string; onClose: () => void; onDerive: (p: ReferencePage) => void; onNavigate: (dir: 1 | -1) => void; apiLive: boolean }) {
  const updateReferencePage = useWorkspace((s) => s.updateReferencePage);
  const current = useWorkspace((s) => s.referencePages.find((p) => p.id === page?.id));
  const [overlay, setOverlay] = React.useState(true);
  const [role, setRole] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!page) return;
      if (e.key === "ArrowRight") onNavigate(1);
      if (e.key === "ArrowLeft") onNavigate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, onNavigate]);
  if (!page || !current) return <Dialog open={false} />;

  const byRole = current.blocks.reduce<Record<string, number>>((acc, b) => {
    const r = b.role ?? b.kind;
    acc[r] = (acc[r] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Page ${current.pageNumber} · ${pageTypeLabel(current.layoutType)}`} description="Use ← → to move between pages." size="xl">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3">
            <div className="shadow-page">
              <ReferencePageThumb page={current} width={340} pdfUrl={pdfUrl} overlay={overlay} highlightRole={role} />
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-3">
              <Switch checked={overlay} onCheckedChange={setOverlay} /> Show detected blocks
            </label>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <p className="text-xs font-medium text-ink-3">Layout type</p>
              <div className="mt-1.5 flex items-center gap-2">
                <Select
                  className="w-56"
                  value={current.layoutType}
                  onValueChange={(v) => {
                    updateReferencePage(current.id, { layoutType: v, corrected: true, confidence: 1 });
                    if (apiLive) void live.correctPage(current.referenceId, current.pageNumber, { layoutType: v }).catch(() => undefined);
                    toast.success(`Marked as ${pageTypeLabel(v)}`);
                  }}
                  options={PAGE_TYPES.map((t) => ({ value: t, label: pageTypeLabel(t) }))}
                  aria-label="Layout type"
                />
                <Badge tone={current.confidence < 0.7 ? "warning" : "success"}>{current.corrected ? "Corrected by a person" : `${Math.round(current.confidence * 100)}% confidence`}</Badge>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-3">Columns</dt>
              <dd>{current.properties.columns || "—"}</dd>
              <dt className="text-ink-3">Text coverage</dt>
              <dd className="tabular">{Math.round(current.properties.textCoverage * 100)}%</dd>
              <dt className="text-ink-3">Image coverage</dt>
              <dd className="tabular">{Math.round(current.properties.imageCoverage * 100)}%</dd>
              <dt className="text-ink-3">Fonts</dt>
              <dd className="font-mono text-xs">{current.properties.fonts.join(", ") || "—"}</dd>
              <dt className="text-ink-3">Dominant colours</dt>
              <dd className="flex gap-1">
                {current.properties.dominantColors.map((c) => (
                  <span key={c} title={c} className="size-5 rounded border border-black/10" style={{ background: c }} />
                ))}
              </dd>
            </dl>
            <div>
              <p className="text-xs font-medium text-ink-3">Detected blocks — hover to highlight</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(byRole).map(([r, n]) => (
                  <button key={r} onMouseEnter={() => setRole(r)} onMouseLeave={() => setRole(null)} className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs hover:border-line-strong">
                    <span className="size-2 rounded-full" style={{ background: ROLE_COLORS[r] ?? "#4a5568" }} />
                    {r.replace("_", " ")} <span className="text-ink-4">{n}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-4">
              <Button variant="primary" onClick={() => onDerive(current)}>
                <Wand2 /> Reconstruct template
              </Button>
              <Button
                variant="secondary"
                disabled={!apiLive}
                loading={busy}
                title={apiLive ? undefined : "Re-analysis needs the PressFlow API."}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await live.reanalysePage(current.referenceId, current.pageNumber);
                    toast.success("Re-analysis queued", { description: "The page updates when the job finishes." });
                  } catch (err) {
                    toast.error((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Sparkles /> Re-analyse page
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Live preview: real pages re-composed with the profile as it is being edited. */
function ProfilePreview({ profileId }: { profileId: string }) {
  const state = useWorkspace();
  const profile = state.designProfiles.find((d) => d.id === profileId)!;
  const project = state.projects.find((p) => p.designProfileId === profileId && state.pages.some((x) => x.projectId === p.id));
  const [which, setWhich] = React.useState<"report" | "interview">("report");
  const preview = React.useMemo(() => {
    if (!project) return null;
    const pages = state.pages.filter((p) => p.projectId === project.id);
    const startIdx = pages.findIndex((p) => p.templateId === (which === "report" ? "tpl_report_hero" : "tpl_interview_opener"));
    if (startIdx < 0) return null;
    const slice = pages.slice(startIdx, startIdx + 2);
    const articles = state.articles.filter((a) => a.projectId === project.id);
    const composed = composeMagazine(
      slice.map((p) => ({ id: p.id, pageType: p.pageType, templateId: p.templateId, label: p.label, articleId: p.articleId })),
      { profile, project, articles, speakers: state.speakers, facts: state.facts, assets: state.assets, referenceTemplates: state.templates, imagePreference: project.config.imagePreference },
    );
    const toc = buildToc(pages, articles);
    return { composed, ctx: (i: number) => ({ ...renderContext(project, pages, startIdx + i, articles, toc) }), assets: assetMap(state.assets) };
  }, [project, profile, which, state.pages, state.articles, state.speakers, state.facts, state.assets, state.templates]);

  return (
    <div className="xl:sticky xl:top-4 xl:self-start">
      <Panel>
        <PanelHeader
          title="Live composition preview"
          description={project ? `Pages from ${project.title.split("—")[0].trim()} re-composed with this profile` : "No project uses this profile yet"}
          icon={<PanelsTopLeft />}
          actions={<Segmented size="sm" value={which} onChange={setWhich} options={[{ value: "report", label: "Report" }, { value: "interview", label: "Interview" }]} />}
        />
        <div className="canvas-backdrop flex justify-center p-5">
          {preview ? (
            <div className="flex shadow-page">
              {preview.composed.map((p, i) => (
                <PageView key={p.id} page={p} profile={profile} assets={preview.assets} ctx={preview.ctx(i)} scale={210 / profile.page.widthPt} showGuides />
              ))}
            </div>
          ) : (
            <p className="py-16 text-sm text-ink-3">Attach this reference to a project to preview composed pages.</p>
          )}
        </div>
        <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">Guides show the margins and column grid. Change any value on the left and the pages re-compose instantly. Project pages change only when you apply the profile.</p>
      </Panel>
    </div>
  );
}

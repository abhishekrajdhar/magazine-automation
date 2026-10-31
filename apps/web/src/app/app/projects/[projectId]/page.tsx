"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Check, Clapperboard, FileText, FolderX, Info, LibraryBig, PanelsTopLeft, Pencil, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { useProjectData } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, EmptyState, PageHeader, Panel, PanelHeader, SimulatedBadge } from "@/components/ui/display";
import { Dialog, DialogContent, Select, useConfirm } from "@/components/ui/overlays";
import { PageThumb } from "@/components/magazine/page-thumb";
import { PipelineStatus } from "@/components/dashboard/pipeline-status";
import { ProjectFields, validateDetails, type ProjectDetails } from "@/components/wizard/project-fields";
import { SourceGlyph } from "@/components/shell/logo";
import { articleStatus, articleTypeLabel, processingState, projectStatus, PROJECT_STAGES } from "@/lib/domain/status";
import type { ArticleStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatDuration, formatRelative } from "@/lib/utils/format";

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const setActiveProject = useWorkspace((s) => s.setActiveProject);
  const updateProject = useWorkspace((s) => s.updateProject);
  const deleteProject = useWorkspace((s) => s.deleteProject);
  const summaries = useWorkspace((s) => s.projectSummaries);
  const members = useWorkspace((s) => s.members);
  const data = useProjectData(projectId);
  const { project, profile, reference, videos, articles, pages, assetsById } = data;
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    if (project) setActiveProject(project.id);
  }, [project, setActiveProject]);

  if (!project || project.id !== projectId) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-16">
        <Panel>
          <EmptyState icon={<FolderX />} title="Project not found" description="It may have been deleted, or the link is from another workspace." action={<Button asChild variant="secondary"><Link href="/app/projects">All projects</Link></Button>} />
        </Panel>
      </div>
    );
  }

  const summary = summaries[project.id];
  const stageIndex = PROJECT_STAGES.indexOf(project.status);
  const byStatus = (s: ArticleStatus) => articles.filter((a) => a.status === s).length;

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-7">
      <PageHeader
        meta={
          <>
            <Badge tone={projectStatus[project.status].tone} dot>
              {projectStatus[project.status].label}
            </Badge>
            <span className="text-xs text-ink-3">
              {project.issueNumber} · {project.category} · publishes {formatDate(project.publicationDate)}
            </span>
            {project.isDemo && <SimulatedBadge label="Demo project" />}
          </>
        }
        title={project.title}
        description={project.description || project.eventName}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil /> Edit details
            </Button>
            <Button variant="primary" asChild>
              <Link href="/app/designer">
                <PanelsTopLeft /> Open designer
              </Link>
            </Button>
          </>
        }
      />

      <Panel className="mt-6 px-5 py-4">
        <ol className="scroll-thin flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
          {PROJECT_STAGES.map((s, i) => (
            <li key={s} className="flex shrink-0 items-center gap-2">
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold",
                  i < stageIndex && "border-success-dot bg-success-dot text-white",
                  i === stageIndex && "border-accent bg-accent text-white",
                  i > stageIndex && "border-line-strong text-ink-4",
                )}
              >
                {i < stageIndex ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-sm", i === stageIndex ? "font-medium text-ink" : "text-ink-3")}>{projectStatus[s].label}</span>
              {i < PROJECT_STAGES.length - 1 && <span className="mx-1 h-px w-8 bg-line-strong" />}
            </li>
          ))}
          <li className="ml-auto shrink-0 pl-4">
            <Select
              size="sm"
              className="w-40"
              aria-label="Set project stage"
              value={project.status}
              onValueChange={(v) => {
                updateProject(project.id, { status: v });
                toast.success(`Stage set to ${projectStatus[v].label}`);
              }}
              options={PROJECT_STAGES.map((s) => ({ value: s, label: projectStatus[s].label }))}
            />
          </li>
        </ol>
      </Panel>

      {summary && (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" />
          <p>
            This demo project shows summary figures only ({summary.videos} recordings, {summary.articles} articles, {summary.pages} pages). Its content isn&apos;t included in the demo workspace — open{" "}
            <Link href="/app/projects/prj_negs26" className="font-medium text-accent hover:underline">
              National eGovernance Summit 2026 Special
            </Link>{" "}
            to explore the full workflow.
          </p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Production pipeline" description="Live counts from this project's recordings, facts, articles and pages." />
            <div className="p-5">
              <PipelineStatus data={data} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Event recordings"
              icon={<Clapperboard />}
              actions={
                <Button variant="ghost" size="xs" asChild>
                  <Link href="/app/media">
                    Media library <ArrowRight />
                  </Link>
                </Button>
              }
            />
            {videos.length === 0 ? (
              <EmptyState compact icon={<Clapperboard />} title="No recordings yet" description="Add YouTube or Google Drive links, or upload recordings." action={<Button variant="secondary" size="sm" asChild><Link href="/app/media?add=1">Add recordings</Link></Button>} />
            ) : (
              <ul className="divide-y divide-line">
                {videos.map((v) => (
                  <li key={v.id}>
                    <Link href={`/app/media/${v.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle">
                      <SourceGlyph type={v.sourceType} className="text-ink-3" />
                      <span className="min-w-0 flex-1 truncate text-sm">{v.title}</span>
                      <span className="tabular text-xs text-ink-3">{formatDuration(v.durationSec)}</span>
                      <Badge tone={processingState[v.processing.state].tone} dot>
                        {processingState[v.processing.state].label}
                      </Badge>
                      {v.simulated && <SimulatedBadge />}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Articles"
              icon={<FileText />}
              description={`${byStatus("approved")} approved · ${byStatus("in_review") + byStatus("needs_revision")} awaiting review · ${byStatus("draft")} drafts`}
              actions={
                <Button variant="ghost" size="xs" asChild>
                  <Link href="/app/studio">
                    Content Studio <ArrowRight />
                  </Link>
                </Button>
              }
            />
            {articles.length === 0 ? (
              <EmptyState compact icon={<FileText />} title="No articles yet" description="Articles are drafted from approved facts once recordings are processed." />
            ) : (
              <ul className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-y-0">
                {articles.map((a) => (
                  <li key={a.id} className="border-line md:border-b md:odd:border-r">
                    <Link href={`/app/studio/${a.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{a.headline.replace(/[“”]/g, "")}</span>
                        <span className="block text-xs text-ink-4">{articleTypeLabel[a.type]}</span>
                      </span>
                      <Badge tone={articleStatus[a.status].tone}>{articleStatus[a.status].label}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel className="flex flex-col items-center gap-3 p-5">
            {pages[0] && profile ? (
              <PageThumb page={pages[0]} profile={profile} assets={assetsById} ctx={data.ctxFor(0)} width={200} localUrls={data.localUrls} />
            ) : (
              <div className="flex h-[283px] w-[200px] flex-col items-center justify-center gap-2 border border-dashed border-line-strong text-xs text-ink-4">
                <PanelsTopLeft className="size-5" /> Cover appears once pages are planned
              </div>
            )}
            <p className="text-xs text-ink-3">{pages.length ? `${pages.length} of ${project.targetPageCount} pages planned` : `Target: ${project.targetPageCount} pages`}</p>
          </Panel>

          <Panel>
            <PanelHeader title="Design reference" icon={<LibraryBig />} />
            {reference ? (
              <Link href={`/app/references/${reference.id}`} className="block px-4 py-3 hover:bg-subtle">
                <p className="text-sm font-medium">{reference.title}</p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {reference.pageCount} pages · profile {profile?.status === "approved" ? "approved" : "awaiting approval"}
                </p>
                {profile && (
                  <div className="mt-3 flex gap-1">
                    {profile.colors.palette.map((c) => (
                      <span key={c} className="size-5 rounded-sm border border-line" style={{ background: c }} title={c} />
                    ))}
                  </div>
                )}
              </Link>
            ) : (
              <EmptyState compact icon={<LibraryBig />} title="No reference selected" action={<Button size="sm" variant="secondary" asChild><Link href="/app/references">Choose a reference</Link></Button>} />
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Generation settings" icon={<Settings2 />} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 py-3 text-sm">
              {[
                ["Design mode", project.config.designMode === "exact_reference" ? "Exact reference style" : project.config.designMode === "adapted_reference" ? "Adapted reference" : "House style"],
                ["Tone", project.config.editorialTone],
                ["Content style", project.config.contentStyle],
                ["Language", project.config.language === "en" ? "English" : project.config.language === "hi" ? "Hindi" : "English + Hindi"],
                ["Images", project.config.imagePreference.replace("_", " ")],
                ["Ad pages", project.config.includeAdvertisements ? String(project.config.adPageCount) : "None"],
              ].map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="capitalize text-ink">{v}</dd>
                </React.Fragment>
              ))}
            </dl>
          </Panel>

          <Panel>
            <PanelHeader title="Team" />
            <ul className="divide-y divide-line">
              {members.slice(0, 5).map((m) => (
                <li key={m.userId} className="flex items-center gap-2.5 px-4 py-2">
                  <Avatar initials={m.initials} seed={m.userId} size={24} />
                  <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                  <span className="text-xs capitalize text-ink-3">{m.role}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Button
            variant="danger-ghost"
            className="self-start"
            onClick={async () => {
              if (await confirm({ title: `Delete “${project.title}”?`, description: "Its recordings, articles and pages are removed from this workspace. This cannot be undone.", confirmLabel: "Delete project", tone: "danger" })) {
                deleteProject(project.id);
                toast.success("Project deleted");
                router.push("/app/projects");
              }
            }}
          >
            <Trash2 /> Delete project
          </Button>
          <p className="-mt-4 text-xs text-ink-4">Last updated {formatRelative(project.updatedAt)}</p>
        </div>
      </div>

      <EditDetailsDialog open={editing} onOpenChange={setEditing} project={project} onSave={(d) => updateProject(project.id, d)} />
    </div>
  );
}

function EditDetailsDialog({ open, onOpenChange, project, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; project: ProjectDetails & { id: string }; onSave: (d: ProjectDetails) => void }) {
  const [value, setValue] = React.useState<ProjectDetails>(project);
  const [errors, setErrors] = React.useState<ReturnType<typeof validateDetails>>({});
  React.useEffect(() => {
    if (open) {
      setValue({ title: project.title, eventName: project.eventName, category: project.category, issueNumber: project.issueNumber, publicationDate: project.publicationDate.slice(0, 10), publisher: project.publisher, targetPageCount: project.targetPageCount, description: project.description });
      setErrors({});
    }
  }, [open, project]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Edit project details"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const e = validateDetails(value);
                setErrors(e);
                if (Object.keys(e).length) return;
                onSave(value);
                onOpenChange(false);
                toast.success("Project details saved");
              }}
            >
              Save changes
            </Button>
          </>
        }
      >
        <ProjectFields value={value} onChange={setValue} errors={errors} />
      </DialogContent>
    </Dialog>
  );
}

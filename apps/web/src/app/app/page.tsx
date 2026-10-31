"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CircleCheck,
  Clapperboard,
  FilePlus2,
  FileText,
  FolderKanban,
  Hourglass,
  NotebookPen,
  PackageCheck,
  PanelsTopLeft,
} from "lucide-react";
import { useWorkspace } from "@/lib/store/workspace";
import { useProjectData } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, PageHeader, Panel, PanelHeader, Stat, Td, Th, Table } from "@/components/ui/display";
import { Tooltip } from "@/components/ui/primitives";
import { PageThumb } from "@/components/magazine/page-thumb";
import { ActivityChart } from "@/components/dashboard/activity-chart";
import { PipelineStatus } from "@/components/dashboard/pipeline-status";
import { articleStatus, exportFormatInfo, projectStatus } from "@/lib/domain/status";
import { formatBytes, formatDate, formatNumber, formatRelative } from "@/lib/utils/format";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function OverviewPage() {
  const user = useWorkspace((s) => s.user);
  const projects = useWorkspace((s) => s.projects);
  const summaries = useWorkspace((s) => s.projectSummaries);
  const allVideos = useWorkspace((s) => s.videos);
  const allArticles = useWorkspace((s) => s.articles);
  const allExports = useWorkspace((s) => s.exports);
  const activity = useWorkspace((s) => s.activity);
  const members = useWorkspace((s) => s.members);
  const setActiveProject = useWorkspace((s) => s.setActiveProject);
  const data = useProjectData();
  const { project, profile, pages, articles, assetsById } = data;

  const totals = React.useMemo(() => {
    const summaryList = Object.values(summaries);
    return {
      magazines: projects.length,
      exported: projects.filter((p) => p.status === "exported").length,
      active: projects.filter((p) => p.status !== "exported").length,
      publications: new Set(projects.map((p) => p.category)).size,
      videos: allVideos.filter((v) => v.processing.state === "ready").length + summaryList.reduce((n, s) => n + s.videos, 0),
      videosBusy: allVideos.filter((v) => ["queued", "acquiring", "extracting_audio", "transcribing", "analysing"].includes(v.processing.state)).length,
      articles: allArticles.length + summaryList.reduce((n, s) => n + s.articles, 0),
      pending: allArticles.filter((a) => a.status === "in_review" || a.status === "needs_revision").length + summaryList.reduce((n, s) => n + s.approvals, 0),
    };
  }, [projects, summaries, allVideos, allArticles]);

  const pendingArticles = articles.filter((a) => a.status === "in_review" || a.status === "needs_revision" || a.status === "draft");
  const recentExports = [...allExports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const memberName = (id: string) => members.find((m) => m.userId === id)?.name ?? "Someone";

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-7">
      <PageHeader
        title={`${greeting()}, ${user?.name.split(" ")[0] ?? "there"}`}
        description={project ? <>Production overview for your workspace. Active issue: <span className="font-medium text-ink-2">{project.title}</span>.</> : "Production overview for your workspace."}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/app/designer">
                <PanelsTopLeft /> Open designer
              </Link>
            </Button>
            <Button variant="primary" size="lg" asChild>
              <Link href="/app/new">
                <FilePlus2 /> Create new magazine
              </Link>
            </Button>
          </>
        }
      />

      <Panel className="mt-6 grid grid-cols-2 divide-line md:grid-cols-5 md:divide-x [&>*]:border-line max-md:[&>*:nth-child(odd)]:border-r max-md:[&>*:nth-child(-n+4)]:border-b">
        <Stat label="Magazines created" icon={<BookOpen />} value={formatNumber(totals.magazines)} sub={`${totals.exported} exported`} />
        <Stat label="Active projects" icon={<FolderKanban />} value={formatNumber(totals.active)} sub={`across ${totals.publications} categor${totals.publications === 1 ? "y" : "ies"}`} />
        <Stat label="Videos processed" icon={<Clapperboard />} value={formatNumber(totals.videos)} sub={totals.videosBusy ? `${totals.videosBusy} processing now` : "none processing now"} />
        <Stat label="Articles generated" icon={<FileText />} value={formatNumber(totals.articles)} sub="drafts and approved" />
        <Stat
          label="Pending approvals"
          icon={<Hourglass />}
          value={<span className={totals.pending ? "text-warning" : undefined}>{totals.pending}</span>}
          sub="editorial sign-off needed"
        />
      </Panel>

      {project && profile && (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
          <Panel className="flex flex-col overflow-hidden">
            <div className="flex flex-1 flex-col gap-6 p-5 sm:flex-row">
              <Link href={`/app/projects/${project.id}`} className="shrink-0 self-start transition-transform hover:-translate-y-0.5">
                {pages[0] ? (
                  <PageThumb page={pages[0]} profile={profile} assets={assetsById} ctx={data.ctxFor(0)} width={150} localUrls={data.localUrls} />
                ) : (
                  <div className="flex h-[212px] w-[150px] items-center justify-center rounded border border-dashed border-line-strong text-xs text-ink-4">No pages yet</div>
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={projectStatus[project.status].tone} dot>
                    {projectStatus[project.status].label}
                  </Badge>
                  <span className="text-xs text-ink-3">
                    {project.issueNumber} · publishes {formatDate(project.publicationDate)}
                  </span>
                </div>
                <h2 className="mt-2 font-serif text-[26px] font-medium leading-tight tracking-[-0.01em] text-ink">{project.title}</h2>
                <p className="mt-1.5 max-w-xl text-sm text-ink-3">{project.description}</p>
                <PipelineStatus className="mt-5" data={data} />
              </div>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-line bg-subtle px-4 py-2">
              {[
                { href: "/app/media", label: "Recordings", icon: Clapperboard },
                { href: "/app/studio", label: "Content Studio", icon: NotebookPen },
                { href: "/app/designer", label: "Flatplan", icon: PanelsTopLeft },
                { href: "/app/designer/preflight", label: "Preflight", icon: CircleCheck },
                { href: "/app/exports", label: "Exports", icon: PackageCheck },
              ].map((l) => (
                <Button key={l.href} variant="ghost" size="sm" asChild>
                  <Link href={l.href} onClick={() => setActiveProject(project.id)}>
                    <l.icon /> {l.label}
                  </Link>
                </Button>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Pending editorial approvals"
              description="Unapproved copy is never placed in final output."
              actions={
                <Button variant="ghost" size="xs" asChild>
                  <Link href="/app/studio?status=pending">View all</Link>
                </Button>
              }
            />
            <ul className="divide-y divide-line">
              {pendingArticles.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <Link href={`/app/studio/${a.id}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-subtle">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{a.headline.replace(/[“”]/g, "")}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-3">{a.reviewNote ?? a.kicker}</p>
                    </div>
                    <Badge tone={articleStatus[a.status].tone}>{articleStatus[a.status].label}</Badge>
                  </Link>
                </li>
              ))}
              {pendingArticles.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-3">Everything is approved.</li>}
            </ul>
          </Panel>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <Panel>
          <PanelHeader
            title="Recent projects"
            actions={
              <Button variant="ghost" size="xs" asChild>
                <Link href="/app/projects">
                  All projects <ArrowRight />
                </Link>
              </Button>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Status</Th>
                <Th className="text-right">Pages</Th>
                <Th>Publication</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {[...projects]
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, 6)
                .map((p) => (
                  <tr key={p.id} className="group hover:bg-subtle">
                    <Td>
                      <Link href={`/app/projects/${p.id}`} className="block max-w-[360px]" onClick={() => setActiveProject(p.id)}>
                        <span className="block truncate font-medium group-hover:text-accent">{p.title}</span>
                        <span className="block truncate text-xs text-ink-3">{p.category}</span>
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={projectStatus[p.status].tone} dot>
                        {projectStatus[p.status].label}
                      </Badge>
                    </Td>
                    <Td className="tabular text-right text-ink-2">{p.id === project?.id ? pages.length : summaries[p.id]?.pages ?? 0}/{p.targetPageCount}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDate(p.publicationDate)}</Td>
                    <Td className="whitespace-nowrap text-ink-3">{formatRelative(p.updatedAt)}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Panel>

        <Panel>
          <PanelHeader title="Processing activity" description="Workspace events per day, last 14 days" />
          <div className="px-4 pb-4 pt-3">
            <ActivityChart activity={activity} />
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Recent exports"
            actions={
              <Button variant="ghost" size="xs" asChild>
                <Link href="/app/exports">Export centre</Link>
              </Button>
            }
          />
          <ul className="divide-y divide-line">
            {recentExports.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-[10px] font-semibold uppercase text-ink-3">{exportFormatInfo[e.format].ext}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{exportFormatInfo[e.format].label}</p>
                  <p className="truncate text-xs text-ink-3">
                    {e.fileName} · {formatRelative(e.createdAt)}
                    {e.sizeBytes ? ` · ${formatBytes(e.sizeBytes)}` : ""}
                  </p>
                </div>
                <Tooltip content={e.message ?? ""}>
                  <span>
                    <Badge tone={e.status === "complete" ? "success" : e.status === "unavailable" ? "warning" : e.status === "failed" ? "danger" : "accent"} dot>
                      {e.status === "complete" ? "Complete" : e.status === "unavailable" ? "Unavailable" : e.status === "failed" ? "Failed" : "Running"}
                    </Badge>
                  </span>
                </Tooltip>
              </li>
            ))}
            {recentExports.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-3">No exports yet.</li>}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title="Team activity" />
          <ul className="divide-y divide-line">
            {activity.slice(0, 7).map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar initials={members.find((m) => m.userId === a.actorId)?.initials ?? "?"} seed={a.actorId} size={24} />
                <p className="min-w-0 flex-1 truncate text-sm text-ink-2">
                  <span className="font-medium text-ink">{memberName(a.actorId)}</span> {a.verb} <span className="font-medium text-ink">{a.target}</span>
                </p>
                <span className="shrink-0 text-xs text-ink-4">{formatRelative(a.at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

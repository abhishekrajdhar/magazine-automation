"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, FilePlus2, FolderKanban, LayoutGrid, MoreHorizontal, Rows3, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader, Panel, SimulatedBadge, Table, Td, Th } from "@/components/ui/display";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Select, useConfirm } from "@/components/ui/overlays";
import { Segmented } from "@/components/ui/primitives";
import { Pagination, paginate } from "@/components/ui/pagination";
import { PageThumb } from "@/components/magazine/page-thumb";
import { projectStatus, PROJECT_STAGES } from "@/lib/domain/status";
import type { ProjectStatus } from "@/lib/domain/types";
import { assetMap, buildToc, renderContext } from "@/lib/magazine/context";
import { formatDate, formatRelative } from "@/lib/utils/format";

const PAGE_SIZE = 8;

export default function ProjectsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const projects = useWorkspace((s) => s.projects);
  const summaries = useWorkspace((s) => s.projectSummaries);
  const pages = useWorkspace((s) => s.pages);
  const articles = useWorkspace((s) => s.articles);
  const videos = useWorkspace((s) => s.videos);
  const assets = useWorkspace((s) => s.assets);
  const profiles = useWorkspace((s) => s.designProfiles);
  const setActiveProject = useWorkspace((s) => s.setActiveProject);
  const deleteProject = useWorkspace((s) => s.deleteProject);
  const createProject = useWorkspace((s) => s.createProject);
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<"all" | ProjectStatus>("all");
  const [view, setView] = React.useState<"table" | "grid">("table");
  const [page, setPage] = React.useState(1);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...projects]
      .filter((p) => status === "all" || p.status === status)
      .filter((p) => !q || [p.title, p.eventName, p.category, p.issueNumber].some((f) => f.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [projects, query, status]);
  React.useEffect(() => setPage(1), [query, status]);

  const counts = (id: string) => {
    const s = summaries[id];
    if (s) return s;
    return {
      videos: videos.filter((v) => v.projectId === id).length,
      articles: articles.filter((a) => a.projectId === id).length,
      pages: pages.filter((p) => p.projectId === id).length,
      approvals: articles.filter((a) => a.projectId === id && (a.status === "in_review" || a.status === "needs_revision")).length,
    };
  };
  const open = (id: string) => {
    setActiveProject(id);
    router.push(`/app/projects/${id}`);
  };
  const assetsById = React.useMemo(() => assetMap(assets), [assets]);

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-7">
      <PageHeader
        title="Projects"
        description="Every magazine issue is a project: its recordings, reference design, articles, pages and exports."
        actions={
          <Button variant="primary" asChild>
            <Link href="/app/new">
              <FilePlus2 /> Create new magazine
            </Link>
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Input className="w-full sm:w-72" leading={<Search />} placeholder="Search projects…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" />
        <Select
          className="w-44"
          value={status}
          onValueChange={setStatus}
          aria-label="Filter by status"
          options={[{ value: "all", label: "All statuses" }, ...PROJECT_STAGES.map((s) => ({ value: s, label: projectStatus[s].label }))]}
        />
        <Segmented
          className="ml-auto"
          value={view}
          onChange={setView}
          options={[
            { value: "table", label: "", icon: <Rows3 />, title: "Table view" },
            { value: "grid", label: "", icon: <LayoutGrid />, title: "Grid view" },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <Panel className="mt-4">
          <EmptyState
            icon={<FolderKanban />}
            title={projects.length ? "No projects match" : "No projects yet"}
            description={projects.length ? "Try a different search or status filter." : "Create a magazine project to start ingesting recordings."}
            action={
              projects.length ? (
                <Button variant="secondary" onClick={() => { setQuery(""); setStatus("all"); }}>Clear filters</Button>
              ) : (
                <Button variant="primary" asChild><Link href="/app/new">Create new magazine</Link></Button>
              )
            }
          />
        </Panel>
      ) : view === "table" ? (
        <Panel className="mt-4 overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Status</Th>
                <Th className="text-right">Recordings</Th>
                <Th className="text-right">Articles</Th>
                <Th className="text-right">Pages</Th>
                <Th>Publication</Th>
                <Th>Updated</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {paginate(filtered, page, PAGE_SIZE).map((p) => {
                const c = counts(p.id);
                return (
                  <tr key={p.id} className="group cursor-pointer hover:bg-subtle" onClick={() => open(p.id)}>
                    <Td>
                      <div className="flex max-w-[380px] items-center gap-2">
                        <span className="min-w-0">
                          <span className="block truncate font-medium group-hover:text-accent">{p.title}</span>
                          <span className="block truncate text-xs text-ink-3">
                            {p.issueNumber} · {p.category}
                          </span>
                        </span>
                        {p.isDemo && <SimulatedBadge label="Demo" />}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={projectStatus[p.status].tone} dot>
                        {projectStatus[p.status].label}
                      </Badge>
                    </Td>
                    <Td className="tabular text-right text-ink-2">{c.videos}</Td>
                    <Td className="tabular text-right text-ink-2">{c.articles}</Td>
                    <Td className="tabular text-right text-ink-2">
                      {c.pages}/{p.targetPageCount}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDate(p.publicationDate)}</Td>
                    <Td className="whitespace-nowrap text-ink-3">{formatRelative(p.updatedAt)}</Td>
                    <Td onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-xs" aria-label="Project actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => open(p.id)}>Open</DropdownMenuItem>
                          <DropdownMenuItem
                            icon={<Copy />}
                            onSelect={() => {
                              const { id: _id, createdAt: _c, updatedAt: _u, orgId: _o, ownerId: _ow, isDemo: _d, ...rest } = p;
                              const copy = createProject({ ...rest, title: `${p.title} (copy)`, status: "setup" });
                              toast.success("Project duplicated", { description: "Settings and reference were copied. Recordings and pages were not." });
                              router.push(`/app/projects/${copy.id}`);
                            }}
                          >
                            Duplicate settings
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            icon={<Trash2 />}
                            tone="danger"
                            onSelect={async () => {
                              if (await confirm({ title: `Delete “${p.title}”?`, description: "Its recordings, articles and pages are removed from this workspace. This cannot be undone.", confirmLabel: "Delete project", tone: "danger" })) {
                                deleteProject(p.id);
                                toast.success("Project deleted");
                              }
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} noun="projects" />
        </Panel>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => {
            const projectPages = pages.filter((x) => x.projectId === p.id);
            const profile = profiles.find((d) => d.id === p.designProfileId);
            const c = counts(p.id);
            return (
              <button key={p.id} onClick={() => open(p.id)} className="group flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-left shadow-xs transition-shadow hover:shadow-md">
                <div className="canvas-backdrop flex h-48 items-center justify-center">
                  {projectPages[0] && profile ? (
                    <PageThumb page={projectPages[0]} profile={profile} assets={assetsById} ctx={renderContext(p, projectPages, 0, articles, buildToc(projectPages, articles))} width={118} />
                  ) : (
                    <div className="flex h-[167px] w-[118px] flex-col items-center justify-center gap-1 border border-dashed border-line-strong bg-surface text-[11px] text-ink-4">
                      <FolderKanban className="size-4" /> No pages yet
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 border-t border-line p-3.5">
                  <Badge tone={projectStatus[p.status].tone} dot className="self-start">
                    {projectStatus[p.status].label}
                  </Badge>
                  <p className="line-clamp-2 text-sm font-medium group-hover:text-accent">{p.title}</p>
                  <p className="mt-auto text-xs text-ink-3">
                    {c.videos} recordings · {c.articles} articles · {formatDate(p.publicationDate)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

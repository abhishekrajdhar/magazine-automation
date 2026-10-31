"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, CircleCheck, CircleX, EyeOff, Info, Loader2, PackageCheck, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { useProjectData } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/display";
import { Segmented } from "@/components/ui/primitives";
import { PageThumb } from "@/components/magazine/page-thumb";
import { useOversetProbe } from "@/components/designer/overset-probe";
import { fitTextInDom } from "@/components/designer/editor-panels";
import { approvalChecklist, runPreflight } from "@/lib/preflight/checks";
import type { PreflightCode, PreflightIssue, Severity } from "@/lib/domain/types";
import { liveArea } from "@/lib/templates/geometry";
import { cn } from "@/lib/utils/cn";

const CODE_LABEL: Record<PreflightCode, string> = {
  overset_text: "Overset text",
  missing_image: "Missing images",
  broken_asset: "Broken asset links",
  low_resolution: "Low image resolution",
  font_substitution: "Fonts",
  page_size_mismatch: "Page dimensions",
  margin_violation: "Margins",
  page_numbering: "Page numbering",
  empty_frame: "Empty frames",
  missing_caption: "Missing captions",
  layout_overflow: "Layout overflow",
  unapproved_content: "Unapproved content",
};

const SEVERITY: Record<Severity, { icon: React.ReactNode; tone: "danger" | "warning" | "neutral"; label: string }> = {
  error: { icon: <CircleX className="size-4 text-danger" />, tone: "danger", label: "Errors" },
  warning: { icon: <TriangleAlert className="size-4 text-warning-dot" />, tone: "warning", label: "Warnings" },
  info: { icon: <Info className="size-4 text-ink-4" />, tone: "neutral", label: "Info" },
};

const IGNORE_KEY = "pressflow-preflight-ignored";

export default function PreflightPage() {
  const router = useRouter();
  const data = useProjectData();
  const { project, profile, pages, articles, assetsById } = data;
  const referencePages = useWorkspace((s) => s.referencePages);
  const localFiles = useWorkspace((s) => s.localFiles);
  const updateElement = useWorkspace((s) => s.updateElement);
  const removeElement = useWorkspace((s) => s.removeElement);
  const { overset, ready, probe } = useOversetProbe(data);
  const [filter, setFilter] = React.useState<"all" | Severity>("all");
  const [ignored, setIgnored] = React.useState<Set<string>>(new Set());
  const [ranAt, setRanAt] = React.useState<Date | null>(null);

  React.useEffect(() => {
    try {
      setIgnored(new Set(JSON.parse(localStorage.getItem(IGNORE_KEY) ?? "[]")));
    } catch {
      /* ignore */
    }
  }, []);
  const persistIgnored = (next: Set<string>) => {
    setIgnored(next);
    try {
      localStorage.setItem(IGNORE_KEY, JSON.stringify([...next]));
    } catch {
      /* storage unavailable */
    }
  };

  const issues = React.useMemo(() => {
    if (!project || !profile || !ready) return null;
    return runPreflight({ project, profile, pages, articles, assets: assetsById, referencePages: referencePages.filter((r) => r.referenceId === project.referenceId), overset, localFiles });
  }, [project, profile, pages, articles, assetsById, referencePages, overset, ready, localFiles]);

  React.useEffect(() => {
    if (issues) setRanAt(new Date());
  }, [issues]);

  if (!project) return null;
  if (!profile || !pages.length) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-16">
        <Panel>
          <EmptyState icon={<ShieldCheck />} title="Nothing to check yet" description="Preflight runs on composed pages. Plan the issue in the flatplan first." action={<Button variant="primary" asChild><Link href="/app/designer">Open flatplan</Link></Button>} />
        </Panel>
      </div>
    );
  }

  const active = issues?.filter((i) => !ignored.has(i.id)) ?? [];
  const count = (s: Severity) => active.filter((i) => i.severity === s).length;
  const shown = active.filter((i) => filter === "all" || i.severity === filter);
  const groups = Object.entries(
    shown.reduce<Record<string, PreflightIssue[]>>((acc, i) => {
      (acc[i.code] ??= []).push(i);
      return acc;
    }, {}),
  );
  const checklist = approvalChecklist({ profile, pages, articles, issues, ignored });
  const blocking = checklist.filter((c) => c.blocking && !c.ok);

  const resolve = (issue: PreflightIssue) => {
    const page = pages.find((p) => p.id === issue.pageId);
    const el = page?.elements.find((e) => e.id === issue.elementId);
    switch (issue.fix) {
      case "fit_text": {
        if (!page || !el) return;
        const fit = fitTextInDom(page.id, el, profile);
        if (!fit) return toast.error("Can't fit within 85% of the type size", { description: "Open the page to enlarge the frame or shorten the copy.", action: { label: "Open page", onClick: () => router.push(`/app/designer/editor?page=${page.id}`) } });
        updateElement(page.id, el.id, { style: { ...el.style, size: fit.size, leading: fit.leading } });
        return toast.success(`Fitted at ${fit.size} pt on page ${issue.pageNumber}`);
      }
      case "snap_to_margins": {
        if (!page || !el || !issue.pageNumber) return;
        const la = liveArea(profile, issue.pageNumber);
        const w = Math.min(el.w, la.w);
        const h = Math.min(el.h, la.h);
        updateElement(page.id, el.id, { w, h, x: Math.min(Math.max(el.x, la.x), la.x + la.w - w), y: Math.min(Math.max(el.y, la.y), la.y + la.h - h) });
        return toast.success("Moved inside the margins");
      }
      case "remove_frame":
        if (page && el) {
          removeElement(page.id, el.id);
          toast.success("Frame removed");
        }
        return;
      case "approve_content":
        return router.push(`/app/studio/${page?.articleId ?? ""}`);
      case "renumber":
        return router.push("/app/designer");
      default:
        return router.push(`/app/designer/editor?page=${issue.pageId ?? pages[0].id}`);
    }
  };
  const fixLabel: Record<NonNullable<PreflightIssue["fix"]>, string> = {
    fit_text: "Fit text",
    snap_to_margins: "Snap to margins",
    remove_frame: "Remove frame",
    approve_content: "Review article",
    renumber: "Open flatplan",
    assign_image: "Choose image",
    add_caption: "Add caption",
    open_editor: "Open page",
  };

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-7">
      {probe}
      <PageHeader
        title="Preflight"
        description="Checks every page before export: text fit measured on the rendered pages, images, resolution, fonts, margins, numbering and approvals."
        meta={ranAt && <span className="text-xs text-ink-3">Last run {ranAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · re-runs automatically as you edit</span>}
        actions={
          <>
            {ignored.size > 0 && (
              <Button variant="ghost" onClick={() => persistIgnored(new Set())}>
                <RefreshCw /> Restore {ignored.size} ignored
              </Button>
            )}
            <Button variant="primary" asChild disabled={blocking.length > 0}>
              <Link href="/app/exports">
                <PackageCheck /> Go to exports
              </Link>
            </Button>
          </>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            {(["error", "warning", "info"] as Severity[]).map((s) => (
              <button key={s} onClick={() => setFilter(filter === s ? "all" : s)} className={cn("flex items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-left shadow-xs transition-colors", filter === s ? "border-ink" : "border-line hover:border-line-strong")}>
                {SEVERITY[s].icon}
                <div>
                  <p className="tabular text-xl font-semibold leading-none">{issues ? count(s) : "–"}</p>
                  <p className="mt-1 text-xs text-ink-3">{SEVERITY[s].label}</p>
                </div>
              </button>
            ))}
          </div>

          {!issues ? (
            <Panel className="flex items-center justify-center gap-2 py-16 text-sm text-ink-3">
              <Loader2 className="size-4 animate-spin" /> Measuring {pages.length} pages…
            </Panel>
          ) : active.length === 0 ? (
            <Panel>
              <EmptyState icon={<CircleCheck />} title="No issues" description="Every check passed." />
            </Panel>
          ) : (
            <div className="flex flex-col gap-4">
              <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: `All ${active.length}` }, { value: "error", label: "Errors" }, { value: "warning", label: "Warnings" }, { value: "info", label: "Info" }]} className="self-start" />
              {groups.map(([code, list]) => (
                <Panel key={code}>
                  <PanelHeader title={CODE_LABEL[code as PreflightCode]} description={`${list.length} issue${list.length > 1 ? "s" : ""}`} />
                  <ul className="divide-y divide-line">
                    {list.map((issue) => {
                      const page = pages.find((p) => p.id === issue.pageId);
                      return (
                        <li key={issue.id} className="flex items-start gap-3 px-4 py-3">
                          <span className="mt-0.5">{SEVERITY[issue.severity].icon}</span>
                          {page && profile ? (
                            <Link href={`/app/designer/editor?page=${page.id}`} className="shrink-0">
                              <PageThumb page={page} profile={profile} assets={assetsById} ctx={data.ctxFor(pages.indexOf(page))} width={44} />
                            </Link>
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm">
                              {issue.pageNumber && <span className="tabular mr-1.5 font-semibold">p.{issue.pageNumber}</span>}
                              {issue.message}
                            </p>
                            <p className="mt-0.5 text-xs text-ink-3">{issue.recommendation}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {issue.fix && (
                              <Button variant={issue.fix === "fit_text" || issue.fix === "snap_to_margins" ? "secondary" : "ghost"} size="xs" onClick={() => resolve(issue)}>
                                {fixLabel[issue.fix]} {!["fit_text", "snap_to_margins", "remove_frame"].includes(issue.fix) && <ArrowRight />}
                              </Button>
                            )}
                            {issue.severity !== "error" && (
                              <Button variant="ghost" size="icon-xs" title="Ignore" aria-label="Ignore issue" onClick={() => persistIgnored(new Set([...ignored, issue.id]))}>
                                <EyeOff />
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
          <Panel>
            <PanelHeader title="Final approval checklist" description="Required before final PDF or INDD export." />
            <ul className="divide-y divide-line">
              {checklist.map((c) => (
                <li key={c.key} className="flex items-start gap-3 px-4 py-3">
                  {c.ok ? <CircleCheck className="mt-0.5 size-4 text-success" /> : c.blocking ? <CircleAlert className="mt-0.5 size-4 text-danger" /> : <TriangleAlert className="mt-0.5 size-4 text-warning-dot" />}
                  <div className="min-w-0">
                    <p className="text-sm">{c.label}</p>
                    <p className="text-xs text-ink-3">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-4 py-3">
              {blocking.length ? <Badge tone="danger">{blocking.length} blocking item{blocking.length > 1 ? "s" : ""}</Badge> : <Badge tone="success">Ready for final export</Badge>}
            </div>
          </Panel>
          <Panel className="p-4 text-xs leading-relaxed text-ink-3">
            Overset is measured on the HTML preview renderer with substitute web fonts. InDesign re-checks overset with the licensed fonts when it renders, and reports any remaining overset frames in its render report.
          </Panel>
        </div>
      </div>
    </div>
  );
}

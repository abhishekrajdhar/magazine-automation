"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpenCheck, CircleAlert, CircleCheck, Download, FileArchive, FileJson, FileText, Images, Loader2, NotebookPen, PackageCheck, Printer, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { useProjectData } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader, Table, Td, Th } from "@/components/ui/display";
import { Tooltip } from "@/components/ui/primitives";
import { useOversetProbe } from "@/components/designer/overset-probe";
import { approvalChecklist, runPreflight } from "@/lib/preflight/checks";
import { exportFormatInfo } from "@/lib/domain/status";
import type { ExportFormat, ExportRecord, ExportRenderer } from "@/lib/domain/types";
import { assetArchive, contentPackage, downloadBlob, layoutJson, pagePreviews, type ExportData, type GeneratedFile } from "@/lib/exports/browser";
import { buildLayoutContract } from "@/lib/exports/contract";
import { useApiStatus, integration } from "@/lib/api/use-api-status";
import { live } from "@/lib/api/live";
import { formatBytes, formatDateTime, uid } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

const ICONS: Record<ExportFormat, React.ReactNode> = {
  pdf_digital: <FileText />,
  pdf_print: <Printer />,
  indd: <BookOpenCheck />,
  page_previews: <Images />,
  content_package: <NotebookPen />,
  asset_archive: <FileArchive />,
  layout_json: <FileJson />,
};

const RENDERER_LABEL: Record<ExportRenderer, string> = { browser: "Browser", reportlab: "API · ReportLab", indesign: "Adobe InDesign" };
const FINAL: ExportFormat[] = ["pdf_print", "indd"];

export default function ExportsPage() {
  const data = useProjectData();
  const { project, profile, pages, articles } = data;
  const mode = useWorkspace((s) => s.mode);
  const user = useWorkspace((s) => s.user);
  const members = useWorkspace((s) => s.members);
  const referencePages = useWorkspace((s) => s.referencePages);
  const localFiles = useWorkspace((s) => s.localFiles);
  const addExport = useWorkspace((s) => s.addExport);
  const updateExport = useWorkspace((s) => s.updateExport);
  const log = useWorkspace((s) => s.log);
  const api = useApiStatus();
  const { overset, ready, probe } = useOversetProbe(data);
  const [busy, setBusy] = React.useState<ExportFormat | string | null>(null);
  const apiLive = mode === "live" && api.online;
  const bridge = integration(api.integrations, "indesign_bridge");
  const bridgeOnline = apiLive && !!bridge?.available;

  const issues = React.useMemo(() => (project && profile && ready ? runPreflight({ project, profile, pages, articles, assets: data.assetsById, referencePages: referencePages.filter((r) => r.referenceId === project.referenceId), overset, localFiles }) : null), [project, profile, pages, articles, data.assetsById, referencePages, overset, ready, localFiles]);
  const ignored = React.useMemo(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem("pressflow-preflight-ignored") ?? "[]"));
    } catch {
      return new Set<string>();
    }
  }, []);
  const checklist = approvalChecklist({ profile, pages, articles, issues, ignored });
  const blocked = checklist.some((c) => c.blocking && !c.ok);

  if (!project) return null;
  if (!profile || !pages.length) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-16">
        <Panel>
          <EmptyState icon={<PackageCheck />} title="Nothing to export yet" description="Exports are produced from the composed pages. Plan and design the issue first." action={<Button variant="primary" asChild><Link href="/app/designer">Open flatplan</Link></Button>} />
        </Panel>
      </div>
    );
  }

  const exportData: ExportData = { project, profile, pages, articles, assets: data.assets, speakers: data.speakers, segments: data.segments };

  const availability = (f: ExportFormat): { renderer: ExportRenderer; available: boolean; reason?: string } => {
    switch (f) {
      case "pdf_digital":
        return apiLive ? { renderer: "reportlab", available: true } : { renderer: "browser", available: true };
      case "pdf_print":
        if (!apiLive) return { renderer: "reportlab", available: false, reason: "Needs the PressFlow API (ReportLab renderer with bleed and crop marks) or the InDesign bridge for PDF/X-4." };
        return { renderer: bridgeOnline ? "indesign" : "reportlab", available: !blocked, reason: blocked ? "Complete the approval checklist first." : undefined };
      case "indd":
        if (!bridgeOnline) return { renderer: "indesign", available: false, reason: apiLive ? "No InDesign bridge is connected. Native .indd files are only produced by Adobe InDesign." : "Needs the PressFlow API and a connected InDesign bridge. Native .indd files are only produced by Adobe InDesign." };
        return { renderer: "indesign", available: !blocked, reason: blocked ? "Complete the approval checklist first." : undefined };
      case "page_previews":
      case "asset_archive":
        return { renderer: apiLive ? "reportlab" : "browser", available: true };
      default:
        return { renderer: "browser", available: true };
    }
  };

  const record = (format: ExportFormat, renderer: ExportRenderer, patch: Partial<ExportRecord>): ExportRecord => {
    const rec: ExportRecord = { id: uid("exp"), projectId: project.id, format, status: "running", renderer, fileName: "", createdAt: new Date().toISOString(), createdBy: user?.id ?? "u_local", ...patch };
    addExport(rec);
    return rec;
  };

  const runBrowser = async (format: ExportFormat) => {
    if (format === "pdf_digital") {
      window.open(`/print?project=${project.id}&auto=1`, "_blank", "noopener");
      record(format, "browser", { status: "complete", fileName: "Browser print dialog", completedAt: new Date().toISOString(), message: "Opened in the browser print dialog (HTML preview renderer). Choose “Save as PDF”." });
      return;
    }
    let gen: GeneratedFile;
    let note: string | undefined;
    if (format === "content_package") {
      const pkg = await contentPackage(exportData);
      gen = pkg;
      note = `${pkg.count} approved articles; ${pkg.skipped} unapproved left out.`;
    } else if (format === "asset_archive") {
      const arc = await assetArchive(exportData);
      gen = arc;
      note = `${arc.placeholders} placeholder images included as labelled SVGs.`;
    } else gen = format === "layout_json" ? layoutJson(exportData) : await pagePreviews(exportData);
    downloadBlob(gen);
    record(format, "browser", { status: "complete", fileName: gen.fileName, sizeBytes: gen.blob.size, completedAt: new Date().toISOString(), message: note ?? "Generated in the browser from the current pages." });
    toast.success(`${exportFormatInfo[format].label} downloaded`, { description: note });
  };

  const runApi = async (format: ExportFormat, renderer: ExportRenderer) => {
    const contract = buildLayoutContract({ ...exportData, assets: data.assetsById });
    const rec = await live.createExport(project.id, format, contract);
    addExport(rec);
    toast.success(`${exportFormatInfo[format].label} queued`, { description: renderer === "indesign" ? "The InDesign bridge will pick it up." : "Rendering on the API." });
    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const list = await live.listExports(project.id);
      const latest = list.find((e) => e.id === rec.id);
      if (latest) updateExport(rec.id, latest);
      if (!latest || !["queued", "running"].includes(latest.status) || Date.now() - started > 10 * 60_000) break;
    }
  };

  const run = async (format: ExportFormat) => {
    const a = availability(format);
    if (!a.available) return;
    setBusy(format);
    try {
      if (a.renderer === "browser") await runBrowser(format);
      else await runApi(format, a.renderer);
      log("exported", exportFormatInfo[format].label, "export");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const download = async (e: ExportRecord) => {
    if (e.downloadUrl || (apiLive && e.renderer !== "browser")) {
      window.location.href = e.downloadUrl ?? `/api/v1/exports/${e.id}/download`;
      return;
    }
    if (e.renderer === "browser" && e.status === "complete") {
      setBusy(e.id);
      try {
        await runBrowser(e.format);
      } finally {
        setBusy(null);
      }
    }
  };

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-7">
      {probe}
      <PageHeader title="Export Centre" description={`Outputs for ${project.title}. Final formats need every blocking item on the checklist cleared.`} />

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(Object.keys(exportFormatInfo) as ExportFormat[]).map((f) => {
            const info = exportFormatInfo[f];
            const a = availability(f);
            return (
              <Panel key={f} className={cn("flex flex-col p-4", !a.available && "bg-subtle")}>
                <div className="flex items-start gap-3">
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md [&_svg]:size-4", a.available ? "bg-accent-soft text-accent" : "bg-sunken text-ink-4")}>{ICONS[f]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-semibold">{info.label}</p>
                      {FINAL.includes(f) && <Badge tone="outline">Final</Badge>}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-ink-3">{info.description}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Badge tone={a.available ? "accent" : "neutral"}>{RENDERER_LABEL[a.renderer]}</Badge>
                  {!a.available && <Badge tone="warning">Unavailable</Badge>}
                  <Tooltip content={a.reason ?? `Generate ${info.label.toLowerCase()}`}>
                    <span className="ml-auto">
                      <Button variant={a.available ? "secondary" : "ghost"} size="sm" disabled={!a.available || busy !== null} loading={busy === f} onClick={() => run(f)}>
                        <Download /> {f === "pdf_digital" && a.renderer === "browser" ? "Open print view" : "Generate"}
                      </Button>
                    </span>
                  </Tooltip>
                </div>
                {a.reason && <p className="mt-2.5 text-xs text-ink-3">{a.reason}</p>}
              </Panel>
            );
          })}
        </div>

        <div className="flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
          <Panel>
            <PanelHeader title="Final approval checklist" actions={<Button variant="ghost" size="xs" asChild><Link href="/app/designer/preflight"><ShieldCheck /> Preflight</Link></Button>} />
            {!ready ? (
              <p className="flex items-center gap-2 px-4 py-6 text-sm text-ink-3">
                <Loader2 className="size-4 animate-spin" /> Checking {pages.length} pages…
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {checklist.map((c) => (
                  <li key={c.key} className="flex items-start gap-3 px-4 py-2.5">
                    {c.ok ? <CircleCheck className="mt-0.5 size-4 text-success" /> : c.blocking ? <CircleAlert className="mt-0.5 size-4 text-danger" /> : <TriangleAlert className="mt-0.5 size-4 text-warning-dot" />}
                    <div className="min-w-0">
                      <p className="text-sm">{c.label}</p>
                      <p className="text-xs text-ink-3">{c.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel className="p-4 text-xs leading-relaxed text-ink-3">
            <p className="font-medium text-ink-2">About renderers</p>
            <p className="mt-1">
              <strong>Browser</strong> and <strong>ReportLab</strong> outputs come from PressFlow&apos;s preview renderers using substitute fonts. Only <strong>Adobe InDesign</strong>, via the bridge, produces native .indd files and PDF/X-4 print files with your licensed fonts.{" "}
              <Link href="/app/settings?tab=integrations" className="text-accent hover:underline">
                Integration status
              </Link>
            </p>
          </Panel>
        </div>
      </div>

      <Panel className="mt-6 overflow-hidden">
        <PanelHeader title="Export history" description="Browser exports are regenerated from the current pages when you download them again." />
        {data.exports.length === 0 ? (
          <EmptyState compact icon={<PackageCheck />} title="No exports yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Format</Th>
                <Th>File</Th>
                <Th>Renderer</Th>
                <Th>Status</Th>
                <Th className="text-right">Size</Th>
                <Th>Created</Th>
                <Th>By</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {[...data.exports]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((e) => (
                  <tr key={e.id} className="hover:bg-subtle">
                    <Td className="whitespace-nowrap font-medium">{exportFormatInfo[e.format].label}</Td>
                    <Td className="max-w-[260px]">
                      <span className="block truncate font-mono text-xs">{e.fileName || "—"}</span>
                      {e.message && <span className="block truncate text-xs text-ink-3" title={e.message}>{e.message}</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-ink-2">{RENDERER_LABEL[e.renderer]}</Td>
                    <Td>
                      <Badge tone={e.status === "complete" ? "success" : e.status === "unavailable" ? "warning" : e.status === "failed" ? "danger" : "accent"} dot pulse={e.status === "running" || e.status === "queued"}>
                        {e.status[0].toUpperCase() + e.status.slice(1)}
                      </Badge>
                    </Td>
                    <Td className="tabular whitespace-nowrap text-right text-xs text-ink-2">{e.sizeBytes ? formatBytes(e.sizeBytes) : "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-ink-3">{formatDateTime(e.createdAt)}</Td>
                    <Td className="whitespace-nowrap text-xs text-ink-3">{members.find((m) => m.userId === e.createdBy)?.name ?? "You"}</Td>
                    <Td>
                      {e.status === "complete" && e.format !== "pdf_digital" && (
                        <Tooltip content={e.renderer === "browser" ? "Regenerate and download" : "Download"}>
                          <Button variant="ghost" size="icon-xs" loading={busy === e.id} onClick={() => download(e)} aria-label="Download">
                            <Download />
                          </Button>
                        </Tooltip>
                      )}
                    </Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

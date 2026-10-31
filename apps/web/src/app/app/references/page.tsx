"use client";

import * as React from "react";
import Link from "next/link";
import { FileUp, LibraryBig, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel, SimulatedBadge } from "@/components/ui/display";
import { referenceStatus } from "@/lib/domain/status";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, useConfirm } from "@/components/ui/overlays";
import { ReferencePageThumb } from "@/components/reference/reference-thumb";
import { ReferenceStep } from "@/components/wizard/reference-step";
import type { DraftReference } from "@/components/wizard/types";
import { useApiStatus } from "@/lib/api/use-api-status";
import { live } from "@/lib/api/live";
import { formatBytes, formatDate, uid } from "@/lib/utils/format";


export default function ReferencesPage() {
  const confirm = useConfirm();
  const references = useWorkspace((s) => s.references);
  const pages = useWorkspace((s) => s.referencePages);
  const profiles = useWorkspace((s) => s.designProfiles);
  const localFiles = useWorkspace((s) => s.localFiles);
  const projects = useWorkspace((s) => s.projects);
  const removeReference = useWorkspace((s) => s.removeReference);
  const mode = useWorkspace((s) => s.mode);
  const api = useApiStatus();
  const [uploading, setUploading] = React.useState(false);
  const [draft, setDraft] = React.useState<DraftReference>({ mode: "upload", status: "empty" });
  const [saving, setSaving] = React.useState(false);
  const apiLive = mode === "live" && api.online;

  const save = async () => {
    const store = useWorkspace.getState();
    setSaving(true);
    try {
      const file = draft.file ?? (draft.sampleUrl ? new File([await (await fetch(draft.sampleUrl)).blob()], draft.fileName ?? "reference.pdf", { type: "application/pdf" }) : undefined);
      if (!file) return;
      const title = (draft.fileName ?? "Reference").replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
      if (apiLive) {
        const { reference: ref } = await live.uploadReference(file, title, draft.inddFile);
        store.addReference({ ...ref, status: "analysing" });
        toast.success("Uploaded — analysis queued");
      } else {
        const id = uid("ref");
        store.addReference({
          id,
          orgId: store.organisation?.id ?? "org_local",
          title,
          fileName: file.name,
          fileSizeBytes: file.size,
          pageCount: draft.pageCount ?? 0,
          uploadedAt: new Date().toISOString(),
          status: "uploaded",
          analysis: { progress: 0, analyser: "pymupdf", message: "Analysis requires the PressFlow API, which isn't connected. The PDF is kept in this browser for preview only." },
          hasSourcePdf: false,
          hasInddSource: !!draft.inddFile,
          isDemo: false,
        });
        store.registerLocalFile(id, file);
        toast.success("Added to the library", { description: "Not analysed — the API isn't connected." });
      }
      setUploading(false);
      setDraft({ mode: "upload", status: "empty" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-7">
      <PageHeader
        title="Reference Library"
        description="Past issues analysed into reusable design profiles: trim, grid, typography, colour and page archetypes."
        actions={
          <Button variant="primary" onClick={() => setUploading(true)}>
            <FileUp /> Upload reference PDF
          </Button>
        }
      />

      {references.length === 0 ? (
        <Panel className="mt-6">
          <EmptyState icon={<LibraryBig />} title="No reference magazines" description="Upload a previous issue to reconstruct its design system." action={<Button variant="primary" onClick={() => setUploading(true)}>Upload reference PDF</Button>} />
        </Panel>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {references.map((r) => {
            const refPages = pages.filter((p) => p.referenceId === r.id);
            const profile = profiles.find((d) => d.id === r.designProfileId);
            const usedBy = projects.filter((p) => p.referenceId === r.id).length;
            return (
              <Panel key={r.id} className="group flex flex-col overflow-hidden transition-shadow hover:shadow-md">
                <Link href={`/app/references/${r.id}`} className="canvas-backdrop flex h-56 items-center justify-center gap-2 overflow-hidden px-4">
                  {refPages.length ? (
                    refPages.slice(0, 3).map((p, i) => (
                      <div key={p.id} className={i === 1 ? "z-10 scale-105 shadow-page" : "shadow-page"}>
                        <ReferencePageThumb page={p} width={i === 1 ? 118 : 100} pdfUrl={localFiles[r.id]?.url} />
                      </div>
                    ))
                  ) : (
                    <div className="flex h-[160px] w-[113px] items-center justify-center border border-dashed border-line-strong bg-surface text-[11px] text-ink-4">{r.pageCount} pages</div>
                  )}
                </Link>
                <div className="flex flex-1 flex-col gap-2 border-t border-line p-4">
                  <div className="flex items-start gap-2">
                    <Link href={`/app/references/${r.id}`} className="min-w-0 flex-1">
                      <p className="truncate font-medium group-hover:text-accent">{r.title}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-3">
                        {r.pageCount} pages · {formatBytes(r.fileSizeBytes)} · {formatDate(r.uploadedAt)}
                      </p>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label="Reference actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          tone="danger"
                          icon={<Trash2 />}
                          disabled={usedBy > 0}
                          onSelect={async () => {
                            if (await confirm({ title: `Remove “${r.title}”?`, description: "Its pages and design profile are removed from the library.", confirmLabel: "Remove", tone: "danger" })) {
                              removeReference(r.id);
                              toast.success("Reference removed");
                            }
                          }}
                        >
                          {usedBy > 0 ? `In use by ${usedBy} project${usedBy > 1 ? "s" : ""}` : "Remove"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={referenceStatus[r.status].tone} dot>
                      {referenceStatus[r.status].label}
                    </Badge>
                    {r.isDemo && <SimulatedBadge label="Demo profile" title="Seeded profile: the source PDF isn't bundled, so pages show detected structure only." />}
                    {r.hasInddSource && <Badge tone="outline">INDD source</Badge>}
                  </div>
                  {profile ? (
                    <div className="mt-auto flex items-center justify-between pt-2 text-xs text-ink-3">
                      <span>
                        {profile.grid.columns} col · {profile.typography.body.size}/{profile.typography.body.leading} pt · {Math.round((profile.page.widthPt / 72) * 25.4)}×{Math.round((profile.page.heightPt / 72) * 25.4)} mm
                      </span>
                      <span className="flex gap-0.5">
                        {profile.colors.palette.slice(0, 5).map((c) => (
                          <span key={c} className="size-3.5 rounded-[3px] border border-black/10" style={{ background: c }} />
                        ))}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-auto pt-2 text-xs text-ink-3">{r.analysis.message ?? "No design profile yet."}</p>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <Dialog open={uploading} onOpenChange={setUploading}>
        <DialogContent
          title="Upload reference magazine"
          description={apiLive ? "The PDF is uploaded and analysed on the server." : "The API isn't connected: the PDF stays in this browser for preview and isn't analysed."}
          size="xl"
          footer={
            <>
              <Button variant="secondary" onClick={() => setUploading(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={saving} disabled={draft.mode !== "upload" || draft.status !== "ready"} onClick={save}>
                {apiLive ? "Upload & analyse" : "Add to library"}
              </Button>
            </>
          }
        >
          <ReferenceStep value={draft} onChange={setDraft} apiOnline={apiLive} uploadOnly />
        </DialogContent>
      </Dialog>
    </div>
  );
}

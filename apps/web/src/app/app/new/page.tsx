"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, Loader2, Server, ServerOff } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/display";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { ProjectFields, validateDetails, type ProjectDetails } from "@/components/wizard/project-fields";
import { MediaStep, describeDraft } from "@/components/wizard/media-step";
import { ReferenceStep } from "@/components/wizard/reference-step";
import { ConfigStep } from "@/components/wizard/config-step";
import type { DraftMedia, DraftReference } from "@/components/wizard/types";
import { SourceGlyph } from "@/components/shell/logo";
import { useApiStatus } from "@/lib/api/use-api-status";
import { live } from "@/lib/api/live";
import { articleTypeLabel } from "@/lib/domain/status";
import type { GenerationConfig, ReferenceMagazine, VideoSource } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatBytes, formatDate, formatDuration, uid } from "@/lib/utils/format";

const STEPS = [
  { key: "details", title: "Project information", hint: "Title, event and issue details" },
  { key: "media", title: "Event recordings", hint: "YouTube, Drive or uploads" },
  { key: "reference", title: "Reference magazine", hint: "The design to reproduce" },
  { key: "config", title: "Generation settings", hint: "Mode, sections and tone" },
  { key: "review", title: "Review & create", hint: "Check everything once more" },
] as const;

const DRAFT_KEY = "pressflow-wizard-draft";

const defaultDetails = (): ProjectDetails => ({
  title: "",
  eventName: "",
  category: "Government Technology",
  issueNumber: "",
  publicationDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10),
  publisher: "Elets Technomedia Pvt. Ltd.",
  targetPageCount: 40,
  description: "",
});

const defaultConfig = (): GenerationConfig => ({
  designMode: "exact_reference",
  targetPageCount: 40,
  contentStyle: "feature",
  language: "en",
  editorialTone: "authoritative",
  imagePreference: "speakers_first",
  articleTypes: ["event_report", "keynote", "panel", "interview", "government_perspective", "speaker_profiles", "highlights", "editorial", "photo_captions"],
  includeToc: true,
  includeEditorial: true,
  includeAdvertisements: true,
  includeInterviews: true,
  includeEventReports: true,
  adPageCount: 6,
});

type TaskState = "pending" | "running" | "done" | "failed" | "skipped";
interface Task {
  label: string;
  state: TaskState;
  detail?: string;
}

export default function CreateMagazinePage() {
  const router = useRouter();
  const api = useApiStatus();
  const mode = useWorkspace((s) => s.mode);
  const references = useWorkspace((s) => s.references);
  const [step, setStep] = React.useState(0);
  const [details, setDetails] = React.useState<ProjectDetails>(defaultDetails);
  const [media, setMedia] = React.useState<DraftMedia[]>([]);
  const [reference, setReference] = React.useState<DraftReference>({ mode: "upload", status: "empty" });
  const [config, setConfig] = React.useState<GenerationConfig>(defaultConfig);
  const [errors, setErrors] = React.useState<ReturnType<typeof validateDetails>>({});
  const [tasks, setTasks] = React.useState<Task[] | null>(null);
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const live_ = mode === "live" && api.online;

  // Text fields survive a refresh; files can't be persisted by the browser.
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { details?: ProjectDetails; config?: GenerationConfig };
        if (d.details) setDetails(d.details);
        if (d.config) setConfig(d.config);
      }
    } catch {
      /* ignore unreadable drafts */
    }
  }, []);
  React.useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ details, config }));
    } catch {
      /* storage may be unavailable */
    }
  }, [details, config]);
  React.useEffect(() => setConfig((c) => ({ ...c, targetPageCount: details.targetPageCount })), [details.targetPageCount]);

  const canLeave = (i: number): string | null => {
    if (i === 0) {
      const e = validateDetails(details);
      setErrors(e);
      return Object.keys(e).length ? "Complete the highlighted fields." : null;
    }
    if (i === 1 && media.some((m) => m.resolve === "pending")) return "Wait for recordings to finish loading.";
    if (i === 2 && reference.status === "loading") return "Wait for the PDF preview to finish.";
    if (i === 3 && config.articleTypes.length === 0) return "Choose at least one article type.";
    return null;
  };

  const go = (target: number) => {
    if (target > step) {
      for (let i = step; i < target; i += 1) {
        const problem = canLeave(i);
        if (problem) {
          setStep(i);
          toast.error(problem);
          return;
        }
      }
    }
    setStep(target);
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const create = async () => {
    const problem = canLeave(0);
    if (problem) return go(0);
    const plan: Task[] = [
      { label: "Create project", state: "pending" },
      { label: `Register ${media.length} recording${media.length === 1 ? "" : "s"}`, state: media.length ? "pending" : "skipped" },
      { label: reference.mode === "library" ? "Attach reference from library" : "Add reference magazine", state: reference.status === "ready" ? "pending" : "skipped" },
      { label: "Queue processing", state: "pending" },
    ];
    setTasks(plan);
    const update = (i: number, patch: Partial<Task>) => setTasks((t) => (t ? t.map((x, j) => (j === i ? { ...x, ...patch } : x)) : t));
    if (live_) await createLive(update);
    else await createLocal(update);
  };

  /* ----------------------------- demo / offline ----------------------------- */
  const createLocal = async (update: (i: number, p: Partial<Task>) => void) => {
    const store = useWorkspace.getState();
    update(0, { state: "running" });
    const libraryRef = reference.mode === "library" ? references.find((r) => r.id === reference.libraryId) : undefined;
    let referenceId = libraryRef?.id;
    if (reference.mode === "upload" && reference.status === "ready") {
      referenceId = uid("ref");
      const ref: ReferenceMagazine = {
        id: referenceId,
        orgId: store.organisation?.id ?? "org_local",
        title: reference.fileName?.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ") ?? "Reference",
        fileName: reference.fileName ?? "reference.pdf",
        fileSizeBytes: reference.fileSize ?? 0,
        pageCount: reference.pageCount ?? 0,
        uploadedAt: new Date().toISOString(),
        status: "uploaded",
        analysis: { progress: 0, analyser: "pymupdf", message: "Analysis requires the PressFlow API, which isn't connected. The PDF is kept in this browser for preview only." },
        hasSourcePdf: false,
        hasInddSource: !!reference.inddFile,
        isDemo: false,
      };
      store.addReference(ref);
      if (reference.file) store.registerLocalFile(referenceId, reference.file);
    }
    const project = store.createProject({
      ...details,
      publicationDate: details.publicationDate,
      status: media.length ? "ingesting" : "setup",
      referenceId,
      designProfileId: libraryRef?.designProfileId,
      config,
    });
    update(0, { state: "done", detail: project.id });

    if (media.length) {
      update(1, { state: "running" });
      for (const m of media) {
        const id = uid("vid");
        const video: VideoSource = {
          id,
          projectId: project.id,
          sourceType: m.sourceType,
          url: m.url,
          externalId: m.externalId,
          fileName: m.fileName,
          fileSizeBytes: m.fileSize,
          title: m.title,
          durationSec: m.durationSec,
          thumbnailUrl: m.thumbnailUrl,
          processing: {
            state: m.sourceType === "google_drive" ? "needs_auth" : "pending",
            progress: 0,
            message: m.sourceType === "google_drive" ? "Authorise Google Drive to download this recording." : "Processing requires the PressFlow API, which isn't connected.",
            updatedAt: new Date().toISOString(),
          },
          transcription: { state: "none" },
          simulated: false,
          addedAt: new Date().toISOString(),
        };
        store.addVideo(video);
        if (m.file) store.registerLocalFile(id, m.file);
      }
      update(1, { state: "done", detail: "Saved to this workspace" });
    }
    if (reference.status === "ready") update(2, { state: "done", detail: libraryRef ? libraryRef.title : "Kept in this browser for preview" });
    update(3, { state: "skipped", detail: "API not connected — nothing was processed" });
    sessionStorage.removeItem(DRAFT_KEY);
    setCreatedId(project.id);
  };

  /* --------------------------------- live --------------------------------- */
  const createLive = async (update: (i: number, p: Partial<Task>) => void) => {
    try {
      update(0, { state: "running" });
      let referenceId = reference.mode === "library" ? reference.libraryId : undefined;
      if (reference.mode === "upload" && reference.status === "ready") {
        update(2, { state: "running" });
        const file = reference.file ?? new File([await (await fetch(reference.sampleUrl!)).blob()], reference.fileName ?? "reference.pdf", { type: "application/pdf" });
        const { reference: ref } = await live.uploadReference(file, reference.fileName?.replace(/\.pdf$/i, "") ?? "Reference", reference.inddFile, (f) => update(2, { detail: `Uploading ${Math.round(f * 100)}%` }));
        referenceId = ref.id;
        useWorkspace.getState().addReference({ ...ref, status: "analysing" });
        update(2, { state: "done", detail: "Uploaded · analysis queued" });
      } else if (reference.status === "ready") update(2, { state: "done" });
      const project = await live.createProject({ ...details, status: "setup", referenceId, config });
      update(0, { state: "done", detail: project.id });
      if (media.length) {
        update(1, { state: "running" });
        const created: VideoSource[] = [];
        for (const [i, m] of media.entries()) {
          update(1, { detail: `${i + 1} of ${media.length}` });
          if (m.file) created.push(await live.uploadVideo(project.id, m.file, (f) => update(1, { detail: `${i + 1} of ${media.length} · uploading ${Math.round(f * 100)}%` })));
          else created.push(...(await live.addVideoFromUrl(project.id, m.url!, m.title)));
        }
        update(1, { state: "done" });
        update(3, { state: "running" });
        let queued = 0;
        for (const v of created) {
          if (v.sourceType === "google_drive") continue;
          await live.processVideo(v.id).then(() => (queued += 1)).catch(() => undefined);
        }
        update(3, { state: "done", detail: `${queued} recording${queued === 1 ? "" : "s"} queued` });
      } else update(3, { state: "skipped" });
      const ws = await live.workspace(project.id);
      const s = useWorkspace.getState();
      s.hydrateLive({ projects: [ws.project, ...s.projects.filter((p) => p.id !== ws.project.id)], videos: [...s.videos.filter((v) => v.projectId !== project.id), ...ws.videos], activeProjectId: project.id });
      sessionStorage.removeItem(DRAFT_KEY);
      setCreatedId(project.id);
    } catch (err) {
      setTasks((t) => t?.map((x) => (x.state === "running" ? { ...x, state: "failed", detail: (err as Error).message } : x)) ?? null);
    }
  };

  const current = STEPS[step];
  const selectedRef = reference.mode === "library" ? references.find((r) => r.id === reference.libraryId) : undefined;

  return (
    <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-8 px-6 py-7 lg:grid-cols-[240px_1fr]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <p className="text-xs font-medium uppercase tracking-[0.1em] text-ink-4">New magazine</p>
        <ol className="mt-4 flex flex-col gap-1">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button onClick={() => go(i)} className={cn("flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover", i === step && "bg-surface shadow-xs ring-1 ring-line")}>
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                    i < step ? "border-success-dot bg-success-dot text-white" : i === step ? "border-accent bg-accent text-white" : "border-line-strong text-ink-4",
                  )}
                >
                  {i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                <span>
                  <span className={cn("block text-sm", i === step ? "font-medium text-ink" : "text-ink-2")}>{s.title}</span>
                  <span className="block text-xs text-ink-4">{s.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-6 rounded-md border border-line bg-surface px-3 py-2.5 text-xs">
          {api.checking ? (
            <span className="flex items-center gap-2 text-ink-3">
              <Loader2 className="size-3.5 animate-spin" /> Checking API…
            </span>
          ) : live_ ? (
            <span className="flex items-center gap-2 text-success">
              <Server className="size-3.5" /> API connected — processing will run
            </span>
          ) : (
            <span className="flex items-start gap-2 text-ink-3">
              <ServerOff className="mt-0.5 size-3.5 shrink-0" />
              {mode === "demo" ? "Demo workspace: the project is saved in this browser and nothing is processed." : "API not reachable: nothing will be processed."}
            </span>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        <div className="mb-6">
          <p className="text-xs text-ink-4">
            Step {step + 1} of {STEPS.length}
          </p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.015em]">{current.title}</h1>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}>
            {step === 0 && (
              <Panel className="p-5">
                <ProjectFields value={details} onChange={setDetails} errors={errors} />
              </Panel>
            )}
            {step === 1 && <MediaStep media={media} onChange={(fn) => setMedia(fn)} apiOnline={live_} />}
            {step === 2 && <ReferenceStep value={reference} onChange={setReference} apiOnline={live_} />}
            {step === 3 && <ConfigStep value={config} onChange={setConfig} />}
            {step === 4 && (
              <div className="flex flex-col gap-4">
                <Panel>
                  <ReviewRow title="Project" onEdit={() => go(0)}>
                    <p className="font-serif text-xl font-medium">{details.title || "Untitled issue"}</p>
                    <p className="mt-1 text-sm text-ink-3">
                      {details.eventName} · {details.category} · {details.issueNumber} · publishes {formatDate(details.publicationDate)} · {details.targetPageCount} pages
                    </p>
                  </ReviewRow>
                  <ReviewRow title={`Recordings (${media.length})`} onEdit={() => go(1)}>
                    {media.length === 0 ? (
                      <p className="text-sm text-warning">No recordings — you can add them later, but nothing can be written until you do.</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {media.map((m) => (
                          <li key={m.id} className="flex items-center gap-2 text-sm">
                            <SourceGlyph type={m.sourceType} className="text-ink-3" />
                            <span className="min-w-0 flex-1 truncate">{m.title}</span>
                            <span className="tabular text-xs text-ink-3">{m.durationSec ? formatDuration(m.durationSec) : m.fileSize ? formatBytes(m.fileSize) : ""}</span>
                            <Badge tone={describeDraft(m, live_).processing.tone}>{describeDraft(m, live_).processing.label}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </ReviewRow>
                  <ReviewRow title="Reference" onEdit={() => go(2)}>
                    {reference.status !== "ready" ? (
                      <p className="text-sm text-warning">No reference selected — pages can't be composed until a design profile is approved.</p>
                    ) : selectedRef ? (
                      <p className="text-sm">{selectedRef.title} · {selectedRef.pageCount} pages · design profile available</p>
                    ) : (
                      <p className="text-sm">
                        {reference.fileName} · {reference.pageCount} pages · {reference.sizeLabel}
                        {reference.inddFile ? ` · with ${reference.inddFile.name}` : ""}
                      </p>
                    )}
                  </ReviewRow>
                  <ReviewRow title="Generation" onEdit={() => go(3)} last>
                    <p className="text-sm">
                      {config.designMode === "exact_reference" ? "Exact reference-style reproduction" : config.designMode === "adapted_reference" ? "Adapted reference" : "PressFlow house style"} · {config.editorialTone} tone · {config.contentStyle} style ·{" "}
                      {config.includeAdvertisements ? `${config.adPageCount} ad pages` : "no ads"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {config.articleTypes.map((t) => (
                        <Badge key={t} tone="outline">
                          {articleTypeLabel[t]}
                        </Badge>
                      ))}
                    </div>
                  </ReviewRow>
                </Panel>
                <Panel className="p-4">
                  <p className="text-sm font-medium">What happens next</p>
                  {live_ ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
                      <li>The reference PDF is uploaded and analysed into a design profile you review and approve.</li>
                      <li>Uploaded recordings are stored; YouTube captions are fetched where your account is entitled to them; audio is transcribed otherwise.</li>
                      <li>Google Drive recordings wait for you to authorise Google access.</li>
                      <li>Speakers, quotes and figures are extracted for editorial review. Nothing is drafted until you approve facts.</li>
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-ink-2">
                      The API isn&apos;t connected, so the project, recordings and reference are saved in this browser and <strong>nothing is analysed, transcribed or generated</strong>. To explore processed content, open the seeded National eGovernance Summit 2026 project.
                    </p>
                  )}
                </Panel>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-6 flex items-center justify-between border-t border-line pt-5">
          <Button variant="ghost" onClick={() => (step === 0 ? router.back() : go(step - 1))}>
            <ArrowLeft /> {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => go(step + 1)}>
              Continue <ArrowRight />
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={create}>
              {live_ ? "Create project & start processing" : "Create project"}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={tasks !== null} onOpenChange={(o) => !o && (createdId || tasks?.some((t) => t.state === "failed")) && setTasks(null)}>
        <DialogContent
          title={createdId ? "Project created" : tasks?.some((t) => t.state === "failed") ? "Something went wrong" : "Creating project…"}
          size="sm"
          hideClose={!createdId}
          footer={
            createdId ? (
              <Button variant="primary" onClick={() => router.push(`/app/projects/${createdId}`)}>
                Open project <ArrowRight />
              </Button>
            ) : tasks?.some((t) => t.state === "failed") ? (
              <Button variant="secondary" onClick={() => setTasks(null)}>
                Close
              </Button>
            ) : undefined
          }
        >
          <ul className="flex flex-col gap-3">
            {tasks?.map((t) => (
              <li key={t.label} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5">
                  {t.state === "done" ? <CircleCheck className="size-4 text-success" /> : t.state === "running" ? <Loader2 className="size-4 animate-spin text-accent" /> : t.state === "failed" ? <CircleAlert className="size-4 text-danger" /> : <span className="block size-4 rounded-full border border-line-strong" />}
                </span>
                <span className="min-w-0">
                  <span className={cn("block", t.state === "skipped" && "text-ink-4")}>{t.label}</span>
                  {t.detail && <span className={cn("block text-xs", t.state === "failed" ? "text-danger" : "text-ink-3")}>{t.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewRow({ title, onEdit, children, last }: { title: string; onEdit: () => void; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-[180px_1fr_auto]", !last && "border-b border-line")}>
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-4">{title}</p>
      <div className="min-w-0">{children}</div>
      <Button variant="ghost" size="xs" onClick={onEdit} className="self-start">
        Edit
      </Button>
    </div>
  );
}

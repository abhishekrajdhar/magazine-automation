"use client";

/**
 * Typed calls to the PressFlow API used in live mode. Every function hits a
 * real endpoint; there are no canned responses here.
 */
import type {
  Article,
  Asset,
  DesignProfile,
  ExportFormat,
  ExportRecord,
  Job,
  MagazinePage,
  Project,
  ProjectWorkspace,
  ReferenceMagazine,
  ReferencePage,
  Template,
  VideoSource,
} from "@/lib/domain/types";
import { apiFetch, apiUpload } from "./client";

export type ImageAspect = "portrait" | "landscape" | "square";

export interface JobRef {
  jobId: string;
  job: Job;
}

export interface ResolvedMedia {
  valid: boolean;
  sourceType?: "youtube" | "google_drive";
  externalId?: string;
  title?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  captions?: "available" | "none" | "unknown";
  error?: string;
  isFolder?: boolean;
}

export const live = {
  resolveMedia: (url: string) => apiFetch<ResolvedMedia>("/media/resolve", { method: "POST", json: { url } }),

  listProjects: () => apiFetch<Project[]>("/projects"),
  createProject: (input: Partial<Project>) => apiFetch<Project>("/projects", { method: "POST", json: input }),
  updateProject: (id: string, patch: Partial<Project>) => apiFetch<Project>(`/projects/${id}`, { method: "PATCH", json: patch }),
  deleteProject: (id: string) => apiFetch<void>(`/projects/${id}`, { method: "DELETE" }),
  workspace: (id: string) => apiFetch<ProjectWorkspace>(`/projects/${id}/workspace`),

  /** A Drive folder expands into one video per file, so this returns a list. */
  addVideoFromUrl: (projectId: string, url: string, title?: string) => apiFetch<VideoSource[]>(`/projects/${projectId}/videos`, { method: "POST", json: { url, title } }),
  uploadVideo: (projectId: string, file: File, onProgress?: (f: number) => void) => {
    const form = new FormData();
    form.append("file", file);
    return apiUpload<VideoSource>(`/projects/${projectId}/videos/upload`, form, onProgress);
  },
  processVideo: (videoId: string) => apiFetch<JobRef>(`/videos/${videoId}/process`, { method: "POST" }),

  uploadAsset: (projectId: string, file: File, onProgress?: (f: number) => void) => {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "photo");
    return apiUpload<Asset>(`/projects/${projectId}/assets`, form, onProgress);
  },
  generateImage: (projectId: string, body: { prompt: string; aspect: ImageAspect; sessionId?: string }) => apiFetch<Asset>(`/projects/${projectId}/assets/generate`, { method: "POST", json: body }),

  templateLogos: (projectId: string, templateId: string) => apiFetch<Asset[]>(`/projects/${projectId}/templates/${templateId}/logos`, { method: "POST" }),

  googleAuthorize: () => apiFetch<{ authorizeUrl: string }>("/integrations/google/authorize"),
  googleDisconnect: () => apiFetch<{ message: string }>("/integrations/google", { method: "DELETE" }),

  listReferences: () => apiFetch<ReferenceMagazine[]>("/references"),
  listTemplates: () => apiFetch<Template[]>("/templates"),
  uploadReference: (file: File, title: string, indd?: File, onProgress?: (f: number) => void) => {
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    if (indd) form.append("designSource", indd);
    // The API queues analysis automatically on upload.
    return apiUpload<{ reference: ReferenceMagazine; jobId?: string }>("/references", form, onProgress);
  },
  analyseReference: (id: string) => apiFetch<{ jobId: string; reference: ReferenceMagazine }>(`/references/${id}/analyse`, { method: "POST" }),
  reference: (id: string) => apiFetch<ReferenceMagazine>(`/references/${id}`),
  referencePages: (id: string) => apiFetch<ReferencePage[]>(`/references/${id}/pages`),
  referencePageImage: (id: string, n: number, scale = 1) => `/api/v1/references/${id}/pages/${n}/image?scale=${scale}`,
  reanalysePage: (id: string, n: number) => apiFetch<JobRef>(`/references/${id}/pages/${n}/reanalyse`, { method: "POST" }),
  correctPage: (id: string, n: number, patch: Partial<ReferencePage>) => apiFetch<ReferencePage>(`/references/${id}/pages/${n}`, { method: "PATCH", json: patch }),
  profile: (id: string) => apiFetch<DesignProfile>(`/design-profiles/${id}`),
  patchProfile: (id: string, patch: Partial<DesignProfile>) => apiFetch<DesignProfile>(`/design-profiles/${id}`, { method: "PATCH", json: patch }),
  approveProfile: (id: string) => apiFetch<DesignProfile>(`/design-profiles/${id}/approve`, { method: "POST" }),
  deriveTemplate: (referenceId: string, pageNumber: number) => apiFetch<Template>("/templates/derive", { method: "POST", json: { referenceId, pageNumber } }),

  generateArticles: (projectId: string, types: string[], sessionIds: string[]) => apiFetch<JobRef>(`/projects/${projectId}/articles/generate`, { method: "POST", json: { types, sessionIds } }),
  generationJobs: (projectId: string) => apiFetch<Job[]>(`/projects/${projectId}/articles/jobs`),
  patchArticle: (id: string, patch: Partial<Article>) => apiFetch<Article>(`/articles/${id}`, { method: "PATCH", json: patch }),
  article: (id: string) => apiFetch<Article>(`/articles/${id}`),
  /** Returns suggestions only; nothing is applied server-side. */
  assist: (id: string, body: { action: string; blockId?: string; tone?: string }) => apiFetch<{ action: string; blockId?: string; suggestions: string[]; provider: string; model: string }>(`/articles/${id}/assist`, { method: "POST", json: body }),
  approveArticle: (id: string) => apiFetch<Article>(`/articles/${id}/approve`, { method: "POST" }),
  rejectArticle: (id: string, note: string) => apiFetch<Article>(`/articles/${id}/reject`, { method: "POST", json: { note } }),

  savePages: (projectId: string, pages: MagazinePage[]) => apiFetch<{ pages: MagazinePage[]; preservedLocked: string[] }>(`/projects/${projectId}/pages`, { method: "PUT", json: { pages } }),
  recommendPlan: (projectId: string) => apiFetch<{ pages: MagazinePage[]; rationale: string[]; engine: string }>(`/projects/${projectId}/plan/recommend`, { method: "POST" }),

  createExport: (projectId: string, format: ExportFormat, contract: unknown) => apiFetch<ExportRecord>(`/projects/${projectId}/exports`, { method: "POST", json: { format, contract } }),
  listExports: (projectId: string) => apiFetch<ExportRecord[]>(`/projects/${projectId}/exports`),
  preflight: (projectId: string, contract: unknown) => apiFetch<{ checkedAt: string; issues: unknown[]; summary: Record<string, number>; notes: string[] }>(`/projects/${projectId}/preflight`, { method: "POST", json: contract }),

  job: (id: string) => apiFetch<Job>(`/jobs/${id}`),
};

/** Poll a job until it leaves queued/running. */
export async function waitForJob(id: string, onUpdate?: (job: Job) => void, intervalMs = 1500, timeoutMs = 15 * 60_000): Promise<Job> {
  const started = Date.now();
  for (;;) {
    const job = await live.job(id);
    onUpdate?.(job);
    if (job.status !== "queued" && job.status !== "running") return job;
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for the job to finish.");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

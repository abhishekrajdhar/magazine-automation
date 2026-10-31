"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  ActivityItem,
  Article,
  ArticleStatus,
  Asset,
  DesignProfile,
  EventSession,
  ExportRecord,
  ExtractedFact,
  MagazinePage,
  Member,
  Organisation,
  PageElement,
  PageType,
  Project,
  ReferenceMagazine,
  ReferencePage,
  Speaker,
  Template,
  TranscriptSegment,
  User,
  VideoSource,
} from "@/lib/domain/types";
import { buildDemoSeed, DEMO_SEED_VERSION, type ProjectSummary } from "@/lib/demo/workspace";
import {
  composeMagazine,
  recomposeArticlePages,
  recomposeStandalonePage,
  type ComposeContext,
  type PlanEntry,
} from "@/lib/templates/compose";
import { uid } from "@/lib/utils/format";

export type Mode = "demo" | "live";

interface Data {
  mode: Mode | null;
  seedVersion: number;
  user: User | null;
  organisation: Organisation | null;
  members: Member[];
  projects: Project[];
  projectSummaries: Record<string, ProjectSummary>;
  activeProjectId: string | null;
  references: ReferenceMagazine[];
  referencePages: ReferencePage[];
  designProfiles: DesignProfile[];
  templates: Template[];
  videos: VideoSource[];
  segments: TranscriptSegment[];
  speakers: Speaker[];
  sessions: EventSession[];
  facts: ExtractedFact[];
  articles: Article[];
  assets: Asset[];
  pages: MagazinePage[];
  exports: ExportRecord[];
  activity: ActivityItem[];
  /** Local object URLs and files the user added in this browser session (not persisted). */
  localFiles: Record<string, { url: string; name: string; size: number; type: string }>;
}

interface History {
  past: MagazinePage[][];
  future: MagazinePage[][];
}

interface Actions {
  hasHydrated: boolean;
  history: Record<string, History>;
  setHydrated: () => void;

  enterDemo: () => void;
  enterLive: (input: { user: User; organisation: Organisation; members?: Member[] }) => void;
  signOut: () => void;
  resetDemo: () => void;
  hydrateLive: (data: Partial<Data>) => void;

  setActiveProject: (id: string) => void;
  createProject: (project: Omit<Project, "id" | "createdAt" | "updatedAt" | "orgId" | "ownerId" | "isDemo"> & { id?: string }) => Project;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  addVideo: (video: VideoSource) => void;
  updateVideo: (id: string, patch: Partial<VideoSource>) => void;
  removeVideo: (id: string) => void;
  registerLocalFile: (id: string, file: File) => string;

  updateSpeaker: (id: string, patch: Partial<Speaker>) => void;
  updateSession: (id: string, patch: Partial<EventSession>) => void;
  updateFact: (id: string, patch: Partial<ExtractedFact>) => void;
  updateSegment: (id: string, patch: Partial<TranscriptSegment>) => void;

  updateArticle: (id: string, patch: Partial<Article>) => void;
  setArticleStatus: (id: string, status: ArticleStatus, note?: string) => void;

  addReference: (ref: ReferenceMagazine, pages?: ReferencePage[], profile?: DesignProfile) => void;
  updateReference: (id: string, patch: Partial<ReferenceMagazine>) => void;
  removeReference: (id: string) => void;
  updateReferencePage: (id: string, patch: Partial<ReferencePage>) => void;
  updateProfile: (id: string, path: string, value: unknown) => void;
  approveProfile: (id: string) => void;
  addTemplate: (template: Template) => void;
  removeTemplate: (id: string) => void;

  setPages: (projectId: string, pages: MagazinePage[], opts?: { history?: boolean }) => void;
  updatePage: (pageId: string, patch: Partial<MagazinePage>, opts?: { history?: boolean }) => void;
  updateElement: (pageId: string, elementId: string, patch: Partial<PageElement>, opts?: { history?: boolean }) => void;
  addElement: (pageId: string, element: PageElement) => void;
  removeElement: (pageId: string, elementId: string) => void;
  reorderPages: (projectId: string, fromIndex: number, toIndex: number) => void;
  insertPage: (projectId: string, index: number, pageType: PageType, templateId: string, articleId?: string) => string;
  duplicatePage: (pageId: string) => void;
  removePage: (pageId: string) => void;
  changeTemplate: (pageId: string, templateId: string) => void;
  assignArticle: (pageId: string, articleId: string | undefined) => void;
  reflowArticle: (articleId: string) => void;
  regeneratePages: (projectId: string, plan: PlanEntry[]) => void;
  /** Re-compose every unlocked page with its current template (e.g. after a profile change). */
  reflowProject: (projectId: string) => number;
  pushHistory: (projectId: string) => void;
  undo: (projectId: string) => void;
  redo: (projectId: string) => void;

  addExport: (record: ExportRecord) => void;
  updateExport: (id: string, patch: Partial<ExportRecord>) => void;

  log: (verb: string, target: string, kind: ActivityItem["kind"]) => void;
}

export type WorkspaceState = Data & Actions;

const emptyData: Data = {
  mode: null,
  seedVersion: 0,
  user: null,
  organisation: null,
  members: [],
  projects: [],
  projectSummaries: {},
  activeProjectId: null,
  references: [],
  referencePages: [],
  designProfiles: [],
  templates: [],
  videos: [],
  segments: [],
  speakers: [],
  sessions: [],
  facts: [],
  articles: [],
  assets: [],
  pages: [],
  exports: [],
  activity: [],
  localFiles: {},
};

function demoData(): Data {
  const seed = buildDemoSeed();
  return {
    ...emptyData,
    mode: "demo",
    seedVersion: DEMO_SEED_VERSION,
    user: seed.user,
    organisation: seed.organisation,
    members: seed.members,
    projects: seed.projects,
    projectSummaries: seed.projectSummaries,
    activeProjectId: seed.projects[0].id,
    references: seed.references,
    referencePages: seed.referencePages,
    designProfiles: seed.designProfiles,
    templates: seed.templates,
    ...seed.workspace,
    activity: seed.activity,
  };
}

const now = () => new Date().toISOString();
const MAX_HISTORY = 60;

const replace = <T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] => list.map((x) => (x.id === id ? { ...x, ...patch } : x));

function setPath(obj: unknown, path: string, value: unknown): unknown {
  const [head, ...rest] = path.split(".");
  const source = (obj ?? {}) as Record<string, unknown>;
  return { ...source, [head]: rest.length ? setPath(source[head], rest.join("."), value) : value };
}

export function composeContextFor(state: Data, projectId: string): ComposeContext | null {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const profile = state.designProfiles.find((d) => d.id === project.designProfileId) ?? state.designProfiles[0];
  if (!profile) return null;
  return {
    profile,
    project,
    articles: state.articles.filter((a) => a.projectId === projectId),
    speakers: state.speakers.filter((s) => s.projectId === projectId),
    facts: state.facts.filter((f) => f.projectId === projectId),
    assets: state.assets.filter((a) => a.projectId === projectId),
    referenceTemplates: state.templates,
    imagePreference: project.config.imagePreference,
  };
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => {
      const pagesOf = (projectId: string) => get().pages.filter((p) => p.projectId === projectId);
      const replaceProjectPages = (projectId: string, next: MagazinePage[]) => {
        const others = get().pages.filter((p) => p.projectId !== projectId);
        set({ pages: [...others, ...next] });
      };
      const snapshot = (projectId: string) => {
        const h = get().history[projectId] ?? { past: [], future: [] };
        set({ history: { ...get().history, [projectId]: { past: [...h.past, pagesOf(projectId)].slice(-MAX_HISTORY), future: [] } } });
      };
      const projectOfPage = (pageId: string) => get().pages.find((p) => p.id === pageId)?.projectId;
      const touchProject = (projectId: string | undefined) => {
        if (projectId) set({ projects: replace(get().projects, projectId, { updatedAt: now() }) });
      };

      return {
        ...emptyData,
        hasHydrated: false,
        history: {},
        setHydrated: () => {
          const s = get();
          // Replace stale demo state when the seed changes.
          if (s.mode === "demo" && s.seedVersion !== DEMO_SEED_VERSION) set({ ...demoData(), hasHydrated: true });
          else set({ hasHydrated: true });
        },

        enterDemo: () => {
          const s = get();
          if (s.mode === "demo" && s.seedVersion === DEMO_SEED_VERSION && s.projects.length) return;
          set({ ...demoData(), history: {} });
        },
        enterLive: ({ user, organisation, members }) => set({ ...emptyData, mode: "live", user, organisation, members: members ?? [], history: {} }),
        signOut: () => set({ ...emptyData, history: {} }),
        resetDemo: () => set({ ...demoData(), history: {} }),
        hydrateLive: (data) => set({ ...data }),

        setActiveProject: (id) => set({ activeProjectId: id }),
        createProject: (input) => {
          const s = get();
          const project: Project = {
            ...input,
            id: input.id ?? uid("prj"),
            orgId: s.organisation?.id ?? "org_local",
            ownerId: s.user?.id ?? "u_local",
            createdAt: now(),
            updatedAt: now(),
            isDemo: false,
          };
          set({ projects: [project, ...s.projects], activeProjectId: project.id });
          get().log("created project", project.title, "project");
          return project;
        },
        updateProject: (id, patch) => set({ projects: replace(get().projects, id, { ...patch, updatedAt: now() }) }),
        deleteProject: (id) => {
          const s = get();
          set({
            projects: s.projects.filter((p) => p.id !== id),
            videos: s.videos.filter((v) => v.projectId !== id),
            pages: s.pages.filter((p) => p.projectId !== id),
            articles: s.articles.filter((a) => a.projectId !== id),
            activeProjectId: s.activeProjectId === id ? s.projects.find((p) => p.id !== id)?.id ?? null : s.activeProjectId,
          });
        },

        addVideo: (video) => set({ videos: [...get().videos, video] }),
        updateVideo: (id, patch) => set({ videos: replace(get().videos, id, patch) }),
        removeVideo: (id) => set({ videos: get().videos.filter((v) => v.id !== id) }),
        registerLocalFile: (id, file) => {
          const url = URL.createObjectURL(file);
          set({ localFiles: { ...get().localFiles, [id]: { url, name: file.name, size: file.size, type: file.type } } });
          return url;
        },

        updateSpeaker: (id, patch) => set({ speakers: replace(get().speakers, id, patch) }),
        updateSession: (id, patch) => set({ sessions: replace(get().sessions, id, patch) }),
        updateFact: (id, patch) => set({ facts: replace(get().facts, id, patch) }),
        updateSegment: (id, patch) => set({ segments: replace(get().segments, id, patch) }),

        updateArticle: (id, patch) => {
          const article = get().articles.find((a) => a.id === id);
          // Any edit to approved copy sends it back for review.
          const status = article?.status === "approved" && !("status" in patch) ? "in_review" : patch.status;
          set({ articles: replace(get().articles, id, { ...patch, ...(status ? { status } : {}), generatedBy: patch.generatedBy ?? (article?.generatedBy === "demo_seed" ? "demo_seed" : "human"), updatedAt: now() }) });
          if (status === "in_review" && article?.status === "approved") {
            set({ pages: get().pages.map((p) => (p.articleId === id ? { ...p, editorialStatus: "pending" } : p)) });
          }
        },
        setArticleStatus: (id, status, note) => {
          const s = get();
          const article = s.articles.find((a) => a.id === id);
          set({
            articles: replace(s.articles, id, {
              status,
              reviewNote: note ?? (status === "approved" ? undefined : article?.reviewNote),
              approvedBy: status === "approved" ? s.user?.id : undefined,
              approvedAt: status === "approved" ? now() : undefined,
              updatedAt: now(),
            }),
            pages: s.pages.map((p) => (p.articleId === id ? { ...p, editorialStatus: status === "approved" ? "approved" : "pending" } : p)),
          });
          if (article) get().log(status === "approved" ? "approved" : status === "rejected" ? "rejected" : status === "needs_revision" ? "requested revision on" : "updated", article.headline, "article");
        },

        addReference: (ref, pages, profile) => {
          const s = get();
          set({
            references: [ref, ...s.references.filter((r) => r.id !== ref.id)],
            referencePages: pages ? [...s.referencePages.filter((p) => p.referenceId !== ref.id), ...pages] : s.referencePages,
            designProfiles: profile ? [profile, ...s.designProfiles.filter((d) => d.id !== profile.id)] : s.designProfiles,
          });
        },
        updateReference: (id, patch) => set({ references: replace(get().references, id, patch) }),
        removeReference: (id) => {
          const s = get();
          set({
            references: s.references.filter((r) => r.id !== id),
            referencePages: s.referencePages.filter((p) => p.referenceId !== id),
            designProfiles: s.designProfiles.filter((d) => d.referenceId !== id),
          });
        },
        updateReferencePage: (id, patch) => set({ referencePages: replace(get().referencePages, id, patch) }),
        updateProfile: (id, path, value) => {
          const s = get();
          set({
            designProfiles: s.designProfiles.map((d) => {
              if (d.id !== id) return d;
              const next = setPath(d, path, value) as DesignProfile;
              return { ...next, overrides: Array.from(new Set([...d.overrides, path])), version: d.version + 1, status: "draft" };
            }),
          });
        },
        approveProfile: (id) => {
          const s = get();
          set({ designProfiles: replace(s.designProfiles, id, { status: "approved", approvedAt: now(), approvedBy: s.user?.id }) });
          const profile = s.designProfiles.find((d) => d.id === id);
          if (profile) {
            set({ references: replace(get().references, profile.referenceId, { status: "approved" }) });
            get().log("approved design profile", profile.name, "reference");
          }
        },
        addTemplate: (template) => set({ templates: [template, ...get().templates.filter((t) => t.id !== template.id)] }),
        removeTemplate: (id) => set({ templates: get().templates.filter((t) => t.id !== id) }),

        pushHistory: (projectId) => snapshot(projectId),
        setPages: (projectId, pages, opts) => {
          if (opts?.history !== false) snapshot(projectId);
          replaceProjectPages(projectId, pages);
          touchProject(projectId);
        },
        updatePage: (pageId, patch, opts) => {
          const projectId = projectOfPage(pageId);
          if (!projectId) return;
          if (opts?.history !== false) snapshot(projectId);
          set({ pages: replace(get().pages, pageId, patch) });
        },
        updateElement: (pageId, elementId, patch, opts) => {
          const projectId = projectOfPage(pageId);
          if (!projectId) return;
          if (opts?.history !== false) snapshot(projectId);
          set({
            pages: get().pages.map((p) =>
              p.id === pageId
                ? { ...p, designStatus: p.designStatus === "not_started" ? "in_progress" : p.designStatus, elements: p.elements.map((e) => (e.id === elementId ? { ...e, ...patch } : e)) }
                : p,
            ),
          });
        },
        addElement: (pageId, element) => {
          const projectId = projectOfPage(pageId);
          if (!projectId) return;
          snapshot(projectId);
          set({ pages: get().pages.map((p) => (p.id === pageId ? { ...p, elements: [...p.elements, element] } : p)) });
        },
        removeElement: (pageId, elementId) => {
          const projectId = projectOfPage(pageId);
          if (!projectId) return;
          snapshot(projectId);
          set({ pages: get().pages.map((p) => (p.id === pageId ? { ...p, elements: p.elements.filter((e) => e.id !== elementId) } : p)) });
        },
        reorderPages: (projectId, from, to) => {
          const list = [...pagesOf(projectId)];
          const [moved] = list.splice(from, 1);
          if (!moved) return;
          list.splice(to, 0, moved);
          snapshot(projectId);
          replaceProjectPages(projectId, list);
        },
        insertPage: (projectId, index, pageType, templateId, articleId) => {
          const s = get();
          const ctx = composeContextFor(s, projectId);
          const list = [...pagesOf(projectId)];
          const id = uid("pg");
          let page: MagazinePage = { id, projectId, pageType, templateId, label: "New page", articleId, elements: [], editorialStatus: articleId ? "pending" : "approved", designStatus: "not_started", locked: false };
          if (ctx) {
            const composed = composeMagazine([{ id, pageType, templateId, label: "New page", articleId }], { ...ctx });
            page = { ...composed[0], designStatus: "not_started" };
          }
          snapshot(projectId);
          list.splice(index, 0, page);
          replaceProjectPages(projectId, list);
          if (articleId) get().reflowArticle(articleId);
          return id;
        },
        duplicatePage: (pageId) => {
          const page = get().pages.find((p) => p.id === pageId);
          if (!page) return;
          const list = [...pagesOf(page.projectId)];
          const index = list.findIndex((p) => p.id === pageId);
          snapshot(page.projectId);
          list.splice(index + 1, 0, { ...page, id: uid("pg"), label: `${page.label} (copy)`, locked: false, elements: page.elements.map((e) => ({ ...e })) });
          replaceProjectPages(page.projectId, list);
        },
        removePage: (pageId) => {
          const page = get().pages.find((p) => p.id === pageId);
          if (!page) return;
          snapshot(page.projectId);
          set({ pages: get().pages.filter((p) => p.id !== pageId) });
          if (page.articleId) get().reflowArticle(page.articleId);
        },
        changeTemplate: (pageId, templateId) => {
          const s = get();
          const page = s.pages.find((p) => p.id === pageId);
          if (!page) return;
          const ctx = composeContextFor(s, page.projectId);
          snapshot(page.projectId);
          const updated = { ...page, templateId };
          set({ pages: replace(s.pages, pageId, { templateId }) });
          if (!ctx) return;
          if (page.articleId) {
            replaceProjectPages(page.projectId, recomposeArticlePages(pagesOf(page.projectId), page.articleId, ctx));
          } else {
            const index = pagesOf(page.projectId).findIndex((p) => p.id === pageId);
            set({ pages: replace(get().pages, pageId, recomposeStandalonePage(updated, index + 1, ctx)) });
          }
        },
        assignArticle: (pageId, articleId) => {
          const s = get();
          const page = s.pages.find((p) => p.id === pageId);
          if (!page) return;
          const previous = page.articleId;
          snapshot(page.projectId);
          const article = s.articles.find((a) => a.id === articleId);
          set({ pages: replace(s.pages, pageId, { articleId, label: article ? article.headline.replace(/[“”]/g, "").slice(0, 48) : page.label, editorialStatus: article?.status === "approved" ? "approved" : "pending" }) });
          if (previous) get().reflowArticle(previous);
          if (articleId) get().reflowArticle(articleId);
        },
        reflowArticle: (articleId) => {
          const s = get();
          const page = s.pages.find((p) => p.articleId === articleId);
          if (!page) return;
          const ctx = composeContextFor(s, page.projectId);
          if (!ctx) return;
          replaceProjectPages(page.projectId, recomposeArticlePages(pagesOf(page.projectId), articleId, ctx));
        },
        regeneratePages: (projectId, plan) => {
          const ctx = composeContextFor(get(), projectId);
          if (!ctx) return;
          snapshot(projectId);
          replaceProjectPages(projectId, composeMagazine(plan, ctx));
        },
        reflowProject: (projectId) => {
          const s = get();
          const ctx = composeContextFor(s, projectId);
          if (!ctx) return 0;
          snapshot(projectId);
          let pages = pagesOf(projectId);
          const articleIds = Array.from(new Set(pages.filter((p) => p.articleId && !p.locked).map((p) => p.articleId!)));
          for (const id of articleIds) pages = recomposeArticlePages(pages, id, ctx);
          pages = pages.map((p, i) => (!p.articleId && !p.locked ? recomposeStandalonePage(p, i + 1, ctx) : p));
          replaceProjectPages(projectId, pages);
          return pages.filter((p) => !p.locked).length;
        },
        undo: (projectId) => {
          const h = get().history[projectId];
          if (!h?.past.length) return;
          const prev = h.past[h.past.length - 1];
          const current = pagesOf(projectId);
          replaceProjectPages(projectId, prev);
          set({ history: { ...get().history, [projectId]: { past: h.past.slice(0, -1), future: [current, ...h.future].slice(0, MAX_HISTORY) } } });
        },
        redo: (projectId) => {
          const h = get().history[projectId];
          if (!h?.future.length) return;
          const [next, ...rest] = h.future;
          const current = pagesOf(projectId);
          replaceProjectPages(projectId, next);
          set({ history: { ...get().history, [projectId]: { past: [...h.past, current], future: rest } } });
        },

        addExport: (record) => set({ exports: [record, ...get().exports] }),
        updateExport: (id, patch) => set({ exports: replace(get().exports, id, patch) }),

        log: (verb, target, kind) => {
          const s = get();
          set({ activity: [{ id: uid("act"), at: now(), actorId: s.user?.id ?? "u_local", verb, target, kind, projectId: s.activeProjectId ?? undefined }, ...s.activity].slice(0, 200) });
        },
      };
    },
    {
      name: "pressflow-workspace",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        const { localFiles: _localFiles, ...data } = Object.fromEntries(Object.entries(state).filter(([k, v]) => typeof v !== "function" && k !== "history" && k !== "hasHydrated")) as unknown as Data;
        // Live data always comes from the API; only the session is remembered.
        if (data.mode === "live") return { mode: data.mode, user: data.user, organisation: data.organisation, activeProjectId: data.activeProjectId } as Partial<Data>;
        return data;
      },
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export function useActiveProject(): Project | undefined {
  return useWorkspace((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? s.projects[0]);
}

export function useProfileFor(project: Project | undefined): DesignProfile | undefined {
  return useWorkspace((s) => s.designProfiles.find((d) => d.id === project?.designProfileId) ?? (project?.isDemo ? s.designProfiles[0] : undefined));
}

export function useProjectPages(projectId: string | undefined): MagazinePage[] {
  const pages = useWorkspace((s) => s.pages);
  return pages.filter((p) => p.projectId === projectId);
}

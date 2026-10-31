"use client";

import * as React from "react";
import { toast } from "sonner";
import type { Article, DesignProfile, EventSession, ExtractedFact, MagazinePage, ReferencePage, Speaker } from "@/lib/domain/types";
import { useWorkspace, type WorkspaceState } from "@/lib/store/workspace";
import { apiFetch } from "./client";
import { live } from "./live";

type ProjectScoped = "videos" | "speakers" | "sessions" | "facts" | "articles" | "assets" | "pages" | "exports";

/** Replace one project's rows in a store list with fresh rows from the API. */
function replaceFor<K extends ProjectScoped>(state: WorkspaceState, key: K, projectId: string, rows: WorkspaceState[K]) {
  const others = (state[key] as { projectId: string }[]).filter((x) => x.projectId !== projectId);
  return [...others, ...(rows as { projectId: string }[])] as WorkspaceState[K];
}

async function loadLists() {
  const [projects, references, templates] = await Promise.all([live.listProjects(), live.listReferences(), live.listTemplates().catch(() => [])]);
  const profiles = (await Promise.all(references.filter((r) => r.designProfileId).map((r) => live.profile(r.designProfileId!).catch(() => null)))).filter((p): p is DesignProfile => !!p);
  const refPages = (await Promise.all(references.filter((r) => r.status === "analysed" || r.status === "approved").map((r) => live.referencePages(r.id).catch(() => [] as ReferencePage[])))).flat();
  const s = useWorkspace.getState();
  s.hydrateLive({
    projects,
    references,
    designProfiles: profiles,
    referencePages: refPages.map((p) => {
      const ref = references.find((r) => r.id === p.referenceId);
      return ref?.hasSourcePdf && !p.imageUrl ? { ...p, imageUrl: live.referencePageImage(p.referenceId, p.pageNumber, 1) } : p;
    }),
    // Built-in templates are defined in the client; only reference-derived ones come from the API.
    templates: templates.filter((t) => t.source === "reference"),
    activeProjectId: projects.some((p) => p.id === s.activeProjectId) ? s.activeProjectId : projects[0]?.id ?? null,
  });
}

let hydratedPages: MagazinePage[] | null = null;

async function loadWorkspace(projectId: string) {
  const ws = await live.workspace(projectId);
  const transcriptVideoIds = new Set(ws.videos.map((v) => v.id));
  useWorkspace.setState((s) => ({
    projects: s.projects.map((p) => (p.id === projectId ? ws.project : p)),
    videos: replaceFor(s, "videos", projectId, ws.videos),
    segments: [...s.segments.filter((x) => !transcriptVideoIds.has(x.videoId)), ...ws.segments],
    speakers: replaceFor(s, "speakers", projectId, ws.speakers),
    sessions: replaceFor(s, "sessions", projectId, ws.sessions),
    facts: replaceFor(s, "facts", projectId, ws.facts),
    articles: replaceFor(s, "articles", projectId, ws.articles),
    assets: replaceFor(s, "assets", projectId, ws.assets),
    pages: replaceFor(s, "pages", projectId, ws.pages),
    exports: replaceFor(s, "exports", projectId, ws.exports),
  }));
  hydratedPages = useWorkspace.getState().pages.filter((p) => p.projectId === projectId);
}

const CONTENT_FIELDS: (keyof Article)[] = ["kicker", "headline", "subheadline", "byline", "intro", "body", "captions", "suggestedImageIds", "quoteFactIds", "reviewNote"];

/**
 * Keeps the store and the API in step while signed in to a live organisation:
 * loads data, polls while jobs run, and saves edits back (debounced).
 */
export function useLiveSync() {
  const mode = useWorkspace((s) => s.mode);
  const hydrated = useWorkspace((s) => s.hasHydrated);
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const busy = useWorkspace((s) => s.videos.some((v) => ["queued", "acquiring", "extracting_audio", "transcribing", "analysing"].includes(v.processing.state)) || s.references.some((r) => r.status === "analysing") || s.exports.some((e) => e.status === "queued" || e.status === "running"));
  const isLive = hydrated && mode === "live";

  React.useEffect(() => {
    if (!isLive) return;
    loadLists().catch((e) => toast.error("Couldn't load your workspace", { description: (e as Error).message }));
  }, [isLive]);

  React.useEffect(() => {
    if (!isLive || !activeProjectId) return;
    loadWorkspace(activeProjectId).catch((e) => toast.error("Couldn't load the project", { description: (e as Error).message }));
  }, [isLive, activeProjectId]);

  // Poll while recordings, references or exports are being processed.
  React.useEffect(() => {
    if (!isLive || !busy) return;
    const t = setInterval(() => {
      if (activeProjectId) void loadWorkspace(activeProjectId).catch(() => undefined);
      void loadLists().catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [isLive, busy, activeProjectId]);

  // Save edits back to the API.
  React.useEffect(() => {
    if (!isLive) return;
    let pageTimer: ReturnType<typeof setTimeout> | undefined;
    const articleTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const unsub = useWorkspace.subscribe((state, prev) => {
      const pid = state.activeProjectId;
      if (pid && state.pages !== prev.pages) {
        const pages = state.pages.filter((p) => p.projectId === pid);
        if (hydratedPages && pages.length === hydratedPages.length && pages.every((p, i) => p === hydratedPages![i])) return;
        clearTimeout(pageTimer);
        pageTimer = setTimeout(() => {
          live.savePages(pid, pages).then(() => (hydratedPages = pages)).catch((e) => toast.error("Pages not saved", { description: (e as Error).message }));
        }, 1500);
      }
      if (state.articles !== prev.articles) {
        for (const a of state.articles) {
          const before = prev.articles.find((x) => x.id === a.id);
          if (!before || before === a || CONTENT_FIELDS.every((f) => before[f] === a[f])) continue;
          clearTimeout(articleTimers.get(a.id));
          articleTimers.set(
            a.id,
            setTimeout(() => {
              const body = Object.fromEntries(CONTENT_FIELDS.map((f) => [f, a[f]]));
              void live.patchArticle(a.id, body as Partial<Article>).catch((e) => toast.error("Article not saved", { description: (e as Error).message }));
            }, 1200),
          );
        }
      }
      if (state.designProfiles !== prev.designProfiles) {
        for (const d of state.designProfiles) {
          const before = prev.designProfiles.find((x) => x.id === d.id);
          if (!before || before === d || d.status === "approved") continue;
          const { id: _id, overrides: _o, version: _v, status: _s, approvedAt: _a, approvedBy: _b, ...patch } = d;
          void live.patchProfile(d.id, patch).catch(() => undefined);
        }
      }
      const patchChanged = <T extends { id: string }>(list: T[], prevList: T[], path: string) => {
        if (list === prevList) return;
        for (const x of list) {
          const before = prevList.find((y) => y.id === x.id);
          if (before && before !== x) void apiFetch(`${path}/${x.id}`, { method: "PATCH", json: x }).catch(() => undefined);
        }
      };
      patchChanged<ExtractedFact>(state.facts, prev.facts, "/facts");
      patchChanged<Speaker>(state.speakers, prev.speakers, "/speakers");
      patchChanged<EventSession>(state.sessions, prev.sessions, "/sessions");
    });
    return () => {
      unsub();
      clearTimeout(pageTimer);
      articleTimers.forEach(clearTimeout);
    };
  }, [isLive]);
}

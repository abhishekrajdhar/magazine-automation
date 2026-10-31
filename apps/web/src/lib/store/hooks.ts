"use client";

import * as React from "react";
import { useWorkspace } from "./workspace";
import { assetMap, buildToc, renderContext } from "@/lib/magazine/context";

/** Everything scoped to the active project, memoised against the underlying store slices. */
export function useProjectData(projectIdOverride?: string) {
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const projectId = projectIdOverride ?? activeProjectId ?? undefined;
  const projects = useWorkspace((s) => s.projects);
  const videos = useWorkspace((s) => s.videos);
  const segments = useWorkspace((s) => s.segments);
  const speakers = useWorkspace((s) => s.speakers);
  const sessions = useWorkspace((s) => s.sessions);
  const facts = useWorkspace((s) => s.facts);
  const articles = useWorkspace((s) => s.articles);
  const assets = useWorkspace((s) => s.assets);
  const pages = useWorkspace((s) => s.pages);
  const exportsList = useWorkspace((s) => s.exports);
  const designProfiles = useWorkspace((s) => s.designProfiles);
  const references = useWorkspace((s) => s.references);
  const localFiles = useWorkspace((s) => s.localFiles);

  return React.useMemo(() => {
    const project = projects.find((p) => p.id === projectId) ?? projects[0];
    const pid = project?.id;
    const by = <T extends { projectId: string }>(list: T[]) => list.filter((x) => x.projectId === pid);
    const projectVideos = by(videos);
    const videoIds = new Set(projectVideos.map((v) => v.id));
    const projectArticles = by(articles);
    const projectPages = by(pages);
    const projectAssets = by(assets);
    const profile = designProfiles.find((d) => d.id === project?.designProfileId);
    const reference = references.find((r) => r.id === project?.referenceId);
    const toc = buildToc(projectPages, projectArticles);
    return {
      project,
      profile,
      reference,
      videos: projectVideos,
      segments: segments.filter((s) => videoIds.has(s.videoId)),
      speakers: by(speakers),
      sessions: by(sessions),
      facts: by(facts),
      articles: projectArticles,
      assets: projectAssets,
      assetsById: assetMap(projectAssets),
      pages: projectPages,
      exports: by(exportsList),
      toc,
      localUrls: Object.fromEntries(Object.entries(localFiles).map(([k, v]) => [k, v.url])),
      ctxFor: (index: number) => (project ? renderContext(project, projectPages, index, projectArticles, toc) : { pageNumber: index + 1, magazineName: "", issueLabel: "" }),
    };
  }, [projects, projectId, videos, segments, speakers, sessions, facts, articles, assets, pages, exportsList, designProfiles, references, localFiles]);
}

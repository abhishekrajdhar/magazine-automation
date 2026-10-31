"use client";

import * as React from "react";
import { buildDemoPages, demoProject } from "@/lib/demo/workspace";
import { demoArticles } from "@/lib/demo/articles";
import { demoAssets } from "@/lib/demo/assets";
import { demoProfile, demoReferencePages } from "@/lib/demo/reference";
import { demoSegments, demoSpeakers, demoVideos } from "@/lib/demo/event";
import { assetMap, buildToc, renderContext } from "@/lib/magazine/context";

/** Seeded demo content rendered on the marketing pages (all fictional). */
export function useDemoPreview() {
  return React.useMemo(() => {
    const pages = buildDemoPages();
    const toc = buildToc(pages, demoArticles);
    return {
      pages,
      profile: demoProfile,
      assets: assetMap(demoAssets),
      referencePages: demoReferencePages,
      videos: demoVideos,
      segments: demoSegments,
      speakers: demoSpeakers,
      ctx: (i: number) => renderContext(demoProject, pages, i, demoArticles, toc),
    };
  }, []);
}

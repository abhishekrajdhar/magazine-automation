"use client";

import * as React from "react";
import type { Asset, DesignProfile, MagazinePage } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { PageView, type RenderContext } from "./page-view";

interface PageThumbProps {
  page: MagazinePage;
  profile: DesignProfile;
  assets: Record<string, Asset>;
  ctx: RenderContext;
  width: number;
  localUrls?: Record<string, string>;
  className?: string;
  onOverset?: (elementId: string, overset: boolean) => void;
}

/** Live, scaled render of a page. Thumbnails are real renders, not screenshots. */
export const PageThumb = React.memo(function PageThumb({ page, profile, assets, ctx, width, localUrls, className, onOverset }: PageThumbProps) {
  const scale = width / profile.page.widthPt;
  return (
    <div className={cn("overflow-hidden bg-white shadow-page", className)} style={{ width, height: profile.page.heightPt * scale }}>
      <PageView page={page} profile={profile} assets={assets} ctx={ctx} scale={scale} localUrls={localUrls} onOverset={onOverset} />
    </div>
  );
});

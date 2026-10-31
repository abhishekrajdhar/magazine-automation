"use client";

import * as React from "react";
import type { ReferencePage } from "@/lib/domain/types";
import { openPdf, renderPdfPage } from "@/lib/pdf/preview";
import { ReferenceStructure } from "./reference-structure";

const docCache = new Map<string, Promise<Awaited<ReturnType<typeof openPdf>>>>();

/**
 * Best available preview of a reference page: the API's rendered image, a
 * pdf.js render of a PDF held in this browser, or the detected structure.
 */
export function ReferencePageThumb({ page, width, pdfUrl, overlay, highlightRole, className }: { page: ReferencePage; width: number; pdfUrl?: string; overlay?: boolean; highlightRole?: string | null; className?: string }) {
  const [src, setSrc] = React.useState<string | null>(null);
  const height = (width * page.heightPt) / page.widthPt;

  React.useEffect(() => {
    if (page.imageUrl || !pdfUrl) return;
    let cancelled = false;
    if (!docCache.has(pdfUrl)) docCache.set(pdfUrl, openPdf(pdfUrl));
    docCache
      .get(pdfUrl)!
      .then((doc) => renderPdfPage(doc, page.pageNumber, width))
      .then((url) => !cancelled && setSrc(url))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [page.imageUrl, page.pageNumber, pdfUrl, width]);

  const image = page.imageUrl ?? src;
  if (!image) return <ReferenceStructure page={page} width={width} overlay={overlay} highlightRole={highlightRole} className={className} />;
  return (
    <div className={className} style={{ position: "relative", width, height }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt={`Reference page ${page.pageNumber}`} style={{ width, height, display: "block" }} />
      {overlay && (
        <div style={{ position: "absolute", inset: 0, opacity: 0.85 }}>
          <ReferenceStructure page={{ ...page, blocks: page.blocks }} width={width} overlay highlightRole={highlightRole} className="[&>rect:first-of-type]:fill-transparent" />
        </div>
      )}
    </div>
  );
}

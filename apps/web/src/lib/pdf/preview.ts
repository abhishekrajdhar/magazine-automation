"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";

/** True when the first bytes are the PDF signature. */
export async function isPdf(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return lib;
}

export async function openPdf(source: Blob | string): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  const params = typeof source === "string" ? { url: source } : { data: new Uint8Array(await source.arrayBuffer()) };
  return lib.getDocument(params).promise;
}

export interface PdfSummary {
  pageCount: number;
  widthPt: number;
  heightPt: number;
  sizeLabel: string;
}

const SIZES: [string, number, number][] = [
  ["A4", 595.28, 841.89],
  ["A5", 419.53, 595.28],
  ["A3", 841.89, 1190.55],
  ["US Letter", 612, 792],
  ["Tabloid", 792, 1224],
];

export function describePageSize(w: number, h: number): string {
  const portrait = h >= w;
  const [a, b] = portrait ? [w, h] : [h, w];
  const named = SIZES.find(([, sw, sh]) => Math.abs(sw - a) < 4 && Math.abs(sh - b) < 4)?.[0];
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  return `${named ? `${named} ` : ""}${portrait ? "portrait" : "landscape"} · ${mm(w)} × ${mm(h)} mm`;
}

export async function summarisePdf(doc: PDFDocumentProxy): Promise<PdfSummary> {
  const first = await doc.getPage(1);
  const vp = first.getViewport({ scale: 1 });
  return { pageCount: doc.numPages, widthPt: vp.width, heightPt: vp.height, sizeLabel: describePageSize(vp.width, vp.height) };
}

/** Render one page to a JPEG data URL at the given CSS width. */
export async function renderPdfPage(doc: PDFDocumentProxy, pageNumber: number, width: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const ratio = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const viewport = page.getViewport({ scale: (width / base.width) * ratio });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  // "print" intent renders without requestAnimationFrame, so thumbnails also
  // finish in background tabs where animation frames are paused.
  await page.render({ canvas, canvasContext: ctx, viewport, intent: "print" }).promise;
  return canvas.toDataURL("image/jpeg", 0.82);
}

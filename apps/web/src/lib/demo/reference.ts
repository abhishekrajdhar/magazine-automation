/**
 * Demo reference magazine and the design profile an analysis of it would
 * produce. The source PDF is not bundled, so the reference library shows the
 * detected page structure (layout blocks) rather than page renders.
 */
import type { DesignProfile, LayoutBlock, PageType, ReferenceMagazine, ReferencePage, TextStyle, TextRole } from "@/lib/domain/types";
import { mulberry32 } from "@/lib/utils/random";

export const DEMO_REFERENCE_ID = "ref_egov_sep26";
export const DEMO_PROFILE_ID = "dp_egov_sep26";

const style = (role: TextRole, s: Omit<TextStyle, "role">): TextStyle => ({ role, ...s });

export const demoProfile: DesignProfile = {
  id: DEMO_PROFILE_ID,
  referenceId: DEMO_REFERENCE_ID,
  name: "eGov house style (from September 2026 issue)",
  status: "approved",
  version: 3,
  page: { widthPt: 595.28, heightPt: 841.89, orientation: "portrait", bleedPt: 9 },
  margins: { top: 54, bottom: 60, inside: 48, outside: 42 },
  grid: { columns: 3, gutterPt: 14, baselinePt: 13.5 },
  typography: {
    kicker: style("kicker", { detectedFont: "MyriadPro-Semibold", classification: "sans", previewFont: "Inter", size: 8.5, leading: 10.5, weight: 600, tracking: 90, color: "#1E4FC2", uppercase: true, confidence: 0.84 }),
    headline: style("headline", { detectedFont: "MinionPro-Bold", classification: "serif", previewFont: "Source Serif 4", size: 33, leading: 36, weight: 700, tracking: -12, color: "#14213D", confidence: 0.9 }),
    deck: style("deck", { detectedFont: "MyriadPro-Regular", classification: "sans", previewFont: "Inter", size: 12.5, leading: 17, weight: 400, tracking: 0, color: "#33415C", confidence: 0.86 }),
    byline: style("byline", { detectedFont: "MyriadPro-Semibold", classification: "sans", previewFont: "Inter", size: 8, leading: 10, weight: 600, tracking: 40, color: "#5B6577", uppercase: true, confidence: 0.78 }),
    body: style("body", { detectedFont: "MinionPro-Regular", classification: "serif", previewFont: "Source Serif 4", size: 9.5, leading: 13.5, weight: 400, tracking: 0, color: "#1B2333", confidence: 0.93 }),
    subhead: style("subhead", { detectedFont: "MyriadPro-Bold", classification: "sans", previewFont: "Inter", size: 9.5, leading: 13.5, weight: 700, tracking: 0, color: "#1E4FC2", confidence: 0.8 }),
    pullquote: style("pullquote", { detectedFont: "MinionPro-It", classification: "serif", previewFont: "Source Serif 4", size: 16.5, leading: 21, weight: 500, tracking: -5, color: "#1E4FC2", italic: true, confidence: 0.82 }),
    caption: style("caption", { detectedFont: "MyriadPro-Regular", classification: "sans", previewFont: "Inter", size: 7.5, leading: 9.75, weight: 400, tracking: 0, color: "#4A5568", confidence: 0.88 }),
    folio: style("folio", { detectedFont: "MyriadPro-Semibold", classification: "sans", previewFont: "Inter", size: 7.5, leading: 9, weight: 600, tracking: 30, color: "#14213D", confidence: 0.91 }),
    question: style("question", { detectedFont: "MyriadPro-Bold", classification: "sans", previewFont: "Inter", size: 9.5, leading: 13.5, weight: 700, tracking: 0, color: "#14213D", confidence: 0.79 }),
    stat: style("stat", { detectedFont: "MyriadPro-Black", classification: "sans", previewFont: "Inter", size: 38, leading: 40, weight: 800, tracking: -20, color: "#1E4FC2", confidence: 0.7 }),
  },
  colors: {
    ink: "#14213D",
    paper: "#FFFFFF",
    accent: "#1E4FC2",
    accentAlt: "#D7263D",
    muted: "#5B6577",
    rule: "#CBD2DC",
    palette: ["#14213D", "#1E4FC2", "#D7263D", "#F1F4F9", "#8A94A6", "#FFFFFF"],
  },
  folio: { position: "bottom_outside", showMagazineName: true, showSection: true },
  images: { captionPlacement: "below", cornerRadius: 0, fullBleedCover: true },
  pullQuote: { style: "rule_above" },
  pageTypeCounts: {},
  confidence: { overall: 0.86, page: 0.99, margins: 0.92, grid: 0.88, typography: 0.83, fonts: 0.62, colors: 0.9, layoutTypes: 0.81 },
  overrides: ["typography.headline.size", "colors.accentAlt"],
  approvedAt: "2026-10-18T07:45:00.000Z",
  approvedBy: "u_arjun",
};

/* ------------------------------------------------------------------ */
/* Reference page structure                                            */
/* ------------------------------------------------------------------ */

const sequence: PageType[] = [
  "cover", "advertisement", "toc", "editorial", "advertisement",
  "event_report", "two_column_article", "two_column_article", "advertisement", "interview", "interview",
  "event_report", "two_column_article", "full_page_image", "speaker_profile", "advertisement",
  "event_report", "two_column_article", "two_column_article", "infographic", "advertisement",
  "interview", "interview", "two_column_article", "event_report", "two_column_article",
  "photo_gallery", "photo_gallery", "advertisement", "event_report", "two_column_article",
  "two_column_article", "interview", "advertisement", "event_report", "two_column_article",
  "infographic", "two_column_article", "advertisement", "event_report", "two_column_article",
  "speaker_profile", "speaker_profile", "advertisement", "interview", "two_column_article",
  "event_report", "two_column_article", "full_page_image", "advertisement", "event_report",
  "two_column_article", "two_column_article", "interview", "advertisement", "photo_gallery",
  "photo_gallery", "event_report", "two_column_article", "advertisement", "two_column_article",
  "infographic", "event_report", "two_column_article", "advertisement", "photo_gallery", "advertisement", "advertisement",
];

const W = demoProfile.page.widthPt;
const H = demoProfile.page.heightPt;

function liveArea(pageNumber: number) {
  const { top, bottom, inside, outside } = demoProfile.margins;
  const rightHand = pageNumber % 2 === 1;
  const left = (rightHand ? inside : outside) / W;
  const right = 1 - (rightHand ? outside : inside) / W;
  return { left, right, top: top / H, bottom: 1 - bottom / H, width: right - left, height: 1 - (top + bottom) / H };
}

let blockId = 0;
const blk = (kind: LayoutBlock["kind"], role: LayoutBlock["role"], x: number, y: number, w: number, h: number, extra: Partial<LayoutBlock> = {}): LayoutBlock => ({
  id: `rb_${++blockId}`,
  kind,
  role,
  x: +x.toFixed(4),
  y: +y.toFixed(4),
  w: +w.toFixed(4),
  h: +h.toFixed(4),
  ...extra,
});

const t = demoProfile.typography;

function columnsBlocks(la: ReturnType<typeof liveArea>, y0: number, y1: number, cols = 3): LayoutBlock[] {
  const gutter = demoProfile.grid.gutterPt / W;
  const cw = (la.width - gutter * (cols - 1)) / cols;
  return Array.from({ length: cols }, (_, c) =>
    blk("text", "body", la.left + c * (cw + gutter), y0, cw, y1 - y0, { fontName: t.body.detectedFont, fontSize: t.body.size, color: t.body.color }),
  );
}

function folio(la: ReturnType<typeof liveArea>, pageNumber: number): LayoutBlock {
  const rightHand = pageNumber % 2 === 1;
  const w = 0.28;
  return blk("text", "folio", rightHand ? la.right - w : la.left, la.bottom + 0.022, w, 0.012, { fontName: t.folio.detectedFont, fontSize: t.folio.size, sample: `${pageNumber}  eGov · September 2026` });
}

function blocksFor(type: PageType, pageNumber: number, rand: () => number): LayoutBlock[] {
  const la = liveArea(pageNumber);
  const j = (n: number) => n + (rand() - 0.5) * 0.02;
  const headline = (y: number, h = 0.085, w = la.width) => blk("text", "headline", la.left, y, w, h, { fontName: t.headline.detectedFont, fontSize: t.headline.size, color: t.headline.color });
  const kicker = (y: number) => blk("text", "kicker", la.left, y, la.width * 0.4, 0.012, { fontName: t.kicker.detectedFont, fontSize: t.kicker.size, color: t.kicker.color });
  const deck = (y: number, w = la.width * 0.8) => blk("text", "deck", la.left, y, w, 0.045, { fontName: t.deck.detectedFont, fontSize: t.deck.size });
  const caption = (x: number, y: number, w: number) => blk("text", "caption", x, y, w, 0.02, { fontName: t.caption.detectedFont, fontSize: t.caption.size });

  switch (type) {
    case "cover":
      return [
        blk("image", "image", -0.015, -0.01, 1.03, 1.02),
        blk("text", "headline", 0.07, 0.04, 0.6, 0.11, { fontName: "Didot-Bold", fontSize: 96, sample: "eGov", color: "#FFFFFF" }),
        blk("text", "kicker", 0.07, 0.165, 0.4, 0.012, { fontName: t.kicker.detectedFont, fontSize: 9, sample: "Volume 22 · Issue 09 · September 2026" }),
        blk("text", "headline", 0.07, 0.7, 0.7, 0.1, { fontName: t.headline.detectedFont, fontSize: 40 }),
        blk("text", "deck", 0.07, 0.81, 0.6, 0.04, { fontName: t.deck.detectedFont, fontSize: 13 }),
        blk("text", "caption", 0.7, 0.3, 0.24, 0.3, { fontName: t.kicker.detectedFont, fontSize: 10, sample: "Cover lines" }),
      ];
    case "advertisement":
      return [blk("image", "image", -0.015, -0.01, 1.03, 1.02), blk("text", "caption", 0.06, 0.88, 0.5, 0.05, { fontSize: 18 })];
    case "toc":
      return [
        kicker(la.top),
        headline(la.top + 0.02, 0.06, la.width * 0.6),
        blk("image", "image", la.left + la.width * 0.62, la.top, la.width * 0.38, 0.32),
        ...Array.from({ length: 9 }, (_, i) => blk("text", "body", la.left, la.top + 0.12 + i * 0.075, la.width * 0.58, 0.055, { fontName: t.deck.detectedFont, fontSize: 11 })),
        folio(la, pageNumber),
      ];
    case "editorial":
      return [
        kicker(la.top),
        headline(la.top + 0.025, 0.07),
        deck(la.top + 0.11),
        blk("image", "image", la.left, la.top + 0.17, la.width * 0.3, 0.17),
        ...columnsBlocks(la, la.top + 0.36, la.bottom, 2),
        blk("text", "byline", la.left, la.top + 0.345, 0.3, 0.012, { fontName: t.byline.detectedFont, fontSize: t.byline.size }),
        folio(la, pageNumber),
      ];
    case "event_report":
      return [
        blk("image", "image", -0.015, -0.01, 1.03, j(0.47)),
        caption(la.left, 0.47, la.width * 0.5),
        kicker(0.5),
        headline(0.52, 0.09),
        deck(0.62),
        blk("text", "byline", la.left, 0.675, 0.3, 0.012, { fontName: t.byline.detectedFont, fontSize: t.byline.size }),
        ...columnsBlocks(la, 0.7, la.bottom),
        folio(la, pageNumber),
      ];
    case "two_column_article": {
      const imageTop = rand() > 0.5;
      const blocks: LayoutBlock[] = [];
      if (imageTop) {
        const cw = (la.width - (2 * demoProfile.grid.gutterPt) / W) / 3;
        blocks.push(blk("image", "image", la.left, la.top, cw * 2 + demoProfile.grid.gutterPt / W, 0.3), caption(la.left, la.top + 0.305, la.width * 0.5));
        blocks.push(blk("text", "pullquote", la.left + la.width * 0.68, la.top, la.width * 0.32, 0.16, { fontName: t.pullquote.detectedFont, fontSize: t.pullquote.size, color: t.pullquote.color }));
        blocks.push(...columnsBlocks(la, la.top + 0.34, la.bottom));
      } else {
        blocks.push(...columnsBlocks(la, la.top, la.top + 0.42));
        blocks.push(blk("rule", undefined, la.left, la.top + 0.44, la.width, 0.002), blk("text", "pullquote", la.left, la.top + 0.45, la.width, 0.08, { fontName: t.pullquote.detectedFont, fontSize: 20 }));
        blocks.push(...columnsBlocks(la, la.top + 0.55, la.bottom));
      }
      blocks.push(folio(la, pageNumber));
      return blocks;
    }
    case "interview":
      return [
        blk("image", "image", -0.015, -0.01, 0.5, 0.56),
        kicker(0.06),
        blk("text", "headline", 0.53, 0.09, 0.4, 0.2, { fontName: t.headline.detectedFont, fontSize: 28 }),
        blk("text", "deck", 0.53, 0.32, 0.4, 0.08, { fontName: t.deck.detectedFont, fontSize: t.deck.size }),
        blk("text", "question", la.left, 0.6, la.width, 0.02, { fontName: t.question.detectedFont, fontSize: t.question.size }),
        ...columnsBlocks(la, 0.63, la.bottom),
        folio(la, pageNumber),
      ];
    case "full_page_image":
      return [blk("image", "image", -0.015, -0.01, 1.03, 1.02), caption(0.07, 0.9, 0.5)];
    case "photo_gallery":
      return [
        kicker(la.top),
        headline(la.top + 0.02, 0.05, la.width * 0.7),
        ...Array.from({ length: 6 }, (_, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const w = (la.width - 0.03) / 2;
          return blk("image", "image", la.left + col * (w + 0.03), la.top + 0.1 + row * 0.27, w, 0.22);
        }),
        ...Array.from({ length: 6 }, (_, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const w = (la.width - 0.03) / 2;
          return caption(la.left + col * (w + 0.03), la.top + 0.325 + row * 0.27, w);
        }),
        folio(la, pageNumber),
      ];
    case "speaker_profile":
      return [
        kicker(la.top),
        headline(la.top + 0.02, 0.05, la.width * 0.7),
        ...Array.from({ length: 12 }, (_, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          const w = (la.width - 0.06) / 4;
          return blk("image", "image", la.left + col * (w + 0.02), la.top + 0.1 + row * 0.27, w, 0.16);
        }),
        ...Array.from({ length: 12 }, (_, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          const w = (la.width - 0.06) / 4;
          return blk("text", "caption", la.left + col * (w + 0.02), la.top + 0.27 + row * 0.27, w, 0.05, { fontName: t.caption.detectedFont, fontSize: 8 });
        }),
        folio(la, pageNumber),
      ];
    case "infographic":
      return [
        kicker(la.top),
        headline(la.top + 0.02, 0.06),
        ...Array.from({ length: 6 }, (_, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const w = la.width / 3;
          return blk("text", "stat", la.left + col * w, la.top + 0.16 + row * 0.3, w - 0.03, 0.06, { fontName: t.stat.detectedFont, fontSize: t.stat.size, color: t.stat.color });
        }),
        ...Array.from({ length: 6 }, (_, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const w = la.width / 3;
          return blk("text", "caption", la.left + col * w, la.top + 0.23 + row * 0.3, w - 0.03, 0.06, { fontName: t.caption.detectedFont, fontSize: 9 });
        }),
        folio(la, pageNumber),
      ];
    default:
      return [...columnsBlocks(la, la.top, la.bottom), folio(la, pageNumber)];
  }
}

const dominant: Record<PageType, string[]> = {
  cover: ["#0F1E3D", "#1E4FC2", "#FFFFFF", "#D7263D"],
  advertisement: ["#0B2545", "#F2A541", "#FFFFFF"],
  toc: ["#FFFFFF", "#14213D", "#1E4FC2"],
  editorial: ["#FFFFFF", "#14213D", "#CBD2DC"],
  event_report: ["#FFFFFF", "#14213D", "#2C3E63", "#1E4FC2"],
  two_column_article: ["#FFFFFF", "#14213D", "#1E4FC2"],
  interview: ["#FFFFFF", "#14213D", "#3A4A6B"],
  full_page_image: ["#1C2B4A", "#8C6B4F", "#F1E3CF"],
  photo_gallery: ["#FFFFFF", "#2C3E63", "#C9A27E"],
  speaker_profile: ["#FFFFFF", "#14213D", "#D9DEE7"],
  infographic: ["#FFFFFF", "#1E4FC2", "#D7263D"],
};

const fontsFor = (type: PageType) =>
  type === "advertisement" || type === "full_page_image" ? ["(no live text detected)"] : ["MinionPro-Regular", "MinionPro-Bold", "MyriadPro-Regular", "MyriadPro-Semibold"];

const rand = mulberry32(2609);

export const demoReferencePages: ReferencePage[] = sequence.map((layoutType, i) => {
  const pageNumber = i + 1;
  const blocks = blocksFor(layoutType, pageNumber, rand);
  const area = (k: LayoutBlock["kind"]) => blocks.filter((b) => b.kind === k).reduce((s, b) => s + Math.min(1, b.w) * Math.min(1, b.h), 0);
  const lowConfidence = [14, 20, 37, 49].includes(pageNumber);
  return {
    id: `rp_${pageNumber}`,
    referenceId: DEMO_REFERENCE_ID,
    pageNumber,
    layoutType,
    confidence: lowConfidence ? 0.58 + rand() * 0.1 : 0.8 + rand() * 0.18,
    widthPt: W,
    heightPt: H,
    blocks,
    properties: {
      columns: layoutType === "editorial" ? 2 : ["advertisement", "full_page_image", "cover"].includes(layoutType) ? 0 : 3,
      dominantColors: dominant[layoutType],
      textCoverage: +Math.min(0.95, area("text")).toFixed(2),
      imageCoverage: +Math.min(1, area("image")).toFixed(2),
      fonts: fontsFor(layoutType),
    },
    corrected: pageNumber === 20,
  };
});

demoProfile.pageTypeCounts = demoReferencePages.reduce<Partial<Record<PageType, number>>>((acc, p) => {
  acc[p.layoutType] = (acc[p.layoutType] ?? 0) + 1;
  return acc;
}, {});

export const demoReference: ReferenceMagazine = {
  id: DEMO_REFERENCE_ID,
  orgId: "org_elets",
  title: "eGov · September 2026",
  fileName: "eGov_September_2026_print.pdf",
  fileSizeBytes: 48_712_334,
  pageCount: demoReferencePages.length,
  uploadedAt: "2026-10-16T09:30:00.000Z",
  status: "approved",
  analysis: { progress: 100, analyser: "demo_seed", completedAt: "2026-10-16T09:41:00.000Z" },
  designProfileId: DEMO_PROFILE_ID,
  hasSourcePdf: false,
  hasInddSource: false,
  isDemo: true,
};

import type { LayoutBlock, ReferencePage, SlotRole, Template, TemplateSlot } from "@/lib/domain/types";

const PAGE_TYPE_LABEL: Record<string, string> = {
  cover: "Cover",
  editorial: "Editorial",
  toc: "Contents",
  interview: "Interview",
  event_report: "Event report",
  two_column_article: "Article",
  full_page_image: "Full-page image",
  photo_gallery: "Gallery",
  advertisement: "Advertisement",
  infographic: "Infographic",
  speaker_profile: "Speaker profiles",
};

export const pageTypeLabel = (t: string) => PAGE_TYPE_LABEL[t] ?? t;

function roleFor(block: LayoutBlock, largestImageId: string | undefined): SlotRole | null {
  if (block.kind === "image") return block.id === largestImageId ? "hero_image" : "image";
  if (block.kind === "rule") return "rule";
  if (block.kind === "shape") return "background";
  switch (block.role) {
    case "folio":
      return null; // folios are generated from the profile
    case "question":
      return "body";
    case "headline":
    case "kicker":
    case "deck":
    case "byline":
    case "body":
    case "subhead":
    case "pullquote":
    case "caption":
    case "stat":
      return block.role;
    default:
      return "body";
  }
}

/**
 * Reconstruct an editable template from a reference page's detected layout
 * blocks. Adjacent body columns with matching vertical extents are merged into
 * a single multi-column text frame so text can flow.
 */
export function deriveTemplate(page: ReferencePage, referenceTitle: string): Template {
  const images = page.blocks.filter((b) => b.kind === "image");
  const largest = images.reduce<LayoutBlock | undefined>((best, b) => (!best || b.w * b.h > best.w * best.h ? b : best), undefined);

  const bodies = page.blocks.filter((b) => b.kind === "text" && (b.role === "body" || b.role === "question"));
  const merged: { x: number; y: number; w: number; h: number; columns: number }[] = [];
  for (const b of [...bodies].sort((a, c) => a.y - c.y || a.x - c.x)) {
    const row = merged.find((m) => Math.abs(m.y - b.y) < 0.01 && Math.abs(m.h - b.h) < 0.02 && b.x >= m.x + m.w - 0.005 && b.x - (m.x + m.w) < 0.06);
    if (row) {
      row.w = b.x + b.w - row.x;
      row.columns += 1;
    } else merged.push({ x: b.x, y: b.y, w: b.w, h: b.h, columns: 1 });
  }

  const slots: TemplateSlot[] = [];
  let n = 0;
  for (const b of page.blocks) {
    if (b.kind === "text" && (b.role === "body" || b.role === "question")) continue;
    const role = roleFor(b, largest?.id);
    if (!role) continue;
    slots.push({ id: `s${++n}`, role, x: b.x, y: b.y, w: b.w, h: b.h });
  }
  merged.forEach((m) => slots.push({ id: `s${++n}`, role: "body", x: m.x, y: m.y, w: m.w, h: m.h, columns: m.columns }));

  return {
    id: `tpl_ref_${page.referenceId}_p${page.pageNumber}`,
    name: `${pageTypeLabel(page.layoutType)} — reference p.${page.pageNumber}`,
    pageType: page.layoutType,
    source: "reference",
    referencePageNumber: page.pageNumber,
    description: `Reconstructed from page ${page.pageNumber} of ${referenceTitle}: ${slots.length} frames${merged.some((m) => m.columns > 1) ? `, ${Math.max(...merged.map((m) => m.columns))}-column text` : ""}.`,
    slots,
    columns: Math.max(1, ...merged.map((m) => m.columns)),
  };
}

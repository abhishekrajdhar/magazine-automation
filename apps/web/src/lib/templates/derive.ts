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
const COVER_TEXT_SLOTS: Partial<Record<NonNullable<LayoutBlock["coverRole"]>, [string, SlotRole, string]>> = {
  masthead: ["mast", "headline", "Masthead"],
  issue_line: ["issue", "kicker", "Issue line"],
  headline: ["headline", "headline", "Headline"],
  deck: ["deck", "deck", "Standfirst"],
  cover_line: ["lines", "deck", "Cover lines"],
};

const edges = (x: number, y: number, w: number, h: number, tol = 0.006): TemplateSlot["bleed"] => {
  const e = { top: y <= tol, bottom: y + h >= 1 - tol, left: x <= tol, right: x + w >= 1 - tol };
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v));
};

function textStyle(b: LayoutBlock): TemplateSlot["style"] {
  const style: NonNullable<TemplateSlot["style"]> = {};
  if (b.fontSize) [style.size, style.leading] = [+b.fontSize.toFixed(1), +(b.fontSize * 1.08).toFixed(1)];
  if (b.weight) style.weight = b.weight as NonNullable<TemplateSlot["style"]>["weight"];
  if (b.uppercase) style.uppercase = true;
  if (b.color) style.color = b.color;
  if (b.align) style.align = b.align;
  return style;
}

/**
 * A cover rebuilt from vision-detected elements, or null. Slot ids match the built-in cover so the composer fills
 * them with the project's masthead, issue line, headline, standfirst and cover lines; taglines keep their printed
 * text and logos become frames bound to artwork cropped from the page. Mirrors templates.derive_cover_template.
 */
export function deriveCoverTemplate(page: ReferencePage, referenceTitle: string): Template | null {
  const vision = page.blocks.filter((b) => b.coverRole);
  if (!vision.length) return null;
  const id = `tpl_ref_${page.referenceId}_p${page.pageNumber}`;
  const slots: TemplateSlot[] = [{ id: "bg", role: "hero_image", x: 0, y: 0, w: 1, h: 1, name: "Cover image", bleed: edges(0, 0, 1, 1) }];
  vision
    .filter((b) => b.coverRole === "band")
    .forEach((b, i) => slots.push({ id: `band${i + 1}`, role: "background", x: b.x, y: b.y, w: b.w, h: b.h, name: "Band", fill: b.fill, opacity: 1, bleed: edges(b.x, b.y, b.w, b.h) }));
  const logos = vision.filter((b) => b.coverRole === "logo" || (b.coverRole === "masthead" && b.kind === "image"));
  logos.forEach((b, i) => {
    const sid = `logo${i + 1}`;
    slots.push({ id: sid, role: "image", x: b.x, y: b.y, w: b.w, h: b.h, name: `Logo: ${b.description ?? "logo"}`.slice(0, 120), assetTag: `ref-logo:${id}:${sid}` });
  });
  const lines = vision.filter((b) => b.coverRole === "cover_line");
  const used = new Set<string>();
  let tags = 0;
  for (const b of vision) {
    if (b.kind !== "text" || !b.coverRole) continue;
    if (b.coverRole === "tagline") {
      slots.push({ id: `tag${++tags}`, role: "kicker", x: b.x, y: b.y, w: b.w, h: b.h, name: "Tagline", fixedText: b.sample ?? "", style: textStyle(b) });
      continue;
    }
    const def = COVER_TEXT_SLOTS[b.coverRole];
    if (!def || used.has(def[0])) continue;
    used.add(def[0]);
    let { x, y, w, h } = b;
    if (b.coverRole === "cover_line" && lines.length > 1) {
      x = Math.min(...lines.map((l) => l.x));
      y = Math.min(...lines.map((l) => l.y));
      w = Math.max(...lines.map((l) => l.x + l.w)) - x;
      h = Math.max(...lines.map((l) => l.y + l.h)) - y;
    }
    slots.push({ id: def[0], role: def[1], x, y, w, h, name: def[2], style: textStyle(b) });
  }
  return {
    id,
    name: `Cover — reference p.${page.pageNumber}`,
    pageType: "cover",
    source: "reference",
    referencePageNumber: page.pageNumber,
    description: `Rebuilt from page ${page.pageNumber} of ${referenceTitle}: ${slots.length} frames — live masthead, headline and cover lines, ${logos.length} logo graphic(s) and the cover image.`,
    slots,
    columns: 1,
  };
}

export function deriveTemplate(page: ReferencePage, referenceTitle: string): Template {
  const cover = deriveCoverTemplate(page, referenceTitle);
  if (cover) return cover;
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

/**
 * Magazine preflight. Pure checks over the composed pages; overset text is
 * measured from the rendered DOM by the caller and passed in.
 */
import type { Article, Asset, DesignProfile, MagazinePage, PreflightIssue, Project, ReferencePage } from "@/lib/domain/types";
import { liveArea } from "@/lib/templates/geometry";
import { effectivePpi } from "@/components/designer/editor-panels";

export interface PreflightInput {
  project: Project;
  profile: DesignProfile;
  pages: MagazinePage[];
  articles: Article[];
  assets: Record<string, Asset>;
  referencePages: ReferencePage[];
  /** elementId → overset, keyed per page: `${pageId}:${elementId}` */
  overset: Record<string, boolean>;
  /** Fonts reported by a connected InDesign bridge; undefined when none is connected. */
  bridgeFonts?: string[];
  localFiles: Record<string, unknown>;
}

const NO_FOLIO_TYPES = new Set(["cover", "advertisement", "full_page_image"]);
const CAPTIONED_TYPES = new Set(["event_report", "two_column_article", "interview"]);

export function runPreflight(input: PreflightInput): PreflightIssue[] {
  const { project, profile, pages, articles, assets, overset } = input;
  const issues: PreflightIssue[] = [];
  const seen = new Map<string, number>();
  const add = (i: Omit<PreflightIssue, "id">) => {
    const key = `${i.code}:${i.pageId ?? "doc"}:${i.elementId ?? ""}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    issues.push({ ...i, id: n ? `${key}:${n}` : key });
  };
  const W = profile.page.widthPt;
  const H = profile.page.heightPt;
  const bleed = profile.page.bleedPt;

  // Document-level checks.
  if (pages.length % 4 !== 0) add({ code: "page_numbering", severity: "warning", message: `${pages.length} pages isn't a multiple of 4.`, recommendation: `Add or remove ${4 - (pages.length % 4)} page(s); saddle-stitched issues are bound in 4-page signatures.`, fix: "renumber" });
  if (pages.length !== project.targetPageCount) add({ code: "page_numbering", severity: "info", message: `Flatplan has ${pages.length} pages; the project targets ${project.targetPageCount}.`, recommendation: "Adjust the flatplan or update the project's target page count.", fix: "renumber" });
  const refSize = input.referencePages[0];
  if (refSize && (Math.abs(refSize.widthPt - W) > 1 || Math.abs(refSize.heightPt - H) > 1))
    add({ code: "page_size_mismatch", severity: "error", message: `Pages are ${Math.round(W)}×${Math.round(H)} pt but the reference is ${Math.round(refSize.widthPt)}×${Math.round(refSize.heightPt)} pt.`, recommendation: "Correct the trim size in the design profile, then re-flow pages." });
  if (profile.status !== "approved") add({ code: "unapproved_content", severity: "error", message: "The design profile hasn't been approved.", recommendation: "Review and approve the profile in the Reference Library." });

  const fonts = new Map<string, string>();
  Object.values(profile.typography).forEach((t) => t.detectedFont && fonts.set(t.detectedFont.replace(/-.*$/, ""), t.previewFont));
  for (const [family, preview] of fonts) {
    const installed = input.bridgeFonts?.some((f) => f.replace(/\s+/g, "").toLowerCase().startsWith(family.toLowerCase()));
    add({
      code: "font_substitution",
      severity: input.bridgeFonts ? (installed ? "info" : "error") : "warning",
      message: input.bridgeFonts ? (installed ? `${family} is installed on the InDesign machine.` : `${family} isn't installed on the InDesign machine.`) : `${family} is previewed with ${preview}; its availability for InDesign can't be checked without a connected bridge.`,
      recommendation: input.bridgeFonts && !installed ? `Install a licensed copy of ${family} on the render machine, or map the style to an installed font.` : "Connect the InDesign bridge so font availability can be verified before export.",
    });
  }

  const placeholders = new Set<string>();
  pages.forEach((page, i) => {
    const n = i + 1;
    const la = liveArea(profile, n);
    const base = { pageId: page.id, pageNumber: n };

    if (page.articleId && page.editorialStatus !== "approved") {
      const a = articles.find((x) => x.id === page.articleId);
      add({ ...base, code: "unapproved_content", severity: "error", message: `“${a?.headline.replace(/[“”]/g, "").slice(0, 60) ?? "Article"}” isn't approved.`, recommendation: "Approve the article in the Content Studio. Unapproved copy can't be exported as final.", fix: "approve_content" });
    }

    let imageCount = 0;
    let captioned = false;
    for (const el of page.elements) {
      if (el.hidden) continue;
      const elBase = { ...base, elementId: el.id };
      if (el.kind === "text") {
        if (overset[`${page.id}:${el.id}`]) add({ ...elBase, code: "overset_text", severity: "error", message: `${el.name} has overset text.`, recommendation: "Fit the text (up to 15% smaller), enlarge the frame, or shorten the copy.", fix: "fit_text" });
        if (!el.dynamic && !(el.text ?? "").trim()) add({ ...elBase, code: "empty_frame", severity: "warning", message: `${el.name} is empty.`, recommendation: "Add copy or remove the frame.", fix: "remove_frame" });
        if (el.role === "caption" && (el.text ?? "").trim()) captioned = true;
        const outside = el.role !== "folio" && (el.x < la.x - 2 || el.y < la.y - 2 || el.x + el.w > la.x + la.w + 2 || el.y + el.h > la.y + la.h + 2);
        const onImageTemplate = page.templateId.includes("cover") || page.templateId.includes("spread_photo") || page.templateId.includes("full_image");
        if (outside && !onImageTemplate) add({ ...elBase, code: "margin_violation", severity: "warning", message: `${el.name} extends outside the margins.`, recommendation: "Snap the frame back inside the live area.", fix: "snap_to_margins" });
      }
      if (el.kind === "image") {
        if (el.role === "image" || el.role === "hero_image") imageCount += 1;
        const asset = el.assetId ? input.assets[el.assetId] : undefined;
        if (!el.assetId) add({ ...elBase, code: "missing_image", severity: "error", message: `${el.name} is an empty image frame.`, recommendation: "Place a photograph or remove the frame.", fix: "assign_image" });
        else if (!asset) add({ ...elBase, code: "broken_asset", severity: "error", message: `${el.name} links to an asset that no longer exists.`, recommendation: "Relink the frame to a photograph from the library.", fix: "assign_image" });
        else {
          if (asset.simulated) placeholders.add(asset.id);
          else if (!asset.url && !input.localFiles[asset.id]) add({ ...elBase, code: "broken_asset", severity: "error", message: `${asset.fileName} has no file attached.`, recommendation: "Upload the original image.", fix: "assign_image" });
          if (asset.kind !== "ad") {
            const ppi = effectivePpi(asset, el);
            if (ppi < 150) add({ ...elBase, code: "low_resolution", severity: "error", message: `${asset.fileName} is ${ppi} ppi at this size.`, recommendation: "Use a higher-resolution original or shrink the frame. Print needs about 300 ppi; 150 is the floor.", fix: "assign_image" });
            else if (ppi < 200) add({ ...elBase, code: "low_resolution", severity: "warning", message: `${asset.fileName} is ${ppi} ppi at this size.`, recommendation: "Acceptable for digital; soft in print. Consider a higher-resolution original.", fix: "assign_image" });
          }
        }
      }
      if (el.x + el.w < -bleed || el.y + el.h < -bleed || el.x > W + bleed || el.y > H + bleed) add({ ...elBase, code: "layout_overflow", severity: "error", message: `${el.name} sits entirely off the page.`, recommendation: "Move it back onto the page or delete it.", fix: "remove_frame" });
      else if (el.x < -bleed - 1 || el.y < -bleed - 1 || el.x + el.w > W + bleed + 1 || el.y + el.h > H + bleed + 1) add({ ...elBase, code: "layout_overflow", severity: "warning", message: `${el.name} extends beyond the ${bleed} pt bleed.`, recommendation: "Trim the frame to the bleed edge.", fix: "snap_to_margins" });
    }
    if (CAPTIONED_TYPES.has(page.pageType) && imageCount > 0 && !captioned && !page.templateId.includes("spread_photo")) add({ ...base, code: "missing_caption", severity: "warning", message: "Photographs on this page have no caption.", recommendation: "Add a caption crediting the session or speaker.", fix: "open_editor" });
    if (!NO_FOLIO_TYPES.has(page.pageType) && !page.templateId.includes("spread_photo") && !page.elements.some((e) => e.dynamic === "folio")) add({ ...base, code: "page_numbering", severity: "warning", message: "This page has no folio.", recommendation: "Re-apply the template to restore the page number.", fix: "open_editor" });
  });

  if (placeholders.size) add({ code: "missing_image", severity: "info", message: `${placeholders.size} placed images are demo placeholders, not photographs.`, recommendation: "Replace them with real event photography before print." });

  const rank = { error: 0, warning: 1, info: 2 } as const;
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.pageNumber ?? 0) - (b.pageNumber ?? 0));
}

export interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  blocking: boolean;
}

export function approvalChecklist(input: { profile?: DesignProfile; pages: MagazinePage[]; articles: Article[]; issues: PreflightIssue[] | null; ignored: Set<string> }): ChecklistItem[] {
  const placedArticles = new Set(input.pages.map((p) => p.articleId).filter(Boolean));
  const unapproved = input.articles.filter((a) => placedArticles.has(a.id) && a.status !== "approved");
  const errors = input.issues?.filter((i) => i.severity === "error" && !input.ignored.has(i.id)) ?? [];
  const notSigned = input.pages.filter((p) => p.designStatus !== "approved" && p.designStatus !== "ready");
  return [
    { key: "profile", label: "Design profile approved", ok: input.profile?.status === "approved", detail: input.profile?.status === "approved" ? `v${input.profile.version}` : "Approve it in the Reference Library", blocking: true },
    { key: "articles", label: "All placed articles approved", ok: unapproved.length === 0, detail: unapproved.length ? `${unapproved.length} still awaiting approval` : `${placedArticles.size} approved`, blocking: true },
    { key: "preflight", label: "Preflight run with no unresolved errors", ok: input.issues !== null && errors.length === 0, detail: input.issues === null ? "Not run yet" : errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""} open` : "Clean", blocking: true },
    { key: "pages", label: "Page count is a multiple of 4", ok: input.pages.length % 4 === 0 && input.pages.length > 0, detail: `${input.pages.length} pages`, blocking: true },
    { key: "design", label: "Every page signed off by design", ok: notSigned.length === 0, detail: notSigned.length ? `${notSigned.length} page${notSigned.length > 1 ? "s" : ""} in progress` : "All signed off", blocking: false },
  ];
}

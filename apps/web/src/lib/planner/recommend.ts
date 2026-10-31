/**
 * Heuristic flatplan recommendation. Deterministic and explainable: it is not
 * an AI model, and the UI says so. When an LLM is configured the API can offer
 * its own recommendation; this one always works offline.
 */
import type { Article, ArticleType, DesignProfile, MagazinePage, PageType, Project } from "@/lib/domain/types";
import { bodyCapacities, resolveTemplate, type PlanEntry } from "@/lib/templates/compose";
import { specsForPageType, templateSpecs } from "@/lib/templates/specs";

const IMPORTANCE: Record<ArticleType, number> = {
  editorial: 100,
  event_report: 95,
  keynote: 90,
  panel: 70,
  interview: 68,
  government_perspective: 60,
  tech_feature: 58,
  highlights: 55,
  speaker_profiles: 30,
  photo_captions: 20,
};

const pageTypeFor = (a: Article): PageType =>
  a.type === "editorial" ? "editorial" : a.type === "interview" ? "interview" : a.type === "speaker_profiles" ? "speaker_profile" : a.type === "photo_captions" ? "photo_gallery" : a.type === "highlights" ? "infographic" : a.type === "event_report" || a.type === "keynote" || a.type === "panel" ? "event_report" : "two_column_article";

const words = (a: Article) => [a.intro, ...a.body.map((b) => b.text)].join(" ").split(/\s+/).filter(Boolean).length;

/** Pick opener/continuation templates whose combined body capacity best fits the article. */
function fitTemplates(article: Article, profile: DesignProfile, startPage: number): { templateIds: string[]; fill: number } {
  const type = pageTypeFor(article);
  if (type === "speaker_profile") return { templateIds: Array(Math.max(1, Math.ceil(article.speakerIds.length / 12))).fill("tpl_speakers_grid"), fill: 1 };
  if (type === "photo_gallery") {
    const pages = Math.max(1, Math.round(article.suggestedImageIds.length / 5));
    return { templateIds: Array.from({ length: pages }, (_, i) => (i % 2 ? "tpl_gallery_mosaic" : "tpl_gallery_grid")), fill: 1 };
  }
  if (type === "infographic") return { templateIds: ["tpl_infographic_stats"], fill: 1 };
  if (type === "editorial") return { templateIds: ["tpl_editorial_portrait"], fill: 1 };
  const need = words(article);
  const openers = specsForPageType(type).filter((s) => s.position !== "continuation");
  const conts = templateSpecs.filter((s) => s.position === "continuation" && (s.pageType === "two_column_article" || s.pageType === type));
  const cap = (id: string, page: number) => bodyCapacities(resolveTemplate(id, [])!, profile, page).reduce((a, b) => a + b, 0);
  let best = { templateIds: [openers[0]?.id ?? "tpl_perspective_single"], fill: 0, score: Infinity };
  for (const o of openers) {
    const c1 = cap(o.id, startPage);
    const consider = (ids: string[], total: number) => {
      const fill = need / Math.max(1, total);
      // Prefer 80–100% full; overset is worse than white space.
      const score = fill > 1.02 ? (fill - 1) * 4 + 0.2 : Math.abs(0.92 - fill);
      if (score < best.score) best = { templateIds: ids, fill, score };
    };
    consider([o.id], c1);
    if (o.position === "opener") for (const c of conts) consider([o.id, c.id], c1 + cap(c.id, startPage + 1));
  }
  return { templateIds: best.templateIds, fill: best.fill };
}

export interface Recommendation {
  plan: PlanEntry[];
  rationale: string[];
}

export function recommendFlatplan(project: Project, articles: Article[], profile: DesignProfile, adAssetIds: string[], existing: MagazinePage[]): Recommendation {
  const rationale: string[] = [];
  const cfg = project.config;
  const usable = articles.filter((a) => a.status !== "rejected" && cfg.articleTypes.includes(a.type));
  const skipped = articles.length - usable.length;
  if (skipped) rationale.push(`Left out ${skipped} rejected or deselected article${skipped > 1 ? "s" : ""}.`);
  const ranked = [...usable].sort((a, b) => IMPORTANCE[b.type] - IMPORTANCE[a.type] || words(b) - words(a));
  const lead = ranked.find((a) => a.type === "event_report");
  const editorial = cfg.includeEditorial ? ranked.find((a) => a.type === "editorial") : undefined;
  const tail = ranked.filter((a) => ["speaker_profiles", "photo_captions"].includes(a.type));
  const body = ranked.filter((a) => a !== lead && a !== editorial && !tail.includes(a));
  const ads = cfg.includeAdvertisements ? adAssetIds.slice(0, cfg.adPageCount) : [];
  const keepCover = existing.find((p) => p.pageType === "cover");

  const plan: PlanEntry[] = [{ pageType: "cover", templateId: "tpl_cover_fullbleed", label: "Cover", imageIds: keepCover?.elements.filter((e) => e.kind === "image" && e.assetId).map((e) => e.assetId!) }];
  let adCursor = 0;
  const pushAd = (label: string) => {
    const id = ads[adCursor++];
    if (id) plan.push({ pageType: "advertisement", templateId: "tpl_ad_full", label, adAssetId: id });
  };
  pushAd("Ad · inside front cover");
  if (cfg.includeToc) plan.push({ pageType: "toc", templateId: "tpl_toc_classic", label: "Contents" });
  const place = (a: Article) => {
    // Two-page stories open on a left-hand page so they read as a spread.
    const fit = fitTemplates(a, profile, plan.length + 1);
    if (fit.templateIds.length === 2 && (plan.length + 1) % 2 === 1 && adCursor < ads.length) pushAd(`Ad · before ${a.headline.slice(0, 24)}`);
    fit.templateIds.forEach((t, i) => plan.push({ pageType: i === 0 ? pageTypeFor(a) : t.includes("gallery") ? "photo_gallery" : t === "tpl_speakers_grid" ? "speaker_profile" : "two_column_article", templateId: t, label: `${a.headline.replace(/[“”]/g, "").slice(0, 40)}${i ? " (cont.)" : ""}`, articleId: a.id }));
    if (fit.fill > 1.02) rationale.push(`“${a.headline.replace(/[“”]/g, "").slice(0, 40)}” is ~${Math.round((fit.fill - 1) * 100)}% longer than its best-fitting layout — expect overset to trim.`);
  };
  if (editorial) place(editorial);
  if (lead) {
    place(lead);
    rationale.push("Lead event report placed straight after the editorial, as in the reference's issue structure.");
  }
  body.forEach((a, i) => {
    place(a);
    if (i % 3 === 2) pushAd(`Ad slot ${adCursor + 1}`);
  });
  tail.forEach(place);
  while (adCursor < ads.length) pushAd(adCursor === ads.length - 1 ? "Back cover ad" : `Ad slot ${adCursor + 1}`);
  rationale.push(`Ordered by editorial weight: editorial → event report → keynotes → panels and interviews → features → profiles → gallery.`);
  rationale.push(`Templates chosen to fit each article's length to the reference grid (${profile.grid.columns} columns, ${profile.typography.body.size}/${profile.typography.body.leading} pt body).`);
  const total = plan.length;
  if (total % 4 !== 0) rationale.push(`${total} pages isn't a multiple of 4; add or remove ${4 - (total % 4)} page${4 - (total % 4) > 1 ? "s" : ""} before print.`);
  if (total !== project.targetPageCount) rationale.push(`Recommendation is ${total} pages against a target of ${project.targetPageCount}.`);
  return { plan, rationale };
}

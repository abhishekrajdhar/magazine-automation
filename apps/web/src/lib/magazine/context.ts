import type { Article, Asset, MagazinePage, Project } from "@/lib/domain/types";
import type { RenderContext, TocEntry } from "@/components/magazine/page-view";
import { pageTypeLabel } from "@/lib/templates/derive";

/** "eGov — National eGovernance Summit 2026 Special" → "eGov" */
export function magazineName(project: Pick<Project, "title">): string {
  return project.title.split(/\s+[—–-]\s+/)[0].trim() || project.title;
}

export function issueLabel(project: Pick<Project, "publicationDate">): string {
  const d = new Date(project.publicationDate);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

const cleanTitle = (s: string) => s.replace(/[“”"]/g, "").trim();

/** Contents entries: the first page of every article, in flatplan order. */
export function buildToc(pages: MagazinePage[], articles: Article[]): TocEntry[] {
  const seen = new Set<string>();
  const out: TocEntry[] = [];
  pages.forEach((page, i) => {
    if (!page.articleId || seen.has(page.articleId)) return;
    seen.add(page.articleId);
    const a = articles.find((x) => x.id === page.articleId);
    if (!a || a.type === "editorial") return;
    out.push({ page: i + 1, kicker: (a.kicker ?? pageTypeLabel(page.pageType)).split("·")[0].trim(), title: cleanTitle(a.headline) });
  });
  return out.slice(0, 13);
}

export function renderContext(project: Project, pages: MagazinePage[], index: number, articles: Article[], toc: TocEntry[]): RenderContext {
  const page = pages[index];
  const article = page?.articleId ? articles.find((a) => a.id === page.articleId) : undefined;
  return {
    pageNumber: index + 1,
    magazineName: magazineName(project),
    issueLabel: issueLabel(project),
    section: article?.kicker?.split("·")[0].trim() ?? (page ? pageTypeLabel(page.pageType) : undefined),
    toc,
  };
}

export function assetMap(assets: Asset[]): Record<string, Asset> {
  return Object.fromEntries(assets.map((a) => [a.id, a]));
}

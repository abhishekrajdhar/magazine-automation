import { describe, expect, it } from "vitest";
import { buildDemoPages, buildDemoSeed } from "@/lib/demo/workspace";
import { createPageVersions, type ComposeContext } from "./compose";
import { liveArea } from "./geometry";

const full = buildDemoSeed();
const seed = full.workspace;
const project = full.projects[0];
const ctx: ComposeContext = {
  profile: full.designProfiles[0],
  project,
  articles: seed.articles,
  speakers: seed.speakers,
  facts: seed.facts,
  assets: seed.assets,
  referenceTemplates: full.templates,
  imagePreference: project.config.imagePreference,
};
const pages = buildDemoPages().map((p) => ({ ...p, locked: false }));
type Page = (typeof pages)[number];
const words = (p: Page) => p.elements.filter((e) => !e.dynamic).map((e) => e.text ?? "").join(" ").split(/\s+/).filter(Boolean).sort().join(" ");
const look = (p: Page) => JSON.stringify(p.elements.map((e) => [e.x, e.y, e.w, e.h, e.assetId, e.fill, e.style?.color]));
const article0 = pages.find((p) => p.articleId && (p.articlePart ?? 0) === 0 && p.pageType === "event_report")!;

describe("page versions", () => {
  it("gives ten versions at a click, and ten more on request, for a typical article page", () => {
    const source = createPageVersions(pages, article0.id, ctx);
    const first = source.next(10);
    const second = source.next(10);
    expect(first).toHaveLength(10);
    expect(second).toHaveLength(10);
    expect(new Set([...first, ...second].map((v) => v.key)).size).toBe(20);
  });

  it("offers ten or more versions for most editorial pages of the demo issue", () => {
    const editorial = pages.filter((p) => p.pageType !== "advertisement");
    const rich = editorial.filter((p) => createPageVersions(pages, p.id, ctx).next(10).length === 10);
    expect(rich.length / editorial.length).toBeGreaterThan(0.75);
  });

  it("never repeats a look: every version differs from the current page and from the others", () => {
    for (const p of pages) {
      const source = createPageVersions(pages, p.id, ctx);
      const all = [...source.next(10), ...source.next(10), ...source.next(10)];
      const looks = [p, ...all.map((v) => v.page)].map(look);
      expect(new Set(looks).size).toBe(looks.length);
    }
  });

  it("runs out honestly instead of padding", () => {
    const source = createPageVersions(pages, article0.id, ctx);
    let total = 0;
    for (let i = 0; i < 100 && !source.done; i++) total += source.next(10).length;
    expect(source.done).toBe(true);
    expect(source.next(10)).toEqual([]);
    expect(total).toBeGreaterThan(20);
  });

  it("keeps the page's identity, the issue's length and every other article untouched", () => {
    for (const v of createPageVersions(pages, article0.id, ctx).next(20)) {
      expect(v.pages).toHaveLength(pages.length);
      expect(v.pages.map((p) => p.id)).toEqual(pages.map((p) => p.id));
      expect(v.page.articleId).toBe(article0.articleId);
      v.pages.forEach((next, i) => {
        if (pages[i].articleId !== article0.articleId) expect(next).toEqual(pages[i]);
      });
    }
  });

  it("does not write or drop copy: mirrored, recoloured and re-pictured versions of a layout carry the same words", () => {
    const cover = pages[0];
    for (const v of createPageVersions(pages, cover.id, ctx).next(30).filter((x) => x.name === "Same layout")) expect(words(v.page)).toBe(words(cover));
    const article = seed.articles.find((a) => a.id === article0.articleId)!;
    for (const v of createPageVersions(pages, article0.id, ctx).next(30)) expect(v.page.elements.some((e) => e.text?.includes(article.headline))).toBe(true);
  });

  it("uses only photographs that are not already placed elsewhere in the issue", () => {
    const cover = pages[0];
    const elsewhere = new Set(pages.slice(1).flatMap((p) => p.elements.map((e) => e.assetId).filter(Boolean)));
    const repictured = createPageVersions(pages, cover.id, ctx).next(30).filter((v) => v.detail.includes("New pictures"));
    expect(repictured.length).toBeGreaterThan(0);
    for (const v of repictured) {
      const fresh = v.page.elements.map((e) => e.assetId).filter((id) => id && !cover.elements.some((e) => e.assetId === id));
      expect(fresh.length).toBeGreaterThan(0);
      fresh.forEach((id) => expect(elsewhere.has(id)).toBe(false));
    }
  });

  it("keeps mirrored frames on the page, and inside the margins when they started there", () => {
    const W = ctx.profile.page.widthPt;
    pages.forEach((p, i) => {
      const la = liveArea(ctx.profile, i + 1);
      const inside = new Set(p.elements.filter((e) => e.x >= la.x - 1 && e.x + e.w <= la.x + la.w + 1).map((e) => e.id));
      for (const v of createPageVersions(pages, p.id, ctx).next(10).filter((x) => x.name === "Same layout" && x.detail === "Mirrored")) {
        for (const e of v.page.elements) {
          expect(e.x + e.w).toBeGreaterThan(0);
          expect(e.x).toBeLessThan(W);
          if (inside.has(e.id)) {
            expect(e.x).toBeGreaterThanOrEqual(la.x - 1.5);
            expect(e.x + e.w).toBeLessThanOrEqual(la.x + la.w + 1.5);
          }
        }
      }
    });
  });

  it("has nothing to offer for a locked page", () => {
    const locked = pages.map((p, i) => (i === 5 ? { ...p, locked: true } : p));
    const source = createPageVersions(locked, locked[5].id, ctx);
    expect(source.next(10)).toEqual([]);
    expect(source.done).toBe(true);
  });
});

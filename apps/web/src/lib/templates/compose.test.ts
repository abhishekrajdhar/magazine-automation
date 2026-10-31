import { describe, expect, it } from "vitest";
import { buildDemoPages, buildDemoSeed } from "@/lib/demo/workspace";
import { demoProfile } from "@/lib/demo/reference";
import { distributeParagraphs, resolveSlots, resolveTemplate } from "./compose";
import { snapToColumns, liveArea } from "./geometry";

describe("grid snapping", () => {
  it("snaps fractional spans to the profile's column grid", () => {
    const la = liveArea(demoProfile, 1);
    const twoThirds = snapToColumns(demoProfile, la, 0, 0.66);
    expect(twoThirds.columns).toBe(2);
    expect(twoThirds.x).toBeCloseTo(la.x);
    const twoCol = snapToColumns({ ...demoProfile, grid: { ...demoProfile.grid, columns: 2 } }, la, 0, 1);
    expect(twoCol.columns).toBe(2);
    expect(twoCol.w).toBeCloseTo(la.w);
  });

  it("mirrors outside-edge slots on left-hand pages", () => {
    const tpl = resolveTemplate("tpl_interview_opener", [])!;
    const recto = resolveSlots(tpl, demoProfile, 11).find((s) => s.id === "portrait")!;
    const verso = resolveSlots(tpl, demoProfile, 12).find((s) => s.id === "portrait")!;
    expect(recto.x + recto.w).toBeGreaterThan(demoProfile.page.widthPt);
    expect(verso.x).toBeLessThan(0);
  });
});

describe("mirrored templates", () => {
  it.each(["tpl_interview_opener", "tpl_report_split"])("keeps %s text frames inside the margins on left-hand pages", (id) => {
    const tpl = resolveTemplate(id, [])!;
    for (const pageNumber of [8, 9]) {
      const la = liveArea(demoProfile, pageNumber);
      for (const s of resolveSlots(tpl, demoProfile, pageNumber).filter((x) => ["headline", "deck", "kicker", "body"].includes(x.role))) {
        expect(s.x, `${id} p${pageNumber} ${s.id}`).toBeGreaterThanOrEqual(la.x - 0.5);
        expect(s.x + s.w, `${id} p${pageNumber} ${s.id}`).toBeLessThanOrEqual(la.x + la.w + 0.5);
      }
    }
  });
});

describe("text distribution", () => {
  it("never leaves a subhead at the bottom of a frame and puts overflow in the last frame", () => {
    const paras = ["one two three four five", "## Heading", "six seven eight nine ten eleven twelve"];
    const chunks = distributeParagraphs(paras, [10, 1000]);
    expect(chunks[0]).toEqual(["one two three four five"]);
    expect(chunks[1][0]).toBe("## Heading");
  });
});

describe("demo magazine", () => {
  const pages = buildDemoPages();

  it("composes the 40-page flatplan", () => {
    expect(pages).toHaveLength(40);
    expect(pages[0].pageType).toBe("cover");
    expect(pages.filter((p) => p.pageType === "advertisement")).toHaveLength(8);
  });

  it("gives every article page real text and image frames", () => {
    const textPages = pages.filter((p) => p.articleId && !["speaker_profile", "photo_gallery", "infographic"].includes(p.pageType) && p.templateId !== "tpl_spread_photo_opener");
    for (const page of textPages) {
      const body = page.elements.filter((e) => e.role === "body" && !e.dynamic);
      expect(body.length, page.label).toBeGreaterThan(0);
      expect(body.some((b) => (b.text ?? "").length > 40), page.label).toBe(true);
    }
  });

  it("does not reuse a photograph on two pages", () => {
    const seen = new Map<string, string>();
    for (const page of pages) {
      for (const el of page.elements) {
        if (el.kind !== "image" || !el.assetId || el.role === "ad" || page.pageType === "speaker_profile") continue;
        expect(seen.get(el.assetId), `${el.assetId} on ${page.label} and ${seen.get(el.assetId)}`).toBeUndefined();
        seen.set(el.assetId, page.label);
      }
    }
  });

  it("builds a seed with 186 photographs and 24 speakers", () => {
    const seed = buildDemoSeed();
    expect(seed.workspace.assets.filter((a) => a.kind !== "ad")).toHaveLength(186);
    expect(seed.workspace.speakers).toHaveLength(24);
    expect(seed.workspace.videos).toHaveLength(8);
    expect(seed.workspace.articles).toHaveLength(18);
  });
});

import { describe, expect, it } from "vitest";
import { demoProfile } from "@/lib/demo/reference";
import type { LayoutBlock, ReferencePage } from "@/lib/domain/types";
import { buildElements, emptyContent, resolveTemplate } from "./compose";
import { deriveTemplate } from "./derive";

const block = (b: Partial<LayoutBlock> & Pick<LayoutBlock, "kind" | "x" | "y" | "w" | "h">): LayoutBlock => ({ id: `b${Math.random()}`, source: "vision", ...b });

const page: ReferencePage = {
  id: "rpg1",
  referenceId: "ref1",
  pageNumber: 1,
  layoutType: "cover",
  confidence: 0.75,
  widthPt: 595,
  heightPt: 842,
  corrected: false,
  properties: { columns: 1, dominantColors: [], textCoverage: 0, imageCoverage: 1, fonts: [] },
  blocks: [
    block({ kind: "image", role: "background", x: 0, y: 0, w: 1, h: 1, source: "pdf" }),
    block({ kind: "shape", role: "background", coverRole: "band", x: 0, y: 0, w: 1, h: 0.05, fill: "#1E4FD8" }),
    block({ kind: "text", role: "kicker", coverRole: "tagline", x: 0.2, y: 0.01, w: 0.6, h: 0.03, sample: "Monthly magazine on e-Governance", color: "#FFFFFF" }),
    block({ kind: "text", role: "headline", coverRole: "masthead", x: 0.05, y: 0.07, w: 0.45, h: 0.12, sample: "egov", fontSize: 80, color: "#E31B23" }),
    block({ kind: "image", role: "image", coverRole: "logo", x: 0.6, y: 0.07, w: 0.35, h: 0.12, description: "Summit logo" }),
    block({ kind: "text", role: "headline", coverRole: "headline", x: 0.1, y: 0.3, w: 0.8, h: 0.12, sample: "INDIA'S\nAI MOMENT", fontSize: 40, uppercase: true, weight: 900, align: "center", color: "#FFFFFF" }),
    block({ kind: "text", role: "kicker", coverRole: "cover_line", x: 0.1, y: 0.5, w: 0.3, h: 0.02, sample: "One" }),
    block({ kind: "text", role: "kicker", coverRole: "cover_line", x: 0.5, y: 0.6, w: 0.4, h: 0.03, sample: "Two" }),
  ],
} as ReferencePage;

describe("covers rebuilt from a flattened reference page", () => {
  const tpl = deriveTemplate(page, "eGov");

  it("maps detected elements onto the cover slots the composer fills", () => {
    const ids = tpl.slots.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["bg", "band1", "logo1", "tag1", "mast", "headline", "lines"]));
    const lines = tpl.slots.find((s) => s.id === "lines")!;
    expect([lines.x, lines.y, +(lines.x + lines.w).toFixed(2), +(lines.y + lines.h).toFixed(2)]).toEqual([0.1, 0.5, 0.9, 0.63]);
  });

  it("composes live text with the measured style, logos, band colour and bleed", () => {
    const content = { ...emptyContent(), masthead: "AI in Edtech", headline: "Classrooms Rewired", coverLines: "Lines", logos: { "ref-logo:tpl_ref_ref1_p1:logo1": "ast_logo" } };
    const els = Object.fromEntries(buildElements(resolveTemplate(tpl.id, [tpl])!, demoProfile, 1, content, "cover").map((e) => [e.id, e]));
    expect(els.el_mast).toMatchObject({ kind: "text", text: "AI in Edtech", name: "Masthead", style: { color: "#E31B23", size: 80 } });
    expect(els.el_headline).toMatchObject({ text: "Classrooms Rewired", style: { uppercase: true, weight: 900, align: "center" } });
    expect(els.el_tag1).toMatchObject({ text: "Monthly magazine on e-Governance" });
    expect(els.el_logo1).toMatchObject({ kind: "image", assetId: "ast_logo", name: "Logo: Summit logo" });
    expect(els.el_band1).toMatchObject({ kind: "shape", fill: "#1E4FD8" });
    expect(els.el_bg.x).toBeLessThan(0);
    expect(els.el_bg.w).toBeGreaterThan(demoProfile.page.widthPt);
  });
});

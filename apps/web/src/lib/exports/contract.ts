/**
 * Builds the layout contract (packages/contracts/layout-contract.schema.json)
 * from the composed pages. This is exactly what the InDesign renderer and the
 * API's ReportLab renderer consume.
 */
import type { Article, Asset, DesignProfile, MagazinePage, PageElement, Project, TextRole } from "@/lib/domain/types";
import { buildToc, issueLabel, magazineName } from "@/lib/magazine/context";

const STYLE_NAME = (role: TextRole) => `PF ${role[0].toUpperCase()}${role.slice(1)}`;

const fallbackFamily = (classification: string, weight: number, italic?: boolean) => {
  if (classification === "sans") return weight >= 600 ? "Helvetica-Bold" : "Helvetica";
  if (italic) return "Times-Italic";
  return weight >= 600 ? "Times-Bold" : "Times-Roman";
};

const fontStyle = (weight: number, italic?: boolean) => `${weight >= 800 ? "Black" : weight >= 700 ? "Bold" : weight >= 600 ? "Semibold" : weight >= 500 ? "Medium" : "Regular"}${italic ? " Italic" : ""}`.replace("Regular Italic", "Italic");

/** "MinionPro-Bold" → "Minion Pro" */
function familyName(detected: string | undefined, preview: string): string {
  if (!detected) return preview;
  const base = detected.replace(/^[A-Z]{6}\+/, "").split("-")[0];
  return base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/MT$/, "").trim();
}

function hexToCmyk(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  const c = (1 - r - k) / (1 - k);
  const m = (1 - g - k) / (1 - k);
  const y = (1 - b - k) / (1 - k);
  return [c, m, y, k].map((v) => Math.round(v * 100)) as [number, number, number, number];
}

/** Strip the light markup used in text frames into plain paragraphs. */
export function plainText(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/^(\^ |## |Q: |> )/, "").trim())
    .filter(Boolean)
    .join("\n\n");
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ContractInput {
  project: Project;
  profile: DesignProfile;
  pages: MagazinePage[];
  articles: Article[];
  assets: Record<string, Asset>;
}

export function buildLayoutContract({ project, profile, pages, articles, assets }: ContractInput) {
  const toc = buildToc(pages, articles);
  const name = magazineName(project);
  const issue = issueLabel(project);
  const colors = [
    ["PF Ink", profile.colors.ink],
    ["PF Paper", profile.colors.paper],
    ["PF Accent", profile.colors.accent],
    ["PF Accent 2", profile.colors.accentAlt],
    ["PF Muted", profile.colors.muted],
    ["PF Rule", profile.colors.rule],
  ].map(([n, hex]) => ({ name: n, hex: hex.toUpperCase(), cmyk: hexToCmyk(hex) }));
  const swatch = (hex: string | undefined) => colors.find((c) => c.hex === hex?.toUpperCase())?.name;

  const paragraph = (Object.keys(profile.typography) as TextRole[]).map((role) => {
    const t = profile.typography[role];
    return {
      name: STYLE_NAME(role),
      role,
      font_family: familyName(t.detectedFont, t.previewFont),
      font_style: fontStyle(t.weight, t.italic),
      fallback_family: fallbackFamily(t.classification, t.weight, t.italic),
      size_pt: t.size,
      leading_pt: t.leading,
      tracking: t.tracking,
      color: swatch(t.color) ?? "PF Ink",
      uppercase: !!t.uppercase,
      align: role === "body" ? ("justify" as const) : ("left" as const),
      first_line_indent_pt: role === "body" ? r2(t.size * 0.9) : undefined,
    };
  });

  const usedAssets = new Set<string>();
  const contractPages = pages.map((page, i) => {
    const n = i + 1;
    const article = articles.find((a) => a.id === page.articleId);
    const frames = [...page.elements]
      .filter((e) => !e.hidden)
      .sort((a, b) => a.z - b.z)
      .map((el) => frame(el, n, page, toc, name, issue, profile, swatch, usedAssets));
    const hero = page.elements.find((e) => e.kind === "image" && (e.role === "hero_image" || e.role === "image") && e.assetId);
    const pullQuotes = page.elements.filter((e) => e.role === "pullquote" && e.text).map((e) => plainText(e.text!).split("\n\n")[0].replace(/[“”]/g, ""));
    return {
      page_number: n,
      page_type: page.pageType,
      template_id: page.templateId,
      master: ["cover", "advertisement", "full_page_image"].includes(page.pageType) || page.templateId.includes("spread_photo") ? "B-NoFolio" : "A-Article",
      article_id: page.articleId,
      headline: page.elements.find((e) => e.role === "headline")?.text ?? article?.headline,
      subheadline: page.elements.find((e) => e.role === "deck")?.text ?? undefined,
      body: page.elements.filter((e) => e.role === "body" && !e.dynamic && e.text).map((e) => plainText(e.text!)).join("\n\n") || undefined,
      hero_image: hero?.assetId,
      columns: page.elements.find((e) => e.role === "body")?.columns ?? profile.grid.columns,
      pull_quotes: pullQuotes.length ? pullQuotes : undefined,
      caption: page.elements.find((e) => e.role === "caption" && e.text)?.text,
      approved: page.editorialStatus === "approved",
      frames,
    };
  });

  return {
    contract_version: "1.0" as const,
    generated_at: new Date().toISOString(),
    project_id: project.id,
    document: {
      title: project.title,
      issue: project.issueNumber,
      publication_date: project.publicationDate.slice(0, 10),
      page_width_pt: profile.page.widthPt,
      page_height_pt: profile.page.heightPt,
      bleed_pt: profile.page.bleedPt,
      facing_pages: true,
      margins: { ...profile.margins },
      columns: profile.grid.columns,
      gutter_pt: profile.grid.gutterPt,
      baseline_pt: profile.grid.baselinePt,
    },
    styles: {
      colors,
      paragraph: paragraph.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))),
      character: [{ name: "PF Lead Initial", font_style: "Bold", color: "PF Accent" }],
      object: [{ name: "PF Image", stroke_weight_pt: 0, text_wrap: "bounding_box" as const }],
    },
    masters: [
      { name: "A-Article", folio: { position: profile.folio.position, paragraph_style: STYLE_NAME("folio"), running_text: `${name} · ${issue}` } },
      { name: "B-NoFolio", folio: { position: "none" as const } },
    ],
    pages: contractPages.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))),
    assets: [...usedAssets].map((id) => {
      const a = assets[id];
      return { id, file: `${a?.kind === "ad" ? "ads" : "photos"}/${a?.fileName ?? `${id}.jpg`}`, width_px: a?.widthPx ?? 1, height_px: a?.heightPx ?? 1, credit: a?.credit };
    }),
  };
}

function frame(
  el: PageElement,
  pageNumber: number,
  page: MagazinePage,
  toc: ReturnType<typeof buildToc>,
  name: string,
  issue: string,
  profile: DesignProfile,
  swatch: (hex?: string) => string | undefined,
  used: Set<string>,
) {
  const bounds = [r2(el.y), r2(el.x), r2(el.y + el.h), r2(el.x + el.w)];
  const base = { id: el.id, label: el.name, role: el.role, bounds_pt: bounds, z: el.z };
  if (el.kind === "image") {
    if (el.assetId) used.add(el.assetId);
    return { ...base, kind: "image" as const, ...(el.assetId ? { image: { asset_id: el.assetId, fitting: "fill_proportionally" as const, scale: el.crop?.scale ?? 1, offset_x: el.crop?.offsetX ?? 0, offset_y: el.crop?.offsetY ?? 0 } } : {}), object_style: "PF Image" };
  }
  if (el.kind === "shape" || el.kind === "rule") return { ...base, kind: el.kind === "rule" ? ("rect" as const) : ("rect" as const), fill: swatch(el.fill) ?? el.fill, opacity: el.opacity };
  let content = plainText(el.text ?? "");
  if (el.dynamic === "folio") content = `${pageNumber}  ${name} · ${issue}`;
  if (el.dynamic === "toc") content = toc.map((t) => `${String(t.page).padStart(2, "0")}\t${t.kicker}\t${t.title}`).join("\n\n");
  const style = el.styleRole ?? "body";
  return {
    ...base,
    kind: "text" as const,
    paragraph_style: STYLE_NAME(style),
    content,
    ...(el.columns && el.columns > 1 ? { columns: el.columns, gutter_pt: el.gutter ?? profile.grid.gutterPt } : {}),
    fit: style === "headline" ? ("shrink_to_fit" as const) : ("none" as const),
  };
}

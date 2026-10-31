/**
 * Page composer: turns a template + design profile + approved content into
 * real, editable page elements (text frames, image frames, shapes) in points.
 */
import type {
  Article,
  Asset,
  DesignProfile,
  ExtractedFact,
  MagazinePage,
  PageElement,
  PageType,
  Project,
  SlotRole,
  Speaker,
  Template,
  TextRole,
} from "@/lib/domain/types";
import { estimateWordCapacity, liveArea, snapToColumns } from "./geometry";
import { templateSpecById, type FillKey, type SpecSlot, type TemplateSpec } from "./specs";

/* ------------------------------------------------------------------ */
/* Resolved geometry                                                   */
/* ------------------------------------------------------------------ */

export interface ResolvedSlot extends Omit<SpecSlot, "fx" | "fy" | "fw" | "fh" | "columns" | "snap" | "bleed"> {
  x: number;
  y: number;
  w: number;
  h: number;
  columns: number;
}

const TEXT_ROLES: TextRole[] = ["kicker", "headline", "deck", "byline", "body", "subhead", "pullquote", "caption", "folio", "question", "stat"];
const isTextRole = (r: SlotRole): r is TextRole => (TEXT_ROLES as string[]).includes(r);
const IMAGE_ROLES: SlotRole[] = ["hero_image", "image", "portrait"];

export type AnyTemplate = { kind: "spec"; spec: TemplateSpec } | { kind: "reference"; template: Template };

export function resolveTemplate(templateId: string, referenceTemplates: Template[]): AnyTemplate | undefined {
  const spec = templateSpecById[templateId];
  if (spec) return { kind: "spec", spec };
  const t = referenceTemplates.find((x) => x.id === templateId);
  return t ? { kind: "reference", template: t } : undefined;
}

export function resolveSlots(tpl: AnyTemplate, profile: DesignProfile, pageNumber: number): ResolvedSlot[] {
  const W = profile.page.widthPt;
  const H = profile.page.heightPt;
  const bleed = profile.page.bleedPt;
  const la = liveArea(profile, pageNumber);

  if (tpl.kind === "reference") {
    const counters: Record<string, number> = {};
    return tpl.template.slots.map((slot) => {
      const key = IMAGE_ROLES.includes(slot.role) ? "image" : slot.role;
      const index = counters[key] ?? 0;
      counters[key] = index + 1;
      return {
        id: slot.id,
        role: slot.role,
        x: slot.x * W,
        y: slot.y * H,
        w: slot.w * W,
        h: slot.h * H,
        columns: slot.columns ?? 1,
        index,
      };
    });
  }

  const { spec } = tpl;
  // Mirrored templates are laid out as their right-hand version, then flipped,
  // so the inside/outside margins land on the correct sides.
  const recto = la.recto;
  const layoutArea = spec.mirror && !recto ? liveArea(profile, pageNumber + 1) : la;
  return spec.slots.map((slot) => {
    const la = layoutArea;
    let x: number;
    let w: number;
    let columns = typeof slot.columns === "number" ? slot.columns : 1;
    if (slot.snap === false) {
      x = la.x + slot.fx * la.w;
      w = slot.fw * la.w;
    } else {
      const snapped = snapToColumns(profile, la, slot.fx, slot.fw);
      x = snapped.x;
      w = snapped.w;
      if (slot.columns === "auto") columns = snapped.columns;
    }
    let y = la.y + slot.fy * la.h;
    let h = slot.fh * la.h;
    if (slot.bleed?.top) {
      h += y + bleed;
      y = -bleed;
    }
    if (slot.bleed?.bottom) h = H + bleed - y;
    if (slot.bleed?.left) {
      w += x + bleed;
      x = -bleed;
    }
    if (slot.bleed?.right) w = W + bleed - x;
    if (spec.mirror && !recto) x = W - (x + w);
    const { fx: _fx, fy: _fy, fw: _fw, fh: _fh, snap: _snap, bleed: _bleed, columns: _columns, ...rest } = slot;
    return { ...rest, x, y, w, h, columns };
  });
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

export interface PageContent {
  masthead?: string;
  kicker?: string;
  headline?: string;
  deck?: string;
  byline?: string;
  bodyChunks: string[];
  images: (string | undefined)[];
  captions: (string | undefined)[];
  quotes: { text: string; attribution?: string }[];
  stats: { value: string; label: string }[];
  people: { portraitId?: string; name: string; detail: string }[];
  adAssetId?: string;
  credits?: string;
  coverLines?: string;
}

export const emptyContent = (): PageContent => ({ bodyChunks: [], images: [], captions: [], quotes: [], stats: [], people: [] });

export function fillColor(profile: DesignProfile, key: FillKey | undefined): string | undefined {
  if (!key) return undefined;
  const c = profile.colors;
  return { accent: c.accent, accentAlt: c.accentAlt, ink: c.ink, paper: c.paper, muted: c.muted, rule: c.rule, tint: c.palette[3] ?? "#F1F4F9" }[key];
}

const NAMES: Partial<Record<SlotRole, string>> = {
  hero_image: "Hero image",
  image: "Image",
  portrait: "Portrait",
  headline: "Headline",
  deck: "Standfirst",
  kicker: "Kicker",
  byline: "Byline",
  body: "Body text",
  pullquote: "Pull quote",
  caption: "Caption",
  stat: "Figure",
  background: "Background",
  accent_bar: "Accent bar",
  rule: "Rule",
  ad: "Advertisement",
  folio: "Folio",
};

export function buildElements(tpl: AnyTemplate, profile: DesignProfile, pageNumber: number, content: PageContent, pageType: PageType): PageElement[] {
  const slots = resolveSlots(tpl, profile, pageNumber);
  const elements: PageElement[] = [];
  let bodyIdx = 0;
  let quoteIdx = 0;
  let imageIdx = 0;
  const imageSlotAssets: (string | undefined)[] = [];
  const t = profile.typography;

  slots.forEach((slot, z) => {
    const base = { id: `el_${slot.id}`, role: slot.role, name: NAMES[slot.role] ?? slot.role, x: round(slot.x), y: round(slot.y), w: round(slot.w), h: round(slot.h), z };
    const styleRole: TextRole | undefined = slot.styleRole ?? (isTextRole(slot.role) ? slot.role : undefined);
    const style: PageElement["style"] = {};
    if (slot.sizeScale && styleRole) {
      style.size = +(t[styleRole].size * slot.sizeScale).toFixed(1);
      style.leading = +(t[styleRole].leading * slot.sizeScale).toFixed(1);
    }
    if (slot.lineHeight && styleRole) style.leading = +((style.size ?? t[styleRole].size) * slot.lineHeight).toFixed(1);
    const colour = fillColor(profile, slot.colorKey);
    if (colour) style.color = colour;
    if (slot.align) style.align = slot.align;
    const textEl = (text: string | undefined, extra: Partial<PageElement> = {}): void => {
      if (text === undefined) return;
      elements.push({ ...base, kind: "text", text, styleRole, style: Object.keys(style).length ? style : undefined, columns: slot.columns > 1 ? slot.columns : undefined, gutter: slot.columns > 1 ? profile.grid.gutterPt : undefined, ...extra });
    };

    switch (slot.role) {
      case "hero_image":
      case "image":
      case "portrait": {
        let assetId: string | undefined;
        if (pageType === "speaker_profile") assetId = content.people[slot.index ?? 0]?.portraitId;
        else assetId = content.images[imageIdx];
        imageIdx += 1;
        imageSlotAssets.push(assetId);
        if (pageType === "speaker_profile" && !content.people[slot.index ?? 0]) return;
        elements.push({ ...base, kind: "image", assetId, crop: { scale: 1, offsetX: 0, offsetY: slot.role === "portrait" || pageType === "interview" ? -0.2 : 0 } });
        return;
      }
      case "ad":
        elements.push({ ...base, kind: "image", assetId: content.adAssetId, crop: { scale: 1, offsetX: 0, offsetY: 0 } });
        return;
      case "background":
      case "accent_bar":
      case "rule":
        elements.push({ ...base, kind: slot.role === "rule" ? "rule" : "shape", fill: fillColor(profile, slot.fill) ?? profile.colors.rule, opacity: slot.opacity });
        return;
      case "headline":
        if (pageType === "cover" && slot.id === "mast") return textEl(content.masthead, { name: "Masthead" });
        return textEl(slot.fixedText ?? content.headline);
      case "kicker":
        return textEl(slot.fixedText ?? content.kicker);
      case "deck":
        if (slot.id === "lines") return textEl(content.coverLines, { name: "Cover lines" });
        if (slot.dynamic === "toc") return textEl("", { dynamic: "toc", name: "Contents list" });
        return textEl(content.deck || undefined);
      case "byline":
        return textEl(content.byline ? `By ${content.byline}` : undefined);
      case "body":
        if (slot.dynamic === "toc") return textEl("", { dynamic: "toc", name: "Contents list", styleRole: "deck" });
        return textEl(content.bodyChunks[bodyIdx++] ?? "", { name: slot.columns > 1 ? `Body text (${slot.columns} col)` : "Body text" });
      case "pullquote": {
        const q = content.quotes[quoteIdx++];
        if (!q) return;
        return textEl(`“${q.text.replace(/^[“"]|[”"]$/g, "")}”${q.attribution ? `\n\n— ${q.attribution}` : ""}`);
      }
      case "stat": {
        const st = content.stats[slot.index ?? 0];
        if (!st) return;
        return textEl(st.value, { name: "Figure" });
      }
      case "caption": {
        const i = slot.index ?? 0;
        if (i === 99) return textEl(content.credits, { name: "Issue credits" });
        if (i >= 200) {
          const person = content.people[i - 200];
          return person ? textEl(`${person.name}\n\n${person.detail}`, { name: "Name & designation" }) : undefined;
        }
        if (i >= 100) {
          const st = content.stats[i - 100];
          return st ? textEl(st.label, { name: "Figure label" }) : undefined;
        }
        const assetId = imageSlotAssets[i] ?? content.images[i];
        if (!assetId) return;
        return textEl(content.captions[i] ?? "");
      }
      default:
        return;
    }
  });

  if (tpl.kind === "reference" || (tpl.kind === "spec" && tpl.spec.folio !== false)) {
    elements.push(folioElement(profile, pageNumber, elements.length));
  }
  if (content.adAssetId && !elements.some((e) => e.role === "ad")) {
    // Reference templates may not have an ad slot; never drop a booked ad silently.
    elements.unshift({ id: "el_ad", kind: "image", role: "ad", name: "Advertisement", x: -profile.page.bleedPt, y: -profile.page.bleedPt, w: profile.page.widthPt + 2 * profile.page.bleedPt, h: profile.page.heightPt + 2 * profile.page.bleedPt, z: -1, assetId: content.adAssetId });
  }
  return elements;
}

export function folioElement(profile: DesignProfile, pageNumber: number, z: number): PageElement {
  const la = liveArea(profile, pageNumber);
  const w = 320;
  const y = profile.folio.position === "top_outside" ? Math.max(14, profile.margins.top - 30) : profile.page.heightPt - profile.margins.bottom + 22;
  const center = profile.folio.position === "bottom_center";
  const x = center ? (profile.page.widthPt - w) / 2 : la.recto ? la.x + la.w - w : la.x;
  return {
    id: "el_folio",
    kind: "text",
    role: "folio",
    name: "Folio",
    x: round(x),
    y: round(y),
    w,
    h: 12,
    z,
    dynamic: "folio",
    text: "",
    styleRole: "folio",
    style: { align: center ? "center" : la.recto ? "right" : "left" },
    locked: true,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Article text                                                        */
/* ------------------------------------------------------------------ */

/**
 * Lightweight markup used inside text frames:
 *   "^ "  lead paragraph (drop cap)   "## " subhead   "Q: " question
 *   "• "  list item                    "> "  inline quotation   "— " attribution
 */
export function articleParagraphs(article: Article, speakers: Speaker[], inlineQuoteIds: Set<string>): string[] {
  const out: string[] = [];
  if (article.intro) out.push(`^ ${article.intro}`);
  for (const b of article.body) {
    switch (b.kind) {
      case "paragraph":
      case "answer":
        out.push(b.text);
        break;
      case "subhead":
        out.push(`## ${b.text}`);
        break;
      case "question":
        out.push(`Q: ${b.text}`);
        break;
      case "list_item":
        out.push(`• ${b.text}`);
        break;
      case "quote":
        if (inlineQuoteIds.has(b.id)) {
          const who = speakers.find((s) => s.id === b.speakerId)?.name;
          out.push(`> “${b.text}”${who ? ` — ${who}` : ""}`);
        }
        break;
    }
  }
  return out;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const paragraphCost = (p: string) => words(p) + (p.startsWith("## ") || p.startsWith("Q: ") ? 10 : 3);

/** Greedy distribution of paragraphs over body frames by estimated capacity. */
export function distributeParagraphs(paragraphs: string[], capacities: number[]): string[][] {
  const chunks: string[][] = capacities.map(() => []);
  if (capacities.length === 0) return chunks;
  const queue = [...paragraphs];
  for (let i = 0; i < capacities.length; i += 1) {
    const isLast = i === capacities.length - 1;
    if (isLast) {
      chunks[i].push(...queue.splice(0));
      break;
    }
    let remaining = capacities[i];
    while (queue.length) {
      const p = queue[0];
      const cost = paragraphCost(p);
      if (cost <= remaining) {
        chunks[i].push(queue.shift()!);
        remaining -= cost;
        continue;
      }
      // Split long paragraphs at a sentence boundary when there's useful room.
      if (remaining >= 28 && !p.startsWith("## ") && !p.startsWith("Q: ")) {
        const sentences = p.match(/[^.!?]+[.!?]+["”’)]*\s*/g) ?? [p];
        let head = "";
        while (sentences.length && words(head + sentences[0]) <= remaining - 3) head += sentences.shift();
        if (head.trim() && sentences.length) {
          chunks[i].push(head.trim());
          const prefix = p.startsWith("^ ") ? "" : "";
          queue[0] = prefix + sentences.join("").trim();
        }
      }
      // A subhead never ends a frame.
      const last = chunks[i][chunks[i].length - 1];
      if (last?.startsWith("## ")) queue.unshift(chunks[i].pop()!);
      break;
    }
  }
  return chunks;
}

/**
 * Earlier pages fill completely; the last page's frames share whatever text
 * remains in proportion to their size, so no frame is left empty.
 */
export function balancedCapacities(capacities: number[][], totalWords: number): number[] {
  const flat = capacities.flat();
  const lastIndex = capacities.length - 1;
  const lastCaps = capacities[lastIndex] ?? [];
  if (lastCaps.length < 2) return flat;
  const before = capacities.slice(0, lastIndex).flat().reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, totalWords - before);
  const lastTotal = lastCaps.reduce((a, b) => a + b, 0);
  if (remaining >= lastTotal) return flat;
  const ratio = remaining / lastTotal;
  return [...capacities.slice(0, lastIndex).flat(), ...lastCaps.map((c) => Math.ceil(c * ratio) + 4)];
}

export function bodyCapacities(tpl: AnyTemplate, profile: DesignProfile, pageNumber: number): number[] {
  const body = profile.typography.body;
  return resolveSlots(tpl, profile, pageNumber)
    .filter((s) => s.role === "body" && !s.dynamic)
    .map((s) => estimateWordCapacity(s.w, s.h, s.columns, profile.grid.gutterPt, body.size * (s.sizeScale ?? 1), body.leading * (s.sizeScale ?? 1)));
}

export function countSlots(tpl: AnyTemplate, profile: DesignProfile, pageNumber: number, roles: SlotRole[]): number {
  return resolveSlots(tpl, profile, pageNumber).filter((s) => roles.includes(s.role)).length;
}

/* ------------------------------------------------------------------ */
/* Magazine composition                                                */
/* ------------------------------------------------------------------ */

export interface PlanEntry {
  id?: string;
  pageType: PageType;
  templateId: string;
  label: string;
  articleId?: string;
  adAssetId?: string;
  imageIds?: string[];
  locked?: boolean;
}

export interface ComposeContext {
  profile: DesignProfile;
  project: Project;
  articles: Article[];
  speakers: Speaker[];
  facts: ExtractedFact[];
  assets: Asset[];
  referenceTemplates: Template[];
  imagePreference?: Project["config"]["imagePreference"];
}

const tagPreference: Record<NonNullable<Project["config"]["imagePreference"]>, string[]> = {
  speakers_first: ["speaker", "panel", "stage", "award", "audience"],
  stage_wide: ["stage", "panel", "audience", "speaker", "award"],
  balanced: ["panel", "speaker", "stage", "audience", "award"],
  audience: ["audience", "networking", "stage", "panel", "speaker"],
};

function pickFallbackImages(ctx: ComposeContext, article: Article | undefined, count: number, used: Set<string>): string[] {
  const order = tagPreference[ctx.imagePreference ?? "speakers_first"];
  const pool = ctx.assets
    .filter((a) => (a.kind === "photo" || a.kind === "video_frame") && !used.has(a.id))
    .filter((a) => !article || article.sessionIds.length === 0 || (a.sessionId && article.sessionIds.includes(a.sessionId)) || !a.sessionId);
  pool.sort((a, b) => {
    const ra = order.indexOf(a.tags[0] ?? "");
    const rb = order.indexOf(b.tags[0] ?? "");
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb) || a.id.localeCompare(b.id);
  });
  return pool.slice(0, count).map((a) => a.id);
}

function speakerDetail(s: Speaker) {
  return [s.designation, s.organisation].filter(Boolean).join(", ");
}

/** Compose all pages for one article across its planned page slots. */
function composeArticle(article: Article, entries: { entry: PlanEntry; pageNumber: number }[], ctx: ComposeContext, used: Set<string>): MagazinePage[] {
  const tpls = entries.map(({ entry }) => resolveTemplate(entry.templateId, ctx.referenceTemplates));
  const capacities = entries.map(({ pageNumber }, i) => (tpls[i] ? bodyCapacities(tpls[i]!, ctx.profile, pageNumber) : []));
  const pqSlots = entries.map(({ pageNumber }, i) => (tpls[i] ? countSlots(tpls[i]!, ctx.profile, pageNumber, ["pullquote"]) : 0));
  const imageSlots = entries.map(({ pageNumber }, i) => (tpls[i] ? countSlots(tpls[i]!, ctx.profile, pageNumber, ["hero_image", "image", "portrait"]) : 0));

  // Pull quotes: quote blocks first, then approved quote facts.
  const quoteBlocks = article.body.filter((b) => b.kind === "quote");
  const factQuotes = article.quoteFactIds
    .map((id) => ctx.facts.find((f) => f.id === id))
    .filter((f): f is ExtractedFact => !!f && f.status !== "rejected" && !quoteBlocks.some((b) => b.text === f.text));
  const quotePool = [
    ...quoteBlocks.map((b) => ({ id: b.id, text: b.text, speakerId: b.speakerId })),
    ...factQuotes.map((f) => ({ id: f.id, text: f.text, speakerId: f.speakerId })),
  ];
  const totalPq = pqSlots.reduce((a, b) => a + b, 0);
  const asPull = quotePool.slice(0, totalPq);
  const inline = new Set(quoteBlocks.filter((b) => !asPull.some((q) => q.id === b.id)).map((b) => b.id));

  const paragraphs = articleParagraphs(article, ctx.speakers, inline);
  const chunks = distributeParagraphs(paragraphs, balancedCapacities(capacities, paragraphs.reduce((n, p) => n + paragraphCost(p), 0)));

  // Images: suggested first, then best-matching session photographs.
  const neededImages = imageSlots.reduce((a, b) => a + b, 0);
  const suggested = article.suggestedImageIds.filter((id) => !used.has(id));
  const images = [...suggested, ...pickFallbackImages(ctx, article, Math.max(0, neededImages - suggested.length), new Set([...used, ...suggested]))].slice(0, neededImages);
  images.forEach((id) => used.add(id));

  let chunkCursor = 0;
  let quoteCursor = 0;
  let imageCursor = 0;
  return entries.map(({ entry, pageNumber }, part) => {
    const tpl = tpls[part];
    const bodyCount = capacities[part].length;
    const pageImages = images.slice(imageCursor, imageCursor + imageSlots[part]);
    imageCursor += imageSlots[part];
    const pageQuotes = asPull.slice(quoteCursor, quoteCursor + pqSlots[part]).map((q) => ({ text: q.text, attribution: ctx.speakers.find((s) => s.id === q.speakerId)?.name }));
    quoteCursor += pqSlots[part];
    const content: PageContent = {
      ...emptyContent(),
      kicker: article.kicker,
      headline: article.headline,
      deck: article.subheadline,
      byline: article.byline,
      bodyChunks: chunks.slice(chunkCursor, chunkCursor + bodyCount).map((c) => c.join("\n\n")),
      images: pageImages,
      captions: pageImages.map((id) => (id ? article.captions[id] ?? ctx.assets.find((a) => a.id === id)?.caption : undefined)),
      quotes: pageQuotes,
    };
    chunkCursor += bodyCount;

    if (entry.pageType === "speaker_profile" || article.type === "speaker_profiles") {
      const people = article.speakerIds.slice(part * 12, part * 12 + 12).map((id) => ctx.speakers.find((s) => s.id === id)).filter((s): s is Speaker => !!s);
      content.people = people.map((s) => ({ portraitId: s.portraitAssetId, name: s.name, detail: speakerDetail(s) }));
      content.deck = part === 0 ? article.subheadline : undefined;
    }
    if (entry.pageType === "infographic") {
      content.stats = article.body
        .filter((b) => b.kind === "list_item" && b.text.includes("|"))
        .map((b) => {
          const [value, label] = b.text.split("|").map((x) => x.trim());
          return { value, label };
        });
      content.deck = article.intro;
    }
    if (part > 0 && entry.pageType !== "photo_gallery" && entry.pageType !== "speaker_profile") {
      content.headline = undefined;
      content.kicker = undefined;
      content.deck = undefined;
      content.byline = undefined;
    }

    const elements = tpl ? buildElements(tpl, ctx.profile, pageNumber, content, entry.pageType) : [];
    return {
      id: entry.id ?? `pg_${pageNumber}_${entry.templateId}`,
      projectId: ctx.project.id,
      pageType: entry.pageType,
      templateId: entry.templateId,
      label: entry.label,
      articleId: article.id,
      articlePart: part,
      elements,
      editorialStatus: article.status === "approved" ? "approved" : "pending",
      designStatus: "in_progress",
      locked: entry.locked ?? false,
    } satisfies MagazinePage;
  });
}

function composeStandalone(entry: PlanEntry, pageNumber: number, ctx: ComposeContext, used: Set<string>): MagazinePage {
  const tpl = resolveTemplate(entry.templateId, ctx.referenceTemplates);
  const content = emptyContent();
  const p = ctx.project;
  if (entry.pageType === "cover") {
    const lead = ctx.articles.find((a) => a.type === "event_report" && a.status === "approved") ?? ctx.articles[0];
    const lines = ctx.articles
      .filter((a) => ["keynote", "panel", "interview", "tech_feature"].includes(a.type))
      .slice(0, 4)
      .map((a) => `${(a.kicker ?? "").split("·").pop()?.trim().toUpperCase()}\n${a.headline.replace(/[“”]/g, "")}`);
    content.masthead = p.title.split(/\s+[—–-]\s+/)[0].trim() || p.title;
    content.headline = lead?.headline;
    content.deck = p.eventName + " · Special Issue";
    content.kicker = `${p.issueNumber} · ${new Date(p.publicationDate).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;
    content.coverLines = lines.join("\n\n");
    content.images = entry.imageIds ?? pickFallbackImages(ctx, undefined, 1, used);
  } else if (entry.pageType === "toc") {
    content.images = entry.imageIds ?? pickFallbackImages(ctx, undefined, 1, used);
    content.captions = content.images.map((id) => ctx.assets.find((a) => a.id === id)?.caption);
    content.credits = `${p.title}\n\n${p.issueNumber}\n\nPublished by ${p.publisher}\n\nAll quotations in this issue are linked to the session recordings in which they were spoken.`;
  } else if (entry.pageType === "advertisement") {
    content.adAssetId = entry.adAssetId;
  } else {
    content.images = entry.imageIds ?? pickFallbackImages(ctx, undefined, 1, used);
    content.captions = content.images.map((id) => ctx.assets.find((a) => a.id === id)?.caption);
  }
  content.images.forEach((id) => id && used.add(id));
  return {
    id: entry.id ?? `pg_${pageNumber}_${entry.templateId}`,
    projectId: p.id,
    pageType: entry.pageType,
    templateId: entry.templateId,
    label: entry.label,
    elements: tpl ? buildElements(tpl, ctx.profile, pageNumber, content, entry.pageType) : [],
    editorialStatus: "approved",
    designStatus: entry.pageType === "advertisement" ? "ready" : "in_progress",
    locked: entry.locked ?? false,
  };
}

/** Compose a whole flatplan. Pages of one article are composed together so text flows between them. */
export function composeMagazine(plan: PlanEntry[], ctx: ComposeContext): MagazinePage[] {
  const used = new Set<string>();
  plan.forEach((e) => e.imageIds?.forEach((id) => used.add(id)));
  const out: MagazinePage[] = new Array(plan.length);
  const byArticle = new Map<string, { entry: PlanEntry; pageNumber: number; index: number }[]>();
  plan.forEach((entry, index) => {
    if (entry.articleId) {
      const list = byArticle.get(entry.articleId) ?? [];
      list.push({ entry, pageNumber: index + 1, index });
      byArticle.set(entry.articleId, list);
    }
  });
  // Standalone pages first so their hand-picked images are reserved.
  plan.forEach((entry, index) => {
    if (!entry.articleId) out[index] = composeStandalone(entry, index + 1, ctx, used);
  });
  for (const [articleId, entries] of byArticle) {
    const article = ctx.articles.find((a) => a.id === articleId);
    if (!article) {
      entries.forEach(({ entry, pageNumber, index }) => (out[index] = composeStandalone(entry, pageNumber, ctx, used)));
      continue;
    }
    const pages = composeArticle(article, entries, ctx, used);
    entries.forEach(({ index }, i) => (out[index] = pages[i]));
  }
  return out;
}

/** Re-compose one article's pages in place (e.g. after a template change or text edit). */
export function recomposeArticlePages(pages: MagazinePage[], articleId: string, ctx: ComposeContext): MagazinePage[] {
  const article = ctx.articles.find((a) => a.id === articleId);
  if (!article) return pages;
  const entries = pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => page.articleId === articleId && !page.locked)
    .map(({ page, index }) => ({ entry: { id: page.id, pageType: page.pageType, templateId: page.templateId, label: page.label, articleId }, pageNumber: index + 1, index }));
  if (!entries.length) return pages;
  const used = new Set<string>();
  pages.forEach((p) => p.articleId !== articleId && p.elements.forEach((e) => e.assetId && used.add(e.assetId)));
  const composed = composeArticle(article, entries, ctx, used);
  const next = [...pages];
  entries.forEach(({ index }, i) => {
    next[index] = { ...composed[i], designStatus: pages[index].designStatus, notes: pages[index].notes, articlePart: composed[i].articlePart };
  });
  return next;
}

export function recomposeStandalonePage(page: MagazinePage, pageNumber: number, ctx: ComposeContext): MagazinePage {
  const keepImages = page.elements.filter((e) => e.kind === "image" && e.role !== "ad" && e.assetId).map((e) => e.assetId!);
  const ad = page.elements.find((e) => e.role === "ad")?.assetId;
  const composed = composeStandalone({ id: page.id, pageType: page.pageType, templateId: page.templateId, label: page.label, imageIds: keepImages.length ? keepImages : undefined, adAssetId: ad }, pageNumber, ctx, new Set());
  return { ...composed, designStatus: page.designStatus, notes: page.notes, locked: page.locked };
}

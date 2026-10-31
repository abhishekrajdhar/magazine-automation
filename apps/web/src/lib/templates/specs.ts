/**
 * Built-in template archetypes. Geometry is expressed in fractions of the live
 * area and snapped to the active design profile's column grid at compose time,
 * so the same archetype reproduces a 2-, 3- or 4-column reference faithfully.
 */
import type { PageType, SlotRole, TextRole } from "@/lib/domain/types";

export type FillKey = "accent" | "accentAlt" | "ink" | "paper" | "muted" | "rule" | "tint";

export interface SpecSlot {
  id: string;
  role: SlotRole;
  styleRole?: TextRole;
  fx: number;
  fy: number;
  fw: number;
  fh: number;
  /** Snap horizontal span to the column grid (default true). */
  snap?: boolean;
  bleed?: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean };
  /** Text columns; "auto" = number of grid columns spanned. */
  columns?: number | "auto";
  /** nth image / quote / stat / speaker this slot shows. */
  index?: number;
  fill?: FillKey;
  opacity?: number;
  /** Multiplier on the profile's size for this style role. */
  sizeScale?: number;
  /** Leading as a ratio of the (scaled) size, for display type. */
  lineHeight?: number;
  colorKey?: FillKey;
  align?: "left" | "center" | "right" | "justify";
  /** Fixed copy for furniture such as "Contents". */
  fixedText?: string;
  dynamic?: "toc";
}

export interface TemplateSpec {
  id: string;
  name: string;
  pageType: PageType;
  description: string;
  /** Opener templates start an article; continuation templates carry on. */
  position: "opener" | "continuation" | "single";
  slots: SpecSlot[];
  folio?: boolean;
  /** Mirror horizontally on left-hand (even) pages. */
  mirror?: boolean;
}

const s = (id: string, role: SlotRole, fx: number, fy: number, fw: number, fh: number, extra: Partial<SpecSlot> = {}): SpecSlot => ({ id, role, fx, fy, fw, fh, ...extra });

const ALL_BLEED = { top: true, bottom: true, left: true, right: true };

export const templateSpecs: TemplateSpec[] = [
  {
    id: "tpl_cover_fullbleed",
    name: "Cover — full-bleed photograph",
    pageType: "cover",
    position: "single",
    description: "Masthead over a full-bleed image with lead headline and cover lines, as on the reference cover.",
    folio: false,
    slots: [
      s("bg", "hero_image", 0, 0, 1, 1, { bleed: ALL_BLEED, snap: false, index: 0 }),
      s("scrim", "background", 0, 0.52, 1, 0.48, { bleed: { bottom: true, left: true, right: true }, snap: false, fill: "ink", opacity: 0.62 }),
      s("mast", "headline", 0, 0, 0.8, 0.16, { snap: false, sizeScale: 3.4, lineHeight: 0.92, colorKey: "paper" }),
      s("issue", "kicker", 0, 0.165, 0.8, 0.025, { snap: false, colorKey: "paper" }),
      s("lines", "deck", 0.66, 0.22, 0.34, 0.36, { snap: false, sizeScale: 0.82, colorKey: "paper" }),
      s("bar", "accent_bar", 0, 0.655, 0.12, 0.006, { snap: false, fill: "accentAlt" }),
      s("headline", "headline", 0, 0.675, 0.9, 0.16, { snap: false, sizeScale: 1.32, colorKey: "paper" }),
      s("deck", "deck", 0, 0.84, 0.78, 0.08, { snap: false, colorKey: "paper" }),
    ],
  },
  {
    id: "tpl_toc_classic",
    name: "Contents — list with feature image",
    pageType: "toc",
    position: "single",
    description: "Two-column contents list generated from the flatplan, with a feature image and issue credits.",
    slots: [
      s("kicker", "kicker", 0, 0, 0.6, 0.02, { fixedText: "In this issue" }),
      s("title", "headline", 0, 0.026, 0.6, 0.075, { fixedText: "Contents" }),
      s("rule", "rule", 0, 0.11, 1, 0.002, { fill: "ink" }),
      s("toc", "body", 0, 0.135, 0.62, 0.86, { styleRole: "deck", dynamic: "toc", columns: 1 }),
      s("img", "image", 0.68, 0.135, 0.32, 0.34, { index: 0 }),
      s("cap", "caption", 0.68, 0.48, 0.32, 0.04, { index: 0 }),
      s("credits", "caption", 0.68, 0.56, 0.32, 0.3, { index: 99 }),
    ],
  },
  {
    id: "tpl_editorial_portrait",
    name: "Editorial — portrait and two columns",
    pageType: "editorial",
    position: "single",
    description: "Editor's note with portrait, pull quote and two-column body.",
    slots: [
      s("kicker", "kicker", 0, 0, 0.6, 0.02),
      s("headline", "headline", 0, 0.028, 1, 0.085),
      s("deck", "deck", 0, 0.12, 0.85, 0.065),
      s("rule", "rule", 0, 0.198, 1, 0.0015, { fill: "rule" }),
      s("portrait", "portrait", 0, 0.225, 0.333, 0.2, { index: 0 }),
      s("byline", "byline", 0, 0.432, 0.333, 0.03),
      s("pq", "pullquote", 0, 0.5, 0.333, 0.24, { index: 0 }),
      s("body", "body", 0.34, 0.225, 0.66, 0.775, { columns: "auto", sizeScale: 1.12 }),
    ],
  },
  {
    id: "tpl_report_hero",
    name: "Event report — hero opener",
    pageType: "event_report",
    position: "opener",
    description: "Full-width bleed hero, headline block and three-column body: the reference's event-report opener.",
    slots: [
      s("hero", "hero_image", 0, 0, 1, 0.44, { bleed: { top: true, left: true, right: true }, snap: false, index: 0 }),
      s("cap", "caption", 0, 0.448, 0.667, 0.024, { index: 0 }),
      s("kicker", "kicker", 0, 0.486, 0.667, 0.018),
      s("headline", "headline", 0, 0.506, 1, 0.105),
      s("deck", "deck", 0, 0.615, 0.9, 0.066),
      s("byline", "byline", 0, 0.686, 0.6, 0.017),
      s("rule", "rule", 0, 0.709, 1, 0.0015, { fill: "rule" }),
      s("body", "body", 0, 0.724, 1, 0.276, { columns: "auto" }),
    ],
  },
  {
    id: "tpl_report_split",
    name: "Event report — split opener",
    pageType: "event_report",
    position: "opener",
    description: "Half-page bleed image on the outside edge, headline and single-column body on the inside.",
    mirror: true,
    slots: [
      s("hero", "hero_image", 0.53, 0, 0.47, 1, { bleed: { top: true, bottom: true, right: true }, snap: false, index: 0 }),
      s("cap", "caption", 0.56, 0.93, 0.4, 0.05, { snap: false, index: 0, colorKey: "paper" }),
      s("kicker", "kicker", 0, 0, 0.48, 0.02, { snap: false }),
      s("headline", "headline", 0, 0.028, 0.48, 0.24, { snap: false, sizeScale: 0.95 }),
      s("deck", "deck", 0, 0.275, 0.48, 0.11, { snap: false }),
      s("byline", "byline", 0, 0.392, 0.48, 0.02, { snap: false }),
      s("body", "body", 0, 0.43, 0.48, 0.57, { snap: false, columns: 1 }),
    ],
  },
  {
    id: "tpl_spread_photo_opener",
    name: "Spread opener — photograph with title",
    pageType: "event_report",
    position: "opener",
    description: "Left-hand full-bleed photograph carrying the kicker, headline and standfirst; text continues on the facing page.",
    folio: false,
    slots: [
      s("hero", "hero_image", 0, 0, 1, 1, { bleed: ALL_BLEED, snap: false, index: 0 }),
      s("scrim", "background", 0, 0.5, 1, 0.5, { bleed: { bottom: true, left: true, right: true }, snap: false, fill: "ink", opacity: 0.6 }),
      s("kicker", "kicker", 0, 0.57, 0.8, 0.022, { snap: false, colorKey: "paper" }),
      s("bar", "accent_bar", 0, 0.6, 0.1, 0.005, { snap: false, fill: "accentAlt" }),
      s("headline", "headline", 0, 0.62, 0.95, 0.2, { snap: false, sizeScale: 1.18, lineHeight: 1.05, colorKey: "paper" }),
      s("deck", "deck", 0, 0.83, 0.85, 0.09, { snap: false, colorKey: "paper" }),
      s("byline", "byline", 0, 0.94, 0.6, 0.02, { snap: false, colorKey: "paper" }),
    ],
  },
  {
    id: "tpl_spread_text",
    name: "Spread text page — image, quote band, body",
    pageType: "two_column_article",
    position: "continuation",
    description: "Facing page for a spread opener: image, pull-quote band and three-column body.",
    slots: [
      s("img", "image", 0, 0, 1, 0.4, { index: 0 }),
      s("cap", "caption", 0, 0.405, 0.667, 0.026, { index: 0 }),
      s("rule", "rule", 0, 0.452, 0.2, 0.003, { fill: "accent" }),
      s("pq", "pullquote", 0, 0.468, 1, 0.1, { index: 0, sizeScale: 1.15 }),
      s("body", "body", 0, 0.6, 1, 0.4, { columns: "auto" }),
    ],
  },
  {
    id: "tpl_feature_opener",
    name: "Feature — headline-first opener",
    pageType: "two_column_article",
    position: "opener",
    description: "Large headline block over a grid-width image and three-column body.",
    slots: [
      s("kicker", "kicker", 0, 0, 0.6, 0.02),
      s("headline", "headline", 0, 0.026, 0.95, 0.15, { sizeScale: 1.12 }),
      s("deck", "deck", 0, 0.18, 0.85, 0.07),
      s("byline", "byline", 0, 0.255, 0.6, 0.02),
      s("img", "image", 0, 0.29, 1, 0.33, { index: 0 }),
      s("cap", "caption", 0, 0.627, 0.667, 0.025, { index: 0 }),
      s("body", "body", 0, 0.665, 1, 0.335, { columns: "auto" }),
    ],
  },
  {
    id: "tpl_article_image",
    name: "Article — image and pull quote",
    pageType: "two_column_article",
    position: "continuation",
    description: "Continuation page with a two-column image, side pull quote and three-column body.",
    slots: [
      s("img", "image", 0, 0, 0.667, 0.38, { index: 0 }),
      s("cap", "caption", 0, 0.386, 0.667, 0.026, { index: 0 }),
      s("pq", "pullquote", 0.667, 0, 0.333, 0.38, { index: 0 }),
      s("body", "body", 0, 0.43, 1, 0.57, { columns: "auto" }),
    ],
  },
  {
    id: "tpl_article_quote",
    name: "Article — text with quote band",
    pageType: "two_column_article",
    position: "continuation",
    description: "Text-led continuation with a full-width pull quote band between two body blocks.",
    slots: [
      s("body", "body", 0, 0, 1, 0.44, { columns: "auto" }),
      s("rule1", "rule", 0, 0.462, 0.2, 0.003, { fill: "accent" }),
      s("pq", "pullquote", 0, 0.478, 1, 0.1, { index: 0, sizeScale: 1.2 }),
      s("body2", "body", 0, 0.605, 1, 0.395, { columns: "auto" }),
    ],
  },
  {
    id: "tpl_article_image_heavy",
    name: "Article — image-led continuation",
    pageType: "two_column_article",
    position: "continuation",
    description: "For short continuations: large image with caption and a shorter body block.",
    slots: [
      s("img", "image", 0, 0, 1, 0.52, { index: 0 }),
      s("cap", "caption", 0, 0.527, 0.667, 0.026, { index: 0 }),
      s("pq", "pullquote", 0, 0.585, 0.333, 0.3, { index: 0 }),
      s("body", "body", 0.333, 0.585, 0.667, 0.415, { columns: "auto" }),
    ],
  },
  {
    id: "tpl_interview_opener",
    name: "Interview — portrait opener",
    pageType: "interview",
    position: "opener",
    description: "Large portrait on the outside edge, headline beside it and Q&A body below.",
    mirror: true,
    slots: [
      s("portrait", "hero_image", 0.52, 0, 0.48, 0.62, { bleed: { top: true, right: true }, snap: false, index: 0 }),
      s("kicker", "kicker", 0, 0, 0.47, 0.02, { snap: false }),
      s("headline", "headline", 0, 0.028, 0.47, 0.32, { snap: false, sizeScale: 0.8 }),
      s("deck", "deck", 0, 0.36, 0.47, 0.15, { snap: false }),
      s("byline", "byline", 0, 0.52, 0.47, 0.02, { snap: false }),
      s("cap", "caption", 0.52, 0.627, 0.48, 0.024, { snap: false, index: 0 }),
      s("body", "body", 0, 0.68, 1, 0.32, { columns: "auto" }),
    ],
  },
  {
    id: "tpl_interview_qa",
    name: "Interview — Q&A continuation",
    pageType: "interview",
    position: "continuation",
    description: "Two-column Q&A with a side portrait and pull quote.",
    slots: [
      s("body", "body", 0, 0, 0.667, 1, { columns: "auto" }),
      s("img", "portrait", 0.667, 0, 0.333, 0.26, { index: 0 }),
      s("cap", "caption", 0.667, 0.266, 0.333, 0.03, { index: 0 }),
      s("pq", "pullquote", 0.667, 0.34, 0.333, 0.3, { index: 0 }),
    ],
  },
  {
    id: "tpl_perspective_single",
    name: "Perspective — single page",
    pageType: "two_column_article",
    position: "single",
    description: "One-page perspective: accent bar, headline block, grid-width image, two-column body and side quote.",
    slots: [
      s("bar", "accent_bar", 0, 0, 0.1, 0.004, { fill: "accent", snap: false }),
      s("kicker", "kicker", 0, 0.014, 0.6, 0.02),
      s("headline", "headline", 0, 0.04, 1, 0.1, { sizeScale: 0.92 }),
      s("deck", "deck", 0, 0.145, 0.85, 0.065),
      s("byline", "byline", 0, 0.215, 0.6, 0.018),
      s("img", "image", 0, 0.25, 1, 0.33, { index: 0 }),
      s("cap", "caption", 0, 0.586, 0.667, 0.026, { index: 0 }),
      s("body", "body", 0, 0.63, 0.667, 0.37, { columns: "auto" }),
      s("pq", "pullquote", 0.667, 0.63, 0.333, 0.3, { index: 0 }),
    ],
  },
  {
    id: "tpl_gallery_grid",
    name: "Gallery — six-image grid",
    pageType: "photo_gallery",
    position: "opener",
    description: "Headline and a two-by-three grid of captioned photographs.",
    slots: [
      s("kicker", "kicker", 0, 0, 0.6, 0.02),
      s("headline", "headline", 0, 0.026, 1, 0.065, { sizeScale: 0.85 }),
      s("deck", "deck", 0, 0.094, 0.9, 0.035),
      ...Array.from({ length: 6 }, (_, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        return [
          s(`img${i}`, "image" as SlotRole, col * 0.515, 0.15 + row * 0.285, 0.485, 0.235, { snap: false, index: i }),
          s(`cap${i}`, "caption" as SlotRole, col * 0.515, 0.389 + row * 0.285, 0.485, 0.035, { snap: false, index: i }),
        ];
      }).flat(),
    ],
  },
  {
    id: "tpl_gallery_mosaic",
    name: "Gallery — feature mosaic",
    pageType: "photo_gallery",
    position: "continuation",
    description: "One large bleed photograph over a row of three.",
    slots: [
      s("img0", "image", 0, 0, 1, 0.54, { bleed: { top: true, left: true, right: true }, snap: false, index: 0 }),
      s("cap0", "caption", 0, 0.548, 0.667, 0.025, { index: 0 }),
      ...Array.from({ length: 3 }, (_, i) => [
        s(`img${i + 1}`, "image" as SlotRole, i * 0.345, 0.6, 0.31, 0.3, { snap: false, index: i + 1 }),
        s(`cap${i + 1}`, "caption" as SlotRole, i * 0.345, 0.906, 0.31, 0.06, { snap: false, index: i + 1 }),
      ]).flat(),
    ],
  },
  {
    id: "tpl_full_image",
    name: "Full-page photograph",
    pageType: "full_page_image",
    position: "single",
    description: "Edge-to-edge photograph with an overlaid caption.",
    folio: false,
    slots: [
      s("img", "hero_image", 0, 0, 1, 1, { bleed: ALL_BLEED, snap: false, index: 0 }),
      s("scrim", "background", 0, 0.86, 1, 0.14, { bleed: { bottom: true, left: true, right: true }, snap: false, fill: "ink", opacity: 0.55 }),
      s("cap", "caption", 0, 0.9, 0.7, 0.06, { snap: false, index: 0, colorKey: "paper", sizeScale: 1.3 }),
    ],
  },
  {
    id: "tpl_ad_full",
    name: "Advertisement — full page",
    pageType: "advertisement",
    position: "single",
    description: "Full-page advertisement placed to bleed.",
    folio: false,
    slots: [s("ad", "ad", 0, 0, 1, 1, { bleed: ALL_BLEED, snap: false, index: 0 })],
  },
  {
    id: "tpl_infographic_stats",
    name: "Infographic — key figures",
    pageType: "infographic",
    position: "single",
    description: "Headline and a grid of sourced figures with labels.",
    slots: [
      s("tint", "background", 0, 0.17, 1, 0.83, { fill: "tint", snap: false }),
      s("kicker", "kicker", 0, 0, 0.6, 0.02),
      s("headline", "headline", 0, 0.026, 1, 0.075),
      s("deck", "deck", 0, 0.105, 0.9, 0.05),
      ...Array.from({ length: 8 }, (_, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        return [
          s(`stat${i}`, "stat" as SlotRole, 0.04 + col * 0.5, 0.2 + row * 0.2, 0.42, 0.065, { snap: false, index: i, styleRole: "stat", sizeScale: 0.78, lineHeight: 1.05 }),
          s(`label${i}`, "caption" as SlotRole, 0.04 + col * 0.5, 0.272 + row * 0.2, 0.42, 0.09, { snap: false, index: 100 + i, sizeScale: 1.35 }),
        ];
      }).flat(),
    ],
  },
  {
    id: "tpl_speakers_grid",
    name: "Speaker profiles — grid of twelve",
    pageType: "speaker_profile",
    position: "opener",
    description: "Four-by-three grid of speaker portraits with names and designations.",
    slots: [
      s("kicker", "kicker", 0, 0, 0.6, 0.02),
      s("headline", "headline", 0, 0.026, 1, 0.065, { sizeScale: 0.85 }),
      s("deck", "deck", 0, 0.094, 0.9, 0.035),
      ...Array.from({ length: 12 }, (_, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        return [
          s(`p${i}`, "portrait" as SlotRole, col * 0.255, 0.15 + row * 0.285, 0.235, 0.17, { snap: false, index: i }),
          s(`n${i}`, "caption" as SlotRole, col * 0.255, 0.326 + row * 0.285, 0.235, 0.1, { snap: false, index: 200 + i }),
        ];
      }).flat(),
    ],
  },
];

export const templateSpecById = Object.fromEntries(templateSpecs.map((t) => [t.id, t])) as Record<string, TemplateSpec>;

export function specsForPageType(pageType: PageType): TemplateSpec[] {
  const direct = templateSpecs.filter((t) => t.pageType === pageType);
  // Panels, keynotes and features share the article archetypes.
  if (pageType === "event_report") return [...direct, ...templateSpecs.filter((t) => t.pageType === "two_column_article")];
  return direct;
}

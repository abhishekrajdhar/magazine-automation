/**
 * PressFlow domain model.
 *
 * This file is the canonical shape of the workspace as the frontend sees it.
 * The FastAPI backend mirrors these types in Pydantic (camelCase JSON aliases),
 * and `packages/demo-data/workspace.json` is exported from the demo seed using
 * exactly these shapes.
 *
 * Geometry conventions:
 *  - Page element geometry (x, y, w, h) is in PostScript points from the
 *    top-left corner of the trim box.
 *  - Reference layout blocks and template slots are normalised (0..1) to the
 *    page trim box so they survive page-size changes.
 */

export type ID = string;
export type ISODate = string;

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export type Role = "owner" | "admin" | "editor" | "designer" | "viewer";

export interface User {
  id: ID;
  name: string;
  email: string;
  title?: string;
  initials: string;
}

export interface Organisation {
  id: ID;
  name: string;
  slug: string;
  plan: "demo" | "team" | "enterprise";
}

export interface Member {
  userId: ID;
  name: string;
  email: string;
  role: Role;
  title?: string;
  initials: string;
  lastActiveAt?: ISODate;
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export type ProjectStatus =
  | "setup"
  | "ingesting"
  | "analysing"
  | "editorial"
  | "design"
  | "review"
  | "exported";

export type DesignMode = "exact_reference" | "adapted_reference" | "house_style";
export type ContentStyle = "news" | "feature" | "analytical" | "conversational";
export type EditorialTone = "authoritative" | "neutral" | "celebratory" | "analytical";
export type ImagePreference = "speakers_first" | "stage_wide" | "balanced" | "audience";
export type Language = "en" | "hi" | "en-hi";

export interface GenerationConfig {
  designMode: DesignMode;
  targetPageCount: number;
  contentStyle: ContentStyle;
  language: Language;
  editorialTone: EditorialTone;
  imagePreference: ImagePreference;
  articleTypes: ArticleType[];
  includeToc: boolean;
  includeEditorial: boolean;
  includeAdvertisements: boolean;
  includeInterviews: boolean;
  includeEventReports: boolean;
  adPageCount: number;
}

export interface Project {
  id: ID;
  orgId: ID;
  title: string;
  eventName: string;
  category: string;
  issueNumber: string;
  publicationDate: ISODate;
  publisher: string;
  targetPageCount: number;
  description: string;
  status: ProjectStatus;
  referenceId?: ID;
  designProfileId?: ID;
  config: GenerationConfig;
  ownerId: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** True for seeded demo projects. Simulated data is always labelled in the UI. */
  isDemo: boolean;
}

/* ------------------------------------------------------------------ */
/* Event media & intelligence                                          */
/* ------------------------------------------------------------------ */

export type SourceType = "youtube" | "google_drive" | "upload_video" | "upload_audio";

export type ProcessingState =
  | "pending"
  | "queued"
  | "acquiring"
  | "extracting_audio"
  | "transcribing"
  | "analysing"
  | "ready"
  | "failed"
  | "needs_auth"
  | "unavailable";

export type TranscriptionState =
  | "none"
  | "captions_found"
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "unavailable";

export type TranscriptionMethod = "youtube_captions" | "whisper" | "manual" | "demo_seed";

export interface VideoSource {
  id: ID;
  projectId: ID;
  sourceType: SourceType;
  url?: string;
  externalId?: string;
  fileName?: string;
  fileSizeBytes?: number;
  title: string;
  durationSec?: number;
  thumbnailUrl?: string;
  sessionId?: ID;
  processing: {
    state: ProcessingState;
    progress: number;
    message?: string;
    updatedAt: ISODate;
  };
  transcription: {
    state: TranscriptionState;
    method?: TranscriptionMethod;
    language?: string;
    wordCount?: number;
  };
  /** Seeded demo media that has no real file behind it. */
  simulated: boolean;
  addedAt: ISODate;
}

export interface TranscriptSegment {
  id: ID;
  videoId: ID;
  start: number;
  end: number;
  speakerId?: ID;
  speakerLabel: string;
  text: string;
}

export type SpeakerVerification = "confirmed" | "unverified" | "ai_suggested";

export interface Speaker {
  id: ID;
  projectId: ID;
  name: string;
  designation?: string;
  organisation?: string;
  verification: SpeakerVerification;
  videoIds: ID[];
  bio?: string;
  portraitAssetId?: ID;
}

export type SessionKind =
  | "inaugural"
  | "keynote"
  | "panel"
  | "fireside"
  | "presentation"
  | "awards"
  | "valedictory";

export interface EventSession {
  id: ID;
  projectId: ID;
  videoId: ID;
  title: string;
  kind: SessionKind;
  speakerIds: ID[];
  summary: string;
  topics: string[];
  status: "draft" | "approved";
}

export type FactKind = "quote" | "statistic" | "announcement" | "discussion_point" | "qa";

export interface ExtractedFact {
  id: ID;
  projectId: ID;
  videoId: ID;
  segmentId?: ID;
  kind: FactKind;
  text: string;
  speakerId?: ID;
  timestamp: number;
  /** verbatim = text appears in transcript; interpretation = AI paraphrase/summary. */
  provenance: "transcript_verbatim" | "ai_interpretation";
  status: "pending" | "approved" | "rejected";
  confidence: number;
}

/* ------------------------------------------------------------------ */
/* Editorial                                                           */
/* ------------------------------------------------------------------ */

export type ArticleType =
  | "event_report"
  | "keynote"
  | "interview"
  | "government_perspective"
  | "panel"
  | "tech_feature"
  | "speaker_profiles"
  | "highlights"
  | "editorial"
  | "photo_captions";

export type ArticleStatus = "draft" | "in_review" | "needs_revision" | "approved" | "rejected";

export interface SourceRef {
  videoId: ID;
  start: number;
  end?: number;
  segmentId?: ID;
}

export type ArticleBlockKind = "paragraph" | "subhead" | "quote" | "question" | "answer" | "list_item";

export interface ArticleBlock {
  id: ID;
  kind: ArticleBlockKind;
  text: string;
  speakerId?: ID;
  sourceRefs?: SourceRef[];
}

export interface Article {
  id: ID;
  projectId: ID;
  type: ArticleType;
  kicker?: string;
  headline: string;
  subheadline: string;
  byline?: string;
  intro: string;
  body: ArticleBlock[];
  /** IDs of ExtractedFact (kind = quote) used as pull quotes. */
  quoteFactIds: ID[];
  speakerIds: ID[];
  sessionIds: ID[];
  suggestedImageIds: ID[];
  captions: Record<ID, string>;
  status: ArticleStatus;
  generatedBy: "demo_seed" | "llm" | "human";
  updatedAt: ISODate;
  approvedBy?: ID;
  approvedAt?: ISODate;
  reviewNote?: string;
  /** Pre-generated alternates available offline (demo) or cached from the LLM. */
  variants?: {
    headlines?: string[];
    intros?: Partial<Record<EditorialTone, string>>;
    shortIntro?: string;
    summary?: string;
  };
}

/* ------------------------------------------------------------------ */
/* Reference intelligence                                              */
/* ------------------------------------------------------------------ */

export type PageType =
  | "cover"
  | "editorial"
  | "toc"
  | "interview"
  | "event_report"
  | "two_column_article"
  | "full_page_image"
  | "photo_gallery"
  | "advertisement"
  | "infographic"
  | "speaker_profile";

export type TextRole =
  | "kicker"
  | "headline"
  | "deck"
  | "byline"
  | "body"
  | "subhead"
  | "pullquote"
  | "caption"
  | "folio"
  | "question"
  | "stat";

export interface ReferenceMagazine {
  id: ID;
  orgId: ID;
  title: string;
  fileName: string;
  fileSizeBytes: number;
  pageCount: number;
  uploadedAt: ISODate;
  status: "uploaded" | "analysing" | "analysed" | "approved" | "failed";
  analysis: {
    progress: number;
    message?: string;
    analyser: "pymupdf" | "pymupdf+vision" | "demo_seed";
    completedAt?: ISODate;
  };
  designProfileId?: ID;
  /** Whether the original PDF is stored and page renders can be fetched. */
  hasSourcePdf: boolean;
  /** An INDD/IDML package was supplied alongside the PDF. */
  hasInddSource: boolean;
  isDemo: boolean;
}

export interface LayoutBlock {
  id: ID;
  kind: "text" | "image" | "shape" | "rule";
  role?: TextRole | "image" | "background";
  /** Normalised 0..1 to the trim box. */
  x: number;
  y: number;
  w: number;
  h: number;
  fontName?: string;
  fontSize?: number;
  color?: string;
  sample?: string;
}

export interface ReferencePage {
  id: ID;
  referenceId: ID;
  pageNumber: number;
  layoutType: PageType;
  confidence: number;
  widthPt: number;
  heightPt: number;
  /** URL of the rendered page image when the source PDF is available. */
  imageUrl?: string;
  blocks: LayoutBlock[];
  properties: {
    columns: number;
    dominantColors: string[];
    textCoverage: number;
    imageCoverage: number;
    fonts: string[];
  };
  corrected: boolean;
}

export interface TextStyle {
  role: TextRole;
  /** Font name as found in the PDF, e.g. "MinionPro-Regular". Never guaranteed. */
  detectedFont?: string;
  classification: "serif" | "sans" | "display" | "mono";
  /** Font family used for the HTML preview renderer. */
  previewFont: string;
  size: number;
  leading: number;
  weight: number;
  tracking: number;
  color: string;
  uppercase?: boolean;
  italic?: boolean;
  confidence: number;
}

export interface DesignProfile {
  id: ID;
  referenceId: ID;
  name: string;
  status: "draft" | "approved";
  version: number;
  page: {
    widthPt: number;
    heightPt: number;
    orientation: "portrait" | "landscape";
    bleedPt: number;
  };
  margins: { top: number; bottom: number; inside: number; outside: number };
  grid: { columns: number; gutterPt: number; baselinePt: number };
  typography: Record<TextRole, TextStyle>;
  colors: {
    ink: string;
    paper: string;
    accent: string;
    accentAlt: string;
    muted: string;
    rule: string;
    palette: string[];
  };
  folio: {
    position: "bottom_outside" | "bottom_center" | "top_outside";
    showMagazineName: boolean;
    showSection: boolean;
  };
  images: {
    captionPlacement: "below" | "overlay" | "side";
    cornerRadius: number;
    fullBleedCover: boolean;
  };
  pullQuote: { style: "rule_above" | "quote_mark" | "boxed" };
  pageTypeCounts: Partial<Record<PageType, number>>;
  confidence: Record<string, number>;
  /** Dotted paths of properties corrected by a person, e.g. "grid.columns". */
  overrides: string[];
  approvedAt?: ISODate;
  approvedBy?: ID;
}

/* ------------------------------------------------------------------ */
/* Templates & pages                                                   */
/* ------------------------------------------------------------------ */

export type SlotRole =
  | TextRole
  | "hero_image"
  | "image"
  | "portrait"
  | "background"
  | "accent_bar"
  | "rule"
  | "ad";

export interface TemplateSlot {
  id: ID;
  role: SlotRole;
  /** Normalised 0..1 to the trim box. */
  x: number;
  y: number;
  w: number;
  h: number;
  columns?: number;
}

export interface Template {
  id: ID;
  name: string;
  pageType: PageType;
  source: "builtin" | "reference";
  referencePageNumber?: number;
  description: string;
  slots: TemplateSlot[];
  columns: number;
}

export type ElementKind = "text" | "image" | "shape" | "rule";

export interface ImageCrop {
  /** 1 = cover fit. */
  scale: number;
  /** -1..1 focal offset. */
  offsetX: number;
  offsetY: number;
}

export interface PageElement {
  id: ID;
  kind: ElementKind;
  role: SlotRole;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  locked?: boolean;
  hidden?: boolean;
  /** Text regenerated from the flatplan (page numbers, contents list) rather than edited by hand. */
  dynamic?: "folio" | "toc";
  /* text */
  text?: string;
  styleRole?: TextRole;
  style?: Partial<Pick<TextStyle, "size" | "leading" | "weight" | "tracking" | "color" | "uppercase" | "italic" | "previewFont">> & {
    align?: "left" | "center" | "right" | "justify";
  };
  columns?: number;
  gutter?: number;
  /* image */
  assetId?: ID;
  crop?: ImageCrop;
  /* shape */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  opacity?: number;
}

export type EditorialStatus = "pending" | "approved";
export type DesignStatus = "not_started" | "in_progress" | "ready" | "approved";

export interface MagazinePage {
  id: ID;
  projectId: ID;
  pageType: PageType;
  templateId: ID;
  label: string;
  articleId?: ID;
  /** 0-based index of this page within a multi-page article. */
  articlePart?: number;
  elements: PageElement[];
  editorialStatus: EditorialStatus;
  designStatus: DesignStatus;
  locked: boolean;
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export type AssetKind = "photo" | "portrait" | "ad" | "logo" | "video_frame";

export interface Asset {
  id: ID;
  projectId: ID;
  kind: AssetKind;
  fileName: string;
  widthPx: number;
  heightPx: number;
  sessionId?: ID;
  videoId?: ID;
  speakerId?: ID;
  tags: string[];
  caption?: string;
  credit?: string;
  /** Deterministic seed for the placeholder renderer (demo imagery). */
  seed: number;
  /** URL of the real file (live mode). Absent for demo placeholders. */
  url?: string;
  simulated: boolean;
}

/* ------------------------------------------------------------------ */
/* QC & exports                                                        */
/* ------------------------------------------------------------------ */

export type Severity = "error" | "warning" | "info";

export type PreflightCode =
  | "overset_text"
  | "missing_image"
  | "broken_asset"
  | "low_resolution"
  | "font_substitution"
  | "page_size_mismatch"
  | "margin_violation"
  | "page_numbering"
  | "empty_frame"
  | "missing_caption"
  | "layout_overflow"
  | "unapproved_content";

export interface PreflightIssue {
  id: ID;
  code: PreflightCode;
  severity: Severity;
  pageId?: ID;
  pageNumber?: number;
  elementId?: ID;
  message: string;
  recommendation: string;
  fix?: "fit_text" | "assign_image" | "add_caption" | "approve_content" | "snap_to_margins" | "renumber" | "remove_frame" | "open_editor";
}

export type ExportFormat =
  | "pdf_digital"
  | "pdf_print"
  | "indd"
  | "page_previews"
  | "content_package"
  | "asset_archive"
  | "layout_json";

export type ExportRenderer = "browser" | "reportlab" | "indesign";

export interface ExportRecord {
  id: ID;
  projectId: ID;
  format: ExportFormat;
  status: "queued" | "running" | "complete" | "failed" | "unavailable";
  renderer: ExportRenderer;
  fileName: string;
  sizeBytes?: number;
  createdAt: ISODate;
  completedAt?: ISODate;
  createdBy: ID;
  /** Present when the file is held by the API. Browser exports are regenerated on demand. */
  downloadUrl?: string;
  message?: string;
}

/* ------------------------------------------------------------------ */
/* Activity & jobs                                                     */
/* ------------------------------------------------------------------ */

export interface ActivityItem {
  id: ID;
  at: ISODate;
  actorId: ID;
  verb: string;
  target: string;
  kind: "video" | "article" | "reference" | "page" | "export" | "project" | "qc";
  projectId?: ID;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Job {
  id: ID;
  kind:
    | "video_pipeline"
    | "reference_analysis"
    | "article_generation"
    | "export_render"
    | "page_reanalysis";
  status: JobStatus;
  progress: number;
  message?: string;
  attempts: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  resultRef?: ID;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Aggregate                                                           */
/* ------------------------------------------------------------------ */

/** Everything a project workspace needs, as returned by GET /projects/{id}/workspace. */
export interface ProjectWorkspace {
  project: Project;
  videos: VideoSource[];
  segments: TranscriptSegment[];
  speakers: Speaker[];
  sessions: EventSession[];
  facts: ExtractedFact[];
  articles: Article[];
  assets: Asset[];
  pages: MagazinePage[];
  exports: ExportRecord[];
}

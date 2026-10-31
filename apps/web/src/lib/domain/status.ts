import type { Tone } from "@/components/ui/display";
import type { ArticleStatus, ArticleType, DesignStatus, ExportFormat, ProcessingState, ProjectStatus, ReferenceMagazine, TranscriptionState } from "./types";

export const projectStatus: Record<ProjectStatus, { label: string; tone: Tone }> = {
  setup: { label: "Setup", tone: "neutral" },
  ingesting: { label: "Ingesting media", tone: "accent" },
  analysing: { label: "Analysing", tone: "accent" },
  editorial: { label: "Editorial", tone: "warning" },
  design: { label: "In design", tone: "accent" },
  review: { label: "Final review", tone: "warning" },
  exported: { label: "Exported", tone: "success" },
};

export const PROJECT_STAGES: ProjectStatus[] = ["setup", "ingesting", "analysing", "editorial", "design", "review", "exported"];

export const articleStatus: Record<ArticleStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  in_review: { label: "In review", tone: "warning" },
  needs_revision: { label: "Needs revision", tone: "danger" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

export const articleTypeLabel: Record<ArticleType, string> = {
  event_report: "Event report",
  keynote: "Keynote coverage",
  interview: "Interview",
  government_perspective: "Government perspective",
  panel: "Panel coverage",
  tech_feature: "Technology feature",
  speaker_profiles: "Speaker profiles",
  highlights: "Event highlights",
  editorial: "Editorial",
  photo_captions: "Photo captions",
};

export const processingState: Record<ProcessingState, { label: string; tone: Tone; busy?: boolean }> = {
  pending: { label: "Not processed", tone: "neutral" },
  queued: { label: "Queued", tone: "neutral", busy: true },
  acquiring: { label: "Acquiring", tone: "accent", busy: true },
  extracting_audio: { label: "Extracting audio", tone: "accent", busy: true },
  transcribing: { label: "Transcribing", tone: "accent", busy: true },
  analysing: { label: "Analysing", tone: "accent", busy: true },
  ready: { label: "Ready", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  needs_auth: { label: "Needs authorisation", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "warning" },
};

export const transcriptionState: Record<TranscriptionState, { label: string; tone: Tone }> = {
  none: { label: "No transcript", tone: "neutral" },
  captions_found: { label: "Captions available", tone: "accent" },
  queued: { label: "Transcription queued", tone: "neutral" },
  running: { label: "Transcribing", tone: "accent" },
  complete: { label: "Transcript ready", tone: "success" },
  failed: { label: "Transcription failed", tone: "danger" },
  unavailable: { label: "Transcript unavailable", tone: "warning" },
};

export const designStatus: Record<DesignStatus, { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "accent" },
  ready: { label: "Ready for review", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
};

export const exportFormatInfo: Record<ExportFormat, { label: string; ext: string; description: string }> = {
  pdf_digital: { label: "PDF for digital publishing", ext: "pdf", description: "RGB, web-optimised, no bleed. Rendered by the preview renderer — not InDesign." },
  pdf_print: { label: "Print-ready PDF", ext: "pdf", description: "Bleed and crop marks. PDF/X-4 output requires the InDesign bridge." },
  indd: { label: "Native InDesign document", ext: "indd", description: "Editable .indd built by Adobe InDesign from approved templates." },
  page_previews: { label: "Individual page previews", ext: "zip", description: "One self-contained preview per page." },
  content_package: { label: "Article content package", ext: "zip", description: "Approved articles as Markdown and JSON with source timestamps." },
  asset_archive: { label: "Magazine asset archive", ext: "zip", description: "Photographs and creatives placed in the issue, with a manifest." },
  layout_json: { label: "Layout contract (JSON)", ext: "json", description: "The structured hand-off consumed by the InDesign renderer." },
};

export const referenceStatus: Record<ReferenceMagazine["status"], { label: string; tone: Tone }> = {
  uploaded: { label: "Not analysed", tone: "neutral" },
  analysing: { label: "Analysing", tone: "accent" },
  analysed: { label: "Awaiting approval", tone: "warning" },
  approved: { label: "Profile approved", tone: "success" },
  failed: { label: "Analysis failed", tone: "danger" },
};

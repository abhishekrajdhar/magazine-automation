import type { GenerationConfig, SourceType } from "@/lib/domain/types";
import type { ProjectDetails } from "./project-fields";

export interface DraftMedia {
  id: string;
  sourceType: SourceType;
  url?: string;
  externalId?: string;
  driveKind?: "file" | "folder";
  title: string;
  durationSec?: number;
  thumbnailUrl?: string;
  file?: File;
  fileName?: string;
  fileSize?: number;
  /** Metadata lookup through the API. */
  resolve: "pending" | "ok" | "offline" | "error";
  captions?: "available" | "none" | "unknown";
  error?: string;
}

export interface DraftReference {
  mode: "upload" | "library";
  status: "empty" | "loading" | "ready" | "error";
  file?: File;
  sampleUrl?: string;
  fileName?: string;
  fileSize?: number;
  pageCount?: number;
  sizeLabel?: string;
  thumbs?: string[];
  inddFile?: File;
  libraryId?: string;
  error?: string;
}

export interface WizardState {
  details: ProjectDetails;
  media: DraftMedia[];
  reference: DraftReference;
  config: GenerationConfig;
}

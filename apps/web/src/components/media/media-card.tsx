"use client";

import * as React from "react";
import { AudioLines, Loader2, X } from "lucide-react";
import { SourceGlyph } from "@/components/shell/logo";
import { Badge, SimulatedBadge, type Tone } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { PlaceholderPhoto } from "@/components/magazine/placeholder-photo";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import type { SourceType } from "@/lib/domain/types";

const SOURCE_LABEL: Record<SourceType, string> = {
  youtube: "YouTube",
  google_drive: "Google Drive",
  upload_video: "Video upload",
  upload_audio: "Audio upload",
};

export interface MediaCardProps {
  sourceType: SourceType;
  title: string;
  subtitle?: string;
  durationSec?: number;
  sizeBytes?: number;
  thumbnailUrl?: string;
  placeholderSeed?: number;
  processing: { label: string; tone: Tone; busy?: boolean };
  transcription: { label: string; tone: Tone };
  note?: React.ReactNode;
  simulated?: boolean;
  loading?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
  actions?: React.ReactNode;
}

export function MediaCard(props: MediaCardProps) {
  const { sourceType, title, subtitle, durationSec, sizeBytes, thumbnailUrl, placeholderSeed, processing, transcription, note, simulated, loading, onRemove, onClick, actions } = props;
  const [imgFailed, setImgFailed] = React.useState(false);
  const isAudio = sourceType === "upload_audio";
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xs transition-shadow hover:shadow-md">
      <div className={`relative aspect-video overflow-hidden bg-sunken ${onClick ? "cursor-pointer" : ""}`} onClick={onClick}>
        {loading ? (
          <div className="skeleton h-full w-full rounded-none" />
        ) : thumbnailUrl && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" onError={() => setImgFailed(true)} />
        ) : isAudio ? (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#16213d] to-[#2a3d6b]">
            <AudioLines className="size-10 text-white/70" strokeWidth={1.25} />
          </div>
        ) : placeholderSeed !== undefined ? (
          <PlaceholderPhoto seed={placeholderSeed} tag="stage" className="h-full w-full" label />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-ink-4">No preview</div>
        )}
        {durationSec !== undefined && <span className="tabular absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">{formatDuration(durationSec)}</span>}
        <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-white/95 px-1.5 py-0.5 text-[11px] font-medium text-ink shadow-sm">
          <SourceGlyph type={sourceType} className="size-3.5 text-ink-3" /> {SOURCE_LABEL[sourceType]}
        </span>
        {onRemove && (
          <Button variant="secondary" size="icon-xs" className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Remove ${title}`}>
            <X />
          </Button>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className={`line-clamp-2 text-sm font-medium leading-snug text-ink ${onClick ? "cursor-pointer hover:text-accent" : ""}`} onClick={onClick}>
            {title}
          </p>
          {(subtitle || sizeBytes) && <p className="mt-0.5 truncate text-xs text-ink-3">{[subtitle, sizeBytes ? formatBytes(sizeBytes) : null].filter(Boolean).join(" · ")}</p>}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <Badge tone={processing.tone} dot pulse={processing.busy}>
            {processing.busy && <Loader2 className="animate-spin" />}
            {processing.label}
          </Badge>
          <Badge tone={transcription.tone}>{transcription.label}</Badge>
          {simulated && <SimulatedBadge />}
        </div>
        {note && <div className="text-xs leading-relaxed text-ink-3">{note}</div>}
        {actions && <div className="flex flex-wrap gap-1.5 pt-1">{actions}</div>}
      </div>
    </div>
  );
}

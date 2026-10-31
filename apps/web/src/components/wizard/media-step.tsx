"use client";

import * as React from "react";
import { CloudUpload, Info, Link2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/display";
import { MediaCard } from "@/components/media/media-card";
import { parseMediaUrl, probeMediaFile, splitLinks, validateMediaFile, youtubeThumbnail } from "@/lib/media/url";
import { live } from "@/lib/api/live";
import { ApiUnavailableError } from "@/lib/api/client";
import { uid } from "@/lib/utils/format";
import type { DraftMedia } from "./types";

interface Props {
  media: DraftMedia[];
  onChange: (updater: (m: DraftMedia[]) => DraftMedia[]) => void;
  apiOnline: boolean;
}

export function describeDraft(m: DraftMedia, apiOnline: boolean) {
  if (m.resolve === "error") return { processing: { label: "Invalid", tone: "danger" as const }, transcription: { label: "—", tone: "neutral" as const } };
  if (m.sourceType === "google_drive")
    return {
      processing: { label: "Needs authorisation", tone: "warning" as const },
      transcription: { label: "Transcription after download", tone: "neutral" as const },
    };
  if (m.sourceType === "youtube")
    return {
      processing: { label: apiOnline ? "Ready to queue" : "Not processed", tone: "neutral" as const },
      transcription:
        m.captions === "available"
          ? { label: "Captions listed", tone: "accent" as const }
          : m.captions === "none"
            ? { label: "No captions — needs transcription", tone: "warning" as const }
            : { label: "Captions unknown", tone: "neutral" as const },
    };
  return {
    processing: { label: apiOnline ? "Ready to upload" : "Kept in this browser", tone: "neutral" as const },
    transcription: { label: "Whisper transcription", tone: "neutral" as const },
  };
}

export function MediaStep({ media, onChange, apiOnline }: Props) {
  const [links, setLinks] = React.useState("");
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const addLinks = async () => {
    const items = splitLinks(links);
    if (!items.length) return setLinkError("Paste one or more YouTube or Google Drive links.");
    const errors: string[] = [];
    const rejected: string[] = [];
    const added: DraftMedia[] = [];
    for (const raw of items) {
      const parsed = parseMediaUrl(raw);
      if (!parsed.valid) {
        errors.push(`${raw.slice(0, 60)} — ${parsed.error}`);
        rejected.push(raw);
        continue;
      }
      if ([...media, ...added].some((m) => m.externalId === parsed.externalId)) {
        errors.push(`${raw.slice(0, 60)} — already added.`);
        continue;
      }
      added.push({
        id: uid("draft"),
        sourceType: parsed.sourceType,
        url: parsed.normalized,
        externalId: parsed.externalId,
        driveKind: parsed.sourceType === "google_drive" ? parsed.kind : undefined,
        title: parsed.sourceType === "youtube" ? `YouTube video ${parsed.externalId}` : parsed.kind === "folder" ? "Google Drive folder" : "Google Drive file",
        thumbnailUrl: parsed.sourceType === "youtube" ? youtubeThumbnail(parsed.externalId) : undefined,
        resolve: parsed.sourceType === "youtube" ? "pending" : "ok",
      });
    }
    setLinkError(errors.length ? errors.join("\n") : null);
    if (!added.length) return;
    onChange((m) => [...m, ...added]);
    setLinks(rejected.join("\n"));
    toast.success(`${added.length} link${added.length > 1 ? "s" : ""} added`);

    // Titles, durations and caption availability come from the API (server-side oEmbed / Data API).
    for (const item of added.filter((a) => a.sourceType === "youtube")) {
      try {
        const r = await live.resolveMedia(item.url!);
        onChange((m) =>
          m.map((x) =>
            x.id === item.id
              ? { ...x, resolve: r.valid ? "ok" : "error", title: r.title ?? x.title, thumbnailUrl: r.thumbnailUrl ?? x.thumbnailUrl, durationSec: r.durationSec ?? x.durationSec, captions: r.captions, error: r.error }
              : x,
          ),
        );
      } catch (err) {
        onChange((m) => m.map((x) => (x.id === item.id ? { ...x, resolve: err instanceof ApiUnavailableError ? "offline" : "error", error: err instanceof ApiUnavailableError ? undefined : (err as Error).message } : x)));
      }
    }
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const file of list) {
      const problem = validateMediaFile(file);
      if (problem) {
        toast.error(problem);
        continue;
      }
      const id = uid("draft");
      const isAudio = file.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(file.name);
      onChange((m) => [...m, { id, sourceType: isAudio ? "upload_audio" : "upload_video", title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "), file, fileName: file.name, fileSize: file.size, resolve: "pending" }]);
      const probe = await probeMediaFile(file);
      onChange((m) => m.map((x) => (x.id === id ? { ...x, durationSec: probe.durationSec, thumbnailUrl: probe.thumbnail, resolve: "ok" } : x)));
    }
  };

  const driveCount = media.filter((m) => m.sourceType === "google_drive").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="size-4 text-ink-3" /> YouTube & Google Drive links
          </div>
          <p className="mt-1 text-xs text-ink-3">Paste one or many, separated by new lines or commas.</p>
          <Textarea
            className="mt-3 font-mono text-xs"
            rows={4}
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addLinks();
            }}
            placeholder={"https://www.youtube.com/watch?v=…\nhttps://drive.google.com/file/d/…/view"}
            aria-invalid={!!linkError}
            aria-label="Recording links"
          />
          {linkError && <p className="mt-2 whitespace-pre-line text-xs text-danger">{linkError}</p>}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-ink-4">⌘ Enter to add</span>
            <Button variant="secondary" size="sm" onClick={addLinks}>
              <Plus /> Add links
            </Button>
          </div>
        </div>

        <div
          className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-subtle"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <CloudUpload className="size-6 text-ink-3" />
          <p className="mt-2 text-sm font-medium">Drop video or audio recordings</p>
          <p className="mt-1 text-xs text-ink-3">MP4, MOV, WebM, MKV, MP3, M4A, WAV · up to 8 GB each</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => fileInput.current?.click()}>
            Choose files
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-2">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="space-y-1">
          <p>
            <strong className="font-semibold">YouTube:</strong> captions are downloaded only through the YouTube Data API by an account that owns the video. When captions can&apos;t be obtained that way, upload the original recording or share it from Drive and it will be transcribed.
          </p>
          <p>
            <strong className="font-semibold">Google Drive:</strong> files are fetched after you authorise PressFlow with Google (read-only). Folders are expanded into their video and audio files.
          </p>
          {!apiOnline && (
            <p className="text-warning">
              The PressFlow API isn&apos;t connected, so links are checked in your browser only and nothing will be processed. Titles show the video ID until the API can look them up.
            </p>
          )}
        </div>
      </div>

      {media.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState compact icon={<CloudUpload />} title="No recordings added" description="Add the session recordings this issue should cover. You can add more later from the Event Media Library." />
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-sm font-medium">
              {media.length} recording{media.length > 1 ? "s" : ""}
            </p>
            {driveCount > 0 && <p className="text-xs text-ink-3">{driveCount} Drive item{driveCount > 1 ? "s" : ""} will need Google authorisation</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {media.map((m) => {
              const d = describeDraft(m, apiOnline);
              return (
                <MediaCard
                  key={m.id}
                  sourceType={m.sourceType}
                  title={m.title}
                  subtitle={m.sourceType === "google_drive" ? (m.driveKind === "folder" ? "Folder · contents listed after authorisation" : `File ID ${m.externalId?.slice(0, 12)}…`) : m.fileName}
                  durationSec={m.durationSec}
                  sizeBytes={m.fileSize}
                  thumbnailUrl={m.thumbnailUrl}
                  loading={m.resolve === "pending" && m.sourceType !== "youtube"}
                  processing={d.processing}
                  transcription={d.transcription}
                  note={m.resolve === "offline" ? "Metadata will be fetched when the API is available." : m.error}
                  onRemove={() => onChange((list) => list.filter((x) => x.id !== m.id))}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

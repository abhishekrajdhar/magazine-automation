"use client";

import * as React from "react";
import Link from "next/link";
import { Check, CircleCheck, Quote, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import type { ExtractedFact, FactKind, Speaker, TranscriptSegment, VideoSource } from "@/lib/domain/types";
import { useWorkspace } from "@/lib/store/workspace";
import { Badge, EmptyState, Panel } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/overlays";
import { Tooltip } from "@/components/ui/primitives";
import { findInTranscript } from "@/lib/editorial/verify";
import { formatDuration } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export const factKindLabel: Record<FactKind, string> = {
  quote: "Quotation",
  statistic: "Statistic",
  announcement: "Announcement",
  discussion_point: "Discussion point",
  qa: "Q&A",
};

interface Props {
  facts: ExtractedFact[];
  speakers: Speaker[];
  videos: VideoSource[];
  segments: TranscriptSegment[];
  compact?: boolean;
  onSeek?: (t: number) => void;
}

export function FactsList({ facts, speakers, videos, segments, compact, onSeek }: Props) {
  const updateFact = useWorkspace((s) => s.updateFact);
  const [kind, setKind] = React.useState<"all" | FactKind>("all");
  const [status, setStatus] = React.useState<"all" | ExtractedFact["status"]>("all");
  const list = facts.filter((f) => (kind === "all" || f.kind === kind) && (status === "all" || f.status === status));
  const pending = facts.filter((f) => f.status === "pending");

  if (!facts.length) return <Panel><EmptyState compact={compact} icon={<Quote />} title="No facts extracted" description="Quotations, statistics and announcements appear here after analysis. You can also select transcript text to save a quotation." /></Panel>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select size="sm" className="w-44" aria-label="Filter by kind" value={kind} onValueChange={setKind} options={[{ value: "all", label: "All kinds" }, ...(Object.keys(factKindLabel) as FactKind[]).map((k) => ({ value: k, label: factKindLabel[k] }))]} />
        <Select size="sm" className="w-40" aria-label="Filter by status" value={status} onValueChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }]} />
        {pending.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() => {
              const verbatim = pending.filter((f) => f.provenance === "transcript_verbatim");
              verbatim.forEach((f) => updateFact(f.id, { status: "approved" }));
              toast.success(`Approved ${verbatim.length} verbatim item${verbatim.length === 1 ? "" : "s"}`, { description: pending.length - verbatim.length ? `${pending.length - verbatim.length} AI interpretations still need individual review.` : undefined });
            }}
          >
            <Check /> Approve all verbatim
          </Button>
        )}
      </div>
      <Panel className="divide-y divide-line">
        {list.map((f) => {
          const speaker = speakers.find((s) => s.id === f.speakerId);
          const video = videos.find((v) => v.id === f.videoId);
          const check = findInTranscript(f.text, segments.filter((s) => s.videoId === f.videoId));
          const verbatimOk = f.provenance === "transcript_verbatim" && check.status === "verified";
          return (
            <div key={f.id} className={cn("flex gap-4 px-4 py-3", f.status === "rejected" && "opacity-55")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="outline">{factKindLabel[f.kind]}</Badge>
                  {f.provenance === "transcript_verbatim" ? (
                    <Tooltip content={verbatimOk ? "Found word-for-word in the transcript." : "Marked verbatim but not found word-for-word — check the transcript."}>
                      <span>
                        <Badge tone={verbatimOk ? "success" : "danger"} icon={<CircleCheck />}>
                          {verbatimOk ? "Verbatim · verified" : "Verbatim · not found"}
                        </Badge>
                      </span>
                    </Tooltip>
                  ) : (
                    <Tooltip content="A model's paraphrase or interpretation. It must not be presented as a quotation.">
                      <span>
                        <Badge tone="accent" icon={<Sparkles />}>
                          AI interpretation
                        </Badge>
                      </span>
                    </Tooltip>
                  )}
                  <Badge tone={f.status === "approved" ? "success" : f.status === "rejected" ? "danger" : "warning"} dot>
                    {f.status === "approved" ? "Approved" : f.status === "rejected" ? "Rejected" : "Pending review"}
                  </Badge>
                </div>
                <p className={cn("mt-2 text-sm leading-relaxed text-ink", f.kind === "quote" && "font-serif text-[15px]")}>{f.kind === "quote" ? `“${f.text.replace(/^[“"]|[”"]$/g, "")}”` : f.text}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-ink-3">
                  {speaker?.name ?? "Unattributed"}
                  <span className="text-ink-4">·</span>
                  {onSeek ? (
                    <button className="tabular font-mono text-accent hover:underline" onClick={() => onSeek(f.timestamp)}>
                      {formatDuration(f.timestamp)}
                    </button>
                  ) : (
                    <Link className="tabular font-mono text-accent hover:underline" href={`/app/media/${f.videoId}?t=${f.timestamp}`}>
                      {formatDuration(f.timestamp)}
                    </Link>
                  )}
                  {!compact && video && (
                    <>
                      <span className="text-ink-4">·</span>
                      <span className="truncate">{video.title}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                <Tooltip content="Approve for use in articles">
                  <Button variant={f.status === "approved" ? "subtle" : "ghost"} size="icon-sm" aria-label="Approve" onClick={() => updateFact(f.id, { status: f.status === "approved" ? "pending" : "approved" })}>
                    <Check className={f.status === "approved" ? "text-success" : undefined} />
                  </Button>
                </Tooltip>
                <Tooltip content="Reject">
                  <Button variant={f.status === "rejected" ? "subtle" : "ghost"} size="icon-sm" aria-label="Reject" onClick={() => updateFact(f.id, { status: f.status === "rejected" ? "pending" : "rejected" })}>
                    <X className={f.status === "rejected" ? "text-danger" : undefined} />
                  </Button>
                </Tooltip>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-3">Nothing matches these filters.</p>}
      </Panel>
    </div>
  );
}

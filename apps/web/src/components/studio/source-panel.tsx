"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import type { SourceRef, TranscriptSegment, VideoSource } from "@/lib/domain/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";

interface Props {
  videos: VideoSource[];
  segments: TranscriptSegment[];
  /** Segments cited anywhere in the article. */
  cited: Set<string>;
  /** Segments to bring into view (e.g. the focused paragraph's sources). */
  focus: SourceRef[];
}

export function SourcePanel({ videos, segments, cited, focus }: Props) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState("");
  const focusIds = React.useMemo(() => new Set(focus.map((f) => f.segmentId).filter(Boolean)), [focus]);

  React.useEffect(() => {
    const first = focus.find((f) => f.segmentId)?.segmentId;
    if (first) ref.current?.querySelector(`[data-src="${first}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  const q = query.trim().toLowerCase();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line p-2.5">
        <Input inputSize="sm" leading={<Search />} placeholder="Search source transcripts…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search source transcripts" />
      </div>
      <div ref={ref} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {videos.map((v) => {
          const segs = segments.filter((s) => s.videoId === v.id && (!q || s.text.toLowerCase().includes(q) || s.speakerLabel.toLowerCase().includes(q)));
          if (!segs.length) return null;
          return (
            <section key={v.id} className="border-b border-line">
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-subtle/95 px-3 py-2 backdrop-blur">
                <p className="min-w-0 flex-1 truncate text-xs font-medium text-ink-2">{v.title}</p>
                <Link href={`/app/media/${v.id}`} className="text-ink-4 hover:text-accent" aria-label="Open recording">
                  <ExternalLink className="size-3.5" />
                </Link>
              </div>
              {segs.map((s) => (
                <div
                  key={s.id}
                  data-src={s.id}
                  className={cn(
                    "border-l-2 px-3 py-2 transition-colors duration-500",
                    focusIds.has(s.id) ? "border-accent bg-accent-soft" : cited.has(s.id) ? "border-success-dot/60" : "border-transparent",
                  )}
                >
                  <p className="flex items-center gap-1.5 text-[11px] text-ink-4">
                    <Link href={`/app/media/${v.id}?t=${s.start}`} className="tabular font-mono text-accent hover:underline">
                      {formatDuration(s.start)}
                    </Link>
                    · {s.speakerLabel}
                    {cited.has(s.id) && <span className="ml-auto text-success">cited</span>}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{s.text}</p>
                </div>
              ))}
            </section>
          );
        })}
        {videos.length === 0 && <p className="p-6 text-center text-sm text-ink-3">This article cites no recordings.</p>}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { Progress } from "@/components/ui/primitives";
import type { useProjectData } from "@/lib/store/hooks";

type Data = ReturnType<typeof useProjectData>;

export function pipelineStages(data: Data) {
  const { videos, facts, articles, pages, project } = data;
  const target = project?.targetPageCount ?? pages.length;
  return [
    { key: "media", label: "Recordings", done: videos.filter((v) => v.processing.state === "ready").length, total: videos.length, href: "/app/media" },
    { key: "transcripts", label: "Transcripts", done: videos.filter((v) => v.transcription.state === "complete").length, total: videos.length, href: "/app/media" },
    { key: "facts", label: "Facts approved", done: facts.filter((f) => f.status === "approved").length, total: facts.length, href: "/app/media" },
    { key: "articles", label: "Articles approved", done: articles.filter((a) => a.status === "approved").length, total: articles.length, href: "/app/studio" },
    { key: "pages", label: "Pages signed off", done: pages.filter((p) => p.designStatus === "approved" || p.designStatus === "ready").length, total: Math.max(target, pages.length), href: "/app/designer" },
  ];
}

export function PipelineStatus({ data, className }: { data: Data; className?: string }) {
  const stages = pipelineStages(data);
  return (
    <div className={cn("grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-5", className)}>
      {stages.map((s) => {
        const pct = s.total ? (s.done / s.total) * 100 : 0;
        const complete = s.total > 0 && s.done === s.total;
        return (
          <Link key={s.key} href={s.href} className="group min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-ink-3 group-hover:text-ink">{s.label}</span>
            </div>
            <div className="tabular mt-1 text-sm font-semibold text-ink">
              {s.done}
              <span className="font-normal text-ink-4">/{s.total}</span>
            </div>
            <Progress className="mt-1.5" value={pct} tone={complete ? "success" : pct > 0 ? "accent" : "accent"} />
          </Link>
        );
      })}
    </div>
  );
}

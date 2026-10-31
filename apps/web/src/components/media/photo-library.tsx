"use client";

import * as React from "react";
import { Images, TriangleAlert } from "lucide-react";
import type { Asset, EventSession } from "@/lib/domain/types";
import { Badge, EmptyState, Panel, SimulatedBadge } from "@/components/ui/display";
import { Select } from "@/components/ui/overlays";
import { Tooltip } from "@/components/ui/primitives";
import { Pagination, paginate } from "@/components/ui/pagination";
import { PlaceholderPhoto } from "@/components/magazine/placeholder-photo";

const PAGE_SIZE = 24;

/** Pixels needed for a full-bleed A4 width at 300 ppi. */
export const FULL_WIDTH_PX = Math.round((613 / 72) * 300);

export function PhotoLibrary({ assets, sessions }: { assets: Asset[]; sessions: EventSession[] }) {
  const [session, setSession] = React.useState("all");
  const [tag, setTag] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const photos = assets.filter((a) => a.kind !== "ad");
  const tags = Array.from(new Set(photos.map((a) => a.tags[0]).filter(Boolean)));
  const list = photos.filter((a) => (session === "all" || a.sessionId === session) && (tag === "all" || a.tags[0] === tag));
  React.useEffect(() => setPage(1), [session, tag]);

  if (!photos.length) return <Panel><EmptyState icon={<Images />} title="No photographs yet" description="Upload event photography or extract frames from recordings." /></Panel>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select size="sm" className="w-64" aria-label="Filter by session" value={session} onValueChange={setSession} options={[{ value: "all", label: "All sessions" }, ...sessions.map((s) => ({ value: s.id, label: s.title.split(":")[0] }))]} />
        <Select size="sm" className="w-40" aria-label="Filter by shot type" value={tag} onValueChange={setTag} options={[{ value: "all", label: "All shot types" }, ...tags.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))]} />
        {photos.some((p) => p.simulated) && <SimulatedBadge label="Placeholder imagery" className="ml-auto" title="Demo photographs are procedurally drawn placeholders. Replace them with real photography before print." />}
      </div>
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4 lg:grid-cols-6">
          {paginate(list, page, PAGE_SIZE).map((a) => {
            const lowRes = a.widthPx < FULL_WIDTH_PX * 0.6;
            return (
              <figure key={a.id} className="group relative bg-surface">
                <div className="aspect-[4/3] overflow-hidden">
                  {a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.caption ?? ""} className="h-full w-full object-cover" />
                  ) : (
                    <PlaceholderPhoto seed={a.seed} tag={a.tags[0] ?? "stage"} className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]" />
                  )}
                </div>
                <figcaption className="px-2.5 py-2">
                  <p className="truncate text-xs font-medium text-ink">{a.caption}</p>
                  <p className="tabular mt-0.5 flex items-center gap-1 text-[11px] text-ink-4">
                    {a.widthPx}×{a.heightPx}
                    {a.kind === "video_frame" && <span>· frame</span>}
                    {lowRes && (
                      <Tooltip content={`Below ${FULL_WIDTH_PX}px wide: fine for small placements, too soft for full-bleed print.`}>
                        <span>
                          <Badge tone="warning" icon={<TriangleAlert />} className="ml-1 h-4 px-1 text-[10px]">
                            Low-res
                          </Badge>
                        </span>
                      </Tooltip>
                    )}
                  </p>
                </figcaption>
              </figure>
            );
          })}
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={list.length} onPageChange={setPage} noun="photographs" />
      </Panel>
    </div>
  );
}

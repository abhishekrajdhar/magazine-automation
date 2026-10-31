"use client";

import * as React from "react";
import Link from "next/link";
import { Captions, Quote, Search, Waypoints } from "lucide-react";
import type { useProjectData } from "@/lib/store/hooks";
import { Input } from "@/components/ui/input";
import { Badge, EmptyState, Panel } from "@/components/ui/display";
import { formatDuration } from "@/lib/utils/format";
import { factKindLabel } from "./facts-list";

type Data = ReturnType<typeof useProjectData>;

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return parts.map((p, i) => (p.toLowerCase() === q.toLowerCase() ? <mark key={i} className="rounded-[2px] bg-[#fde68a] px-0.5 text-ink">{p}</mark> : p));
}

/** Full-text search across transcripts, extracted facts and session summaries. */
export function KnowledgeSearch({ data }: { data: Data }) {
  const [q, setQ] = React.useState("");
  const query = q.trim();
  const results = React.useMemo(() => {
    if (query.length < 2) return null;
    const needle = query.toLowerCase();
    return {
      segments: data.segments.filter((s) => s.text.toLowerCase().includes(needle) || s.speakerLabel.toLowerCase().includes(needle)).slice(0, 40),
      facts: data.facts.filter((f) => f.text.toLowerCase().includes(needle)).slice(0, 20),
      sessions: data.sessions.filter((s) => `${s.title} ${s.summary} ${s.topics.join(" ")}`.toLowerCase().includes(needle)),
    };
  }, [query, data.segments, data.facts, data.sessions]);
  const topics = Array.from(new Set(data.sessions.flatMap((s) => s.topics))).slice(0, 24);

  return (
    <div className="flex flex-col gap-4">
      <Input leading={<Search />} placeholder="Search everything that was said — e.g. consent, restore drill, Kirti Malhotra…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-2xl" aria-label="Search the event knowledge base" />
      {!results ? (
        <Panel className="p-5">
          <p className="text-sm font-medium">Topics across the event</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {topics.map((t) => (
              <button key={t} onClick={() => setQ(t)} className="rounded-full border border-line bg-subtle px-2.5 py-1 text-xs text-ink-2 hover:border-accent hover:text-accent">
                {t}
              </button>
            ))}
          </div>
          {topics.length === 0 && <EmptyState compact icon={<Waypoints />} title="The knowledge base is empty" description="It fills as recordings are transcribed and analysed." />}
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
          <Panel>
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium">
              <Captions className="size-4 text-ink-3" /> Transcript matches <Badge>{results.segments.length}</Badge>
            </div>
            <ul className="divide-y divide-line">
              {results.segments.map((s) => {
                const video = data.videos.find((v) => v.id === s.videoId);
                return (
                  <li key={s.id}>
                    <Link href={`/app/media/${s.videoId}?t=${s.start}`} className="block px-4 py-3 hover:bg-subtle">
                      <p className="flex items-center gap-1.5 text-xs text-ink-3">
                        <span className="tabular font-mono text-accent">{formatDuration(s.start)}</span> · {highlight(s.speakerLabel, query)} · <span className="truncate">{video?.title}</span>
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-2">{highlight(s.text, query)}</p>
                    </Link>
                  </li>
                );
              })}
              {results.segments.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-3">No transcript matches.</li>}
            </ul>
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel>
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium">
                <Quote className="size-4 text-ink-3" /> Facts <Badge>{results.facts.length}</Badge>
              </div>
              <ul className="divide-y divide-line">
                {results.facts.map((f) => (
                  <li key={f.id} className="px-4 py-2.5">
                    <Badge tone="outline">{factKindLabel[f.kind]}</Badge>
                    <p className="mt-1.5 text-sm text-ink-2">{highlight(f.text, query)}</p>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel>
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium">
                <Waypoints className="size-4 text-ink-3" /> Sessions <Badge>{results.sessions.length}</Badge>
              </div>
              <ul className="divide-y divide-line">
                {results.sessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/app/media/${s.videoId}`} className="block px-4 py-2.5 text-sm hover:bg-subtle">
                      {highlight(s.title, query)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

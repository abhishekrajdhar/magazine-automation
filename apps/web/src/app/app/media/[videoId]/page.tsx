"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Captions, Check, ChevronDown, ChevronUp, Clapperboard, ExternalLink, Locate, Pencil, Play, Quote, Search, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { useProjectData } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Avatar, Badge, EmptyState, Panel, PanelHeader, SimulatedBadge } from "@/components/ui/display";
import { Select } from "@/components/ui/overlays";
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from "@/components/ui/primitives";
import { RecordingPlayer, type PlayerHandle } from "@/components/media/recording-player";
import { FactsList } from "@/components/media/facts-list";
import { VerificationBadge } from "@/components/media/speakers-table";
import { SourceGlyph } from "@/components/shell/logo";
import { processingState, transcriptionState } from "@/lib/domain/status";
import type { TranscriptSegment } from "@/lib/domain/types";
import { useApiStatus } from "@/lib/api/use-api-status";
import { live } from "@/lib/api/live";
import { cn } from "@/lib/utils/cn";
import { formatDuration, initials, uid } from "@/lib/utils/format";

function VideoIntelligence() {
  const { videoId } = useParams<{ videoId: string }>();
  const params = useSearchParams();
  const video = useWorkspace((s) => s.videos.find((v) => v.id === videoId));
  const data = useProjectData(video?.projectId);
  const setActiveProject = useWorkspace((s) => s.setActiveProject);
  React.useEffect(() => {
    if (video) setActiveProject(video.projectId);
  }, [video, setActiveProject]);
  const localUrl = useWorkspace((s) => s.localFiles[videoId]?.url);
  const updateSegment = useWorkspace((s) => s.updateSegment);
  const updateSession = useWorkspace((s) => s.updateSession);
  const updateVideo = useWorkspace((s) => s.updateVideo);
  const mode = useWorkspace((s) => s.mode);
  const api = useApiStatus();
  const player = React.useRef<PlayerHandle>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [time, setTime] = React.useState(0);
  const [follow, setFollow] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [matchIndex, setMatchIndex] = React.useState(0);
  const [editingSeg, setEditingSeg] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<{ text: string; segment: TranscriptSegment; x: number; y: number } | null>(null);
  const [editingSummary, setEditingSummary] = React.useState(false);
  const [summaryDraft, setSummaryDraft] = React.useState("");

  const segments = React.useMemo(() => data.segments.filter((s) => s.videoId === videoId).sort((a, b) => a.start - b.start), [data.segments, videoId]);
  const session = data.sessions.find((s) => s.videoId === videoId);
  const speakers = data.speakers.filter((s) => s.videoIds.includes(videoId) || session?.speakerIds.includes(s.id));
  const facts = data.facts.filter((f) => f.videoId === videoId);
  const active = segments.findLast((s) => s.start <= time + 0.5);
  const matches = React.useMemo(() => (query.trim().length > 1 ? segments.filter((s) => s.text.toLowerCase().includes(query.toLowerCase())) : []), [segments, query]);

  const seek = React.useCallback((t: number, play = true) => {
    player.current?.seek(t, play);
    setTime(t);
  }, []);

  React.useEffect(() => {
    const t = Number(params.get("t"));
    if (t > 0) setTimeout(() => seek(t, false), 50);
  }, [params, seek]);

  React.useEffect(() => {
    if (!follow || !active || editingSeg) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-seg="${active.id}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, follow, editingSeg]);

  React.useEffect(() => {
    const m = matches[matchIndex];
    if (m) listRef.current?.querySelector<HTMLElement>(`[data-seg="${m.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [matchIndex, matches]);

  if (!video) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-16">
        <Panel>
          <EmptyState icon={<Clapperboard />} title="Recording not found" action={<Button variant="secondary" asChild><Link href="/app/media">Back to media library</Link></Button>} />
        </Panel>
      </div>
    );
  }

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (text.length < 12 || !sel?.rangeCount) return setSelection(null);
    const node = sel.anchorNode?.parentElement?.closest<HTMLElement>("[data-seg]");
    const seg = segments.find((s) => s.id === node?.dataset.seg);
    if (!seg || !seg.text.includes(text)) return setSelection(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setSelection({ text, segment: seg, x: rect.left + rect.width / 2, y: rect.top });
  };

  const saveQuote = () => {
    if (!selection || !data.project) return;
    useWorkspace.setState((s) => ({
      facts: [
        ...s.facts,
        { id: uid("fact"), projectId: data.project!.id, videoId, segmentId: selection.segment.id, kind: "quote", text: selection.text, speakerId: selection.segment.speakerId, timestamp: selection.segment.start, provenance: "transcript_verbatim", status: "pending", confidence: 1 },
      ],
    }));
    toast.success("Saved as quotation", { description: "Verbatim from the transcript · pending approval" });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const process = async () => {
    try {
      updateVideo(video.id, { processing: { ...video.processing, state: "queued", progress: 0, updatedAt: new Date().toISOString() } });
      await live.processVideo(video.id);
      toast.success("Processing queued");
    } catch (err) {
      updateVideo(video.id, { processing: { ...video.processing, state: "failed", message: (err as Error).message, updatedAt: new Date().toISOString() } });
      toast.error((err as Error).message);
    }
  };

  const proc = processingState[video.processing.state];
  const apiLive = mode === "live" && api.online;

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SourceGlyph type={video.sourceType} className="text-ink-3" />
            <Badge tone={proc.tone} dot pulse={proc.busy}>
              {proc.label}
            </Badge>
            <Badge tone={transcriptionState[video.transcription.state].tone}>
              {transcriptionState[video.transcription.state].label}
              {video.transcription.method === "demo_seed" ? " · seeded excerpt" : video.transcription.method ? ` · ${video.transcription.method.replace("_", " ")}` : ""}
            </Badge>
            {video.simulated && <SimulatedBadge />}
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-[-0.01em]">{video.title}</h1>
          <p className="mt-1 text-sm text-ink-3">
            {formatDuration(video.durationSec)} · {segments.length} transcript segments · {speakers.length} speakers · {facts.length} facts
          </p>
        </div>
        <div className="flex gap-2">
          {video.url && !video.simulated && (
            <Button variant="secondary" asChild>
              <a href={video.url} target="_blank" rel="noreferrer">
                <ExternalLink /> Open source
              </a>
            </Button>
          )}
          {video.processing.state !== "ready" && (
            <Tooltip content={apiLive ? "Queue acquisition, transcription and analysis" : "Processing needs the PressFlow API, which isn't connected."}>
              <span>
                <Button variant="primary" disabled={!apiLive} onClick={process}>
                  <Play /> Process recording
                </Button>
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <RecordingPlayer ref={player} video={video} localUrl={localUrl} onTime={setTime} />

          {session ? (
            <Panel>
              <PanelHeader
                title={session.title}
                description={`${session.kind[0].toUpperCase()}${session.kind.slice(1)} session`}
                actions={
                  <Button
                    variant={session.status === "approved" ? "subtle" : "secondary"}
                    size="sm"
                    onClick={() => {
                      updateSession(session.id, { status: session.status === "approved" ? "draft" : "approved" });
                      toast.success(session.status === "approved" ? "Session returned to draft" : "Session summary approved");
                    }}
                  >
                    <Check className={session.status === "approved" ? "text-success" : undefined} /> {session.status === "approved" ? "Approved" : "Approve session"}
                  </Button>
                }
              />
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <Badge tone="accent" icon={<Sparkles />}>
                    AI summary — interpretation, not a quotation
                  </Badge>
                  {!editingSummary && (
                    <Button variant="ghost" size="xs" onClick={() => { setSummaryDraft(session.summary); setEditingSummary(true); }}>
                      <Pencil /> Edit
                    </Button>
                  )}
                </div>
                {editingSummary ? (
                  <div className="mt-2">
                    <Textarea rows={4} value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} aria-label="Session summary" />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditingSummary(false)}>Cancel</Button>
                      <Button size="sm" variant="primary" onClick={() => { updateSession(session.id, { summary: summaryDraft, status: "draft" }); setEditingSummary(false); toast.success("Summary updated"); }}>Save</Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm leading-relaxed text-ink-2">{session.summary}</p>
                )}
                <p className="mt-4 text-xs font-medium text-ink-3">Topics</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {session.topics.map((t) => (
                    <Badge key={t} tone="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            </Panel>
          ) : (
            <Panel className="p-4 text-sm text-ink-3">No session analysis yet. Sessions, topics and summaries appear after this recording is processed.</Panel>
          )}

          <Panel>
            <PanelHeader title="Speakers in this recording" actions={<Button variant="ghost" size="xs" asChild><Link href="/app/media?tab=speakers">Manage</Link></Button>} />
            <ul className="divide-y divide-line">
              {speakers.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar initials={initials(s.name)} seed={s.id} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="truncate text-xs text-ink-3">
                      {s.designation}, {s.organisation}
                    </p>
                  </div>
                  <VerificationBadge v={s.verification} />
                </li>
              ))}
              {speakers.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-3">No speakers identified yet.</li>}
            </ul>
          </Panel>
        </div>

        <Panel className="flex min-h-[640px] min-w-0 flex-col xl:sticky xl:top-4 xl:h-[calc(100dvh-140px)]">
          <Tabs defaultValue={params.get("tab") === "facts" ? "facts" : "transcript"} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="px-3">
              <TabsTrigger value="transcript">
                <Captions /> Transcript
              </TabsTrigger>
              <TabsTrigger value="facts">
                <Quote /> Quotes & facts <Badge>{facts.length}</Badge>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="transcript" className="flex min-h-0 flex-1 flex-col">
              {segments.length === 0 ? (
                <EmptyState
                  icon={<Captions />}
                  title="No transcript yet"
                  description={video.processing.message ?? (video.sourceType === "youtube" ? "Captions are fetched through the YouTube Data API when your account owns the video; otherwise upload the original recording for transcription." : "The transcript appears after processing.")}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                    <Input
                      inputSize="sm"
                      className="min-w-0 flex-1"
                      leading={<Search />}
                      placeholder="Search transcript…"
                      value={query}
                      onChange={(e) => { setQuery(e.target.value); setMatchIndex(0); }}
                      onKeyDown={(e) => e.key === "Enter" && matches.length && setMatchIndex((i) => (i + (e.shiftKey ? -1 : 1) + matches.length) % matches.length)}
                      aria-label="Search transcript"
                      trailing={query ? <span className="tabular pr-1 text-[11px] text-ink-4">{matches.length ? `${matchIndex + 1}/${matches.length}` : "0"}</span> : undefined}
                    />
                    <Button variant="ghost" size="icon-xs" disabled={!matches.length} onClick={() => setMatchIndex((i) => (i - 1 + matches.length) % matches.length)} aria-label="Previous match"><ChevronUp /></Button>
                    <Button variant="ghost" size="icon-xs" disabled={!matches.length} onClick={() => setMatchIndex((i) => (i + 1) % matches.length)} aria-label="Next match"><ChevronDown /></Button>
                    <label className="ml-1 flex items-center gap-1.5 text-xs text-ink-3">
                      <Switch checked={follow} onCheckedChange={setFollow} aria-label="Follow playback" /> <Locate className="size-3.5" /> Follow
                    </label>
                  </div>
                  <div ref={listRef} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto px-2 py-2" onMouseUp={onMouseUp} onScroll={() => setSelection(null)}>
                    <p className="mx-2 mb-2 rounded-md bg-subtle px-2.5 py-1.5 text-[11px] text-ink-3">Select any passage to save it as a verbatim quotation. Double-click a line to correct it.</p>
                    {segments.map((s, i) => {
                      const isActive = active?.id === s.id;
                      const isMatch = matches[matchIndex]?.id === s.id;
                      const gap = i > 0 && s.start - segments[i - 1].end > 45;
                      return (
                        <React.Fragment key={s.id}>
                          {gap && <div className="mx-3 my-2 border-t border-dashed border-line text-center text-[10px] leading-none text-ink-4"><span className="relative -top-[6px] bg-surface px-2">{formatDuration(s.start - segments[i - 1].end)} not excerpted</span></div>}
                          <div data-seg={s.id} className={cn("group rounded-md px-2.5 py-2 transition-colors", isActive ? "bg-accent-soft" : "hover:bg-subtle", isMatch && "ring-2 ring-[#f5c84c]")}>
                            <div className="flex items-center gap-2">
                              <button className="tabular rounded font-mono text-[11px] text-accent hover:underline" onClick={() => seek(s.start)} aria-label={`Play from ${formatDuration(s.start)}`}>
                                {formatDuration(s.start)}
                              </button>
                              <Select
                                size="sm"
                                className="h-6 w-auto max-w-[220px] border-transparent bg-transparent px-1.5 text-xs font-medium shadow-none hover:border-line"
                                aria-label="Speaker"
                                value={s.speakerId ?? ""}
                                onValueChange={(v) => {
                                  const sp = data.speakers.find((x) => x.id === v);
                                  updateSegment(s.id, { speakerId: v, speakerLabel: sp?.name ?? s.speakerLabel });
                                  toast.success(`Reassigned to ${sp?.name}`);
                                }}
                                options={data.speakers.filter((x) => session?.speakerIds.includes(x.id) || x.id === s.speakerId).map((x) => ({ value: x.id, label: x.name }))}
                              />
                            </div>
                            {editingSeg === s.id ? (
                              <SegmentEditor text={s.text} onCancel={() => setEditingSeg(null)} onSave={(text) => { updateSegment(s.id, { text }); setEditingSeg(null); toast.success("Transcript corrected"); }} />
                            ) : (
                              <p className="mt-1 cursor-text text-sm leading-relaxed text-ink-2" onDoubleClick={() => setEditingSeg(s.id)}>
                                {query.length > 1 ? s.text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig")).map((p, j) => (p.toLowerCase() === query.toLowerCase() ? <mark key={j} className="rounded-[2px] bg-[#fde68a] px-0.5">{p}</mark> : p)) : s.text}
                              </p>
                            )}
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </>
              )}
            </TabsContent>
            <TabsContent value="facts" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
              <FactsList facts={facts} speakers={data.speakers} videos={data.videos} segments={data.segments} compact onSeek={(t) => seek(t)} />
            </TabsContent>
          </Tabs>
        </Panel>
      </div>

      {selection && (
        <div className="fixed z-40 -translate-x-1/2 -translate-y-full animate-fade-in pb-2" style={{ left: selection.x, top: selection.y }}>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1 shadow-lg">
            <Button size="sm" variant="primary" onMouseDown={(e) => e.preventDefault()} onClick={saveQuote}>
              <Quote /> Save as quotation
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setSelection(null)} aria-label="Dismiss">
              <X />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SegmentEditor({ text, onSave, onCancel }: { text: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [value, setValue] = React.useState(text);
  return (
    <div className="mt-1.5">
      <Textarea
        autoFocus
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(value.trim());
        }}
        aria-label="Correct transcript line"
      />
      <div className="mt-1.5 flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-ink-4">Quotes taken from this line are re-checked against the corrected text.</span>
        <Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="xs" variant="primary" disabled={!value.trim()} onClick={() => onSave(value.trim())}>Save</Button>
      </div>
    </div>
  );
}

export default function VideoPage() {
  return (
    <React.Suspense>
      <VideoIntelligence />
    </React.Suspense>
  );
}

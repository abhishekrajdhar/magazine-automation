"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clapperboard, Clock, Images, Plus, Quote, Search, Users, Waypoints } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { useProjectData } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui/display";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { MediaCard } from "@/components/media/media-card";
import { MediaStep } from "@/components/wizard/media-step";
import type { DraftMedia } from "@/components/wizard/types";
import { SpeakersTable } from "@/components/media/speakers-table";
import { FactsList } from "@/components/media/facts-list";
import { PhotoLibrary } from "@/components/media/photo-library";
import { KnowledgeSearch } from "@/components/media/knowledge-search";
import { processingState, transcriptionState } from "@/lib/domain/status";
import { useApiStatus } from "@/lib/api/use-api-status";
import { live } from "@/lib/api/live";
import { formatDurationLong, uid } from "@/lib/utils/format";

function MediaLibrary() {
  const router = useRouter();
  const params = useSearchParams();
  const data = useProjectData();
  const { project, videos, speakers, facts, assets } = data;
  const mode = useWorkspace((s) => s.mode);
  const addVideo = useWorkspace((s) => s.addVideo);
  const removeVideo = useWorkspace((s) => s.removeVideo);
  const registerLocalFile = useWorkspace((s) => s.registerLocalFile);
  const api = useApiStatus();
  const [tab, setTab] = React.useState(params.get("tab") ?? "recordings");
  const [adding, setAdding] = React.useState(params.get("add") === "1");
  const [draft, setDraft] = React.useState<DraftMedia[]>([]);
  const [filter, setFilter] = React.useState("");
  const apiLive = mode === "live" && api.online;

  if (!project) return null;
  const totalSec = videos.reduce((n, v) => n + (v.durationSec ?? 0), 0);
  const pendingFacts = facts.filter((f) => f.status === "pending").length;
  const visible = videos.filter((v) => !filter || v.title.toLowerCase().includes(filter.toLowerCase()));

  const saveDraft = async () => {
    for (const m of draft) {
      if (apiLive) {
        try {
          const added = m.file ? [await live.uploadVideo(project.id, m.file)] : await live.addVideoFromUrl(project.id, m.url!, m.title);
          added.forEach(addVideo);
        } catch (err) {
          toast.error(`${m.title}: ${(err as Error).message}`);
        }
        continue;
      }
      const id = uid("vid");
      addVideo({
        id,
        projectId: project.id,
        sourceType: m.sourceType,
        url: m.url,
        externalId: m.externalId,
        fileName: m.fileName,
        fileSizeBytes: m.fileSize,
        title: m.title,
        durationSec: m.durationSec,
        thumbnailUrl: m.thumbnailUrl,
        processing: { state: m.sourceType === "google_drive" ? "needs_auth" : "pending", progress: 0, message: m.sourceType === "google_drive" ? "Authorise Google Drive to download this recording." : "Processing requires the PressFlow API, which isn't connected.", updatedAt: new Date().toISOString() },
        transcription: { state: "none" },
        simulated: false,
        addedAt: new Date().toISOString(),
      });
      if (m.file) registerLocalFile(id, m.file);
    }
    toast.success(`${draft.length} recording${draft.length === 1 ? "" : "s"} added`, { description: apiLive ? undefined : "Saved in this workspace; not processed." });
    setDraft([]);
    setAdding(false);
  };

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-7">
      <PageHeader
        title="Event Media Library"
        description={`Recordings, speakers, extracted facts and photographs for ${project.eventName}.`}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus /> Add recordings
          </Button>
        }
      />

      <Panel className="mt-6 grid grid-cols-2 divide-line md:grid-cols-5 md:divide-x">
        <Stat label="Recordings" icon={<Clapperboard />} value={videos.length} sub={`${videos.filter((v) => v.processing.state === "ready").length} processed`} />
        <Stat label="Total running time" icon={<Clock />} value={formatDurationLong(totalSec)} sub="across all sessions" />
        <Stat label="Speakers" icon={<Users />} value={speakers.length} sub={`${speakers.filter((s) => s.verification !== "confirmed").length} need verification`} />
        <Stat label="Facts & quotes" icon={<Quote />} value={facts.length} sub={<span className={pendingFacts ? "text-warning" : undefined}>{pendingFacts} awaiting review</span>} />
        <Stat label="Photographs" icon={<Images />} value={assets.filter((a) => a.kind !== "ad").length} sub="in the asset library" />
      </Panel>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="recordings">
            <Clapperboard /> Recordings
          </TabsTrigger>
          <TabsTrigger value="speakers">
            <Users /> Speakers
          </TabsTrigger>
          <TabsTrigger value="facts">
            <Quote /> Facts & quotes {pendingFacts > 0 && <Badge tone="warning">{pendingFacts}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="search">
            <Waypoints /> Knowledge base
          </TabsTrigger>
          <TabsTrigger value="photos">
            <Images /> Photographs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recordings" className="pt-5">
          {videos.length === 0 ? (
            <Panel>
              <EmptyState icon={<Clapperboard />} title="No recordings yet" description="Add YouTube or Google Drive links, or upload session recordings." action={<Button variant="primary" onClick={() => setAdding(true)}><Plus /> Add recordings</Button>} />
            </Panel>
          ) : (
            <>
              <Input className="mb-4 w-full sm:w-72" leading={<Search />} placeholder="Filter recordings…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter recordings" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {visible.map((v, i) => (
                  <MediaCard
                    key={v.id}
                    sourceType={v.sourceType}
                    title={v.title}
                    subtitle={data.sessions.find((s) => s.id === v.sessionId)?.kind.replace(/^\w/, (c) => c.toUpperCase()) ?? v.fileName}
                    durationSec={v.durationSec}
                    sizeBytes={v.fileSizeBytes}
                    thumbnailUrl={v.thumbnailUrl}
                    placeholderSeed={v.simulated ? 400 + i * 31 : undefined}
                    processing={processingState[v.processing.state]}
                    transcription={transcriptionState[v.transcription.state]}
                    simulated={v.simulated}
                    note={v.processing.state !== "ready" ? v.processing.message : `${v.transcription.wordCount ?? 0} words · ${speakers.filter((s) => s.videoIds.includes(v.id)).length} speakers · ${facts.filter((f) => f.videoId === v.id).length} facts`}
                    onClick={() => router.push(`/app/media/${v.id}`)}
                    onRemove={v.simulated ? undefined : () => removeVideo(v.id)}
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="speakers" className="pt-5">
          <SpeakersTable speakers={speakers} sessions={data.sessions} />
        </TabsContent>
        <TabsContent value="facts" className="pt-5">
          <FactsList facts={facts} speakers={speakers} videos={videos} segments={data.segments} />
        </TabsContent>
        <TabsContent value="search" className="pt-5">
          <KnowledgeSearch data={data} />
        </TabsContent>
        <TabsContent value="photos" className="pt-5">
          <PhotoLibrary assets={assets} sessions={data.sessions} />
        </TabsContent>
      </Tabs>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent
          title="Add recordings"
          description={`To ${project.title}`}
          size="xl"
          footer={
            <>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!draft.length || draft.some((d) => d.resolve === "pending" && !d.url)} onClick={saveDraft}>
                Add {draft.length || ""} recording{draft.length === 1 ? "" : "s"}
              </Button>
            </>
          }
        >
          <MediaStep media={draft} onChange={(fn) => setDraft(fn)} apiOnline={apiLive} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function MediaPage() {
  return (
    <React.Suspense>
      <MediaLibrary />
    </React.Suspense>
  );
}


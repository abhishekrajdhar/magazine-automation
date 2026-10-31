"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, FileText, NotebookPen, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { useProjectData } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, EmptyState, PageHeader, Panel, SimulatedBadge, Table, Td, Th } from "@/components/ui/display";
import { Dialog, DialogContent, Select } from "@/components/ui/overlays";
import { Checkbox, Segmented, Tooltip } from "@/components/ui/primitives";
import { articleStatus, articleTypeLabel } from "@/lib/domain/status";
import type { ArticleStatus, ArticleType } from "@/lib/domain/types";
import { claimSummary, verifyArticle } from "@/lib/editorial/verify";
import { useApiStatus, integration } from "@/lib/api/use-api-status";
import { live } from "@/lib/api/live";
import { formatRelative, wordCount } from "@/lib/utils/format";

type View = "all" | "pending" | "draft" | "approved" | "rejected";

function Studio() {
  const router = useRouter();
  const params = useSearchParams();
  const data = useProjectData();
  const { project, articles, segments, pages, sessions } = data;
  const mode = useWorkspace((s) => s.mode);
  const api = useApiStatus();
  const [view, setView] = React.useState<View>(params.get("status") === "pending" ? "pending" : "all");
  const [type, setType] = React.useState<"all" | ArticleType>("all");
  const [query, setQuery] = React.useState("");
  const [generating, setGenerating] = React.useState(false);

  const verification = React.useMemo(() => Object.fromEntries(articles.map((a) => [a.id, claimSummary(verifyArticle(a, segments))])), [articles, segments]);
  const matchesView = (s: ArticleStatus) =>
    view === "all" || (view === "pending" && (s === "in_review" || s === "needs_revision")) || (view === "draft" && s === "draft") || (view === "approved" && s === "approved") || (view === "rejected" && s === "rejected");
  const list = articles.filter((a) => matchesView(a.status) && (type === "all" || a.type === type) && (!query || `${a.headline} ${a.subheadline}`.toLowerCase().includes(query.toLowerCase())));
  const count = (v: View) => articles.filter((a) => (v === "all" ? true : v === "pending" ? a.status === "in_review" || a.status === "needs_revision" : a.status === v)).length;
  const llm = integration(api.integrations, "llm");

  if (!project) return null;

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-7">
      <PageHeader
        title="Content Studio"
        description="Articles drafted from approved facts. Nothing reaches a page in final output until an editor approves it."
        actions={
          <Button variant="primary" onClick={() => setGenerating(true)}>
            <Sparkles /> Generate articles
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "all", label: `All ${count("all")}` },
            { value: "pending", label: `Needs review ${count("pending")}` },
            { value: "draft", label: `Drafts ${count("draft")}` },
            { value: "approved", label: `Approved ${count("approved")}` },
            { value: "rejected", label: `Rejected ${count("rejected")}` },
          ]}
        />
        <Select size="md" className="w-52" aria-label="Filter by article type" value={type} onValueChange={setType} options={[{ value: "all", label: "All article types" }, ...(Object.keys(articleTypeLabel) as ArticleType[]).map((t) => ({ value: t, label: articleTypeLabel[t] }))]} />
        <Input className="ml-auto w-full sm:w-64" leading={<Search />} placeholder="Search headlines…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search articles" />
      </div>

      {articles.length === 0 ? (
        <Panel className="mt-4">
          <EmptyState icon={<NotebookPen />} title="No articles yet" description="Process recordings and approve facts, then generate drafts. Generation needs an LLM provider configured on the API." action={<Button variant="primary" onClick={() => setGenerating(true)}><Sparkles /> Generate articles</Button>} />
        </Panel>
      ) : (
        <Panel className="mt-4 overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Article</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th className="text-right">Words</Th>
                <Th>Sources</Th>
                <Th>Placed</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const v = verification[a.id];
                const placed = pages.map((p, i) => (p.articleId === a.id ? i + 1 : null)).filter((x): x is number => x !== null);
                return (
                  <tr key={a.id} className="group cursor-pointer hover:bg-subtle" onClick={() => router.push(`/app/studio/${a.id}`)}>
                    <Td className="max-w-[440px]">
                      <span className="block truncate font-medium group-hover:text-accent">{a.headline.replace(/[“”]/g, "")}</span>
                      <span className="flex items-center gap-1.5 truncate text-xs text-ink-3">
                        {a.reviewNote ? <span className="truncate text-warning">{a.reviewNote}</span> : <span className="truncate">{a.subheadline}</span>}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-ink-2">{articleTypeLabel[a.type]}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={articleStatus[a.status].tone} dot>
                          {articleStatus[a.status].label}
                        </Badge>
                        {a.generatedBy === "demo_seed" && <SimulatedBadge label="Seeded" title="Pre-written demo draft, not generated by a model in this session." />}
                      </div>
                    </Td>
                    <Td className="tabular text-right text-ink-2">{wordCount([a.intro, ...a.body.map((b) => b.text)].join(" "))}</Td>
                    <Td className="whitespace-nowrap">
                      {v.total === 0 ? (
                        <span className="text-xs text-ink-4">No claims</span>
                      ) : v.missing ? (
                        <Tooltip content={`${v.missing} quotation or figure not found in the transcripts`}>
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
                            <CircleAlert className="size-3.5" /> {v.missing} unverified
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip content={`${v.verified} of ${v.total} quotations and figures found in the transcripts`}>
                          <span className="inline-flex items-center gap-1 text-xs text-success">
                            <CircleCheck className="size-3.5" /> {v.verified}/{v.total} verified
                          </span>
                        </Tooltip>
                      )}
                    </Td>
                    <Td className="tabular whitespace-nowrap text-xs text-ink-3">{placed.length ? `p.${placed.join(", ")}` : "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-ink-3">{formatRelative(a.updatedAt)}</Td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-3">
                    No articles match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </Panel>
      )}

      <GenerateDialog
        open={generating}
        onOpenChange={setGenerating}
        sessions={sessions}
        llmConfigured={mode === "live" && api.online && !!llm?.available}
        llmDetail={!api.online ? "The PressFlow API isn't connected." : llm?.detail ?? "No LLM provider is configured on the API."}
        onGenerate={async (types, sessionIds) => {
          try {
            await live.generateArticles(project.id, types, sessionIds);
            toast.success("Generation queued", { description: "Drafts appear here as they finish. Each needs editorial approval." });
            setGenerating(false);
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
      />
    </div>
  );
}

function GenerateDialog({ open, onOpenChange, sessions, llmConfigured, llmDetail, onGenerate }: { open: boolean; onOpenChange: (o: boolean) => void; sessions: { id: string; title: string; status: string }[]; llmConfigured: boolean; llmDetail: string; onGenerate: (types: string[], sessions: string[]) => void }) {
  const [types, setTypes] = React.useState<ArticleType[]>(["event_report", "panel", "interview"]);
  const [picked, setPicked] = React.useState<string[]>([]);
  React.useEffect(() => setPicked(sessions.filter((s) => s.status === "approved").map((s) => s.id)), [sessions]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Generate article drafts"
        description="Drafts are written only from approved facts and transcript excerpts, with a source reference on every paragraph."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!llmConfigured || !types.length || !picked.length} onClick={() => onGenerate(types, picked)}>
              <Sparkles /> Generate {types.length} type{types.length === 1 ? "" : "s"}
            </Button>
          </>
        }
      >
        {!llmConfigured && (
          <div className="mb-4 flex items-start gap-2.5 rounded-md border border-warning-dot/40 bg-warning-soft px-3 py-2.5 text-sm text-warning">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Generation is unavailable</p>
              <p className="mt-0.5 text-[13px]">
                {llmDetail} Configure an LLM provider on the API (see <Link href="/app/settings?tab=integrations" className="underline">Settings → Integrations</Link>). The demo workspace includes 18 pre-written drafts so you can explore editing and approval.
              </p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium">Article types</p>
            <div className="mt-2 flex flex-col gap-1">
              {(Object.keys(articleTypeLabel) as ArticleType[]).map((t) => (
                <label key={t} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-subtle">
                  <Checkbox checked={types.includes(t)} onCheckedChange={() => setTypes((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))} />
                  {articleTypeLabel[t]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium">From sessions</p>
            <div className="mt-2 flex flex-col gap-1">
              {sessions.map((s) => (
                <label key={s.id} className="flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-subtle">
                  <Checkbox className="mt-0.5" checked={picked.includes(s.id)} onCheckedChange={() => setPicked((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]))} />
                  <span className="min-w-0">
                    <span className="block">{s.title}</span>
                    {s.status !== "approved" && <span className="text-xs text-warning">Session not yet approved</span>}
                  </span>
                </label>
              ))}
              {sessions.length === 0 && <p className="text-sm text-ink-3">No analysed sessions yet.</p>}
            </div>
          </div>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-3">
          <FileText className="size-3.5" /> Every draft lands as “Draft” and needs approval before it can be exported.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default function StudioPage() {
  return (
    <React.Suspense>
      <Studio />
    </React.Suspense>
  );
}

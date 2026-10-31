"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  Columns2,
  Expand,
  FileText,
  Heading2,
  Images,
  Pilcrow,
  Plus,
  Quote,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Shrink,
  Sparkles,
  Trash2,
  Type,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { useProjectData } from "@/lib/store/hooks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar, Badge, EmptyState, Panel, SimulatedBadge } from "@/components/ui/display";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, useConfirm } from "@/components/ui/overlays";
import { Popover, PopoverContent, PopoverTrigger, Segmented, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from "@/components/ui/primitives";
import { AutoTextarea } from "@/components/studio/auto-textarea";
import { SourcePanel } from "@/components/studio/source-panel";
import { VerificationBadge } from "@/components/media/speakers-table";
import { PlaceholderPhoto } from "@/components/magazine/placeholder-photo";
import { articleStatus, articleTypeLabel } from "@/lib/domain/status";
import type { Article, ArticleBlock, ArticleBlockKind, EditorialTone, SourceRef } from "@/lib/domain/types";
import { claimSummary, verifyArticle, type Claim } from "@/lib/editorial/verify";
import { useApiStatus } from "@/lib/api/use-api-status";
import { live } from "@/lib/api/live";
import { cn } from "@/lib/utils/cn";
import { formatDuration, formatRelative, initials, uid, wordCount } from "@/lib/utils/format";

const BLOCK_STYLE: Record<ArticleBlockKind, string> = {
  paragraph: "font-serif text-[17px] leading-[1.65] text-ink",
  answer: "font-serif text-[17px] leading-[1.65] text-ink",
  subhead: "text-[15px] font-semibold text-accent-ink",
  quote: "font-serif text-[20px] italic leading-snug text-accent-ink",
  question: "text-[15px] font-semibold leading-snug text-ink",
  list_item: "font-serif text-[16px] leading-relaxed text-ink",
};

export default function ArticleEditorPage() {
  const { articleId } = useParams<{ articleId: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const article = useWorkspace((s) => s.articles.find((a) => a.id === articleId));
  const data = useProjectData(article?.projectId);
  const updateArticle = useWorkspace((s) => s.updateArticle);
  const setArticleStatus = useWorkspace((s) => s.setArticleStatus);
  const reflowArticle = useWorkspace((s) => s.reflowArticle);
  const mode = useWorkspace((s) => s.mode);
  const api = useApiStatus();
  const [layout, setLayout] = React.useState<"split" | "focus">("split");
  const [focusRefs, setFocusRefs] = React.useState<SourceRef[]>([]);
  const [claims, setClaims] = React.useState<Claim[] | null>(null);
  const [rejecting, setRejecting] = React.useState<null | "needs_revision" | "rejected">(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dirtySincePlacement, setDirtySincePlacement] = React.useState(false);
  const apiLive = mode === "live" && api.online;

  const videos = React.useMemo(() => {
    if (!article) return [];
    const ids = new Set([...data.sessions.filter((s) => article.sessionIds.includes(s.id)).map((s) => s.videoId), ...article.body.flatMap((b) => b.sourceRefs?.map((r) => r.videoId) ?? [])]);
    return data.videos.filter((v) => ids.has(v.id));
  }, [article, data.sessions, data.videos]);
  const cited = React.useMemo(() => new Set(article?.body.flatMap((b) => b.sourceRefs?.map((r) => r.segmentId ?? "") ?? []) ?? []), [article]);

  if (!article) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-16">
        <Panel>
          <EmptyState icon={<FileText />} title="Article not found" action={<Button asChild variant="secondary"><Link href="/app/studio">Content Studio</Link></Button>} />
        </Panel>
      </div>
    );
  }

  const placedOn = data.pages.map((p, i) => (p.articleId === article.id ? i + 1 : null)).filter((x): x is number => x !== null);
  const words = wordCount([article.intro, ...article.body.map((b) => b.text)].join(" "));
  const status = articleStatus[article.status];
  const patch = (p: Partial<Article>) => {
    updateArticle(article.id, p);
    if (placedOn.length) setDirtySincePlacement(true);
    if (claims) setClaims(null);
  };
  const setBlocks = (body: ArticleBlock[]) => patch({ body });
  const updateBlock = (id: string, p: Partial<ArticleBlock>) => setBlocks(article.body.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const insertAfter = (index: number, block: ArticleBlock) => setBlocks([...article.body.slice(0, index + 1), block, ...article.body.slice(index + 1)]);
  const move = (index: number, dir: -1 | 1) => {
    const next = [...article.body];
    const [b] = next.splice(index, 1);
    next.splice(index + dir, 0, b);
    setBlocks(next);
  };

  const runVerify = () => {
    const result = verifyArticle(article, data.segments);
    setClaims(result);
    const s = claimSummary(result);
    if (s.missing) toast.warning(`${s.missing} claim${s.missing > 1 ? "s" : ""} not found in the transcripts`, { description: `${s.verified} of ${s.total} verified.` });
    else toast.success(`All ${s.total} quotations and figures verified against the transcripts`);
    return result;
  };

  const approve = async () => {
    const result = verifyArticle(article, data.segments);
    setClaims(result);
    const s = claimSummary(result);
    if (s.missing && !(await confirm({ title: `${s.missing} claim${s.missing > 1 ? "s" : ""} could not be verified`, description: "A quotation or figure in this article wasn't found in the source transcripts. Approve anyway? Your name is recorded on the approval.", confirmLabel: "Approve anyway", tone: "danger" }))) return;
    if (apiLive) await live.approveArticle(article.id).catch((e) => toast.error((e as Error).message));
    setArticleStatus(article.id, "approved");
    toast.success("Article approved", { description: placedOn.length ? `Pages ${placedOn.join(", ")} are now cleared for export.` : undefined });
  };

  /** AI assistance: the API's LLM in live mode; otherwise pre-generated demo variants where they exist. */
  const assist = async (action: string, opts: { blockId?: string; tone?: EditorialTone } = {}) => {
    if (apiLive) {
      setBusy(action);
      try {
        const r = await live.assist(article.id, { action, ...opts });
        const first = r.suggestions[0];
        if (!first) return toast.error("The model returned no suggestion.");
        if (action === "rewrite_headline") {
          // Alternates are cached in variants by the API; refresh to show them in the menu.
          const fresh = await live.article(article.id);
          useWorkspace.setState((s) => ({ articles: s.articles.map((a) => (a.id === article.id ? { ...a, variants: fresh.variants } : a)) }));
          toast.success(`${r.suggestions.length} headline alternatives ready`, { description: `${r.provider} · ${r.model}` });
          return;
        }
        if (action === "summarise") patch({ variants: { ...article.variants, summary: first } });
        else if (opts.blockId) updateBlock(opts.blockId, { text: first });
        else patch({ intro: first });
        toast.success("Suggestion applied — review it before approving", { description: `${r.provider} · ${r.model}` });
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(null);
      }
      return;
    }
    toast.error("AI assistance needs the PressFlow API with an LLM provider configured.");
  };

  const toneVariant = (tone: EditorialTone) => article.variants?.intros?.[tone];
  const approvedQuotes = data.facts.filter((f) => f.kind === "quote" && f.status === "approved" && videos.some((v) => v.id === f.videoId));
  const speakers = data.speakers.filter((s) => article.speakerIds.includes(s.id));
  const summary = claims ? claimSummary(claims) : null;

  return (
    <div className="flex h-[calc(100dvh-48px-29px)] min-h-[600px] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <Button variant="ghost" size="icon-sm" onClick={() => router.push("/app/studio")} aria-label="Back to Content Studio">
          <ArrowLeft />
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          <span className="truncate text-xs text-ink-3">
            {articleTypeLabel[article.type]} · {words} words · edited {formatRelative(article.updatedAt)}
          </span>
          {article.generatedBy === "demo_seed" && <SimulatedBadge label="Seeded draft" title="Pre-written demo content, not generated by a model in this session." />}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            value={layout}
            onChange={setLayout}
            options={[
              { value: "split", label: "Transcript | Article", icon: <Columns2 /> },
              { value: "focus", label: "Article", icon: <FileText /> },
            ]}
          />
          <Button variant="secondary" size="sm" onClick={runVerify}>
            <ShieldCheck /> Verify sources
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" disabled={article.status === "rejected"}>
                Request changes
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<RotateCcw />} onSelect={() => { setNote(article.reviewNote ?? ""); setRejecting("needs_revision"); }}>
                Needs revision…
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Ban />} tone="danger" onSelect={() => { setNote(""); setRejecting("rejected"); }}>
                Reject draft…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="primary" size="sm" disabled={article.status === "approved"} onClick={approve}>
            <BadgeCheck /> {article.status === "approved" ? "Approved" : "Approve"}
          </Button>
        </div>
      </div>

      {(article.status === "needs_revision" || article.status === "rejected") && article.reviewNote && (
        <div className="flex items-center gap-2 border-b border-danger/15 bg-danger-soft px-5 py-2 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> <span className="font-medium">Review note:</span> {article.reviewNote}
        </div>
      )}
      {dirtySincePlacement && placedOn.length > 0 && (
        <div className="flex items-center gap-3 border-b border-accent-line bg-accent-soft px-5 py-2 text-sm text-accent-ink">
          <RefreshCw className="size-4 shrink-0" />
          <span className="flex-1">This article is placed on page{placedOn.length > 1 ? "s" : ""} {placedOn.join(", ")}. Re-flow those pages to apply your edits.</span>
          <Button
            size="xs"
            variant="primary"
            onClick={() => {
              reflowArticle(article.id);
              setDirtySincePlacement(false);
              toast.success("Pages re-flowed", { description: "Undo is available in the designer." });
            }}
          >
            Re-flow pages
          </Button>
        </div>
      )}

      <div className={cn("grid min-h-0 flex-1", layout === "split" ? "grid-cols-1 lg:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.3fr)_320px]" : "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]")}>
        {layout === "split" && (
          <div className="hidden min-h-0 flex-col border-r border-line bg-surface lg:flex">
            <div className="border-b border-line px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">Original transcript</div>
            <SourcePanel videos={videos} segments={data.segments} cited={cited} focus={focusRefs} />
          </div>
        )}

        <div className="scroll-thin min-h-0 overflow-y-auto bg-canvas">
          <article className="mx-auto max-w-[720px] px-8 py-10">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">{layout === "split" ? "AI-generated article" : "Article"}</p>
            <AutoTextarea value={article.kicker ?? ""} onChange={(e) => patch({ kicker: e.target.value })} placeholder="Kicker" className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-accent" aria-label="Kicker" />
            <div className="group relative">
              <AutoTextarea value={article.headline} onChange={(e) => patch({ headline: e.target.value })} placeholder="Headline" className="mt-2 font-serif text-[34px] font-semibold leading-[1.12] tracking-[-0.015em] text-ink" aria-label="Headline" />
              <HeadlineVariants article={article} apiLive={apiLive} onPick={(h) => patch({ headline: h })} onGenerate={() => assist("rewrite_headline")} />
            </div>
            <AutoTextarea value={article.subheadline} onChange={(e) => patch({ subheadline: e.target.value })} placeholder="Standfirst" className="mt-3 text-[17px] leading-relaxed text-ink-2" aria-label="Standfirst" />
            <AutoTextarea value={article.byline ?? ""} onChange={(e) => patch({ byline: e.target.value })} placeholder="Byline" className="mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-ink-3" aria-label="Byline" />
            <div className="my-6 h-px bg-line" />
            <div className="rounded-md border border-transparent px-3 py-2 hover:border-line focus-within:border-accent-line focus-within:bg-surface">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-4">Introduction</p>
              <AutoTextarea value={article.intro} onChange={(e) => patch({ intro: e.target.value })} className="font-serif text-[18px] leading-[1.6] text-ink" aria-label="Introduction" />
            </div>

            <div className="mt-2 flex flex-col">
              {article.body.map((b, i) => (
                <BlockRow
                  key={b.id}
                  block={b}
                  index={i}
                  total={article.body.length}
                  speakerName={data.speakers.find((s) => s.id === b.speakerId)?.name}
                  verdict={claims?.filter((c) => c.blockId === b.id)}
                  busy={busy === `p:${b.id}`}
                  apiLive={apiLive}
                  onFocus={() => setFocusRefs(b.sourceRefs ?? [])}
                  onChange={(text) => updateBlock(b.id, { text })}
                  onKind={(kind) => updateBlock(b.id, { kind })}
                  onDelete={() => setBlocks(article.body.filter((x) => x.id !== b.id))}
                  onMove={(dir) => move(i, dir)}
                  onAdd={(kind) => insertAfter(i, { id: uid("blk"), kind, text: "" })}
                  onRegenerate={() => assist("regenerate_paragraph", { blockId: b.id })}
                />
              ))}
              {article.body.length === 0 && <p className="py-6 text-center text-sm text-ink-3">This article type is composed from structured data (speakers or images) rather than body text.</p>}
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setBlocks([...article.body, { id: uid("blk"), kind: "paragraph", text: "" }])}>
                <Plus /> Paragraph
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Quote /> Insert quotation
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[420px] p-0">
                  <p className="border-b border-line px-3 py-2 text-xs text-ink-3">Approved, verbatim quotations from this article&apos;s sessions</p>
                  <div className="scroll-thin max-h-72 overflow-y-auto">
                    {approvedQuotes.map((f) => (
                      <button
                        key={f.id}
                        className="block w-full border-b border-line px-3 py-2.5 text-left hover:bg-subtle"
                        onClick={() => {
                          setBlocks([...article.body, { id: uid("blk"), kind: "quote", text: f.text, speakerId: f.speakerId, sourceRefs: [{ videoId: f.videoId, start: f.timestamp, segmentId: f.segmentId }] }]);
                          if (!article.quoteFactIds.includes(f.id)) patch({ quoteFactIds: [...article.quoteFactIds, f.id] });
                          toast.success("Quotation inserted with its source");
                        }}
                      >
                        <p className="font-serif text-sm">“{f.text}”</p>
                        <p className="mt-1 text-xs text-ink-3">
                          {data.speakers.find((s) => s.id === f.speakerId)?.name} · {formatDuration(f.timestamp)}
                        </p>
                      </button>
                    ))}
                    {approvedQuotes.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-3">No approved quotations yet.</p>}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </article>
        </div>

        <aside className="scroll-thin min-h-0 overflow-y-auto border-l border-line bg-surface">
          <Tabs defaultValue="assist">
            <TabsList className="px-2">
              <TabsTrigger value="assist">
                <Sparkles /> Assist
              </TabsTrigger>
              <TabsTrigger value="sources">
                <ShieldCheck /> Sources {summary && summary.missing > 0 && <Badge tone="danger">{summary.missing}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="meta">
                <Images /> Details
              </TabsTrigger>
            </TabsList>

            <TabsContent value="assist" className="flex flex-col gap-4 p-4">
              <div className={cn("rounded-md border px-3 py-2 text-xs", apiLive ? "border-success-dot/30 bg-success-soft text-success" : "border-line bg-subtle text-ink-3")}>
                {apiLive ? "Connected to the API's LLM. Every change is a suggestion you review." : "No LLM connected. Options below use pre-generated demo variants where they exist; others need the API."}
              </div>
              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-4">Tone of introduction</p>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {(["authoritative", "neutral", "analytical", "celebratory"] as EditorialTone[]).map((tone) => {
                    const variant = toneVariant(tone);
                    const enabled = apiLive || !!variant;
                    return (
                      <Tooltip key={tone} content={apiLive ? `Rewrite the introduction in a ${tone} tone` : variant ? "Pre-generated demo variant" : "Needs an LLM provider"}>
                        <span>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="w-full capitalize"
                            disabled={!enabled}
                            loading={busy === "change_tone"}
                            onClick={() => (apiLive ? assist("change_tone", { tone }) : variant && (patch({ intro: variant }), toast.success(`Applied the ${tone} variant`, { description: "Pre-generated demo variant" })))}
                          >
                            {tone}
                          </Button>
                        </span>
                      </Tooltip>
                    );
                  })}
                </div>
              </section>
              <section className="grid grid-cols-2 gap-1.5">
                <Button variant="secondary" size="sm" disabled={!apiLive && !article.variants?.shortIntro} onClick={() => (apiLive ? assist("shorten") : (patch({ intro: article.variants!.shortIntro! }), toast.success("Shorter introduction applied", { description: "Pre-generated demo variant" })))}>
                  <Shrink /> Shorten intro
                </Button>
                <Button variant="secondary" size="sm" disabled={!apiLive} onClick={() => assist("expand")}>
                  <Expand /> Expand
                </Button>
              </section>
              <section>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-4">Summary</p>
                  {apiLive && (
                    <Button variant="ghost" size="xs" onClick={() => assist("summarise")}>
                      <WandSparkles /> Generate
                    </Button>
                  )}
                </div>
                <p className="mt-2 rounded-md bg-subtle px-3 py-2.5 text-sm leading-relaxed text-ink-2">{article.variants?.summary ?? <span className="text-ink-4">No summary yet.</span>}</p>
                {article.variants?.summary && article.generatedBy === "demo_seed" && <p className="mt-1 text-[11px] text-ink-4">Pre-generated demo summary.</p>}
              </section>
            </TabsContent>

            <TabsContent value="sources" className="p-4">
              <Button variant="secondary" size="sm" className="w-full" onClick={runVerify}>
                <ShieldCheck /> {claims ? "Re-run verification" : "Verify quotations & figures"}
              </Button>
              {summary && (
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-success-soft px-2 py-2">
                    <p className="tabular text-lg font-semibold text-success">{summary.verified}</p>
                    <p className="text-[11px] text-success">verified</p>
                  </div>
                  <div className="rounded-md bg-warning-soft px-2 py-2">
                    <p className="tabular text-lg font-semibold text-warning">{summary.partial}</p>
                    <p className="text-[11px] text-warning">partial</p>
                  </div>
                  <div className="rounded-md bg-danger-soft px-2 py-2">
                    <p className="tabular text-lg font-semibold text-danger">{summary.missing}</p>
                    <p className="text-[11px] text-danger">not found</p>
                  </div>
                </div>
              )}
              <ul className="mt-4 flex flex-col gap-2">
                {claims
                  ?.slice()
                  .sort((a, b) => (a.status === "not_found" ? -1 : b.status === "not_found" ? 1 : 0))
                  .map((c) => (
                    <li key={c.id}>
                      <button onClick={() => c.segment && setFocusRefs([{ videoId: c.segment.videoId, start: c.segment.start, segmentId: c.segment.id }])} className={cn("w-full rounded-md border px-3 py-2 text-left text-sm", c.status === "not_found" ? "border-danger/25 bg-danger-soft" : c.status === "partial" ? "border-warning-dot/30 bg-warning-soft" : "border-line hover:bg-subtle")}>
                        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em]">
                          {c.status === "verified" ? <CircleCheck className="size-3.5 text-success" /> : <CircleAlert className={cn("size-3.5", c.status === "partial" ? "text-warning" : "text-danger")} />}
                          <span className={c.status === "verified" ? "text-success" : c.status === "partial" ? "text-warning" : "text-danger"}>{c.kind === "quote" ? "Quotation" : "Figure"} · {c.status === "verified" ? "verified" : c.status === "partial" ? "close match" : "not found"}</span>
                        </span>
                        <span className={cn("mt-1 block text-ink-2", c.kind === "quote" && "line-clamp-3 font-serif")}>{c.text}</span>
                        {c.segment && <span className="mt-1 block text-[11px] text-ink-4">{c.segment.speakerLabel} · {formatDuration(c.segment.start)}{!c.inCitedSource && c.status === "verified" ? " · found outside the cited source" : ""}</span>}
                      </button>
                    </li>
                  ))}
              </ul>
              {!claims && <p className="mt-3 text-xs leading-relaxed text-ink-3">Checks every quotation and figure against the transcripts, word for word. It doesn&apos;t use a language model, so results are reproducible.</p>}
            </TabsContent>

            <TabsContent value="meta" className="flex flex-col gap-5 p-4">
              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-4">Speakers referenced</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {speakers.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <Avatar initials={initials(s.name)} seed={s.id} size={22} />
                      <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                      <VerificationBadge v={s.verification} />
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-4">Suggested images & captions</p>
                <div className="mt-2 flex flex-col gap-3">
                  {article.suggestedImageIds.slice(0, 8).map((id) => {
                    const asset = data.assetsById[id];
                    if (!asset) return null;
                    return (
                      <div key={id} className="flex gap-2.5">
                        <div className="h-12 w-16 shrink-0 overflow-hidden rounded-sm">
                          <PlaceholderPhoto seed={asset.seed} tag={asset.tags[0] ?? "stage"} className="h-full w-full" />
                        </div>
                        <Textarea className="min-h-[48px] py-1.5 text-xs" value={article.captions[id] ?? asset.caption ?? ""} onChange={(e) => patch({ captions: { ...article.captions, [id]: e.target.value } })} aria-label="Caption" />
                      </div>
                    );
                  })}
                  {article.suggestedImageIds.length === 0 && <p className="text-sm text-ink-3">No images suggested.</p>}
                </div>
              </section>
              <section>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-4">Placement</p>
                <p className="mt-2 text-sm text-ink-2">{placedOn.length ? `Pages ${placedOn.join(", ")}` : "Not yet placed in the flatplan."}</p>
                <Button variant="link" size="xs" asChild>
                  <Link href={placedOn.length ? `/app/designer/editor?page=${data.pages[placedOn[0] - 1]?.id}` : "/app/designer"}>{placedOn.length ? "Open in page editor" : "Open flatplan"}</Link>
                </Button>
              </section>
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent
          title={rejecting === "rejected" ? "Reject this draft" : "Request revision"}
          description="The note is shown to whoever edits the article next."
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setRejecting(null)}>
                Cancel
              </Button>
              <Button
                variant={rejecting === "rejected" ? "danger" : "primary"}
                disabled={note.trim().length < 5}
                onClick={async () => {
                  if (apiLive && rejecting === "rejected") await live.rejectArticle(article.id, note).catch(() => undefined);
                  setArticleStatus(article.id, rejecting!, note.trim());
                  setRejecting(null);
                  toast.success(rejecting === "rejected" ? "Draft rejected" : "Revision requested");
                }}
              >
                {rejecting === "rejected" ? "Reject draft" : "Request revision"}
              </Button>
            </>
          }
        >
          <Textarea autoFocus rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs to change?" aria-label="Review note" />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HeadlineVariants({ article, apiLive, onPick, onGenerate }: { article: Article; apiLive: boolean; onPick: (h: string) => void; onGenerate: () => void }) {
  const options = (article.variants?.headlines ?? []).filter((h) => h !== article.headline);
  if (!options.length && !apiLive) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="xs" className="absolute -right-2 top-2 translate-x-full opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 max-xl:hidden">
          <WandSparkles /> Rewrite
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[340px]">
        <DropdownMenuLabel>{apiLive ? "Alternatives" : "Pre-generated demo alternatives"}</DropdownMenuLabel>
        {options.map((h) => (
          <DropdownMenuItem key={h} onSelect={() => onPick(h)}>
            <span className="whitespace-normal">{h}</span>
          </DropdownMenuItem>
        ))}
        {apiLive && (
          <DropdownMenuItem icon={<Sparkles />} onSelect={onGenerate}>
            Generate new alternatives
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface BlockRowProps {
  block: ArticleBlock;
  index: number;
  total: number;
  speakerName?: string;
  verdict?: Claim[];
  busy: boolean;
  apiLive: boolean;
  onFocus: () => void;
  onChange: (text: string) => void;
  onKind: (kind: ArticleBlockKind) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onAdd: (kind: ArticleBlockKind) => void;
  onRegenerate: () => void;
}

function BlockRow({ block, index, total, speakerName, verdict, busy, apiLive, onFocus, onChange, onKind, onDelete, onMove, onAdd, onRegenerate }: BlockRowProps) {
  const bad = verdict?.some((c) => c.status === "not_found");
  const ok = verdict && verdict.length > 0 && !bad;
  return (
    <div className={cn("group relative rounded-md border px-3 py-2 transition-colors focus-within:border-accent-line focus-within:bg-surface hover:border-line", bad ? "border-danger/30 bg-danger-soft/40" : "border-transparent")}>
      <div className="absolute -left-9 top-2 flex flex-col items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Tooltip content="Move up" side="left">
          <Button variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp />
          </Button>
        </Tooltip>
        <Tooltip content="Move down" side="left">
          <Button variant="ghost" size="icon-xs" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown />
          </Button>
        </Tooltip>
      </div>
      {block.kind === "quote" && <span className="pointer-events-none absolute left-0 top-2 bottom-2 w-[3px] rounded bg-accent" />}
      {block.kind === "question" && <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-4">Question</span>}
      <AutoTextarea value={block.text} onFocus={onFocus} onChange={(e) => onChange(e.target.value)} className={BLOCK_STYLE[block.kind]} aria-label={`${block.kind} ${index + 1}`} placeholder={block.kind === "subhead" ? "Subhead" : "Write…"} />
      <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5 text-[11px] text-ink-4">
        {block.kind === "quote" && speakerName && <span className="font-medium text-ink-3">— {speakerName}</span>}
        {block.sourceRefs?.length ? (
          <span className="flex items-center gap-1">
            {block.sourceRefs.map((r) => (
              <Link key={`${r.videoId}-${r.start}`} href={`/app/media/${r.videoId}?t=${r.start}`} className="tabular rounded bg-sunken px-1 font-mono text-[10px] text-ink-3 hover:text-accent">
                {r.videoId} · {formatDuration(r.start)}
              </Link>
            ))}
          </span>
        ) : (
          block.kind !== "subhead" && block.kind !== "question" && <span className="text-warning">No source cited</span>
        )}
        {ok && <CircleCheck className="size-3 text-success" />}
        {bad && <span className="font-medium text-danger">Unverified claim</span>}
        <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Block type">
                <Type />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<Pilcrow />} onSelect={() => onKind("paragraph")}>Paragraph</DropdownMenuItem>
              <DropdownMenuItem icon={<Heading2 />} onSelect={() => onKind("subhead")}>Subhead</DropdownMenuItem>
              <DropdownMenuItem icon={<Quote />} onSelect={() => onKind("quote")}>Quotation</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip content={apiLive ? "Regenerate this paragraph from its sources" : "Needs an LLM provider"}>
            <span>
              <Button variant="ghost" size="icon-xs" disabled={!apiLive || block.kind === "quote"} loading={busy} onClick={onRegenerate} aria-label="Regenerate paragraph">
                <RefreshCw />
              </Button>
            </span>
          </Tooltip>
          <Tooltip content="Add paragraph below">
            <Button variant="ghost" size="icon-xs" onClick={() => onAdd("paragraph")} aria-label="Add paragraph below">
              <Plus />
            </Button>
          </Tooltip>
          <Tooltip content="Delete block">
            <Button variant="ghost" size="icon-xs" onClick={onDelete} aria-label="Delete block">
              <Trash2 />
            </Button>
          </Tooltip>
        </span>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { CircleAlert, ExternalLink, Newspaper, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, Select } from "@/components/ui/overlays";
import { Checkbox } from "@/components/ui/primitives";
import { live, type CmsPost, type CmsSources } from "@/lib/api/live";
import { cn } from "@/lib/utils/cn";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** False in the demo workspace or when the API is offline. */
  available: boolean;
  onImported: () => void | Promise<void>;
}

const MAX = 10;

/** Browse the Elets portals and bring published copy and pictures in as article drafts. */
export function CmsImportDialog({ open, onOpenChange, projectId, available, onImported }: Props) {
  const [sources, setSources] = React.useState<CmsSources | null>(null);
  const [site, setSite] = React.useState("egov");
  const [kind, setKind] = React.useState("interview");
  const [search, setSearch] = React.useState("");
  const [posts, setPosts] = React.useState<CmsPost[] | null>(null);
  const [picked, setPicked] = React.useState<number[]>([]);
  const [images, setImages] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const request = React.useRef(0);

  React.useEffect(() => {
    if (!open || !available || sources) return;
    live.cmsSources().then(setSources).catch((e) => setError((e as Error).message));
  }, [open, available, sources]);

  const load = React.useCallback(
    async (query: string) => {
      const id = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const rows = await live.cmsPosts(site, kind, query.trim() || undefined);
        if (id !== request.current) return;
        setPosts(rows);
        setPicked([]);
      } catch (e) {
        if (id !== request.current) return;
        setPosts([]);
        setError((e as Error).message);
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [site, kind],
  );

  // Changing the site or the kind reloads the list; the search box reloads on Enter.
  React.useEffect(() => {
    if (open && available) void load("");
    setSearch("");
  }, [open, available, load]);

  const toggle = (id: number) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length < MAX ? [...x, id] : x));

  const run = async () => {
    setImporting(true);
    try {
      const res = await live.importCms(projectId, { site, kind, postIds: picked, includeImages: images });
      await onImported();
      const skipped = res.skipped.length ? ` ${res.skipped.length} skipped: ${res.skipped[0].reason}` : "";
      if (res.articles.length) toast.success(`${res.articles.length} draft${res.articles.length === 1 ? "" : "s"} imported`, { description: `${res.imagesImported} picture${res.imagesImported === 1 ? "" : "s"} added to the project.${skipped} Each draft needs review and approval.` });
      else toast.error("Nothing was imported", { description: skipped.trim() || undefined });
      if (res.articles.length) onOpenChange(false);
    } catch (e) {
      toast.error("Import failed", { description: (e as Error).message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Import from the Elets CMS"
        description="Published interviews, features and news from the Elets portals, brought in as drafts with their pictures."
        size="lg"
        footer={
          <>
            <label className="mr-auto flex items-center gap-2 text-sm text-ink-2">
              <Checkbox checked={images} onCheckedChange={(v) => setImages(v === true)} /> Bring the pictures too
            </label>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!available || picked.length === 0} loading={importing} onClick={run}>
              <Newspaper /> Import {picked.length || ""} draft{picked.length === 1 ? "" : "s"}
            </Button>
          </>
        }
      >
        {!available ? (
          <div className="flex items-start gap-2.5 rounded-md border border-warning-dot/40 bg-warning-soft px-3 py-2.5 text-sm text-warning">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <p>The CMS import runs on the PressFlow API. Sign in to a live organisation with the API connected to use it; the demo workspace keeps its seeded drafts.</p>
          </div>
        ) : (
          <>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void load(search);
              }}
            >
              <Select size="md" className="w-56" aria-label="Portal" value={site} onValueChange={setSite} options={(sources?.sites ?? [{ key: "egov", name: "eGov", url: "" }]).map((s) => ({ value: s.key, label: s.name }))} />
              <Select size="md" className="w-52" aria-label="Kind of story" value={kind} onValueChange={setKind} options={(sources?.kinds ?? [{ key: "interview", label: "Interview", articleType: "interview" }]).map((k) => ({ value: k.key, label: k.label }))} />
              <Input className="min-w-40 flex-1" leading={<Search />} placeholder="Search this portal, then press Enter" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the portal" />
            </form>

            {error && (
              <p className="mt-3 flex items-start gap-2 text-sm text-danger">
                <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
              </p>
            )}

            <div className="mt-3 max-h-[46vh] overflow-y-auto rounded-md border border-line">
              {loading && <p className="px-4 py-8 text-center text-sm text-ink-3">Reading the portal…</p>}
              {!loading && posts?.length === 0 && !error && <p className="px-4 py-8 text-center text-sm text-ink-3">No published stories of this kind were found.</p>}
              {!loading &&
                posts?.map((p) => {
                  const on = picked.includes(p.id);
                  return (
                    <label key={p.id} className={cn("flex cursor-pointer items-start gap-3 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-subtle", on && "bg-accent-soft hover:bg-accent-soft")}>
                      <Checkbox className="mt-1" checked={on} onCheckedChange={() => toggle(p.id)} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-14 w-20 shrink-0 rounded-sm object-cover" /> : <span className="h-14 w-20 shrink-0 rounded-sm bg-sunken" />}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-snug">{p.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-ink-3">{p.excerpt}</span>
                        <span className="tabular mt-1 flex items-center gap-2 text-[11px] text-ink-4">
                          {p.date} · {p.wordCount.toLocaleString()} words
                          <a href={p.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                            Open <ExternalLink className="size-3" />
                          </a>
                        </span>
                      </span>
                    </label>
                  );
                })}
            </div>
            <p className="mt-3 text-xs text-ink-3">
              Up to {MAX} stories at a time. Imported copy has no session recording behind it, so quotations show as unverified until an editor confirms them. Run <strong>House style</strong> in the article editor to tidy quotation marks, dashes and spacing.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

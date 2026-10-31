"use client";

/**
 * Exports generated entirely in the browser from the current workspace. Every
 * function returns a real file; nothing here pretends to be InDesign output.
 */
import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import type { Article, Asset, DesignProfile, MagazinePage, Project, Speaker, TranscriptSegment } from "@/lib/domain/types";
import { PageView } from "@/components/magazine/page-view";
import { PlaceholderPhoto } from "@/components/magazine/placeholder-photo";
import { assetMap, buildToc, renderContext } from "@/lib/magazine/context";
import { articleTypeLabel } from "@/lib/domain/status";
import { verifyArticle, claimSummary } from "@/lib/editorial/verify";
import { formatDuration } from "@/lib/utils/format";
import { buildLayoutContract } from "./contract";

export interface ExportData {
  project: Project;
  profile: DesignProfile;
  pages: MagazinePage[];
  articles: Article[];
  assets: Asset[];
  speakers: Speaker[];
  segments: TranscriptSegment[];
}

export interface GeneratedFile {
  blob: Blob;
  fileName: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const base = (p: Project) => slug(p.title.replace(/—/g, " "));

export function downloadBlob({ blob, fileName }: GeneratedFile) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function layoutJson(d: ExportData): GeneratedFile {
  const contract = buildLayoutContract({ ...d, assets: assetMap(d.assets) });
  return { blob: new Blob([JSON.stringify(contract, null, 2)], { type: "application/json" }), fileName: `${base(d.project)}-layout-contract.json` };
}

function articleMarkdown(a: Article, speakers: Speaker[]): string {
  const name = (id?: string) => speakers.find((s) => s.id === id)?.name;
  const ref = (refs?: { videoId: string; start: number }[]) => (refs?.length ? ` <!-- source: ${refs.map((r) => `${r.videoId}@${formatDuration(r.start)}`).join(", ")} -->` : "");
  const lines = [`# ${a.headline.replace(/[“”]/g, "")}`, "", `**${a.subheadline}**`, "", a.kicker ? `_${a.kicker}_` : "", a.byline ? `By ${a.byline}` : "", "", a.intro, ""];
  for (const b of a.body) {
    if (b.kind === "subhead") lines.push(`## ${b.text}`, "");
    else if (b.kind === "quote") lines.push(`> “${b.text}”${name(b.speakerId) ? ` — ${name(b.speakerId)}` : ""}${ref(b.sourceRefs)}`, "");
    else if (b.kind === "question") lines.push(`**Q: ${b.text}**`, "");
    else if (b.kind === "list_item") lines.push(`- ${b.text}${ref(b.sourceRefs)}`);
    else lines.push(`${b.text}${ref(b.sourceRefs)}`, "");
  }
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

export async function contentPackage(d: ExportData): Promise<GeneratedFile & { count: number; skipped: number }> {
  const zip = new JSZip();
  const approved = d.articles.filter((a) => a.status === "approved");
  const manifest = approved.map((a) => {
    const v = claimSummary(verifyArticle(a, d.segments));
    const file = `articles/${slug(a.headline.replace(/[“”]/g, ""))}.md`;
    zip.file(file, articleMarkdown(a, d.speakers));
    zip.file(file.replace(/\.md$/, ".json"), JSON.stringify(a, null, 2));
    return { id: a.id, type: articleTypeLabel[a.type], headline: a.headline, file, approvedAt: a.approvedAt, verification: v };
  });
  zip.file("manifest.json", JSON.stringify({ project: d.project.title, generatedAt: new Date().toISOString(), note: "Approved articles only. Quotations and figures were checked against transcripts; see each entry's verification.", articles: manifest }, null, 2));
  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, fileName: `${base(d.project)}-articles.zip`, count: approved.length, skipped: d.articles.length - approved.length };
}

const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&family=Playfair+Display:wght@600;700&display=swap">';
const FONT_VARS = ":root{--font-inter:'Inter';--font-source-serif:'Source Serif 4';--font-playfair:'Playfair Display';--font-newsreader:'Source Serif 4';--font-jetbrains:monospace}";
const FRAME_CSS = ".pf-frame p{margin:0}.pf-frame p+p{text-indent:var(--pf-indent,0)}.pf-frame[data-columns]{column-fill:balance}.pf-frame .pf-q{font-family:var(--pf-q-font);font-weight:700;text-indent:0;margin-top:.6em}.pf-frame .pf-a{text-indent:0}.pf-frame .pf-sub{font-weight:700;text-indent:0;margin-top:.55em}*{box-sizing:border-box}";

export function pageHtml(d: ExportData, index: number, opts: { scale?: number; standalone?: boolean } = {}): string {
  const toc = buildToc(d.pages, d.articles);
  const markup = renderToStaticMarkup(<PageView page={d.pages[index]} profile={d.profile} assets={assetMap(d.assets)} ctx={renderContext(d.project, d.pages, index, d.articles, toc)} scale={opts.scale ?? 1} />);
  if (!opts.standalone) return markup;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${d.project.title} — page ${index + 1}</title>${FONT_LINK}<style>${FONT_VARS}${FRAME_CSS}body{margin:0;background:#e9e7e1;display:flex;justify-content:center;padding:32px;font-family:Inter,sans-serif}</style></head><body>${markup}</body></html>`;
}

export async function pagePreviews(d: ExportData): Promise<GeneratedFile> {
  const zip = new JSZip();
  const index: string[] = [];
  d.pages.forEach((p, i) => {
    const name = `page-${String(i + 1).padStart(2, "0")}.html`;
    zip.file(name, pageHtml(d, i, { standalone: true }));
    index.push(`<li><a href="${name}">Page ${i + 1} — ${p.label.replace(/</g, "&lt;")}</a></li>`);
  });
  zip.file("index.html", `<!doctype html><meta charset="utf-8"><title>${d.project.title} — page previews</title><body style="font-family:system-ui;padding:32px"><h1>${d.project.title}</h1><p>HTML previews from the PressFlow preview renderer. Not InDesign output.</p><ol>${index.join("")}</ol></body>`);
  return { blob: await zip.generateAsync({ type: "blob" }), fileName: `${base(d.project)}-page-previews.zip` };
}

export async function assetArchive(d: ExportData): Promise<GeneratedFile & { placeholders: number }> {
  const zip = new JSZip();
  const used = new Set(d.pages.flatMap((p) => p.elements.map((e) => e.assetId).filter((x): x is string => !!x)));
  const rows: string[] = ["id,file,kind,width_px,height_px,credit,placeholder,caption"];
  let placeholders = 0;
  for (const id of used) {
    const a = d.assets.find((x) => x.id === id);
    if (!a) continue;
    if (a.simulated) {
      placeholders += 1;
      if (a.kind !== "ad") zip.file(`placeholders/${a.fileName.replace(/\.\w+$/, ".svg")}`, renderToStaticMarkup(<PlaceholderPhoto seed={a.seed} tag={a.tags[0] ?? "stage"} label />).replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"'));
    } else if (a.url) {
      try {
        const res = await fetch(a.url);
        if (res.ok) zip.file(`photos/${a.fileName}`, await res.blob());
      } catch {
        /* listed in the manifest even if the file couldn't be fetched */
      }
    }
    rows.push([a.id, a.fileName, a.kind, a.widthPx, a.heightPx, a.credit ?? "", a.simulated ? "yes" : "no", (a.caption ?? "").replace(/"/g, "'")].map((v) => `"${v}"`).join(","));
  }
  zip.file("manifest.csv", rows.join("\n"));
  zip.file("README.txt", `Assets placed in ${d.project.title}.\n\n${placeholders} of ${used.size} assets are demo placeholders: they are included as labelled SVG drawings, not photographs, and must be replaced before print.\n`);
  return { blob: await zip.generateAsync({ type: "blob" }), fileName: `${base(d.project)}-assets.zip`, placeholders };
}

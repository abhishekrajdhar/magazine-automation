"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { useWorkspace } from "@/lib/store/workspace";
import { useProjectData } from "@/lib/store/hooks";
import { PageView } from "@/components/magazine/page-view";
import { Button } from "@/components/ui/button";

/**
 * Print view: every page at 100% on its own sheet, for the browser's
 * "Save as PDF". This is the HTML preview renderer, not InDesign output.
 */
function PrintView() {
  const params = useSearchParams();
  const hydrated = useWorkspace((s) => s.hasHydrated);
  const data = useProjectData(params.get("project") ?? undefined);
  const { profile, pages, project } = data;
  const auto = params.get("auto") === "1";
  const [fontsReady, setFontsReady] = React.useState(false);

  React.useEffect(() => {
    document.fonts.ready.then(() => setFontsReady(true));
  }, []);
  React.useEffect(() => {
    if (auto && fontsReady && hydrated && pages.length) setTimeout(() => window.print(), 400);
  }, [auto, fontsReady, hydrated, pages.length]);

  if (!hydrated) return null;
  if (!profile || !project) return <p className="p-10 text-sm">Nothing to print — open this from the Export Centre.</p>;
  const W = profile.page.widthPt;
  const H = profile.page.heightPt;

  return (
    <>
      <style>{`@page { size: ${W}pt ${H}pt; margin: 0 } @media print { html, body { background: #fff !important } .sheet { break-after: page; box-shadow: none !important; margin: 0 !important } }`}</style>
      <div className="no-print sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface px-6 py-3 text-sm">
        <span className="font-medium">{project.title}</span>
        <span className="text-ink-3">
          {pages.length} pages · HTML preview renderer — use “Save as PDF” in the print dialog. Not InDesign output; draft pages are not watermarked here.
        </span>
        <Button variant="primary" size="sm" className="ml-auto" onClick={() => window.print()}>
          <Printer /> Print / Save as PDF
        </Button>
      </div>
      <div className="flex flex-col items-center gap-6 bg-[#e9e7e1] py-6 print:block print:gap-0 print:bg-white print:py-0">
        {pages.map((p, i) => (
          <div key={p.id} className="sheet shadow-page" style={{ width: `${W}pt`, height: `${H}pt`, overflow: "hidden" }}>
            {/* 1 CSS px = 0.75 pt, so render at 4/3 to fill a sheet sized in points. */}
            <PageView page={p} profile={profile} assets={data.assetsById} ctx={data.ctxFor(i)} scale={4 / 3} localUrls={data.localUrls} />
          </div>
        ))}
      </div>
    </>
  );
}

export default function PrintPage() {
  return (
    <React.Suspense>
      <PrintView />
    </React.Suspense>
  );
}

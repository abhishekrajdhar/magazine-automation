"use client";

import * as React from "react";
import Link from "next/link";
import { Quote } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { PageThumb } from "@/components/magazine/page-thumb";
import { buildDemoPages } from "@/lib/demo/workspace";
import { demoProfile } from "@/lib/demo/reference";
import { demoAssets } from "@/lib/demo/assets";
import { demoArticles } from "@/lib/demo/articles";
import { demoProject } from "@/lib/demo/workspace";
import { assetMap, buildToc, renderContext } from "@/lib/magazine/context";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const preview = React.useMemo(() => {
    const pages = buildDemoPages();
    const toc = buildToc(pages, demoArticles);
    return { pages, toc, assets: assetMap(demoAssets) };
  }, []);

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-canvas lg:grid-cols-[minmax(440px,1fr)_1.15fr]">
      <div className="flex flex-col px-6 py-6 sm:px-12">
        <Link href="/" className="self-start">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-12">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          <p className="mt-2 text-sm text-ink-3">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
        {footer && <div className="mx-auto w-full max-w-[380px] text-sm text-ink-3">{footer}</div>}
      </div>

      <div className="relative hidden overflow-hidden border-l border-line bg-navy lg:block">
        <div className="absolute inset-0 opacity-[0.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:18px_18px]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-white/50">
            <span className="size-1.5 rounded-full bg-[#4f7bff]" /> Reference-driven magazine production
          </div>
          <div className="flex items-end justify-center gap-5 py-8">
            {[5, 6].map((i) => (
              <div key={i} className={i === 5 ? "-rotate-2 translate-y-3" : "rotate-1"}>
                <PageThumb page={preview.pages[i]} profile={demoProfile} assets={preview.assets} ctx={renderContext(demoProject, preview.pages, i, demoArticles, preview.toc)} width={250} className="rounded-[2px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)]" />
              </div>
            ))}
          </div>
          <figure className="max-w-md">
            <Quote className="size-5 text-[#4f7bff]" />
            <blockquote className="mt-3 font-serif text-[22px] leading-snug text-white">Every quotation is linked to the recording it came from. Every page follows the house style you already approved.</blockquote>
            <figcaption className="mt-3 text-xs text-white/50">Pages shown are live renders from the demo workspace, using placeholder imagery and fictional content.</figcaption>
          </figure>
        </div>
      </div>
    </div>
  );
}

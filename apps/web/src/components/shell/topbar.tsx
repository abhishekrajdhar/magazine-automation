"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, CircleHelp, Menu, Search } from "lucide-react";
import { useWorkspace } from "@/lib/store/workspace";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlays";
import { SEGMENT_LABELS } from "./nav";

const PROJECT_SCOPED = ["/app/media", "/app/studio", "/app/designer", "/app/exports"];

function useCrumbs(pathname: string) {
  const projects = useWorkspace((s) => s.projects);
  const articles = useWorkspace((s) => s.articles);
  const videos = useWorkspace((s) => s.videos);
  const references = useWorkspace((s) => s.references);
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((seg, i) => {
    const href = "/" + parts.slice(0, i + 1).join("/");
    const parent = parts[i - 1];
    let label = SEGMENT_LABELS[seg] ?? seg;
    if (parent === "projects") label = projects.find((p) => p.id === seg)?.title ?? "Project";
    if (parent === "studio") label = articles.find((a) => a.id === seg)?.headline.replace(/[“”]/g, "") ?? "Article";
    if (parent === "media") label = videos.find((v) => v.id === seg)?.title ?? "Recording";
    if (parent === "references") label = references.find((r) => r.id === seg)?.title ?? "Reference";
    return { href, label };
  });
}

export function Topbar({ onOpenPalette, onOpenShortcuts, onOpenNav }: { onOpenPalette: () => void; onOpenShortcuts: () => void; onOpenNav: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const crumbs = useCrumbs(pathname);
  const projects = useWorkspace((s) => s.projects);
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const setActiveProject = useWorkspace((s) => s.setActiveProject);
  const active = projects.find((p) => p.id === activeProjectId);
  const scoped = PROJECT_SCOPED.some((p) => pathname.startsWith(p));
  const [isMac, setIsMac] = React.useState(true);
  React.useEffect(() => setIsMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-canvas/70">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenNav} aria-label="Open navigation">
        <Menu />
      </Button>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <React.Fragment key={c.href}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-ink-4" />}
            {i === crumbs.length - 1 ? (
              <span className="truncate font-medium text-ink" aria-current="page">
                {c.label}
              </span>
            ) : (
              <Link href={c.href} className="truncate text-ink-3 hover:text-ink">
                {c.label}
              </Link>
            )}
          </React.Fragment>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {scoped && active && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="hidden h-7 max-w-[300px] items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-sm shadow-xs hover:border-line-strong md:flex">
                <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                <span className="truncate text-ink-2">{active.title}</span>
                <ChevronDown className="size-3.5 shrink-0 text-ink-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[320px]">
              <DropdownMenuLabel>Active project</DropdownMenuLabel>
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setActiveProject(p.id)} icon={p.id === activeProjectId ? <Check className="!text-accent" /> : <span className="size-3.5" />}>
                  {p.title}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push("/app/projects")}>All projects…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          onClick={onOpenPalette}
          className="flex h-7 items-center gap-2 rounded-md border border-line bg-surface pl-2 pr-1 text-sm text-ink-4 shadow-xs transition-colors hover:border-line-strong hover:text-ink-3"
        >
          <Search className="size-3.5" />
          <span className="hidden w-36 text-left sm:inline">Search or jump to…</span>
          <span className="flex gap-0.5">
            <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <Button variant="ghost" size="icon-sm" onClick={onOpenShortcuts} aria-label="Keyboard shortcuts and help">
          <CircleHelp />
        </Button>
      </div>
    </header>
  );
}

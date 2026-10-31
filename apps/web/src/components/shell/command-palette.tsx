"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowRight, Clapperboard, FileText, FolderKanban, PanelsTopLeft, Search, ShieldCheck, Sparkles } from "lucide-react";
import { useWorkspace } from "@/lib/store/workspace";
import { NAV } from "./nav";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const projects = useWorkspace((s) => s.projects);
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const allArticles = useWorkspace((s) => s.articles);
  const allVideos = useWorkspace((s) => s.videos);
  const allPages = useWorkspace((s) => s.pages);
  const setActiveProject = useWorkspace((s) => s.setActiveProject);
  const articles = React.useMemo(() => allArticles.filter((a) => a.projectId === activeProjectId), [allArticles, activeProjectId]);
  const videos = React.useMemo(() => allVideos.filter((v) => v.projectId === activeProjectId), [allVideos, activeProjectId]);
  const pages = React.useMemo(() => allPages.filter((p) => p.projectId === activeProjectId), [allPages, activeProjectId]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(14_23_38/0.28)] data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg outline-none data-[state=open]:animate-fade-in">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search pages, projects, articles and actions</DialogPrimitive.Description>
          <Command loop className="flex flex-col" label="Command palette">
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search className="size-4 text-ink-4" />
              <Command.Input autoFocus placeholder="Search or jump to…" className="h-12 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-ink-4" />
              <kbd className="rounded border border-line px-1.5 text-[10px] text-ink-4">ESC</kbd>
            </div>
            <Command.List className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-4">
              <Command.Empty className="px-3 py-10 text-center text-sm text-ink-3">No results.</Command.Empty>
              <Command.Group heading="Actions">
                <Item icon={<Sparkles />} onSelect={() => go("/app/new")} hint="C">
                  Create new magazine
                </Item>
                <Item icon={<ShieldCheck />} onSelect={() => go("/app/designer/preflight")}>
                  Run preflight checks
                </Item>
                <Item icon={<PanelsTopLeft />} onSelect={() => go("/app/designer/editor")}>
                  Open page editor
                </Item>
              </Command.Group>
              <Command.Group heading="Navigate">
                {NAV.map((n) => (
                  <Item key={n.href} icon={<n.icon />} onSelect={() => go(n.href)} hint={n.shortcut}>
                    {n.label}
                  </Item>
                ))}
              </Command.Group>
              <Command.Group heading="Projects">
                {projects.map((p) => (
                  <Item
                    key={p.id}
                    icon={<FolderKanban />}
                    onSelect={() => {
                      setActiveProject(p.id);
                      go(`/app/projects/${p.id}`);
                    }}
                    value={`project ${p.title} ${p.eventName}`}
                  >
                    {p.title}
                  </Item>
                ))}
              </Command.Group>
              {articles.length > 0 && (
                <Command.Group heading="Articles">
                  {articles.map((a) => (
                    <Item key={a.id} icon={<FileText />} onSelect={() => go(`/app/studio/${a.id}`)} value={`article ${a.headline}`}>
                      {a.headline.replace(/[“”]/g, "")}
                    </Item>
                  ))}
                </Command.Group>
              )}
              {videos.length > 0 && (
                <Command.Group heading="Recordings">
                  {videos.map((v) => (
                    <Item key={v.id} icon={<Clapperboard />} onSelect={() => go(`/app/media/${v.id}`)} value={`video ${v.title}`}>
                      {v.title}
                    </Item>
                  ))}
                </Command.Group>
              )}
              {pages.length > 0 && (
                <Command.Group heading="Pages">
                  {pages.map((p, i) => (
                    <Item key={p.id} icon={<PanelsTopLeft />} onSelect={() => go(`/app/designer/editor?page=${p.id}`)} value={`page ${i + 1} ${p.label}`}>
                      <span className="tabular mr-2 text-ink-4">p.{i + 1}</span>
                      {p.label}
                    </Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Item({ icon, children, onSelect, hint, value }: { icon: React.ReactNode; children: React.ReactNode; onSelect: () => void; hint?: string; value?: string }) {
  return (
    <Command.Item
      onSelect={onSelect}
      value={value}
      className="group flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm text-ink data-[selected=true]:bg-hover [&_svg]:size-4 [&_svg]:text-ink-3"
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {hint ? <span className="text-[11px] text-ink-4">{hint}</span> : <ArrowRight className="!size-3.5 opacity-0 group-data-[selected=true]:opacity-100" />}
    </Command.Item>
  );
}

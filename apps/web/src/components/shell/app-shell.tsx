"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { FlaskConical, X } from "lucide-react";
import { useWorkspace } from "@/lib/store/workspace";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Kbd, Skeleton } from "@/components/ui/primitives";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { NAV } from "./nav";
import { useLiveSync } from "@/lib/api/live-sync";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useWorkspace((s) => s.hasHydrated);
  const mode = useWorkspace((s) => s.mode);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [navOpen, setNavOpen] = React.useState(false);
  const [bannerHidden, setBannerHidden] = React.useState(false);
  useLiveSync();

  React.useEffect(() => {
    if (!hydrated || mode) return;
    // A demo cookie without local state (e.g. storage cleared): re-seed rather than bounce.
    if (document.cookie.split("; ").includes("pf_mode=demo")) useWorkspace.getState().enterDemo();
    else router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [hydrated, mode, router, pathname]);

  React.useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        setShortcutsOpen(true);
        return;
      }
      if (pendingG) {
        pendingG = false;
        const target = NAV.find((n) => n.shortcut === `G ${e.key.toUpperCase()}`);
        if (target) router.push(target.href);
        return;
      }
      if (e.key === "g") {
        pendingG = true;
        clearTimeout(timer);
        timer = setTimeout(() => (pendingG = false), 900);
        return;
      }
      if (e.key === "c" && !pathname.startsWith("/app/designer/editor")) router.push("/app/new");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);

  React.useEffect(() => setNavOpen(false), [pathname]);

  const fullBleed = pathname.startsWith("/app/designer/editor");

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      <DialogPrimitive.Root open={navOpen} onOpenChange={setNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(14_23_38/0.3)] lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex shadow-lg outline-none lg:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Main navigation</DialogPrimitive.Description>
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenPalette={() => setPaletteOpen(true)} onOpenShortcuts={() => setShortcutsOpen(true)} onOpenNav={() => setNavOpen(true)} />
        {mode === "demo" && !bannerHidden && !fullBleed && (
          <div className="flex items-center gap-2 border-b border-[#ecd9ab] bg-[#fdf8ec] px-4 py-1.5 text-xs text-[#7a5200]">
            <FlaskConical className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <strong className="font-semibold">Demo workspace.</strong> People, quotations, statistics, recordings and photographs are fictional seeded data, and processing steps are simulated. Your edits are stored only in this browser.
            </span>
            <button onClick={() => setBannerHidden(true)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-[#f6ead0]">
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <main className={fullBleed ? "min-h-0 flex-1 overflow-hidden" : "scroll-thin min-h-0 flex-1 overflow-y-auto"}>
          {hydrated && mode ? children : <ShellSkeleton />}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent title="Keyboard shortcuts" size="md">
          <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
            {[
              ["Command palette", "⌘ K"],
              ["Create magazine", "C"],
              ["Shortcuts", "?"],
              ...NAV.filter((n) => n.shortcut?.startsWith("G")).map((n) => [`Go to ${n.label}`, n.shortcut!]),
              ["Undo (designer)", "⌘ Z"],
              ["Redo (designer)", "⇧ ⌘ Z"],
              ["Nudge element", "← ↑ → ↓"],
              ["Delete element", "⌫"],
              ["Zoom in / out", "+ / −"],
              ["Save (designer)", "⌘ S"],
            ].map(([label, keys]) => (
              <div key={label} className="flex items-center justify-between border-b border-line py-2 text-sm">
                <span className="text-ink-2">{label}</span>
                <span className="flex gap-1">
                  {keys.split(" ").map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-6 py-8">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

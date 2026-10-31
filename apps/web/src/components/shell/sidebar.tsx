"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut, Plus, RotateCcw, UserRound } from "lucide-react";
import { useWorkspace } from "@/lib/store/workspace";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/display";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, useConfirm } from "@/components/ui/overlays";
import { Logo } from "./logo";
import { NAV } from "./nav";
import { signOutEverywhere } from "@/lib/api/session";

function isActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const confirm = useConfirm();
  const user = useWorkspace((s) => s.user);
  const org = useWorkspace((s) => s.organisation);
  const mode = useWorkspace((s) => s.mode);
  const pendingApprovals = useWorkspace((s) => s.articles.filter((a) => a.projectId === s.activeProjectId && (a.status === "in_review" || a.status === "needs_revision")).length);
  const resetDemo = useWorkspace((s) => s.resetDemo);

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-subtle">
      <div className="flex h-12 items-center px-4">
        <Link href="/app" onClick={onNavigate}>
          <Logo />
        </Link>
      </div>

      <div className="px-2.5 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5 text-left shadow-xs transition-colors hover:border-line-strong">
              <span className="flex size-6 items-center justify-center rounded-[5px] bg-accent text-[11px] font-bold text-white">{org?.name?.[0] ?? "E"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-tight text-ink">{org?.name ?? "Workspace"}</span>
                <span className="block text-[11px] leading-tight text-ink-3">{mode === "demo" ? "Demo workspace" : "Live workspace"}</span>
              </span>
              <ChevronsUpDown className="size-3.5 text-ink-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[212px]">
            <DropdownMenuLabel>Organisation</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => router.push("/app/settings?tab=organisation")}>Organisation settings</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/app/settings?tab=members")}>Members & roles</DropdownMenuItem>
            {mode === "demo" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  icon={<RotateCcw />}
                  onSelect={async () => {
                    if (await confirm({ title: "Reset demo workspace?", description: "All changes you made in this browser are discarded and the seeded demo data is restored.", confirmLabel: "Reset", tone: "danger" })) {
                      resetDemo();
                      router.push("/app");
                    }
                  }}
                >
                  Reset demo data
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="scroll-thin flex-1 overflow-y-auto px-2.5 py-1" aria-label="Main">
        <ul className="flex flex-col gap-px">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-hover hover:text-ink",
                    active && !item.children && "bg-surface font-medium text-ink shadow-xs ring-1 ring-line",
                    active && item.children && "font-medium text-ink",
                  )}
                >
                  <Icon className={cn("size-4 text-ink-3 group-hover:text-ink-2", active && "text-accent group-hover:text-accent")} strokeWidth={1.75} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.href === "/app/studio" && pendingApprovals > 0 && (
                    <span className="tabular rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning">{pendingApprovals}</span>
                  )}
                  {item.href === "/app/new" && <Plus className="size-3.5 text-ink-4 opacity-0 group-hover:opacity-100" />}
                </Link>
                {item.children && active && (
                  <ul className="relative mb-1 ml-[17px] mt-0.5 flex flex-col gap-px border-l border-line pl-2.5">
                    {item.children.map((c) => {
                      const childActive = pathname === c.href;
                      return (
                        <li key={c.href}>
                          <Link
                            href={c.href}
                            onClick={onNavigate}
                            className={cn("flex h-7 items-center rounded-md px-2 text-[13px] text-ink-3 hover:bg-hover hover:text-ink", childActive && "bg-surface font-medium text-ink shadow-xs ring-1 ring-line")}
                          >
                            {c.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-line p-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-hover">
              <Avatar initials={user?.initials ?? "?"} size={26} seed={user?.id} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-tight">{user?.name ?? "Guest"}</span>
                <span className="block truncate text-[11px] leading-tight text-ink-3">{user?.title ?? user?.email}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[212px]">
            <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
            <DropdownMenuItem icon={<UserRound />} onSelect={() => router.push("/app/settings?tab=profile")}>
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<LogOut />}
              onSelect={async () => {
                await signOutEverywhere();
                router.push("/sign-in");
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

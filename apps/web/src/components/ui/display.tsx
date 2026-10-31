import * as React from "react";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/* Badge ------------------------------------------------------------- */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "outline";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-info-soft text-ink-2",
  accent: "bg-accent-soft text-accent-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  outline: "border border-line bg-surface text-ink-2",
};

const dotClasses: Record<Tone, string> = {
  neutral: "bg-ink-4",
  accent: "bg-accent",
  success: "bg-success-dot",
  warning: "bg-warning-dot",
  danger: "bg-danger-dot",
  outline: "bg-ink-4",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  icon?: React.ReactNode;
}

export function Badge({ tone = "neutral", dot, pulse, icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-xs font-medium [&_svg]:size-3",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dotClasses[tone], pulse && "animate-pulse-dot")} />}
      {icon}
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", dotClasses[tone], pulse && "animate-pulse-dot", className)} />;
}

/** Marks seeded/simulated data so it is never mistaken for real processing output. */
export function SimulatedBadge({ label = "Simulated", className, title }: { label?: string; className?: string; title?: string }) {
  return (
    <span
      title={title ?? "Seeded demo data. No real media or AI processing is behind this item."}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-dashed border-[#d9b36c] bg-[#fdf8ec] px-1.5 text-[11px] font-medium text-[#8a5a00]",
        className,
      )}
    >
      <FlaskConical className="size-3" />
      {label}
    </span>
  );
}

/* Panel / card -------------------------------------------------------- */

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-line bg-surface shadow-xs", className)} {...props} />;
}

interface PanelHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export function PanelHeader({ title, description, actions, icon, className }: PanelHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-ink-3 [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/* Empty state -------------------------------------------------------- */

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-16", className)}>
      <div className="relative mb-4">
        <div className="absolute inset-0 -m-3 rounded-full bg-[radial-gradient(circle,rgb(34_81_204/0.08),transparent_70%)]" />
        <div className="relative flex size-11 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 shadow-sm [&_svg]:size-5">
          {icon}
        </div>
      </div>
      <h3 className="text-md font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink-3">{description}</p>}
      {action && <div className="mt-5 flex items-center gap-2">{action}</div>}
    </div>
  );
}

/* Avatar ------------------------------------------------------------- */

const avatarPalette = ["#2251cc", "#0f766e", "#9a3412", "#6d28d9", "#0f1e3d", "#b45309", "#be185d", "#15803d"];

export function Avatar({ initials, size = 24, className, seed }: { initials: string; size?: number; className?: string; seed?: string }) {
  const key = seed ?? initials;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const color = avatarPalette[hash % avatarPalette.length];
  return (
    <span
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38), background: color }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/* Page header -------------------------------------------------------- */

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, meta, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {meta && <div className="mb-2 flex flex-wrap items-center gap-2">{meta}</div>}
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* Stat -------------------------------------------------------------- */

export function Stat({ label, value, sub, icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink-3 [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      <div className="tabular text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink">{value}</div>
      {sub && <div className="text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

/* Table ------------------------------------------------------------- */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn("h-8 whitespace-nowrap border-b border-line bg-subtle px-3 text-left text-xs font-medium text-ink-3 first:pl-4 last:pr-4", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("h-11 border-b border-line px-3 align-middle text-ink first:pl-4 last:pr-4", className)} {...props} />;
}

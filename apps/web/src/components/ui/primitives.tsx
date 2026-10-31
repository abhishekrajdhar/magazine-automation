"use client";

import * as React from "react";
import {
  Checkbox as CheckboxPrimitive,
  Switch as SwitchPrimitive,
  Tooltip as TooltipPrimitive,
  Tabs as TabsPrimitive,
  Popover as PopoverPrimitive,
  Slider as SliderPrimitive,
  Progress as ProgressPrimitive,
  Separator as SeparatorPrimitive,
} from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/* Checkbox ---------------------------------------------------------- */

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line-strong bg-surface shadow-xs transition-colors hover:border-ink-4 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-white">
        {props.checked === "indeterminate" ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/* Switch ------------------------------------------------------------ */

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full border border-transparent bg-line-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 translate-x-[1px] rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[13px]" />
    </SwitchPrimitive.Root>
  );
}

/* Tooltip ----------------------------------------------------------- */

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  shortcut?: string;
  delay?: number;
}

export function Tooltip({ content, children, side = "top", shortcut, delay }: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 flex max-w-xs items-center gap-2 rounded-sm bg-navy px-2 py-1 text-xs text-white shadow-md data-[state=delayed-open]:animate-fade-in"
        >
          {content}
          {shortcut && <kbd className="rounded-[3px] bg-white/15 px-1 font-sans text-[10px] text-white/80">{shortcut}</kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* Tabs -------------------------------------------------------------- */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("flex items-center gap-1 border-b border-line", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-sm font-medium text-ink-3 transition-colors hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("outline-none", className)} {...props} />;
}

/* Segmented control ------------------------------------------------- */

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode; title?: string }[];
  size?: "sm" | "md";
  className?: string;
}

export function Segmented<T extends string>({ value, onChange, options, size = "md", className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-md border border-line bg-sunken p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[5px] font-medium text-ink-3 transition-all hover:text-ink [&_svg]:size-3.5",
            size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
            value === o.value && "bg-surface text-ink shadow-sm",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* Popover ----------------------------------------------------------- */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({ className, align = "start", sideOffset = 6, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 rounded-lg border border-line bg-surface p-3 shadow-lg outline-none data-[state=open]:animate-fade-in", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/* Slider ------------------------------------------------------------ */

export function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root className={cn("relative flex h-4 w-full touch-none select-none items-center", className)} {...props}>
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-line">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          className="block size-3.5 rounded-full border border-line-strong bg-white shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

/* Progress ---------------------------------------------------------- */

export function Progress({ value, className, tone = "accent" }: { value: number; className?: string; tone?: "accent" | "success" | "warning" | "danger" }) {
  const toneClass = { accent: "bg-accent", success: "bg-success-dot", warning: "bg-warning-dot", danger: "bg-danger-dot" }[tone];
  return (
    <ProgressPrimitive.Root className={cn("relative h-1 w-full overflow-hidden rounded-full bg-sunken", className)} value={value}>
      <ProgressPrimitive.Indicator
        className={cn("h-full transition-[width] duration-500 ease-out", toneClass)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

/* Separator --------------------------------------------------------- */

export function Separator({ className, orientation = "horizontal", ...props }: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn("shrink-0 bg-line", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
      {...props}
    />
  );
}

/* Kbd --------------------------------------------------------------- */

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line bg-surface px-1 font-sans text-[10.5px] font-medium text-ink-3 shadow-[0_1px_0_var(--color-line)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* Skeleton ---------------------------------------------------------- */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("skeleton h-4", className)} style={style} aria-hidden />;
}

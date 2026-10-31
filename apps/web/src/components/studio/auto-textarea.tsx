"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Borderless textarea that grows with its content — for writing in place. */
export const AutoTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function AutoTextarea({ className, value, onChange, ...props }, forwarded) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };
  React.useLayoutEffect(resize, [value]);
  return (
    <textarea
      ref={(n) => {
        inner.current = n;
        if (typeof forwarded === "function") forwarded(n);
        else if (forwarded) forwarded.current = n;
      }}
      rows={1}
      value={value}
      onChange={(e) => {
        onChange?.(e);
        resize();
      }}
      className={cn("block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-ink-4", className)}
      {...props}
    />
  );
});

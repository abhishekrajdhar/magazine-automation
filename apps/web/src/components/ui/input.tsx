import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/utils/cn";

const fieldBase =
  "w-full rounded-md border border-line bg-surface text-ink shadow-xs transition-[border-color,box-shadow] placeholder:text-ink-4 hover:border-line-strong focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_rgb(34_81_204/0.14)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 aria-invalid:border-danger aria-invalid:focus-visible:shadow-[0_0_0_3px_rgb(180_35_24/0.12)]";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  inputSize?: "sm" | "md";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, leading, trailing, inputSize = "md", ...props }, ref) => {
    const height = inputSize === "sm" ? "h-7 text-sm" : "h-8 text-sm";
    if (!leading && !trailing) {
      return <input ref={ref} className={cn(fieldBase, height, "px-2.5", className)} {...props} />;
    }
    return (
      <div className={cn("relative flex items-center", className)}>
        {leading && (
          <span className="pointer-events-none absolute left-2.5 flex items-center text-ink-4 [&_svg]:size-3.5">
            {leading}
          </span>
        )}
        <input
          ref={ref}
          className={cn(fieldBase, height, leading ? "pl-8" : "pl-2.5", trailing ? "pr-9" : "pr-2.5")}
          {...props}
        />
        {trailing && <span className="absolute right-1.5 flex items-center">{trailing}</span>}
      </div>
    );
  },
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldBase, "min-h-[76px] px-2.5 py-2 text-sm leading-relaxed", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("text-sm font-medium text-ink", className)} {...props} />;
}

interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  optional?: boolean;
  /** Content aligned opposite the label, e.g. a "Forgot password?" link. */
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, hint, error, optional, aside, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {aside ?? (optional && <span className="text-xs text-ink-4">Optional</span>)}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

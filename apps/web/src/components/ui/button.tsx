import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow] duration-150 select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(14_23_38/0.15)] hover:bg-accent-hover",
        dark: "bg-navy text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_1px_2px_rgb(14_23_38/0.2)] hover:bg-[#182a4f]",
        secondary:
          "border border-line bg-surface text-ink shadow-xs hover:border-line-strong hover:bg-subtle",
        ghost: "text-ink-2 hover:bg-hover hover:text-ink",
        subtle: "bg-sunken text-ink hover:bg-[#e8e6e0]",
        danger: "bg-danger text-white hover:bg-[#9b1d13]",
        "danger-ghost": "text-danger hover:bg-danger-soft",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 rounded-sm px-2 text-xs [&_svg]:size-3.5",
        sm: "h-7 rounded-sm px-2.5 text-sm [&_svg]:size-3.5",
        md: "h-8 rounded-md px-3 text-sm [&_svg]:size-4",
        lg: "h-10 rounded-md px-4 text-base [&_svg]:size-4",
        icon: "size-8 rounded-md [&_svg]:size-4",
        "icon-sm": "size-7 rounded-sm [&_svg]:size-3.5",
        "icon-xs": "size-6 rounded-sm [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };

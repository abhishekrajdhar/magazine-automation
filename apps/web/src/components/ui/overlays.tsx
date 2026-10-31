"use client";

import * as React from "react";
import { Dialog as DialogPrimitive, DropdownMenu as MenuPrimitive, Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "./button";

/* Dialog ------------------------------------------------------------ */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

interface DialogContentProps extends Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  footer?: React.ReactNode;
  hideClose?: boolean;
}

export function DialogContent({ title, description, size = "md", footer, hideClose, className, children, ...props }: DialogContentProps) {
  const width = { sm: "max-w-[400px]", md: "max-w-[520px]", lg: "max-w-[720px]", xl: "max-w-[960px]" }[size];
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(14_23_38/0.32)] backdrop-blur-[1px] data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-[12vh] z-50 flex max-h-[80vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-xl border border-line bg-surface shadow-lg outline-none data-[state=open]:animate-fade-in",
          width,
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-md font-semibold text-ink">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-ink-3">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogPrimitive.Description>
            )}
          </div>
          {!hideClose && (
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X />
              </Button>
            </DialogPrimitive.Close>
          )}
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-subtle px-5 py-3">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/* Confirm dialog (imperative) ---------------------------------------- */

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: "default" | "danger";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = React.useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setState({ ...options, resolve })),
    [],
  );

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={state !== null} onOpenChange={(open) => !open && close(false)}>
        {state && (
          <DialogContent
            title={state.title}
            description={state.description}
            size="sm"
            footer={
              <>
                <Button variant="secondary" onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button variant={state.tone === "danger" ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
                  {state.confirmLabel ?? "Confirm"}
                </Button>
              </>
            }
          >
            <span className="sr-only">Confirm action</span>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ctx;
}

/* Dropdown menu ----------------------------------------------------- */

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;

export function DropdownMenuContent({ className, sideOffset = 6, align = "start", ...props }: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn("z-50 min-w-[200px] rounded-lg border border-line bg-surface p-1 shadow-lg data-[state=open]:animate-fade-in", className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

interface MenuItemProps extends React.ComponentProps<typeof MenuPrimitive.Item> {
  icon?: React.ReactNode;
  shortcut?: string;
  tone?: "default" | "danger";
}

export function DropdownMenuItem({ className, icon, shortcut, tone = "default", children, ...props }: MenuItemProps) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-sm text-ink outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover [&_svg]:size-3.5 [&_svg]:text-ink-3",
        tone === "danger" && "text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="text-xs text-ink-4">{shortcut}</span>}
    </MenuPrimitive.Item>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn("px-2 pb-1 pt-1.5 text-xs font-medium text-ink-4", className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <MenuPrimitive.Separator className="-mx-1 my-1 h-px bg-line" />;
}

/* Select ------------------------------------------------------------ */

interface SelectProps<T extends string> {
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; description?: string; disabled?: boolean }[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Select<T extends string>({ value, onValueChange, options, placeholder, className, size = "md", id, disabled, ...rest }: SelectProps<T>) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={rest["aria-label"]}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-2.5 text-left text-sm text-ink shadow-xs transition-colors hover:border-line-strong focus-visible:border-accent focus-visible:outline-none data-[placeholder]:text-ink-4 disabled:opacity-50",
          size === "sm" ? "h-7" : "h-8",
          className,
        )}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-3.5 text-ink-4" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[320px] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-surface shadow-lg data-[state=open]:animate-fade-in"
        >
          <SelectPrimitive.Viewport className="scroll-thin p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-default flex-col rounded-sm py-1.5 pl-7 pr-2 text-sm text-ink outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 top-2">
                  <Check className="size-3.5 text-accent" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                {o.description && <span className="text-xs text-ink-3">{o.description}</span>}
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

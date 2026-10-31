"use client";

import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/primitives";
import { ConfirmProvider } from "@/components/ui/overlays";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <ConfirmProvider>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: "!rounded-lg !border !border-line !bg-surface !text-ink !shadow-lg !font-sans !text-sm",
              description: "!text-ink-3",
              actionButton: "!bg-accent !text-white",
            },
          }}
        />
      </ConfirmProvider>
    </TooltipProvider>
  );
}

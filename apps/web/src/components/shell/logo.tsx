import { cn } from "@/lib/utils/cn";

export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <rect width="24" height="24" rx="5.5" fill="#0f1e3d" />
      <path d="M7 5.5h6.2a4.3 4.3 0 0 1 0 8.6H10v4.4H7z" fill="#fff" />
      <rect x="10" y="8.3" width="3.4" height="3" rx="0.6" fill="#0f1e3d" />
      <rect x="13.6" y="15.8" width="4.4" height="2.7" rx="0.6" fill="#4f7bff" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      {!compact && (
        <span className="flex items-baseline gap-1.5 leading-none">
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">PressFlow</span>
          <span className="hidden text-[11px] font-medium text-ink-4 sm:inline">by Elets</span>
        </span>
      )}
    </span>
  );
}

/** Generic source glyphs for media cards. */
export function SourceGlyph({ type, className }: { type: "youtube" | "google_drive" | "upload_video" | "upload_audio"; className?: string }) {
  if (type === "youtube")
    return (
      <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-label="YouTube">
        <rect x="2" y="5" width="20" height="14" rx="4" fill="#e5372e" />
        <path d="M10 9l5 3-5 3z" fill="#fff" />
      </svg>
    );
  if (type === "google_drive")
    return (
      <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-label="Google Drive">
        <path d="M8.5 3h7l6 10.5-3.5 6h-12L2.5 13.5z" fill="none" />
        <path d="M8.6 3.5h6.8l6 10.4h-6.8z" fill="#f6b600" />
        <path d="M8.6 3.5L2.6 13.9l3.4 5.9 6-10.4z" fill="#1fa463" />
        <path d="M6 19.8h12l3.4-5.9H9.4z" fill="#4285f4" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-label="Upload" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {type === "upload_audio" ? <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" /> : <path d="M15 10l5-3v10l-5-3M3 6h12v12H3z" />}
    </svg>
  );
}

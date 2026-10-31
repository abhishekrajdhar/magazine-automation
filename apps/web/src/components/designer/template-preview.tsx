import type { DesignProfile } from "@/lib/domain/types";
import { resolveSlots, resolveTemplate } from "@/lib/templates/compose";
import { useWorkspace } from "@/lib/store/workspace";

const FILL: Record<string, string> = {
  hero_image: "#c9d4ea",
  image: "#c9d4ea",
  portrait: "#d6dceb",
  ad: "#e7d9c9",
  background: "#3b4660",
  accent_bar: "#2251cc",
  rule: "#2251cc",
};

/** Wireframe of a template resolved against a design profile (so it reflects the reference grid). */
export function TemplatePreview({ templateId, profile, pageNumber = 1, width }: { templateId: string; profile: DesignProfile; pageNumber?: number; width: number }) {
  const templates = useWorkspace((s) => s.templates);
  const tpl = resolveTemplate(templateId, templates);
  const W = profile.page.widthPt;
  const H = profile.page.heightPt;
  if (!tpl) return <div style={{ width, height: (width * H) / W }} className="bg-sunken" />;
  const slots = resolveSlots(tpl, profile, pageNumber);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width} height={(width * H) / W} className="shrink-0 border border-line bg-white" aria-hidden>
      {slots.map((s) => {
        const fill = FILL[s.role];
        if (fill) return <rect key={s.id} x={s.x} y={s.y} width={s.w} height={Math.max(2, s.h)} fill={fill} opacity={s.role === "background" ? (s.opacity ?? 0.5) : 1} />;
        const isHeadline = s.role === "headline" || s.role === "stat";
        const lineH = isHeadline ? 18 : s.role === "body" ? 9 : 7;
        const lines = Math.max(1, Math.floor(s.h / (lineH * 1.5)));
        const cols = s.columns || 1;
        const cw = (s.w - (cols - 1) * profile.grid.gutterPt) / cols;
        return (
          <g key={s.id} fill={isHeadline ? "#14213d" : s.role === "kicker" || s.role === "pullquote" ? "#2251cc" : "#aab2c0"}>
            {Array.from({ length: cols }).flatMap((_, c) =>
              Array.from({ length: Math.min(lines, 60) }, (_, i) => <rect key={`${c}-${i}`} x={s.x + c * (cw + profile.grid.gutterPt)} y={s.y + i * lineH * 1.5} width={i === lines - 1 && lines > 1 ? cw * 0.6 : cw} height={lineH * 0.6} rx={lineH * 0.2} />),
            )}
          </g>
        );
      })}
    </svg>
  );
}

import type { EventSession, ExtractedFact } from "@/lib/domain/types";

export interface GenerationBlocker {
  title: string;
  body: string;
  href?: string;
  cta?: string;
}

/**
 * The first thing standing between the editor and a batch of drafts, in the
 * order it has to be fixed, or null when Generate can run. Mirrors the API,
 * which only writes from approved facts on the selected sessions' recordings.
 * A missing LLM provider is reported separately, so it isn't checked here.
 */
export function generationBlocker(input: {
  sessions: Pick<EventSession, "id" | "videoId">[];
  facts: Pick<ExtractedFact, "videoId" | "status">[];
  pickedSessionIds: string[];
  typeCount: number;
}): GenerationBlocker | null {
  const { sessions, facts, pickedSessionIds, typeCount } = input;
  if (sessions.length === 0) {
    return {
      title: "Process a recording first",
      body: "Drafts are written from analysed sessions, and this project has none yet. Upload the original recording (or add it from Google Drive), open it and choose Process recording. It's transcribed, then the sessions, speakers, quotes and figures are extracted.",
      href: "/app/media",
      cta: "Go to Event Media Library",
    };
  }
  if (!pickedSessionIds.length) return { title: "Choose at least one session", body: "Tick the sessions this batch of drafts should cover." };
  const videos = new Set(sessions.filter((s) => pickedSessionIds.includes(s.id)).map((s) => s.videoId));
  if (!facts.some((f) => f.status === "approved" && videos.has(f.videoId))) {
    return {
      title: "Approve some facts first",
      body: "Drafts only use quotations and figures an editor has approved, and none are approved for the selected sessions. Review them on each recording's Quotes & facts tab.",
      href: videos.size === 1 ? `/app/media/${[...videos][0]}?tab=facts` : "/app/media",
      cta: "Review facts",
    };
  }
  if (!typeCount) return { title: "Choose at least one article type", body: "Tick the kinds of article to draft." };
  return null;
}

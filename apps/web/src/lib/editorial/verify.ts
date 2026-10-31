/**
 * Deterministic source verification: are an article's quotations and figures
 * actually present in the transcripts they cite? No language model involved.
 */
import type { Article, SourceRef, TranscriptSegment } from "@/lib/domain/types";

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”"]/g, "")
    .replace(/[—–]/g, "-")
    .replace(/[^\p{L}\p{N}%.,'\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,'-]+|[\s.,'-]+$/g, "")
    .trim();
}

const tokens = (s: string) => normalize(s).split(" ").filter(Boolean);

export type MatchKind = "verified" | "partial" | "not_found";

export interface TranscriptMatch {
  status: MatchKind;
  segment?: TranscriptSegment;
  score: number;
}

/** Find text in transcript segments: exact (normalised) substring, else best token overlap. */
export function findInTranscript(text: string, segments: TranscriptSegment[]): TranscriptMatch {
  const needle = normalize(text);
  if (!needle) return { status: "not_found", score: 0 };
  for (const seg of segments) if (normalize(seg.text).includes(needle)) return { status: "verified", segment: seg, score: 1 };
  const want = tokens(text);
  let best: TranscriptMatch = { status: "not_found", score: 0 };
  for (const seg of segments) {
    const have = new Set(tokens(seg.text));
    const score = want.filter((t) => have.has(t)).length / want.length;
    if (score > best.score) best = { status: score >= 0.8 ? "partial" : "not_found", segment: seg, score };
  }
  return best;
}

export interface Claim {
  id: string;
  kind: "quote" | "figure";
  text: string;
  blockId?: string;
  status: MatchKind;
  /** Where the evidence was found, if anywhere. */
  segment?: TranscriptSegment;
  /** True when the evidence is in a segment the block itself cites. */
  inCitedSource: boolean;
}

const NUMBER = /(?:₹\s?)?\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s?(?:%|percent|per cent|crore|lakh|billion|million|days?|hours?|months?|years?)?|\b(?:a fifth|a third|half|nine out of eleven|forty-five|twenty-one)\b/gi;

function figuresIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(NUMBER)) {
    const v = m[0].trim();
    // Skip years and bare small ordinals that carry no claim ("2026", "two days").
    if (/^(19|20)\d{2}$/.test(v)) continue;
    if (/^\d$/.test(v)) continue;
    out.add(v);
  }
  return [...out];
}

const QUOTED = /[“"]([^”"]{12,})[”"]/g;

const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "forty-five" → "45", "nine out of eleven" → "9 out of 11", so spoken and written figures compare equal. */
export function numberWordsToDigits(text: string): string {
  return text.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](one|two|three|four|five|six|seven|eight|nine))?\b|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi, (m, tens?: string, unit?: string, single?: string) => {
    if (tens) return String(TENS[tens.toLowerCase()] + (unit ? UNITS[unit.toLowerCase()] : 0));
    return single ? String(UNITS[single.toLowerCase()]) : m;
  });
}

function figurePresent(figure: string, segText: string): boolean {
  const f = normalize(numberWordsToDigits(figure)).replace(/ per cent| percent/, "%").replace(/\s/g, "");
  const s = normalize(numberWordsToDigits(segText)).replace(/ per cent| percent/g, "%").replace(/\s/g, "");
  const core = f.replace(/(%|crore|lakh|billion|million|days?|hours?|months?|years?)$/, "");
  return s.includes(f) || (core.length > 0 && new RegExp(`(^|[^0-9.,])${core.replace(/[.,]/g, (c) => `\\${c}`)}([^0-9]|$)`).test(s));
}

function segmentsFor(refs: SourceRef[] | undefined, all: TranscriptSegment[]): TranscriptSegment[] {
  if (!refs?.length) return [];
  return all.filter((s) => refs.some((r) => r.segmentId === s.id || (r.videoId === s.videoId && s.start >= r.start - 1 && s.start <= (r.end ?? r.start + 1))));
}

/** Check every quotation and figure in an article against the transcripts. */
export function verifyArticle(article: Article, segments: TranscriptSegment[]): Claim[] {
  const claims: Claim[] = [];
  const blocks = [{ id: "intro", text: article.intro, sourceRefs: undefined as SourceRef[] | undefined, kind: "paragraph" as const }, ...article.body];
  for (const b of blocks) {
    const cited = segmentsFor(b.sourceRefs, segments);
    const quotes = b.kind === "quote" || b.kind === "answer" ? [b.text] : [...b.text.matchAll(QUOTED)].map((m) => m[1]);
    for (const q of quotes) {
      const inCited = cited.length ? findInTranscript(q, cited) : undefined;
      const match = inCited?.status === "verified" ? inCited : findInTranscript(q, segments);
      claims.push({ id: `${b.id}:q:${claims.length}`, kind: "quote", text: q, blockId: b.id, status: match.status, segment: match.segment, inCitedSource: inCited?.status === "verified" });
    }
    if (b.kind === "quote" || b.kind === "answer") continue;
    for (const f of figuresIn(b.text)) {
      const local = cited.find((s) => figurePresent(f, s.text));
      const anywhere = local ?? segments.find((s) => figurePresent(f, s.text));
      claims.push({ id: `${b.id}:f:${claims.length}`, kind: "figure", text: f, blockId: b.id, status: anywhere ? "verified" : "not_found", segment: anywhere, inCitedSource: !!local });
    }
  }
  return claims;
}

export function claimSummary(claims: Claim[]) {
  return {
    total: claims.length,
    verified: claims.filter((c) => c.status === "verified").length,
    partial: claims.filter((c) => c.status === "partial").length,
    missing: claims.filter((c) => c.status === "not_found").length,
  };
}

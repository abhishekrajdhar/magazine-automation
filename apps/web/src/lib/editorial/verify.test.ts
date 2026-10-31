import { describe, expect, it } from "vitest";
import { demoArticles } from "@/lib/demo/articles";
import { demoFacts, demoSegments } from "@/lib/demo/event";
import { claimSummary, findInTranscript, verifyArticle } from "./verify";

describe("findInTranscript", () => {
  it("matches quotations regardless of curly quotes and case", () => {
    const r = findInTranscript("“No patient should have to carry a plastic bag of old prescriptions to a new doctor.”", demoSegments);
    expect(r.status).toBe("verified");
    expect(r.segment?.videoId).toBe("v05");
  });

  it("reports paraphrases as partial or not found, never verified", () => {
    expect(findInTranscript("Infrastructure is public only if all citizens use it.", demoSegments).status).not.toBe("verified");
  });

  it("finds every seeded verbatim fact in its own transcript", () => {
    for (const f of demoFacts.filter((x) => x.provenance === "transcript_verbatim")) {
      const r = findInTranscript(f.text, demoSegments.filter((s) => s.videoId === f.videoId));
      expect(r.status, f.id).toBe("verified");
    }
  });
});

describe("verifyArticle", () => {
  it("flags the figure that does not appear in the cyber panel recording", () => {
    const art05 = demoArticles.find((a) => a.id === "art05")!;
    const claims = verifyArticle(art05, demoSegments);
    const wrong = claims.find((c) => c.kind === "figure" && c.text.startsWith("2,500"));
    expect(wrong?.status).toBe("not_found");
    expect(claims.filter((c) => c.kind === "quote").every((c) => c.status === "verified")).toBe(true);
  });

  it("treats spoken and written numbers as the same figure", () => {
    const art14 = demoArticles.find((a) => a.id === "art14")!;
    expect(claimSummary(verifyArticle(art14, demoSegments)).missing).toBe(0);
  });

  it("verifies all claims in an approved article", () => {
    const art04 = demoArticles.find((a) => a.id === "art04")!;
    const s = claimSummary(verifyArticle(art04, demoSegments));
    expect(s.total).toBeGreaterThan(4);
    expect(s.missing).toBe(0);
  });
});

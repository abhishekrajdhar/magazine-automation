import { describe, expect, it } from "vitest";
import { generationBlocker } from "./generation";

const sessions = [
  { id: "s1", videoId: "v1" },
  { id: "s2", videoId: "v2" },
];

describe("generationBlocker", () => {
  it("asks for a processed recording when there are no sessions", () => {
    const b = generationBlocker({ sessions: [], facts: [], pickedSessionIds: [], typeCount: 3 });
    expect(b?.title).toBe("Process a recording first");
    expect(b?.href).toBe("/app/media");
  });

  it("asks for a session when none is picked", () => {
    expect(generationBlocker({ sessions, facts: [], pickedSessionIds: [], typeCount: 3 })?.title).toBe("Choose at least one session");
  });

  it("only counts approved facts from the picked sessions' recordings", () => {
    const facts = [
      { videoId: "v1", status: "pending" as const },
      { videoId: "v2", status: "approved" as const },
    ];
    const b = generationBlocker({ sessions, facts, pickedSessionIds: ["s1"], typeCount: 3 });
    expect(b?.title).toBe("Approve some facts first");
    expect(b?.href).toBe("/app/media/v1?tab=facts");
    expect(generationBlocker({ sessions, facts, pickedSessionIds: ["s1", "s2"], typeCount: 3 })).toBeNull();
  });

  it("links to the library when the picked sessions span recordings", () => {
    const b = generationBlocker({ sessions, facts: [], pickedSessionIds: ["s1", "s2"], typeCount: 3 });
    expect(b?.href).toBe("/app/media");
  });

  it("asks for an article type last", () => {
    const facts = [{ videoId: "v1", status: "approved" as const }];
    expect(generationBlocker({ sessions, facts, pickedSessionIds: ["s1"], typeCount: 0 })?.title).toBe("Choose at least one article type");
  });
});

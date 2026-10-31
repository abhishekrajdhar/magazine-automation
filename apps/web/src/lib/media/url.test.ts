import { describe, expect, it } from "vitest";
import { parseMediaUrl, splitLinks } from "./url";

const ok = (u: string) => {
  const r = parseMediaUrl(u);
  if (!r.valid) throw new Error(`${u}: ${r.error}`);
  return r;
};

describe("parseMediaUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ?feature=share", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("accepts YouTube %s", (url, id) => {
    const r = ok(url);
    expect(r.sourceType).toBe("youtube");
    expect(r.externalId).toBe(id);
  });

  it.each([
    ["https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing", "file"],
    ["https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345", "file"],
    ["https://drive.google.com/uc?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345&export=download", "file"],
    ["https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345", "folder"],
    ["https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345", "folder"],
  ])("accepts Drive %s", (url, kind) => {
    const r = ok(url);
    expect(r.sourceType).toBe("google_drive");
    if (r.sourceType === "google_drive") expect(r.kind).toBe(kind);
  });

  it.each([
    ["", "Paste a link"],
    ["https://www.youtube.com/watch?v=short", "malformed"],
    ["https://www.youtube.com/@eletsonline", "channel"],
    ["https://www.youtube.com/playlist?list=PL123", "Playlists"],
    ["https://vimeo.com/123456", "Only YouTube and Google Drive"],
    ["ftp://drive.google.com/file/d/abc", "http\\(s\\)"],
    ["https://drive.google.com/drive/my-drive", "Couldn't find"],
  ])("rejects %s", (url, msg) => {
    const r = parseMediaUrl(url);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toMatch(new RegExp(msg, "i"));
  });

  it("splits pasted lists", () => {
    expect(splitLinks("https://youtu.be/dQw4w9WgXcQ,\nhttps://youtu.be/aaaaaaaaaaa  ")).toHaveLength(2);
  });
});

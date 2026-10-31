/**
 * Client-side validation for recording links. The API repeats this check and
 * fetches metadata server-side; nothing here contacts YouTube or Google.
 */

export type ParsedMediaUrl =
  | { valid: true; sourceType: "youtube"; externalId: string; kind: "video"; normalized: string }
  | { valid: true; sourceType: "google_drive"; externalId: string; kind: "file" | "folder"; normalized: string }
  | { valid: false; error: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

export function parseMediaUrl(input: string): ParsedMediaUrl {
  const raw = input.trim();
  if (!raw) return { valid: false, error: "Paste a link." };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) return { valid: false, error: "Only http(s) links are supported." };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { valid: false, error: "That isn't a valid URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { valid: false, error: "Only http(s) links are supported." };
  const host = url.hostname.replace(/^www\.|^m\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return YT_ID.test(id) ? yt(id) : { valid: false, error: "This youtu.be link has no valid video ID." };
  }
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (url.pathname === "/watch" && v) return YT_ID.test(v) ? yt(v) : { valid: false, error: "The video ID in this link is malformed." };
    const m = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/);
    if (m) return YT_ID.test(m[1]) ? yt(m[1]) : { valid: false, error: "The video ID in this link is malformed." };
    if (url.pathname.startsWith("/playlist")) return { valid: false, error: "Playlists aren't supported yet — add each session's video link." };
    if (/^\/(@|c\/|channel\/|user\/)/.test(url.pathname)) return { valid: false, error: "That's a channel link. Paste a link to a specific video." };
    return { valid: false, error: "Couldn't find a video in this YouTube link." };
  }
  if (host === "drive.google.com" || host === "docs.google.com") {
    const file = url.pathname.match(/\/file\/d\/([^/]+)/);
    if (file) return DRIVE_ID.test(file[1]) ? drive(file[1], "file") : { valid: false, error: "The Drive file ID in this link is malformed." };
    const folder = url.pathname.match(/\/drive\/(?:u\/\d+\/)?folders\/([^/?#]+)/);
    if (folder) return DRIVE_ID.test(folder[1]) ? drive(folder[1], "folder") : { valid: false, error: "The Drive folder ID in this link is malformed." };
    const id = url.searchParams.get("id");
    if ((url.pathname === "/open" || url.pathname === "/uc") && id) return DRIVE_ID.test(id) ? drive(id, "file") : { valid: false, error: "The Drive file ID in this link is malformed." };
    return { valid: false, error: "Couldn't find a file or folder in this Google Drive link." };
  }
  return { valid: false, error: "Only YouTube and Google Drive links are supported. Upload other recordings directly." };
}

const yt = (id: string): ParsedMediaUrl => ({ valid: true, sourceType: "youtube", externalId: id, kind: "video", normalized: `https://www.youtube.com/watch?v=${id}` });
const drive = (id: string, kind: "file" | "folder"): ParsedMediaUrl => ({
  valid: true,
  sourceType: "google_drive",
  externalId: id,
  kind,
  normalized: kind === "folder" ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view`,
});

/** Public thumbnail for a YouTube video ID (served by YouTube's image CDN). */
export const youtubeThumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Split a pasted block of links on whitespace/commas. */
export function splitLinks(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const MAX_UPLOAD_BYTES = 8 * 1024 ** 3;
export const ACCEPTED_MEDIA = /^(video\/(mp4|quicktime|webm|x-matroska|x-msvideo|mpeg)|audio\/(mpeg|mp4|x-m4a|m4a|wav|x-wav|webm|ogg|aac|flac))$/;
export const ACCEPTED_EXTENSIONS = /\.(mp4|mov|webm|mkv|avi|mpg|mpeg|mp3|m4a|wav|ogg|aac|flac)$/i;

export function validateMediaFile(file: File): string | null {
  if (!ACCEPTED_MEDIA.test(file.type) && !ACCEPTED_EXTENSIONS.test(file.name)) return `${file.name}: unsupported format. Use MP4, MOV, WebM, MKV, MP3, M4A, WAV or FLAC.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name}: larger than 8 GB. Split the recording or share it from Google Drive.`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  return null;
}

/** Read duration (and a poster frame for video) from a local file without uploading it. */
export async function probeMediaFile(file: File): Promise<{ durationSec?: number; thumbnail?: string; isAudio: boolean }> {
  const isAudio = file.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(file.name);
  const url = URL.createObjectURL(file);
  try {
    const el = document.createElement(isAudio ? "audio" : "video") as HTMLVideoElement;
    el.preload = "metadata";
    el.muted = true;
    el.src = url;
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error("unreadable"));
      setTimeout(() => reject(new Error("timeout")), 8000);
    });
    const durationSec = Number.isFinite(el.duration) ? el.duration : undefined;
    if (isAudio || !durationSec) return { durationSec, isAudio };
    el.currentTime = Math.min(durationSec * 0.1, 30);
    await new Promise<void>((resolve) => {
      el.onseeked = () => resolve();
      setTimeout(resolve, 4000);
    });
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = Math.round((320 * (el.videoHeight || 180)) / (el.videoWidth || 320));
    canvas.getContext("2d")?.drawImage(el, 0, 0, canvas.width, canvas.height);
    return { durationSec, thumbnail: canvas.toDataURL("image/jpeg", 0.72), isAudio };
  } catch {
    return { isAudio };
  } finally {
    URL.revokeObjectURL(url);
  }
}

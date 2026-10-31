/**
 * Demo asset library: 186 photographs (24 speaker portraits, 144 session
 * photographs, 18 general event photographs) plus advertisement slots.
 * None of these have real image files — they render as clearly labelled
 * procedural placeholders until real photographs are linked.
 */
import type { Asset } from "@/lib/domain/types";
import { DEMO_PROJECT_ID, demoSessions, demoSpeakers } from "./event";

const P = DEMO_PROJECT_ID;

/** Shot list used for every session; the placeholder renderer draws by tag. */
const sessionShots: { tag: string; label: string }[] = [
  { tag: "audience", label: "Delegates in the hall" },
  { tag: "stage", label: "Wide view of the stage" },
  { tag: "panel", label: "Panellists on stage" },
  { tag: "speaker", label: "Speaker at the lectern" },
  { tag: "speaker", label: "Speaker close-up" },
  { tag: "panel", label: "Panel in discussion" },
  { tag: "speaker", label: "Speaker addressing the audience" },
  { tag: "audience", label: "Audience listening" },
  { tag: "audience", label: "Audience from the rear of the hall" },
  { tag: "stage", label: "Stage and screens" },
  { tag: "networking", label: "Conversation after the session" },
  { tag: "audience", label: "Questions from the floor" },
  { tag: "panel", label: "Panellists respond to a question" },
  { tag: "stage", label: "Lamp-lighting / opening moment" },
  { tag: "speaker", label: "Speaker portrait on stage" },
  { tag: "networking", label: "Delegates exchange cards" },
  { tag: "audience", label: "Front rows" },
  { tag: "stage", label: "Session close" },
];

const generalShots: { tag: string; label: string }[] = [
  { tag: "venue", label: "Registration desk on the opening morning" },
  { tag: "exhibition", label: "Exhibition floor" },
  { tag: "networking", label: "Networking lounge" },
  { tag: "venue", label: "Venue exterior" },
  { tag: "exhibition", label: "Urban innovation pavilion" },
  { tag: "exhibition", label: "GovTech exhibition booths" },
  { tag: "networking", label: "Delegates at lunch" },
  { tag: "exhibition", label: "Product demonstration" },
  { tag: "networking", label: "Press lounge interview" },
  { tag: "venue", label: "Main hall before doors open" },
  { tag: "networking", label: "Closing reception" },
  { tag: "venue", label: "Summit signage" },
  { tag: "exhibition", label: "Start-up corner" },
  { tag: "networking", label: "Speakers' lounge" },
  { tag: "audience", label: "Overflow seating" },
  { tag: "venue", label: "Media wall" },
  { tag: "networking", label: "Delegates in the corridor" },
  { tag: "venue", label: "Evening view of the venue" },
];

const pad = (n: number) => String(n).padStart(2, "0");

// Session 8 is the awards night: retag some shots so placeholders show the ceremony.
const awardOverrides: Record<number, string> = { 1: "award", 4: "speaker", 9: "award", 12: "award", 14: "award" };

/** Assets that are deliberately low-resolution frame grabs (exercise preflight). */
const frameGrabs: Record<string, { w: number; h: number; videoId: string; at: number }> = {
  ast_ses03_06: { w: 1280, h: 720, videoId: "v03", at: 1680 },
  ast_ses06_04: { w: 1920, h: 1080, videoId: "v06", at: 1505 },
  ast_gen_09: { w: 960, h: 640, videoId: "v02", at: 0 },
};

const sessionAssets: Asset[] = demoSessions.flatMap((session, si) =>
  sessionShots.map((shot, i) => {
    const id = `ast_${session.id}_${pad(i + 1)}`;
    const tag = session.id === "ses08" ? awardOverrides[i + 1] ?? shot.tag : shot.tag;
    const grab = frameGrabs[id];
    const portraitOrientation = tag === "speaker" && i % 3 === 1;
    return {
      id,
      projectId: P,
      kind: grab ? "video_frame" : "photo",
      fileName: grab ? `${session.videoId}_frame_${grab.at}s.jpg` : `NEGS26_${session.id.toUpperCase()}_${pad(i + 1)}.jpg`,
      widthPx: grab?.w ?? (portraitOrientation ? 4000 : 6000),
      heightPx: grab?.h ?? (portraitOrientation ? 6000 : 4000),
      sessionId: session.id,
      videoId: session.videoId,
      tags: [tag, session.kind],
      caption: `${shot.label} — ${session.title.split(":")[0]}`,
      credit: grab ? `Frame from recording ${session.videoId}` : "Elets Photo Desk",
      seed: (si + 1) * 101 + i * 7,
      simulated: true,
    } satisfies Asset;
  }),
);

const generalAssets: Asset[] = generalShots.map((shot, i) => {
  const id = `ast_gen_${pad(i + 1)}`;
  const grab = frameGrabs[id];
  return {
    id,
    projectId: P,
    kind: grab ? "video_frame" : "photo",
    fileName: grab ? "v02_frame_pressroom.jpg" : `NEGS26_GEN_${pad(i + 1)}.jpg`,
    widthPx: grab?.w ?? 6000,
    heightPx: grab?.h ?? 4000,
    tags: [shot.tag],
    caption: shot.label,
    credit: "Elets Photo Desk",
    seed: 9000 + i * 13,
    simulated: true,
  };
});

const portraitAssets: Asset[] = demoSpeakers.map((s, i) => ({
  id: `ast_portrait_${s.id}`,
  projectId: P,
  kind: "portrait",
  fileName: `portrait_${s.name.replace(/[^a-z]+/gi, "_").toLowerCase()}.jpg`,
  widthPx: 2400,
  heightPx: 3000,
  speakerId: s.id,
  tags: ["portrait"],
  caption: `${s.name}, ${s.designation}, ${s.organisation}`,
  credit: "Speaker supplied",
  seed: 5000 + i * 17,
  simulated: true,
}));

export interface AdCreative {
  brand: string;
  tagline: string;
  body: string;
  ink: string;
  ground: string;
  accent: string;
}

/** Fictional advertisers. Ad slots are placeholders until creatives are supplied. */
export const adCreatives: Record<string, AdCreative> = {
  ast_ad_northwind: { brand: "Northwind Cloud India", tagline: "Sovereign cloud, built in India.", body: "Data residency · Cleared operations · Exit without penalty", ink: "#ffffff", ground: "#0b2545", accent: "#5fa8ff" },
  ast_ad_kaveri: { brand: "Kaveri Systems", tagline: "Grievances resolved, not just recorded.", body: "Case management for state departments", ink: "#13293d", ground: "#e8f1f2", accent: "#006494" },
  ast_ad_trident: { brand: "Trident Secure", tagline: "Test the restore. Not just the backup.", body: "Resilience engineering for critical public systems", ink: "#ffffff", ground: "#1b1b1e", accent: "#f2a541" },
  ast_ad_medisync: { brand: "Medisync Technologies", tagline: "Records that follow the patient.", body: "Certified health-stack integrations for clinics and labs", ink: "#0d3b30", ground: "#e9f5ef", accent: "#1a936f" },
  ast_ad_sahyadri: { brand: "Sahyadri Data Systems", tagline: "Tier IV. Tier trust.", body: "Government community cloud & data-centre services", ink: "#ffffff", ground: "#3d1f5c", accent: "#ff8c61" },
  ast_ad_pragati: { brand: "Pragati Payments", tagline: "Every rupee, reconciled.", body: "Treasury and benefit-transfer reconciliation for state finance departments", ink: "#1f1300", ground: "#f6efe2", accent: "#c8553d" },
  ast_ad_elets_ehealth: { brand: "Elets eHealth", tagline: "Digital Health Conclave 2027.", body: "Register interest · ehealth.eletsonline.com", ink: "#ffffff", ground: "#0f5257", accent: "#9ee493" },
  ast_ad_elets: { brand: "Elets Technomedia", tagline: "See you at the next summit.", body: "eGov · eHealth · Digital Learning · BFSI", ink: "#ffffff", ground: "#1e4fc2", accent: "#ffd23f" },
};

const adAssets: Asset[] = Object.entries(adCreatives).map(([id, c], i) => ({
  id,
  projectId: P,
  kind: "ad",
  fileName: `${c.brand.replace(/[^a-z]+/gi, "_")}_FP_A4.pdf`,
  widthPx: 2550,
  heightPx: 3600,
  tags: ["advertisement"],
  caption: `${c.brand} — full page`,
  credit: c.brand,
  seed: 7000 + i,
  simulated: true,
}));

export const demoAssets: Asset[] = [...portraitAssets, ...sessionAssets, ...generalAssets, ...adAssets];

export const PHOTO_COUNT = portraitAssets.length + sessionAssets.length + generalAssets.length;

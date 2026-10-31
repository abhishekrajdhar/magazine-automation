/**
 * Assembles the seeded demo workspace. Bump DEMO_SEED_VERSION whenever the
 * seed changes so persisted browser state is replaced.
 */
import type { ActivityItem, ExportRecord, Member, Organisation, Project, ReferenceMagazine, ReferencePage, DesignProfile, Template, User, MagazinePage } from "@/lib/domain/types";
import { composeMagazine, type PlanEntry } from "@/lib/templates/compose";
import { deriveTemplate } from "@/lib/templates/derive";
import { demoArticles } from "./articles";
import { demoAssets } from "./assets";
import { DEMO_PROJECT_ID, demoFacts, demoSegments, demoSessions, demoSpeakers, demoVideos } from "./event";
import { DEMO_PROFILE_ID, DEMO_REFERENCE_ID, demoProfile, demoReference, demoReferencePages } from "./reference";

export const DEMO_SEED_VERSION = 13;

export const demoOrg: Organisation = { id: "org_elets", name: "Elets Technomedia", slug: "elets", plan: "demo" };

export const demoUser: User = { id: "u_ritika", name: "Ritika Sharma", email: "ritika.sharma@demo.pressflow", title: "Executive Editor", initials: "RS" };

export const demoMembers: Member[] = [
  { userId: "u_ritika", name: "Ritika Sharma", email: "ritika.sharma@demo.pressflow", role: "owner", title: "Executive Editor", initials: "RS", lastActiveAt: "2026-10-31T11:40:00.000Z" },
  { userId: "u_arjun", name: "Arjun Menon", email: "arjun.menon@demo.pressflow", role: "designer", title: "Design Lead", initials: "AM", lastActiveAt: "2026-10-31T10:05:00.000Z" },
  { userId: "u_kavya", name: "Kavya Iyer", email: "kavya.iyer@demo.pressflow", role: "editor", title: "Senior Correspondent", initials: "KI", lastActiveAt: "2026-10-30T18:22:00.000Z" },
  { userId: "u_sameer", name: "Sameer Qureshi", email: "sameer.qureshi@demo.pressflow", role: "admin", title: "Production Manager", initials: "SQ", lastActiveAt: "2026-10-30T15:00:00.000Z" },
  { userId: "u_neha", name: "Neha Bansal", email: "neha.bansal@demo.pressflow", role: "viewer", title: "Partnerships", initials: "NB", lastActiveAt: "2026-10-27T09:30:00.000Z" },
];

const baseConfig: Project["config"] = {
  designMode: "exact_reference",
  targetPageCount: 40,
  contentStyle: "feature",
  language: "en",
  editorialTone: "authoritative",
  imagePreference: "speakers_first",
  articleTypes: ["event_report", "keynote", "panel", "interview", "government_perspective", "tech_feature", "speaker_profiles", "highlights", "editorial", "photo_captions"],
  includeToc: true,
  includeEditorial: true,
  includeAdvertisements: true,
  includeInterviews: true,
  includeEventReports: true,
  adPageCount: 6,
};

export const demoProject: Project = {
  id: DEMO_PROJECT_ID,
  orgId: demoOrg.id,
  title: "eGov — National eGovernance Summit 2026 Special",
  eventName: "National eGovernance Summit 2026",
  category: "Government Technology",
  issueNumber: "Vol. 22 · Issue 11",
  publicationDate: "2026-11-20",
  publisher: "Elets Technomedia Pvt. Ltd.",
  targetPageCount: 40,
  description: "Special issue covering the two-day summit in New Delhi: keynotes, panels and awards on digital public infrastructure, AI in governance, cyber resilience and citizen services.",
  status: "design",
  referenceId: DEMO_REFERENCE_ID,
  designProfileId: DEMO_PROFILE_ID,
  config: baseConfig,
  ownerId: demoUser.id,
  createdAt: "2026-10-16T09:20:00.000Z",
  updatedAt: "2026-10-31T11:40:00.000Z",
  isDemo: true,
};

/** Summary-only demo projects (no workspace content) to make the portfolio realistic. */
const otherProjects: (Project & { summary: ProjectSummary })[] = [
  ["prj_dhc26", "eHealth — Digital Health Conclave 2026", "Digital Health Conclave 2026", "Healthcare", "Vol. 19 · Issue 10", "2026-10-05", 48, "exported", { videos: 6, articles: 14, pages: 48, approvals: 0 }],
  ["prj_bfsi26", "BFSI Technology Forum 2026", "BFSI Technology Forum 2026", "Banking & Finance", "Vol. 8 · Issue 11", "2026-11-28", 36, "review", { videos: 5, articles: 11, pages: 36, approvals: 4 }],
  ["prj_ucs26", "Smart Cities — Urban Mobility Summit 2026", "Urban Mobility Summit 2026", "Urban Development", "Vol. 11 · Issue 12", "2026-12-12", 32, "editorial", { videos: 4, articles: 7, pages: 0, approvals: 7 }],
  ["prj_hel26", "Digital Learning — Higher Education Leadership Summit", "Higher Education Leadership Summit 2026", "Education", "Vol. 14 · Issue 12", "2026-12-20", 40, "ingesting", { videos: 9, articles: 0, pages: 0, approvals: 0 }],
  ["prj_sdg26", "State Digital Governance Forum 2026", "State Digital Governance Forum 2026", "Government Technology", "Vol. 23 · Issue 01", "2027-01-15", 44, "setup", { videos: 0, articles: 0, pages: 0, approvals: 0 }],
].map(([id, title, eventName, category, issueNumber, publicationDate, pages, status, summary], i) => ({
  ...demoProject,
  id: id as string,
  title: title as string,
  eventName: eventName as string,
  category: category as string,
  issueNumber: issueNumber as string,
  publicationDate: publicationDate as string,
  targetPageCount: pages as number,
  status: status as Project["status"],
  description: `${eventName} coverage issue.`,
  referenceId: i < 3 ? DEMO_REFERENCE_ID : undefined,
  designProfileId: i < 3 ? DEMO_PROFILE_ID : undefined,
  createdAt: new Date(Date.UTC(2026, 8 + Math.floor(i / 2), 3 + i * 5)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 9, 30 - i * 3, 10)).toISOString(),
  summary: summary as ProjectSummary,
}));

export interface ProjectSummary {
  videos: number;
  articles: number;
  pages: number;
  approvals: number;
}

export const demoProjectSummaries: Record<string, ProjectSummary> = Object.fromEntries(otherProjects.map((p) => [p.id, p.summary]));

export const demoProjects: Project[] = [demoProject, ...otherProjects.map(({ summary: _s, ...p }) => p)];

/* ------------------------------------------------------------------ */
/* Templates & flatplan                                                */
/* ------------------------------------------------------------------ */

const derivedFrom = (n: number) => deriveTemplate(demoReferencePages.find((p) => p.pageNumber === n)!, demoReference.title);
export const demoReferenceTemplates: Template[] = [derivedFrom(6), derivedFrom(10), derivedFrom(27)];

const plan: PlanEntry[] = [
  { pageType: "cover", templateId: "tpl_cover_fullbleed", label: "Cover", imageIds: ["ast_ses01_14"], locked: true },
  { pageType: "advertisement", templateId: "tpl_ad_full", label: "Ad · Northwind Cloud (IFC)", adAssetId: "ast_ad_northwind", locked: true },
  { pageType: "toc", templateId: "tpl_toc_classic", label: "Contents", imageIds: ["ast_gen_10"] },
  { pageType: "editorial", templateId: "tpl_editorial_portrait", label: "Editorial", articleId: "art01", locked: true },
  { pageType: "advertisement", templateId: "tpl_ad_full", label: "Ad · Kaveri Systems", adAssetId: "ast_ad_kaveri" },
  { pageType: "event_report", templateId: "tpl_report_hero", label: "Summit report", articleId: "art02", locked: true },
  { pageType: "two_column_article", templateId: "tpl_article_image_heavy", label: "Summit report (cont.)", articleId: "art02", locked: true },
  { pageType: "event_report", templateId: "tpl_report_split", label: "Keynote: DPI", articleId: "art03" },
  { pageType: "two_column_article", templateId: "tpl_article_image_heavy", label: "Keynote: DPI (cont.)", articleId: "art03" },
  { pageType: "event_report", templateId: "tpl_report_hero", label: "Panel: AI for Governance", articleId: "art04" },
  { pageType: "two_column_article", templateId: "tpl_article_image_heavy", label: "Panel: AI (cont.)", articleId: "art04" },
  { pageType: "interview", templateId: "tpl_interview_opener", label: "Interview: Dr. Farah Siddiqui", articleId: "art06" },
  { pageType: "infographic", templateId: "tpl_infographic_stats", label: "Summit in numbers", articleId: "art14" },
  { pageType: "event_report", templateId: "tpl_spread_photo_opener", label: "Panel: Cyber resilience", articleId: "art05" },
  { pageType: "two_column_article", templateId: "tpl_spread_text", label: "Panel: Cyber (cont.)", articleId: "art05" },
  { pageType: "two_column_article", templateId: "tpl_perspective_single", label: "Perspective: State cloud", articleId: "art07" },
  { pageType: "advertisement", templateId: "tpl_ad_full", label: "Ad · Trident Secure", adAssetId: "ast_ad_trident" },
  { pageType: "two_column_article", templateId: "tpl_feature_opener", label: "Feature: Smart cities", articleId: "art08" },
  { pageType: "full_page_image", templateId: "tpl_full_image", label: "Photo: Hall A", imageIds: ["ast_ses02_01"] },
  { pageType: "event_report", templateId: "tpl_spread_photo_opener", label: "Panel: Digital health", articleId: "art09" },
  { pageType: "two_column_article", templateId: "tpl_spread_text", label: "Panel: Health (cont.)", articleId: "art09" },
  { pageType: "interview", templateId: "tpl_interview_opener", label: "Interview: Dr. Lakshmi Venkatesh", articleId: "art10" },
  { pageType: "advertisement", templateId: "tpl_ad_full", label: "Ad · Medisync", adAssetId: "ast_ad_medisync" },
  { pageType: "event_report", templateId: "tpl_spread_photo_opener", label: "Panel: Agri-stack", articleId: "art11" },
  { pageType: "two_column_article", templateId: "tpl_spread_text", label: "Panel: Agri-stack (cont.)", articleId: "art11" },
  { pageType: "event_report", templateId: "tpl_spread_photo_opener", label: "Feature: AI-ready data", articleId: "art12" },
  { pageType: "two_column_article", templateId: "tpl_spread_text", label: "Feature: AI-ready data (cont.)", articleId: "art12" },
  { pageType: "two_column_article", templateId: "tpl_perspective_single", label: "Perspective: Redesign first", articleId: "art17" },
  { pageType: "advertisement", templateId: "tpl_ad_full", label: "Ad · Pragati Payments", adAssetId: "ast_ad_pragati" },
  { pageType: "speaker_profile", templateId: "tpl_speakers_grid", label: "Speakers (1/2)", articleId: "art13" },
  { pageType: "speaker_profile", templateId: "tpl_speakers_grid", label: "Speakers (2/2)", articleId: "art13" },
  { pageType: "photo_gallery", templateId: "tpl_gallery_grid", label: "Gallery (1/4)", articleId: "art18" },
  { pageType: "photo_gallery", templateId: "tpl_gallery_mosaic", label: "Gallery (2/4)", articleId: "art18" },
  { pageType: "photo_gallery", templateId: "tpl_gallery_grid", label: "Gallery (3/4)", articleId: "art18" },
  { pageType: "photo_gallery", templateId: "tpl_gallery_mosaic", label: "Gallery (4/4)", articleId: "art18" },
  { pageType: "event_report", templateId: "tpl_report_hero", label: "Awards", articleId: "art15" },
  { pageType: "full_page_image", templateId: "tpl_full_image", label: "Photo: Awards night", imageIds: ["ast_ses08_14"] },
  { pageType: "advertisement", templateId: "tpl_ad_full", label: "Ad · Sahyadri Data Systems", adAssetId: "ast_ad_sahyadri" },
  { pageType: "advertisement", templateId: "tpl_ad_full", label: "House ad · eHealth Conclave", adAssetId: "ast_ad_elets_ehealth" },
  { pageType: "advertisement", templateId: "tpl_ad_full", label: "Back cover · Elets house ad", adAssetId: "ast_ad_elets", locked: true },
];

const designStatusFor = (i: number): MagazinePage["designStatus"] => (i < 6 ? "approved" : i < 14 ? "ready" : i < 30 ? "in_progress" : "not_started");

export function buildDemoPages(): MagazinePage[] {
  const pages = composeMagazine(
    plan.map((e, i) => ({ ...e, id: `pg_${String(i + 1).padStart(2, "0")}` })),
    {
      profile: demoProfile,
      project: demoProject,
      articles: demoArticles,
      speakers: demoSpeakers,
      facts: demoFacts,
      assets: demoAssets,
      referenceTemplates: demoReferenceTemplates,
      imagePreference: demoProject.config.imagePreference,
    },
  );
  return pages.map((p, i) => ({ ...p, designStatus: p.pageType === "advertisement" ? "ready" : designStatusFor(i) }));
}

/* ------------------------------------------------------------------ */
/* Exports & activity                                                  */
/* ------------------------------------------------------------------ */

export const demoExports: ExportRecord[] = [
  { id: "exp_004", projectId: DEMO_PROJECT_ID, format: "indd", status: "unavailable", renderer: "indesign", fileName: "eGov_NEGS26_Special.indd", createdAt: "2026-10-30T17:02:00.000Z", createdBy: "u_arjun", message: "InDesign bridge not connected. Native INDD export is unavailable until a bridge is online." },
  { id: "exp_003", projectId: DEMO_PROJECT_ID, format: "layout_json", status: "complete", renderer: "browser", fileName: "eGov_NEGS26_layout-contract.json", createdAt: "2026-10-30T16:48:00.000Z", completedAt: "2026-10-30T16:48:01.000Z", createdBy: "u_arjun", message: "Regenerated from the current flatplan on download." },
  { id: "exp_002", projectId: DEMO_PROJECT_ID, format: "content_package", status: "complete", renderer: "browser", fileName: "eGov_NEGS26_articles.zip", createdAt: "2026-10-29T15:12:00.000Z", completedAt: "2026-10-29T15:12:02.000Z", createdBy: "u_kavya", message: "Approved articles only. Regenerated on download." },
  { id: "exp_001", projectId: DEMO_PROJECT_ID, format: "pdf_print", status: "unavailable", renderer: "reportlab", fileName: "eGov_NEGS26_print.pdf", createdAt: "2026-10-28T11:30:00.000Z", createdBy: "u_sameer", message: "Print PDF needs the PressFlow API (ReportLab renderer) or the InDesign bridge. Neither is connected in demo mode." },
];

export const demoActivity: ActivityItem[] = [
  { id: "act_12", at: "2026-10-31T11:40:00.000Z", actorId: "u_ritika", verb: "requested revision on", target: "Assume Breach, Keep Serving", kind: "article", projectId: DEMO_PROJECT_ID },
  { id: "act_11", at: "2026-10-31T10:05:00.000Z", actorId: "u_arjun", verb: "locked", target: "pages 1–6", kind: "page", projectId: DEMO_PROJECT_ID },
  { id: "act_10", at: "2026-10-30T17:02:00.000Z", actorId: "u_arjun", verb: "attempted INDD export of", target: "NEGS 2026 Special", kind: "export", projectId: DEMO_PROJECT_ID },
  { id: "act_09", at: "2026-10-30T16:48:00.000Z", actorId: "u_arjun", verb: "exported layout contract for", target: "NEGS 2026 Special", kind: "export", projectId: DEMO_PROJECT_ID },
  { id: "act_08", at: "2026-10-30T09:00:00.000Z", actorId: "u_ritika", verb: "approved", target: "Scenes From the Summit", kind: "article", projectId: DEMO_PROJECT_ID },
  { id: "act_07", at: "2026-10-29T15:12:00.000Z", actorId: "u_kavya", verb: "exported content package for", target: "NEGS 2026 Special", kind: "export", projectId: DEMO_PROJECT_ID },
  { id: "act_06", at: "2026-10-29T12:00:00.000Z", actorId: "u_ritika", verb: "approved", target: "Two Days, in Figures", kind: "article", projectId: DEMO_PROJECT_ID },
  { id: "act_05", at: "2026-10-28T12:30:00.000Z", actorId: "u_ritika", verb: "approved", target: "Everyone Has Run a Pilot. Very Few Have Run a Platform", kind: "article", projectId: DEMO_PROJECT_ID },
  { id: "act_04", at: "2026-10-18T07:45:00.000Z", actorId: "u_arjun", verb: "approved design profile", target: "eGov house style", kind: "reference", projectId: DEMO_PROJECT_ID },
  { id: "act_03", at: "2026-10-17T09:12:00.000Z", actorId: "u_sameer", verb: "completed processing of", target: "8 session recordings", kind: "video", projectId: DEMO_PROJECT_ID },
  { id: "act_02", at: "2026-10-16T09:41:00.000Z", actorId: "u_arjun", verb: "analysed reference", target: "eGov · September 2026", kind: "reference", projectId: DEMO_PROJECT_ID },
  { id: "act_01", at: "2026-10-16T09:20:00.000Z", actorId: "u_ritika", verb: "created project", target: "NEGS 2026 Special", kind: "project", projectId: DEMO_PROJECT_ID },
];

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

export interface DemoSeed {
  organisation: Organisation;
  user: User;
  members: Member[];
  projects: Project[];
  projectSummaries: Record<string, ProjectSummary>;
  references: ReferenceMagazine[];
  referencePages: ReferencePage[];
  designProfiles: DesignProfile[];
  templates: Template[];
  activity: ActivityItem[];
  workspace: {
    videos: typeof demoVideos;
    segments: typeof demoSegments;
    speakers: typeof demoSpeakers;
    sessions: typeof demoSessions;
    facts: typeof demoFacts;
    articles: typeof demoArticles;
    assets: typeof demoAssets;
    pages: MagazinePage[];
    exports: ExportRecord[];
  };
}

export function buildDemoSeed(): DemoSeed {
  return {
    organisation: demoOrg,
    user: demoUser,
    members: demoMembers,
    projects: demoProjects,
    projectSummaries: demoProjectSummaries,
    references: [demoReference],
    referencePages: demoReferencePages,
    designProfiles: [demoProfile],
    templates: demoReferenceTemplates,
    activity: demoActivity,
    workspace: {
      videos: demoVideos,
      segments: demoSegments,
      speakers: demoSpeakers,
      sessions: demoSessions,
      facts: demoFacts,
      articles: demoArticles,
      assets: demoAssets,
      pages: buildDemoPages(),
      exports: demoExports,
    },
  };
}

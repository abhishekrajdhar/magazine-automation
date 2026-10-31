# PressFlow API (v1)

Base path: `/api/v1`. Served by `services/api` (FastAPI). Interactive OpenAPI docs: `GET /api/docs`
(spec at `/api/openapi.json`).

## Conventions

- **JSON is camelCase** and mirrors `apps/web/src/lib/domain/types.ts`. Optional fields that have no
  value are **omitted** (never `null`), matching TypeScript `field?:` semantics.
- **Auth**: session JWT in the httpOnly cookie `pf_session` (SameSite=Lax, 7 days). `Authorization: Bearer <jwt>`
  is also accepted (the token is returned by signup/login for non-browser clients). The Next.js app proxies
  `/api/v1/*` to the API, so cookies are same-origin; CORS is also enabled for `http://localhost:3000`.
- **Org scoping**: every resource belongs to the caller's organisation. Objects from other organisations are `404`.
- **RBAC**: `viewer` read-only · `editor` content (media, transcripts, speakers, facts, sessions, articles) + article approval ·
  `designer` pages, templates, references, design profiles (+ profile approval) · `admin`/`owner` everything, including
  members and integrations. Denials are `403` with a message naming the role and permission.
- **Errors**: `{"detail": ...}`. Validation errors are `422` `{"detail": "Request validation failed", "errors": [{loc, msg, type}]}`.
  AI features with no provider configured return `503` `{"detail": {"code": "llm_not_configured", "message", "detail", "hint"}}`.
- **Jobs**: long work returns `202` with `{jobId, job}` (or a record that carries `jobId`); poll `GET /jobs/{id}`
  (`Job` shape). A DB-backed worker processes jobs (inline thread in dev, `python -m app.worker` in production).
- **Honesty**: nothing is simulated in production code paths. Missing credentials surface as `configured: false`,
  `unavailable` states, `503`s or explicit error messages.

## Health & integrations

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{status, service, version, env, database, time}` (no auth) |
| GET | `/integrations/status` | `IntegrationStatus[]` = `{key, label, configured, available, detail, docsHint}` for `database, storage, llm, transcription, youtube_metadata, youtube_captions, google_drive, ffmpeg, yt_dlp, indesign_bridge`. `available` is always the result of a real check (DB query, storage write, model lookup, oEmbed request, `ffmpeg -version`, bridge heartbeat < 2 min). Network checks are cached 5–10 min. |
| GET | `/integrations/indesign` | `{status: online\|offline\|not_configured, configured, bridges[], lastHeartbeatAt?, indesignVersion?, fontCount, queuedJobs, runningJobs, detail}` |
| GET | `/integrations/google/authorize` | admin/owner. `409` `{code: google_not_configured, ...}` when `GOOGLE_CLIENT_ID/SECRET` are unset. Browser navigation → `302` to Google; `Accept: application/json` or `?redirect=false` → `{authorizeUrl}`. Scopes: `drive.readonly`, `youtube.force-ssl`, `openid email`. |
| GET | `/integrations/google/callback` | OAuth redirect target. Stores Fernet-encrypted tokens, then redirects to `{FRONTEND_URL}/settings/integrations?google=connected\|error`. |
| DELETE | `/integrations/google` | admin/owner. Deletes stored Google tokens. |

## Auth & organisation

| Method | Path | Body → Response |
|---|---|---|
| POST | `/auth/signup` | `{name, email, password(≥8), organisationName, title?}` → `201 {user, organisation, role: "owner", token}` + cookie |
| POST | `/auth/login` | `{email, password}` → `{user, organisation, role, token}` + cookie. Signing in accepts pending invitations. |
| POST | `/auth/logout` | clears the cookie |
| GET | `/auth/me` | `{user: User, organisation: Organisation, role: Role}` |
| POST | `/auth/forgot-password` | `{email}` → `202 {ok, message}` always (no account enumeration). Token is never returned; in dev the reset link `{FRONTEND_URL}/reset-password?token=…` is written to the server log. |
| POST | `/auth/reset-password` | `{token, password}` → `{ok}`. Invalidates existing sessions. |
| GET | `/orgs/current` | `Organisation` |
| GET | `/orgs/current/members` | `Member[]` (+ additive `status: active\|invited`) |
| POST | `/orgs/current/members` | admin/owner. `{email, name, role, title?}` → `201 Member` (invite record; the invitee sets a password via forgot-password, or signs in if they already have an account) |
| PATCH | `/orgs/current/members/{userId}` | admin/owner. `{role}` → `Member` (only owners grant/revoke `owner`; the last owner cannot be demoted) |
| GET | `/orgs/current/activity?limit=` | `ActivityItem[]` |

## Projects & assets

| Method | Path | Notes |
|---|---|---|
| GET | `/projects` | `Project[]` |
| POST | `/projects` | `{title, eventName?, category?, issueNumber?, publicationDate?, publisher?, targetPageCount?, description?, referenceId?, designProfileId?, config?: GenerationConfig}` → `201 Project`. Linking a `referenceId` also links its design profile. |
| GET / PATCH / DELETE | `/projects/{id}` | PATCH takes any subset of the create fields + `status`. |
| GET | `/projects/{id}/workspace` | `ProjectWorkspace` aggregate (`project, videos, segments, speakers, sessions, facts, articles, assets, pages, exports`) |
| GET | `/projects/{id}/activity` | `ActivityItem[]` |
| GET | `/projects/{id}/assets` | `Asset[]` |
| POST | `/projects/{id}/assets` | multipart `file` (JPEG/PNG/WebP/TIFF, ≤ `MAX_ASSET_UPLOAD_MB`), `kind`, `caption?`, `credit?`, `sessionId?`, `speakerId?` → `201 Asset` (`url` = `/api/v1/assets/{id}/file`) |
| PATCH | `/assets/{id}` | `{kind?, sessionId?, speakerId?, tags?, caption?, credit?}` |
| GET | `/assets/{id}/file` | authorised stream (S3: `307` to a short-lived presigned URL) |

## Event media

| Method | Path | Notes |
|---|---|---|
| POST | `/media/resolve` | `{url}` → `{valid, sourceType?, externalId?, title?, thumbnailUrl?, durationSec?, captions: available\|none\|unknown, error?, isFolder}`. YouTube watch/youtu.be/shorts/live/embed/nocookie/v; Drive `file/d/…`, `open?id=`, `uc?id=`, `drive/folders/…`. YouTube title/thumbnail via oEmbed (server-side, timeouts); with `YOUTUBE_API_KEY` also duration + caption availability (`videos.list`). Drive metadata needs a connected Google account. |
| POST | `/projects/{id}/videos` | editor. `{url, title?, sessionId?, autoProcess?}` → `201 VideoSource[]` (a Drive folder yields one per audio/video file; requires Google connection) |
| POST | `/projects/{id}/videos/upload` | editor. multipart `file` (video/* or audio/*, ≤ `MAX_VIDEO_UPLOAD_MB`), `title?`, `sessionId?`, `autoProcess?` → `201 VideoSource`. Duration probed with ffprobe; files without an audio track are rejected. |
| POST | `/videos/{id}/process` | editor → `202 {jobId, job}`. Pipeline: acquire → ffmpeg 16 kHz mono → transcription → LLM analysis. Resumes from the last successful step. |
| GET | `/videos/{id}` | `VideoSource` |
| GET | `/videos/{id}/transcript` | `{videoId, transcription, segments: TranscriptSegment[]}` |
| PATCH | `/speakers/{id}` | `{name?, designation?, organisation?, verification?, bio?, portraitAssetId?}`. Human edits of an `ai_suggested` speaker make it `unverified` until set to `confirmed`. |
| PATCH | `/facts/{id}` | `{text?, kind?, speakerId?, status?, segmentId?}`. Editing `text` re-checks provenance against the transcript. |
| PATCH | `/sessions/{id}` | `{title?, kind?, speakerIds?, summary?, topics?, status?}` |

**Video states.** `processing.state` moves `pending → queued → acquiring → extracting_audio → transcribing → analysing → ready`.
Terminal non-success states: `failed` (error after retries), `needs_auth` (Drive not connected), `unavailable`:
- YouTube: captions are downloaded **only** through Data API `captions.download` by the Google account that owns the
  video. Otherwise the video becomes `unavailable` with a message asking for the original recording (upload or Drive)
  for Whisper transcription. `yt-dlp` audio download exists only behind `YOUTUBE_ALLOW_DOWNLOAD=true` (default off) and
  only for media the organisation owns.
- `TRANSCRIPTION_PROVIDER=none` → `unavailable` ("Transcription unavailable: …").
- Transcript done but no LLM → `unavailable` ("Transcript is ready, but AI analysis is unavailable: …"); re-run
  `/process` after configuring the provider (the transcript is reused).

**Grounding rules.** Every fact references a real segment (`videoId`, `segmentId`, `timestamp`); quotes that cannot be
grounded are dropped. `provenance: transcript_verbatim` only when the text is found in the transcript (normalised
match), otherwise `ai_interpretation`. Speakers from the LLM are stored as `ai_suggested`, never `confirmed`.

## References & design profiles

| Method | Path | Notes |
|---|---|---|
| POST | `/references` | designer. multipart `file` (PDF, `%PDF-` magic checked, ≤ `MAX_REFERENCE_UPLOAD_MB`, not encrypted), optional `designSource` (`.indd` with InDesign header or `.idml` zip), `title?`, `analyse` (default true) → `201 {reference: ReferenceMagazine, jobId?}` |
| GET | `/references` | `ReferenceMagazine[]` |
| GET | `/references/{id}` | `ReferenceMagazine` |
| POST | `/references/{id}/analyse` | designer → `202 {jobId, reference}` (returns the running job if one exists) |
| GET | `/references/{id}/pages` | `ReferencePage[]` (`imageUrl` points to the render endpoint) |
| GET | `/references/{id}/pages/{n}/image?scale=0.1–4` | PNG rendered by PyMuPDF, cached in storage (`extracted/`) |
| POST | `/references/{id}/pages/{n}/reanalyse` | designer → `202 {jobId, job}`; a manual correction (`corrected: true`) keeps its layout type |
| PATCH | `/references/{id}/pages/{n}` | designer. `{layoutType}` → `ReferencePage` with `corrected: true`, confidence 1; profile `pageTypeCounts` updated |
| GET | `/design-profiles/{id}` | `DesignProfile` |
| PATCH | `/design-profiles/{id}` | designer. Partial nested object, e.g. `{"grid": {"gutterPt": 12}, "typography": {"headline": {"size": 32}}}`. Changed dotted paths are added to `overrides`, `version` increments, an approved profile returns to `draft`. Re-analysis preserves overridden values. |
| POST | `/design-profiles/{id}/approve` | designer/admin → `DesignProfile` (`approvedAt`, `approvedBy`) |

The analysis job's `resultRef` is the design profile id.

## Editorial

| Method | Path | Notes |
|---|---|---|
| POST | `/projects/{id}/articles/generate` | editor. `{types: ArticleType[], sessionIds?: ID[]}` → `202 {jobId, job}`. `503` without an LLM; `409` when no facts are approved. Prompts use **approved** facts + transcript excerpts only; every block must cite segments (`sourceRefs`); names/designations/statistics may not be invented. Generated articles are `draft`, `generatedBy: "llm"`; an automatic deterministic check writes `reviewNote` when claims can't be verified. |
| GET | `/projects/{id}/articles` | `Article[]` |
| POST | `/projects/{id}/articles` | editor. Manual article `{type, headline?, subheadline?, kicker?, byline?, intro?, body?: ArticleBlock[], speakerIds?, sessionIds?}` (`generatedBy: "human"`) |
| GET / PATCH | `/articles/{id}` | PATCH any content field, `captions`, `suggestedImageIds`, `reviewNote`, `status` ∈ `draft\|in_review\|needs_revision` (approval only via `/approve`). Editing content of an approved article revokes approval. |
| POST | `/articles/{id}/assist` | editor. `{action: rewrite_headline\|change_tone\|expand\|shorten\|summarise\|regenerate_paragraph, blockId?, tone?}` → `{action, blockId?, suggestions: string[], provider, model}`. Suggestions are not applied automatically; alternates are cached in `variants`. `503` without an LLM. |
| POST | `/articles/{id}/verify` | **Deterministic, no LLM.** → `{articleId, checkedAt, engine: "deterministic", segmentsChecked, claims: [{text, kind: quote\|number\|percentage, status: verified\|partial\|not_found, sourceRef?, location, note?}], summary: {verified, partial, notFound}}`. Linked segments = block `sourceRefs` + quote facts + the article's sessions. |
| POST | `/articles/{id}/approve` | editor/admin → `Article` (`approvedBy/At`); linked pages become `editorialStatus: approved` |
| POST | `/articles/{id}/reject` | `{note}` → `Article` (`status: rejected`, `reviewNote`) |

## Planner & templates

| Method | Path | Notes |
|---|---|---|
| GET | `/projects/{id}/pages` | ordered `MagazinePage[]` |
| PUT | `/projects/{id}/pages` | designer. `{pages: MagazinePage[]}` (ids optional) → `{pages, preservedLocked}`. `templateId` must be a built-in, a stored template of the organisation, or `tpl_ref_<referenceId>_p<n>` for an analysed page of one of your references (derived and stored on the fly); otherwise `422 {detail: {message, templateIds}}`. Unknown `PageElement` fields round-trip untouched. Bulk replace; locked pages keep their stored content (only their position follows the request) and cannot be removed (`409` with `lockedPageIds`). A page can't be `approved` if its article isn't. |
| POST | `/projects/{id}/plan/recommend` | designer. `{targetPageCount?}` → `{engine: "heuristic", pages: MagazinePage[], rationale: string[]}` — **not saved**; PUT it to keep it. Deterministic: cover → ad → TOC → editorial → event reports → keynotes → panels/interviews interleaved with ads → features → profiles → gallery → back-cover ad; page counts from word count vs. profile capacity; trims by importance; locked pages stay in place. Composes pages with the same geometry and content rules as the frontend composer (`compose.ts`): text frames use the light markup (`^ ` lead, `## ` subhead, `Q: ` question, `• ` list, `> ` quote, `— ` attribution) and folio/contents frames are `dynamic`. |
| GET | `/templates[?designProfileId=]` | the 20 built-ins (`source: builtin`, IDs owned by `apps/web/src/lib/templates/specs.ts`: `tpl_cover_fullbleed`, `tpl_toc_classic`, `tpl_editorial_portrait`, `tpl_report_hero`, `tpl_report_split`, `tpl_spread_photo_opener`, `tpl_spread_text`, `tpl_feature_opener`, `tpl_article_image`, `tpl_article_quote`, `tpl_article_image_heavy`, `tpl_interview_opener`, `tpl_interview_qa`, `tpl_perspective_single`, `tpl_gallery_grid`, `tpl_gallery_mosaic`, `tpl_full_image`, `tpl_ad_full`, `tpl_infographic_stats`, `tpl_speakers_grid`) normalised against the given profile (default: house style) on a recto page, plus the organisation's reference-derived templates |
| POST | `/templates/derive` | designer. `{referenceId, pageNumber, name?}` → `201 Template` with id `tpl_ref_<referenceId>_p<pageNumber>` (port of the frontend's `deriveTemplate`); `200` with the existing template if already derived |

## Preflight & exports

| Method | Path | Notes |
|---|---|---|
| POST | `/projects/{id}/preflight` | Contracts built from saved pages fill `dynamic` frames (folio = page number + running text, contents = article openers), convert markup to plain text, give positional element ids a page prefix (`p3_el_body`), turn per-frame style overrides into derived paragraph styles (`PF Headline ~1`), and use master `B-Frames` (folio off) on pages that carry their own folio frame. Body: a layout contract (snake_case, `packages/contracts/layout-contract.schema.json`) or empty to check the project's saved pages. → `{checkedAt, issues: PreflightIssue[], summary: {error, warning, info, total}, notes: string[]}`. Checks: page size vs profile, numbering continuity, missing/broken assets, effective resolution (warn < 200 ppi, error < 150 ppi), empty text frames, image frames without captions on article pages, unapproved content, fonts missing from the InDesign bridge's reported list, margin violations, frames beyond bleed, **approximate** overset (ReportLab wrapping with fallback fonts — labelled approximate). Invalid contracts → `422` with schema errors. |
| POST | `/projects/{id}/exports` | `{format, contract?, renderer?: auto\|reportlab\|indesign, force?: bool}` → `202 ExportRecord`. The contract (supplied or built from saved pages) is validated against the JSON schema first. Formats: `pdf_digital`, `pdf_print` (ReportLab preview renderer; print adds 9 pt bleed, crop marks, slug; metadata Producer/Creator say *"PressFlow preview renderer (ReportLab) — not Adobe InDesign output"*; unapproved pages are watermarked), `page_previews` (zip of PNGs), `layout_json`, `content_package` (approved articles as Markdown + JSON), `asset_archive`, `indd` (InDesign bridge only — without an online bridge the record is `status: unavailable`, `message: "InDesign bridge not connected"`; never a fake file). `pdf_print` routes to the bridge when one is online (`renderer: indesign`). Final formats (`pdf_print`, `indd`) are refused (`status: failed`) while any page is unapproved unless `force: true`. |
| GET | `/projects/{id}/exports` | `ExportRecord[]` |
| GET | `/exports/{id}` | `ExportRecord` |
| GET | `/exports/{id}/download[?file=pdf\|indd\|idml]` | authorised stream with correct `Content-Type`/`Content-Length`/`Content-Disposition` (S3: `307` presigned redirect). `409` unless `complete`. `file=` selects extra files returned by the InDesign bridge. |
| GET | `/jobs/{id}` | `Job` |

## InDesign bridge (called by `services/indesign`)

Auth: `Authorization: Bearer <INDESIGN_BRIDGE_TOKEN>` (`503` if the API has no token configured, `401` on mismatch).

| Method | Path | Notes |
|---|---|---|
| POST | `/indesign/bridge/heartbeat` | `{bridgeId, hostname, mode: desktop\|server, indesignVersion, platform, fonts: string[]}` (`platform` = `sys.platform`; `fonts` = sorted "Family Style" strings, used by preflight) → `{ok, serverTime, fontCount}`. A bridge is online for 120 s after a heartbeat. |
| GET | `/indesign/bridge/jobs?status=queued\|running\|succeeded\|failed&limit=` | `{jobs: [{jobId, exportId, format, status, attempts, createdAt, fileName}]}` (UXP panel overview) |
| GET | `/indesign/bridge/jobs/next?bridgeId=` | `204` or `{jobId, exportId, format: indd\|pdf_print, contractUrl, assetsUrl, options: {pdfPreset, includeBleed, force?}}`. `force: true` is present **only** when a user explicitly forced export of unapproved pages. Claims are leased for `BRIDGE_JOB_LEASE_SECONDS` (default 2400 s); a claimed job with no result is re-queued after the lease (max 2 attempts, then `failed`). URLs are absolute on the API origin (`PUBLIC_API_URL` if set). |
| GET | `/indesign/bridge/jobs/{jobId}/contract` | the validated layout contract; approved pages carry `"approved": true` |
| GET | `/indesign/bridge/jobs/{jobId}/assets.zip` | files at the paths named by `contract.assets[].file` |
| POST | `/indesign/bridge/jobs/{jobId}/result` | multipart. Success: `status=succeeded`, `report=<json>`, files `indd`, `pdf` and/or `idml` (`indd` exports need `indd`; `pdf_print` needs `pdf`). Failure: `status=failed`, `error=<msg>`, optional `report`, no files. → `{ok, status, …}` |

## Shapes that extend `types.ts`

Additive fields only (frontend can ignore them): `Member.status`, `ResolveResponse.isFolder`,
`IntegrationStatus` (new type), `VerificationResult` (new type), `PreflightResponse` wrapper, `PlanRecommendResponse`
wrapper, `PagesPutResponse` wrapper, `JobRef` wrapper, `SessionResponse.token`.

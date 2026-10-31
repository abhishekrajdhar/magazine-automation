# Testing

## Automated suites

| Suite | Command | Covers |
|---|---|---|
| Web unit tests | `cd apps/web && npm test` | URL parsing for every YouTube and Drive link form, grid snapping, mirrored templates, text distribution, the 40-page demo composition (no repeated photographs), seed counts, verbatim fact matching, claim verification (catches the planted wrong figure) |
| Web types | `cd apps/web && npx tsc --noEmit` | TypeScript strict across the app |
| Web build | `cd apps/web && npx next build` | All routes compile |
| API | `cd services/api && uv run pytest` | Auth and RBAC, org isolation, projects, workspace aggregate, uploads, URL resolution, reference analysis against the fixture PDF (grid, margins, type, all 12 page types), templates and derivation, planner, preflight, contract validation, ReportLab rendering, the export lifecycle, INDD-without-bridge returning `unavailable`, the bridge round trip, the demo import, and the "not configured" paths |
| InDesign | `cd services/indesign && make check` | ES3 syntax check of the `.jsx` files, the renderer run against a mock InDesign DOM, osascript and SOAP payloads, safe zip extraction, the bridge job loop against a fake API, UXP helpers |

## Contract check

The browser's layout contract is validated against the schema with the API's validator:

```bash
cd services/api && uv run python -c "import json,jsonschema; jsonschema.validate(json.load(open('<contract.json>')), json.load(open('../../packages/contracts/layout-contract.schema.json')))"
```

Download a contract from **Exports → Layout contract (JSON)**. The demo issue (40 pages, 310 frames, 74 assets) validates with zero errors.

## Manual acceptance walkthrough

Demo mode needs only the web app; live steps need the API running.

1. **Log in**: `/sign-in` → *Explore the demo workspace*. Live: sign in as the seeded user or sign up.
2. **Create a project**: `/app/new` → fill the details. Validation blocks empty fields and page counts that aren't multiples of 4.
3. **Add recordings**: paste several YouTube and Drive links. Invalid links are rejected with a reason, YouTube thumbnails load, Drive items show "Needs authorisation". Uploaded files report their real duration and a thumbnail.
4. **Reference PDF**: upload a PDF or *Use sample reference PDF*. The preview, page count and size come from pdf.js in the browser. Live: the analysis job runs and the profile appears in the Reference Library.
5. **Review design properties**: Reference Library → the demo reference → *Design profile*. Change columns or margins and watch the live preview re-compose.
6. **Process recordings** (live, with credentials): Media → recording → *Process recording*.
7. **Transcripts and speakers**: Media → *Inaugural Session*. Click timestamps to seek, search, reassign a speaker, select text and *Save as quotation*.
8. **Generate content** (live with an LLM): Studio → *Generate articles*. In demo mode the dialog explains why it's unavailable.
9. **Edit and approve**: Studio → *Assume Breach, Keep Serving*. *Verify sources* flags "2,500"; correct it to "2,300", re-verify, then approve.
10. **Plan**: Designer → Flatplan. Drag pages, lock and unlock, change templates, *Recommend sequence*.
11. **Generate pages in the reference style**: the flatplan is composed from the approved profile. *Apply to project pages* on a reference re-flows pages after profile edits.
12. **Edit page elements**: Page editor. Select, drag (snaps to the grid), resize, double-click to edit text or crop an image, replace images, undo and redo.
13. **Quality checks**: Preflight. Fit overset text, snap frames to margins, follow links to unapproved articles.
14. **Preview**: Page editor → *Preview* opens the spread-by-spread reader.
15. **Export**: Exports → layout JSON, content package, page previews, asset archive, print view. Final formats stay disabled until the checklist passes and the required service is connected.

## Not covered (needs external services)

- Real LLM, Whisper, Google OAuth / Drive, YouTube Data API and S3 calls. These are only exercised against mocks or "not configured" paths.
- PostgreSQL at runtime. Migrations were rendered offline; tests run on SQLite.
- Any run inside Adobe InDesign or InDesign Server.

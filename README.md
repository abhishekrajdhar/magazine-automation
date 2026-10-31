# Elets PressFlow AI

From event videos to publication-ready magazines.

PressFlow takes **one reference magazine PDF** (a past issue) and the **recordings of an event** (YouTube links, Google Drive links or uploads). From those it builds a **new, editable magazine** that follows the reference's design system. Its pipeline:

1. Reconstruct the reference's design system: trim, margins, grid, type hierarchy, colour and page archetypes.
2. Transcribe the recordings and extract speakers, sessions, quotations and figures, each with its timestamp.
3. Draft articles from facts an editor has approved, and verify every quote and figure against the transcripts.
4. Plan and compose pages in the reference's style, as real text frames, image frames and shapes.
5. Preflight the issue and export it. Native `.indd` files are produced only by Adobe InDesign, through a bridge.

Built for Elets Technomedia. The demo workspace runs entirely in the browser and needs no API keys.

---

## What's real, what's simulated

| Area | Status |
|---|---|
| **Frontend app** (landing, auth, dashboard, projects, wizard, media, references, studio, flatplan, page editor, preflight, templates, exports, settings) | Fully working in demo mode. Live mode talks to the API. |
| **Reference analysis** (PyMuPDF: page size, margins, columns, gutter, baseline, type roles, palette, page types) | **Real.** Verified against the bundled sample PDF, where it recovers the known grid and classifies all 12 page types correctly. |
| **Template system and page composer** (profile-driven grid snapping, text flow across pages, mirrored spreads) | **Real.** Runs in the browser and is unit tested. |
| **Claim verification** (quotes and figures checked word for word against transcripts) | **Real and deterministic.** Runs in the browser and in the API. |
| **Preflight** (overset measured on the rendered DOM, resolution, captions, margins, numbering, approvals, fonts) | **Real.** |
| **Exports**: layout contract JSON, content package, page previews, asset archive, browser print-to-PDF | **Real.** Generated in the browser. The contract validates against the JSON Schema. |
| **Exports**: digital and print PDF via the API (ReportLab preview renderer, bleed and crop marks) | **Real.** The API generates it, and it is labelled as not InDesign output. |
| **Native INDD / PDF/X-4** via InDesign bridge (ExtendScript renderer, Python bridge, UXP panel) | **Written but untested.** InDesign wasn't available. Syntax checks and 84 unit tests pass against a mock DOM. |
| **Transcription** (Whisper-compatible), **LLM analysis and drafting** (Anthropic / OpenAI-compatible), **Google Drive OAuth**, **YouTube Data API captions**, **S3** | **Integration code exists but is untested here.** No credentials were available. Without them the API reports "not configured" and never fakes output. |
| **Demo workspace** (National eGovernance Summit 2026: 8 recordings, 24 speakers, 186 photographs, 18 drafts, 40 pages) | **Simulated, and labelled as such everywhere.** All people, quotations, statistics and photographs are fictional. Photographs are procedural placeholders. |

**Verified end to end on a running stack (web and API):**

1. Sign in to a live organisation.
2. Create a project through the wizard: a real YouTube link is resolved server-side via oEmbed, and the sample PDF is uploaded and analysed. The result matches the PDF's known grid, margins and type, with all 12 page types correct.
3. The pipeline reports YouTube captions as unavailable, with the reason, because Google OAuth isn't configured.
4. Page edits in the designer are saved to the API, and undo is saved too.
5. A digital PDF is rendered by the API from the browser-built contract and downloaded (40 pages).

---

## Quick start: demo only (no API, no keys)

```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000, choose **Sign in**, then **Explore the demo workspace**. Everything is stored in your browser. Use **Settings → Workspace data → Reset demo data** to start over.

## Full stack locally

Requires Python 3.13+ with [uv](https://docs.astral.sh/uv/), Node 22, and ffmpeg.

```bash
# 1. API
cd services/api
cp .env.example .env            # optional: add API keys to enable AI features
uv sync
uv run alembic upgrade head
uv run python scripts/seed.py   # demo org + user (password in var/demo-credentials.txt) + demo workspace import
uv run uvicorn app.main:app --port 8000

# 2. Web (in another terminal)
cd apps/web
cp .env.example .env.local
npm run dev
```

Sign in with the seeded demo user, or create an organisation at `/sign-up`. With the API running, the wizard's **Use sample reference PDF** button uploads `apps/web/public/samples/pressflow-sample-reference.pdf` and analyses it for real.

To regenerate the demo data the API imports, run `npm run export:demo` in `apps/web`, which writes `packages/demo-data/workspace.json`.

## Docker

```bash
docker compose up --build
```

This starts Postgres, MinIO (S3), the API, a worker and the web app on :3000. See [docs/deployment.md](docs/deployment.md).

---

## Repository layout

```
apps/web/              Next.js 16 + React 19 + TypeScript (strict) + Tailwind 4 + Radix primitives
  src/app/             Routes: marketing, auth, /app/* workspace, /print
  src/components/      Design system (ui/), shell, magazine renderer, designer, studio, media, reference, wizard
  src/lib/             Domain types, store (zustand), templates & composer, preflight, verification, exports, API client
  scripts/             export-demo-data.ts, copy-pdf-worker.mjs
services/api/          FastAPI + SQLAlchemy 2 + Alembic + PyMuPDF + ReportLab (see services/api/README.md)
services/indesign/     ExtendScript renderer, Python bridge worker, UXP panel (see docs/indesign.md)
packages/contracts/    layout-contract.schema.json: the hand-off between the editorial engine and renderers
packages/demo-data/    workspace.json: the demo workspace the API seed imports
docs/                  architecture, api, indesign, deployment, testing
```

## Documentation

- [Architecture](docs/architecture.md): modules, data flow, the template system and the layout contract
- [API reference](docs/api.md)
- [InDesign automation](docs/indesign.md)
- [Deployment](docs/deployment.md)
- [Testing](docs/testing.md)

## Principles the code enforces

- **Nothing unapproved ships.** Unapproved articles can be laid out but block final export. Editing approved copy sends it back to review.
- **Sources over fluency.** Quotes are only "verbatim" when found word for word in a transcript. Speaker designations are marked confirmed, unverified or AI-suggested.
- **Honest integrations.** Missing providers are reported as missing. A native `.indd` is never claimed unless InDesign produced it.
- **Credentials stay server-side.** The browser only calls same-origin `/api/v1`; Next.js proxies it to the API.

## Note for this machine

`~/Documents` is synced by iCloud with "Optimize Mac Storage", and the disk is about 97% full. macOS has been evicting project files, which made installs, type checks and dev compiles stall. As a workaround, heavy generated folders live in `*.nosync` directories, which iCloud ignores, behind symlinks: `apps/web/node_modules`, `apps/web/.next`, `services/api/.venv` and `services/api/var`.

`npm install` replaces the `node_modules` symlink with a real folder. After installing, run:

```bash
cd apps/web
rm -rf node_modules.nosync
mv node_modules node_modules.nosync
ln -s node_modules.nosync node_modules
```

Moving the repository out of `~/Documents`, for example to `~/Developer`, or freeing disk space avoids all of this.

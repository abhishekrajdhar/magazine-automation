# PressFlow API (`services/api`)

FastAPI backend for **Elets PressFlow AI**: event recordings + one reference magazine PDF → a new magazine that
reproduces the reference's design system. Endpoint reference: [`docs/api.md`](../../docs/api.md) (also live at
`/api/docs`).

Stack: FastAPI · Pydantic v2 (camelCase JSON mirroring `apps/web/src/lib/domain/types.ts`) · SQLAlchemy 2 + Alembic
(SQLite locally, PostgreSQL in production) · PyMuPDF · Pillow/numpy · ReportLab · httpx · PyJWT · bcrypt · Fernet ·
jsonschema · Anthropic SDK.

## Setup

```bash
cd services/api
# On this Mac ~/Documents is iCloud-synced with "optimise storage": keep the venv in a *.nosync dir.
uv venv --python 3.14 .venv.nosync && ln -sfn .venv.nosync .venv     # 3.13 also works
uv sync                                  # dev deps included; extras: --extra postgres --extra s3 --extra whisper-local
cp .env.example .env                     # optional; defaults work for local dev
uv run alembic upgrade head              # creates var/pressflow.db (SQLite)
uv run python scripts/seed.py            # demo org + demo@pressflow.local (password -> var/demo-credentials.txt)
```

If imports hang or fail with `TimeoutError` while reading `.py` files, iCloud has evicted the sources. Keeping
bytecode in the venv avoids reading them: `echo 'import sys, os; sys.pycache_prefix = os.path.join(sys.prefix, "pycache")' > .venv.nosync/lib/python3.14/site-packages/zz_pycache.pth && .venv/bin/python -m compileall -q app scripts tests alembic`.

`var/` holds the SQLite DB, local object storage (`var/storage/{videos,audio,references,extracted,exports,assets}`),
the generated dev secret and demo credentials. On iCloud-synced checkouts make it a `var.nosync` dir + `var` symlink too.

## Run

```bash
uv run uvicorn app.main:app --port 8000          # API (+ inline worker thread when RUN_WORKER_INLINE=true, the default)
uv run python -m app.worker                      # standalone worker (production: RUN_WORKER_INLINE=false)
uv run pytest                                    # tests (temp SQLite + temp storage, no network)
uv run python scripts/make_sample_reference.py   # regenerate the 12-page sample reference PDF
```

The Next.js app on `http://localhost:3000` proxies `/api/v1/*` to `http://localhost:8000`; the session cookie
`pf_session` is therefore same-origin. CORS for `localhost:3000` is enabled as well.

Docker: `docker compose up --build` at the repo root starts PostgreSQL, MinIO, the API and a worker
(`services/api/Dockerfile`, built from the repo root so the shared contract schema is included).

## Layout

```
app/
  main.py config.py db.py security.py deps.py ids.py worker.py
  models/            SQLAlchemy models (identity, project, reference, ops)
  schemas/           Pydantic camelCase schemas mirroring types.ts
  api/v1/            routers (auth, orgs, projects, media, references, profiles, editorial, planner,
                     templates, preflight, exports, jobs, integrations, indesign_bridge, health)
  services/
    reference_analysis/   PyMuPDF analyser (extract, blocks/roles, layout, profile, fonts, colours)
    llm/                  provider abstraction: anthropic | openai_compatible | none
    jobs/                 DB-backed queue + worker loop
    renderers/            ReportLab preview renderer for layout contracts
    storage.py transcription.py media_tools.py youtube.py google.py url_parsing.py video_pipeline.py
    video_analysis.py editorial.py claim_verification.py text_match.py planner.py page_builder.py
    template_specs.py templates.py page_builder.py composer.py (ports of the frontend's specs/geometry/compose)
    preflight.py contract.py exports.py reference_jobs.py integrations.py demo_import.py template_store.py ...
  contracts/         bundled copy of packages/contracts/layout-contract.schema.json (test asserts it matches)
alembic/             migrations (0001_initial — verified on SQLite; DDL renders JSONB on PostgreSQL)
scripts/             seed.py, make_sample_reference.py
tests/               pytest suite + fixtures/sample-reference.pdf
```

## Integrations

| Integration | Configure | Behaviour when not configured |
|---|---|---|
| LLM | Either `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. `LLM_PROVIDER=auto` (default) uses OpenAI when its key is set, otherwise Anthropic. Models: `OPENAI_MODEL` (default `gpt-4.1`) / `ANTHROPIC_MODEL` (default `claude-opus-5-5`, with `LLM_EFFORT`); `LLM_MODEL` overrides either. Force one with `LLM_PROVIDER=openai_compatible` or `anthropic`; `OPENAI_BASE_URL` points at any OpenAI-compatible server | AI endpoints return `503 llm_not_configured`; video pipeline stops after the transcript with state `unavailable` |
| Anthropic details | Streaming `beta.messages.stream` + `get_final_message()`, structured output via `output_config.format` (JSON schema), adaptive thinking (default for this model), server-side refusal fallback `fallbacks="default"` (beta `server-side-fallback-2026-07-01`); a final `refusal` is surfaced as an error, never as content | — |
| Transcription | `TRANSCRIPTION_PROVIDER=openai_compatible` (POST `/audio/transcriptions`, `verbose_json`, audio split into 64 kbps MP3 chunks < 25 MB, timestamps offset per chunk) or `local_whisper` (`uv sync --extra whisper-local`; downloads a model on first use) | video → `unavailable` with a clear message |
| YouTube metadata | none (oEmbed) | — |
| YouTube Data API | `YOUTUBE_API_KEY` → duration + caption availability | `captions: "unknown"` |
| YouTube captions | Google OAuth (`GOOGLE_CLIENT_ID/SECRET`) connected by the **account that owns the video** (`youtube.force-ssl`) → `captions.list` + `captions.download` | video → `unavailable`: "provide the original recording (upload or Drive) for Whisper transcription". No unofficial caption scraping. |
| yt-dlp | `YOUTUBE_ALLOW_DOWNLOAD=true` + `yt-dlp` on PATH — **only for recordings the organisation owns or has rights to** | off by default |
| Google Drive | OAuth web client; redirect URI `{PUBLIC_API_URL}/api/v1/integrations/google/callback`; connect via `GET /api/v1/integrations/google/authorize` (admin/owner) | `409` from authorize; Drive videos → `needs_auth` |
| Storage | `STORAGE_BACKEND=local` (default) or `s3` (`--extra s3`, `S3_*`; MinIO via `S3_ENDPOINT_URL`) | — |
| PostgreSQL | `DATABASE_URL=postgresql://…` (`--extra postgres`, psycopg 3) | SQLite |
| InDesign bridge | `INDESIGN_BRIDGE_TOKEN` shared with `services/indesign`; bridge heartbeats every < 120 s | `indd` exports → `unavailable` ("InDesign bridge not connected") |
| E-mail | integration boundary: dev logs password-reset links (`EMAIL_BACKEND=log`) | links logged, never returned by the API |

Secrets: `SECRET_KEY` and `TOKEN_ENCRYPTION_KEY` are required when `ENV=production` (the API refuses to start /
encrypt without them). In development a key is generated into `var/dev-secret.key`.

## What is verified vs. untested

Verified here (tests + manual `curl` against a running server):
- Alembic `upgrade head` on SQLite (tests run the real migration); PostgreSQL DDL rendered offline (`alembic upgrade head --sql`).
- Auth (signup/login/me/logout, cookie + bearer, forgot/reset with logged link, session invalidation), RBAC denials, org isolation.
- Projects CRUD, workspace aggregate, asset upload/download.
- Reference upload → PyMuPDF analysis → design profile/pages on the sample PDF (A4, 3 columns, 14 pt gutter,
  13 pt baseline, margins within ~1 pt, body Times 9.5, all 10 page types), page renders, corrections, re-analysis,
  profile PATCH overrides/approve, template derivation.
- Planner recommend + PUT pages (locks), preflight, ReportLab `pdf_digital`/`pdf_print`/`page_previews`/`layout_json`/
  `content_package`/`asset_archive` exports and downloads; `indd` → `unavailable` without a bridge.
- InDesign bridge protocol end-to-end with a simulated bridge client in tests (heartbeat, jobs/next, contract,
  assets.zip, result success + failure, lease re-queue).
- Job queue retries/backoff/permanent failure; upload of real audio + ffprobe; pipeline `unavailable` paths.
- YouTube oEmbed metadata (real network call) and integration status checks (ffmpeg, storage, DB, oEmbed).
- Anthropic provider request shape/parsing against a mocked HTTP transport (no real API call).

**Untested (no credentials available in this environment):** real Anthropic / OpenAI-compatible calls (article
generation, assist, transcript analysis, vision refinement), Whisper transcription, YouTube Data API key and
`captions.download`, Google OAuth + Drive download/folder listing, yt-dlp, S3/MinIO, PostgreSQL at runtime,
Docker images (compose file validated with `docker compose config`, images not built), and a real InDesign bridge.

# Deployment

PressFlow is four deployable pieces.

| Piece | Runs as | Notes |
|---|---|---|
| Web (`apps/web`) | Node 22 server: `next start`, or any Next.js host | Needs only `PRESSFLOW_API_URL`, which is server-side; the browser never sees it |
| API (`services/api`) | Container: `uvicorn app.main:app` | Stateless; scale horizontally |
| Worker (`services/api`) | Container: `python -m app.worker` | Set `RUN_WORKER_INLINE=false` on API replicas when running dedicated workers. Needs ffmpeg |
| InDesign bridge (`services/indesign/bridge`) | A Mac/Windows machine with InDesign or InDesign Server | Outbound HTTPS to the API only. Fonts used by your templates must be installed and licensed |

## Before you go live

Run the deployment check inside the API container or environment. It reads the same settings the API will run
with, confirms the database answers and is migrated, confirms storage is writable, and exits non-zero on anything
that must be fixed:

```bash
python -m app.checks
```

With `ENV=production` the API also refuses to start on a missing, short or placeholder `SECRET_KEY`, and logs the
same list at startup.

## Single host with Docker Compose (production)

```bash
cp .env.production.example .env.production      # fill in every value
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production exec api python -m app.checks
```

`docker-compose.prod.yml` has no default secrets, publishes only the web port, runs a dedicated worker, keeps
files in S3-compatible storage and restarts services on failure. Put TLS in front of the web port.
`docker-compose.yml` is the local stack with placeholder secrets and must not be exposed.

## Render

`render.yaml` is a blueprint for PostgreSQL, the API (with the worker inside it) and the web app. It has not been
exercised on Render yet; treat the first deploy as its test and run `python -m app.checks` in the API shell.

## The web app reads the API address at request time

`PRESSFLOW_API_URL` is read by `apps/web/src/proxy.ts` on every request, so one built image works in any
environment. (It used to be a `rewrites()` entry in `next.config.ts`, which Next.js fixes at build time: an image
built without the variable proxied to `localhost:8000` whatever it was given at runtime.)

## Who can sign in

| Variable | Effect |
|---|---|
| `SIGNUP_ALLOWED_DOMAINS` | Comma-separated e-mail domains allowed to create an organisation. Empty allows any. |
| `ALLOW_SIGNUP=false` | Nobody can create an organisation. Set it once yours exists; members join by invitation. |
| `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES` | Failed sign-ins per e-mail address before a temporary lock (default 8 in 15 minutes). Counted per API process; add a rate limit on `/api/v1/auth/*` at the load balancer when you run several replicas. |

**Invitations and password resets.** An administrator invites a member in Settings. A person without an account
gets a one-time link to choose a password. With a mail server (`EMAIL_BACKEND=smtp`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`) the link is e-mailed, and forgotten passwords can
be reset from the sign-in page. Without one, the link is shown once to the administrator to pass on, and nobody can reset a forgotten password by
themselves, so configure SMTP for anything beyond a small team.

## Data stores

- **PostgreSQL**: Neon or Supabase. Set `DATABASE_URL=postgresql+psycopg://…` and run `uv run alembic upgrade head` on deploy.
- **Object storage**: S3-compatible (AWS S3, R2, MinIO). Set `STORAGE_BACKEND=s3` and the `S3_*` variables in `services/api/.env.example`. Recordings, audio, reference PDFs, extracted images and exports use separate prefixes. Downloads go through authorised API endpoints or short-lived presigned URLs.

## Required secrets (API)

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | Session signing. Must be long and random |
| `TOKEN_ENCRYPTION_KEY` | Fernet key for OAuth tokens at rest |
| `INDESIGN_BRIDGE_TOKEN` | Shared with the bridge machine |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | LLM features (optional) |
| `TRANSCRIPTION_API_KEY` | Whisper-compatible transcription (optional) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Drive and YouTube caption access (optional) |
| `YOUTUBE_API_KEY` | Duration and caption availability (optional) |

Set `COOKIE_SECURE=true`, `FRONTEND_URL` and `CORS_ORIGINS` for your domains. Keep every key in the platform's secret store; none belong in the web app.

## Docker Compose (single host / staging)

```bash
docker compose up --build
```

This runs Postgres, MinIO with a bucket bootstrap, the API, the worker and the web app (port 3000). The compose file is a starting point: put TLS termination in front, and change every default password before using it beyond a test machine.

## Suggested production topology

- **Web**: Vercel, or a Node container behind a CDN.
- **API and worker**: Fly.io, Render, ECS or Cloud Run, as two process types from one image.
- **Database and storage**: Neon or Supabase Postgres, plus S3 or R2.
- **InDesign**: one licensed InDesign Server per renderer (or desktop InDesign for low volume), running the bridge as a service. The bridge polls for jobs, so it needs no inbound ports.

## Release checklist

1. Run `uv run alembic upgrade head`.
2. Run `uv run pytest` (API), `npm test && npx tsc --noEmit && npx next build` (web), and `make check` (`services/indesign`). `.github/workflows/ci.yml` runs all of these, the API suite a second time on PostgreSQL, `npm audit`, and both Docker image builds.
3. Check `GET /api/v1/integrations/status` for every integration you expect to be live.
4. Run `python -m app.checks` against the production environment and clear every error.
5. With the bridge running, confirm that `python -m pressflow_bridge --check` passes on the render machine.

## Verified on PostgreSQL

The whole API suite was run against PostgreSQL 16 on 17 November 2026 (real migrations, real queue locking) and
passes, as it does on SQLite. That run found one fault SQLite had hidden: `assets.seed` was a 32-bit column holding
32-bit unsigned hashes, so about half of picture inserts were rejected. Migration `0002_asset_seed_bigint` fixes it;
`alembic upgrade head` (run by the API container on start) applies it.

## Not yet verified

These could not be exercised on the machine the deployment work was done on (no room for Docker builds, no
credentials), so the first CI run and the first deploy are their test:

- The web Docker image building and starting. (The API image was built on 17 November 2026 and started against
  PostgreSQL 16 in Docker: it migrated to `0002_asset_seed_bigint`, answered `/api/v1/health`, passed
  `python -m app.checks` with warnings only, and refused a placeholder secret in production. The web image ran out
  of disk on that machine before it finished.)
- `render.yaml`.
- S3 storage, SMTP delivery against a real server, and every AI and Google integration (no credentials).
- An IDML package opened in Adobe InDesign.

# Deployment

PressFlow is four deployable pieces.

| Piece | Runs as | Notes |
|---|---|---|
| Web (`apps/web`) | Node 22 server: `next start`, or any Next.js host | Needs only `PRESSFLOW_API_URL`, which is server-side; the browser never sees it |
| API (`services/api`) | Container: `uvicorn app.main:app` | Stateless; scale horizontally |
| Worker (`services/api`) | Container: `python -m app.worker` | Set `RUN_WORKER_INLINE=false` on API replicas when running dedicated workers. Needs ffmpeg |
| InDesign bridge (`services/indesign/bridge`) | A Mac/Windows machine with InDesign or InDesign Server | Outbound HTTPS to the API only. Fonts used by your templates must be installed and licensed |

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
2. Run `uv run pytest` (API), `npm test && npx tsc --noEmit && npx next build` (web), and `make check` (`services/indesign`).
3. Check `GET /api/v1/integrations/status` for every integration you expect to be live.
4. With the bridge running, confirm that `python -m pressflow_bridge --check` passes on the render machine.

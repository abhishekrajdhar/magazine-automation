# PressFlow API / worker image.  Build from the repository root so the shared contract schema is included:
#   docker build -f services/api/Dockerfile -t pressflow-api .
FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv

WORKDIR /srv/services/api
COPY services/api/pyproject.toml services/api/uv.lock* ./
RUN uv sync --no-dev --extra postgres --extra s3 --no-install-project

COPY packages/contracts /srv/packages/contracts
COPY services/api/ ./

RUN useradd --create-home --uid 10001 pressflow && mkdir -p var && chown -R pressflow var
USER pressflow

EXPOSE 8000
# API: migrate then serve. The worker service overrides the command with `python -m app.worker`.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]

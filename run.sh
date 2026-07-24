#!/bin/bash
set -e
cd "$(dirname "$0")"

brew services start postgresql@17

# brew services start returns as soon as it's *launched* Postgres, not once it's actually ready
# to accept connections - starting uvicorn immediately after races that gap. db.init_schema()
# then fails at import time, and uvicorn's --reload supervisor gets stuck spinning at high CPU
# afterwards instead of cleanly retrying or exiting (observed directly: process alive, no
# listening socket, no new log output). Waiting here avoids hitting that failure mode at all.
echo "Waiting for Postgres..."
for i in $(seq 1 30); do
  pg_isready >/dev/null 2>&1 && break
  sleep 1
done
pg_isready >/dev/null 2>&1 || { echo "Postgres didn't come up after 30s" >&2; exit 1; }

# curl -s -o /dev/null http://localhost:11434 || { echo "ollama is not running - start it with 'ollama serve'" >&2; exit 1; }

# api.py runs the movers scan itself in a background thread on startup (see _startup() in
# api.py) so the server and frontend come up immediately instead of blocking here.

trap 'kill $(jobs -p) 2>/dev/null' EXIT
.venv/bin/uvicorn api:app --port 8010 --reload &
(cd frontend && npm run dev -- --port 5180) &

# Always the same fixed port - litellm.config.example.yaml documents Proxy URL as
# http://localhost:4000, and a stale process from a previous run silently squatting on a
# different port (instead of failing loudly) is what caused this to drift before. Run kill.sh
# first if this port is still held by an old run.
if [ -f litellm.config.yaml ]; then
  .venv/bin/litellm --config litellm.config.yaml --port 4000 &
else
  echo "litellm.config.yaml not found - skipping LiteLLM proxy (cp litellm.config.example.yaml litellm.config.yaml to set it up)" >&2
fi

# Langfuse (self-hosted, see docker-compose.langfuse.yml) - the LLM tracing backend the
# litellm/langfuse callback above sends to. Runs as containers, not a job for this script's
# `wait` below - `up -d` starts them detached and returns immediately. First boot pulls several
# images and runs DB migrations, so the web UI (http://localhost:3000) takes a minute to answer.
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  docker compose -f docker-compose.langfuse.yml up -d
else
  echo "Docker not available - skipping Langfuse (start Docker Desktop, or see docker-compose.langfuse.yml)" >&2
fi

wait


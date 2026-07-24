#!/bin/bash
set -e
cd "$(dirname "$0")"

brew services start postgresql@17

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

wait


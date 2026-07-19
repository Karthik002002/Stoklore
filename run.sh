#!/bin/bash
set -e
cd "$(dirname "$0")"

brew services start postgresql@17

curl -s -o /dev/null http://localhost:11434 || { echo "ollama is not running - start it with 'ollama serve'" >&2; exit 1; }

.venv/bin/python main.py --limit 10

trap 'kill $(jobs -p) 2>/dev/null' EXIT
.venv/bin/uvicorn api:app --port 8010 &
(cd frontend && npm run dev -- --port 5180) &
wait


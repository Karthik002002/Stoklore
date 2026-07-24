#!/bin/bash
cd "$(dirname "$0")"

# Kills whatever's listening on this app's ports - backend (uvicorn), frontend (vite), and the
# LiteLLM proxy. Port-based instead of pattern-matching process names, so a stale/reload-spawned
# worker still gets killed even if its command line doesn't match a fixed pattern.
for port in 8010 5180 4000; do
  pid=$(lsof -ti :$port)
  if [ -n "$pid" ]; then
    kill -9 $pid 2>/dev/null
    echo "killed process on port $port"
  fi
done
brew services stop postgresql@17

# Langfuse runs as containers (docker-compose.langfuse.yml), not host processes - `down` stops
# and removes them (named volumes, so its data survives to the next `up`). Safe to run even if
# nothing is up.
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  docker compose -f docker-compose.langfuse.yml down
fi

echo "stopped"

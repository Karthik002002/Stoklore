#!/bin/bash
pkill -9 -f "uvicorn api:app" 2>/dev/null
pkill -9 -f "crawler/frontend/node_modules/.bin/vite" 2>/dev/null
brew services stop postgresql@17
echo "stopped"

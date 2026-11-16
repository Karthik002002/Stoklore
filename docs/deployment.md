# Deployment Guide

[← Back to Documentation Index](README.md)

This guide covers deploying Stoklore using **Docker & Docker Compose**, as well as single-container and production deployment options.

---

## 1. Architecture Overview

Stoklore is architected to run as **a single unified service** in production:
* The React 19 frontend is built into static assets (`frontend/dist/`).
* FastAPI (`app/main.py`) detects `frontend/dist/` and automatically mounts the single-page application (SPA) shell and assets directly.
* A single exposed port (**8010**) serves both the JSON API (`/api/*`), WebSocket connections (`/ws/*`), and the interactive UI. No separate Nginx or reverse-proxy container is strictly required for basic deployments.

```
                    ┌──────────────────────────────────────────────┐
                    │               User's Browser                 │
                    │           http://localhost:8010              │
                    └──────────────────────┬───────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Docker Network                                                                         │
│                                                                                        │
│   ┌────────────────────────────────────────┐     ┌──────────────────────────────────┐  │
│   │ stoklore-app                           │     │ stoklore-db                      │  │
│   │ - FastAPI Backend                      │────▶│ - PostgreSQL 17 + pgvector       │  │
│   │ - Embedded Compiled Frontend           │     │ - Stores journals, embeddings    │  │
│   │   (Serves static assets & /api)        │     │ - Auto-migrating schema          │  │
│   └───────────────────┬────────────────────┘     └──────────────────────────────────┘  │
│                       │                                                                │
│       ┌───────────────┴─────────────────┐                                              │
│       │                                 │                                              │
│       ▼                                 ▼                                              │
│ ┌───────────────────────────┐     ┌───────────────────────────┐                        │
│ │ stoklore-ollama (Optional)│     │ stoklore-litellm (Opt)    │                        │
│ │ - Local LLM & embeddings  │     │ - Cloud LLM proxy         │                        │
│ └───────────────────────────┘     └─────────────┬─────────────┘                        │
│                                                 │                                      │
│                                                 ▼                                      │
│                                   ┌───────────────────────────┐                        │
│                                   │ Langfuse Stack (Optional) │                        │
│                                   │ - Tracing & Observability │                        │
│                                   └───────────────────────────┘                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Prerequisites

* **Docker Engine** (version 24.0 or newer)
* **Docker Compose** (version 2.20 or newer, included in Docker Desktop)

---

## 3. Quick Start (Docker Compose)

### Step 1: Clone the repository & create environment file
```bash
git clone <repository-url> stoklore
cd stoklore

# Copy the environment template
cp .env.example .env
```

### Step 2: Build and start the core stack
```bash
docker compose up -d --build
```
This starts:
1. `stoklore-db`: PostgreSQL 17 with the `vector` extension enabled.
2. `stoklore-app`: Builds the frontend via Node 22, builds the Python 3.12 runtime, and serves the application on port `8010`.

### Step 3: Access the application
Open **<http://localhost:8010>** in your browser.

* **First boot setup:** You will see the **Create your login** screen. Set a display name, password (8+ chars), and a 6-digit PIN.
* Save the **one-time recovery code** displayed on screen.

---

## 4. Ollama Integration

Stoklore requires an embedding model (`nomic-embed-text`) and a chat LLM for semantic search and AI features. You can run Ollama in one of two modes:

### Mode A: Ollama on Mac / Host Machine (Recommended for Apple Silicon)
Running Ollama on macOS directly enables Apple Silicon GPU (Metal) hardware acceleration, which is not available to containers inside Docker Desktop.

1. Ensure Ollama is running on your host machine:
   ```bash
   ollama serve
   ```
2. Pull the required models:
   ```bash
   ollama pull nomic-embed-text
   ollama pull llama3.1:8b
   ```
3. In your `.env` file, leave the default setting:
   ```env
   OLLAMA_BASE_URL=http://host.docker.internal:11434
   ```
   Stoklore connects to your host's Ollama automatically via `host.docker.internal`.

### Mode B: Ollama in Docker (Containerized)
If you want Ollama fully containerized within Docker:

1. In your `.env` file, point to the container:
   ```env
   OLLAMA_BASE_URL=http://ollama:11434
   ```
2. Start Docker Compose with the `ollama` profile:
   ```bash
   docker compose --profile ollama up -d
   ```
3. Pull models into the container:
   ```bash
   docker compose exec ollama ollama pull nomic-embed-text
   docker compose exec ollama ollama pull llama3.1:8b
   ```

---

## 5. Docker Compose Profiles

Stoklore uses **Docker Compose Profiles** to keep resource usage lightweight by default, while allowing optional features to be enabled with a single flag.

| Profile | Command | Services Started | Estimated RAM |
|---|---|---|---|
| **Default** (Core) | `docker compose up -d` | `app`, `db` | ~300 MB |
| **`ollama`** | `docker compose --profile ollama up -d` | `app`, `db`, `ollama` | ~1 GB - 4 GB |
| **`litellm`** | `docker compose --profile litellm up -d` | `app`, `db`, `litellm` | ~400 MB |
| **`tracing`** | `docker compose --profile tracing up -d` | `app`, `db`, Langfuse stack (Web, Worker, ClickHouse, MinIO, Redis) | ~2 GB |
| **`all`** | `docker compose --profile all up -d` | All services above | ~4 GB+ |

### Using LiteLLM (Commercial Cloud Models)
If you want to use OpenAI, Anthropic, or Gemini cloud models:
1. Ensure `config/litellm.config.yaml` exists:
   ```bash
   cp config/litellm.config.example.yaml config/litellm.config.yaml
   ```
2. Add your API keys to `.env` (`OPENAI_API_KEY=...`).
3. Start with the LiteLLM profile:
   ```bash
   docker compose --profile litellm up -d
   ```
4. Access LiteLLM proxy at `http://localhost:4000`.

### Using Langfuse (LLM Tracing & Monitoring)
If you want deep latency, cost, and token analytics for your LLM calls:
```bash
docker compose --profile tracing up -d
```
1. Open the Langfuse dashboard at `http://localhost:3000`.
2. Create an account, create a project, and copy the API keys into `.env` (`LANGFUSE_PUBLIC_KEY` & `LANGFUSE_SECRET_KEY`).

---

## 6. Persistent Storage & Backups

The Docker configuration mounts persistent host directories so all user data, trades, and caches survive container rebuilds:

* `./uploads`: Stores manual trade screenshots and chart snapshots.
* `./backups`: Stores automated rolling `pg_dump` backups created by `app/core/backup.py`.
* `./local_data`: Stores cached daily Bhavcopy archives and DuckDB minute-bar extracts.
* `postgres_data` (Named Volume): Stores PostgreSQL table data and vector embeddings.

### Creating a Manual Database Backup
```bash
docker compose exec db pg_dump -U postgres -d crawler -Fc -f /var/lib/postgresql/data/backup.dump
```

### Restoring a Database Backup
```bash
docker compose exec -T db pg_restore -U postgres -d crawler --clean < path/to/your/backup.dump
```

---

## 7. Multi-OS & Cross-Platform Support

Stoklore's Docker build is designed for universal cross-platform compatibility across **macOS (Apple Silicon & Intel)**, **Ubuntu, Debian, Fedora, Arch Linux**, and **Windows (WSL2)**.

### macOS (Apple Silicon M1–M4 & Intel)
* Native multi-architecture images build as `linux/arm64` on Apple Silicon and `linux/amd64` on Intel Macs.
* Fast builds: Stage 1 (`node:22-bookworm-slim`) runs on `--platform=$BUILDPLATFORM` so JavaScript builds execute natively on host CPU without QEMU emulation overhead.
* Metal GPU Acceleration: Run Ollama natively on Mac (`ollama serve`) and Stoklore will reach it via `http://host.docker.internal:11434`.

### Ubuntu, Debian & Linux Distributions
* **Permission Fix (Non-Root UID 1000)**: The runtime container runs under a dedicated `stoklore` user (UID 1000). On Ubuntu and Debian, UID 1000 is the default desktop/server user, ensuring files written to host mounts (`uploads/`, `backups/`, `local_data/`) are owned by you rather than `root`.
* **Host Gateway Resolution**: Linux Docker engines do not have a built-in VM bridge. `docker-compose.yml` includes `extra_hosts: ["host.docker.internal:host-gateway"]` so Stoklore can communicate with services running on the Linux host.
* **Ollama on Linux Host**: If running Ollama natively on Ubuntu/Debian (outside Docker), Ollama defaults to binding only to `127.0.0.1`. Configure it to accept connections from the Docker bridge:
  ```bash
  sudo systemctl edit ollama.service
  # In the editor, add:
  # [Service]
  # Environment="OLLAMA_HOST=0.0.0.0"
  sudo systemctl restart ollama
  ```
  *(Or run Ollama in Docker using `docker compose --profile ollama up -d` to skip host configuration).*

### Windows (WSL2)
* Runs natively via Docker Desktop with the WSL2 backend enabled.
* File paths and line endings are normalized to Linux standards inside the container.

### Building Multi-Arch Images (Buildx)
To build a multi-architecture image targeting both `linux/amd64` and `linux/arm64`:
```bash
docker buildx build --platform linux/amd64,linux/arm64 -t stoklore:latest .
```

---

## 8. Useful Docker Commands

```bash
# View container logs in real time
docker compose logs -f app

# Restart the application
docker compose restart app

# Rebuild images after pull/code changes
docker compose build --no-cache

# Stop all running containers
docker compose down

# Stop all containers and remove volumes (CAUTION: deletes database)
docker compose down -v
```

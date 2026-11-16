# syntax=docker/dockerfile:1

# ==============================================================================
# Stage 1: Frontend Build (Runs on Builder Architecture for Maximum Speed)
# ==============================================================================
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ==============================================================================
# Stage 2: Python Backend Runtime (Multi-Arch: linux/amd64 & linux/arm64)
# Compatible across macOS (Apple Silicon / Intel), Ubuntu / Debian, and Linux
# ==============================================================================
FROM python:3.12-slim AS runtime

# Universal UTF-8 and unbuffered streaming for clean logging across all OSes
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8010

WORKDIR /app

# Install system dependencies:
# - postgresql-client: provides `pg_dump` for automated database backups
# - curl: provides container healthcheck
# - build-essential & ca-certificates: essential build tools and trusted certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    curl \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# Create a non-root user (UID 1000) matching standard Ubuntu, Debian, WSL2, and macOS IDs
# This prevents root-owned volume mount issues on Linux host filesystems
ARG UID=1000
ARG GID=1000
RUN (groupadd -g ${GID} stoklore 2>/dev/null || true) && \
    (useradd -u ${UID} -g ${GID} -m -s /bin/bash stoklore 2>/dev/null || true)

# Copy application source code
COPY app/ ./app/
COPY config/ ./config/

# Copy compiled frontend assets so FastAPI serves the SPA directly on port 8010
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create required persistent storage directories and assign permissions
RUN mkdir -p uploads backups local_data && \
    chown -R stoklore:stoklore /app

USER stoklore

EXPOSE 8010

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8010/api/auth/status || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]

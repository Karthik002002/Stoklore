# Stoklore as one image: the API serves the built frontend itself (see app/main.py), so a deployed
# instance is one process on one port. Postgres runs beside it - see docker-compose.yml.

# --- frontend: build once, only dist/ is kept ---
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- api ---
FROM python:3.14-slim
# pg_dump for the daily backups (app/core/backup.py); must be >= the server's major version (17).
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# CPU-only PyTorch first: the default Linux wheel drags in ~3GB of CUDA libraries a container
# without a GPU never uses. requirements.txt then finds torch already satisfied.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
      "torch==$(grep -oP '^torch==\K.*' requirements.txt)" \
 && pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY --from=frontend /frontend/dist frontend/dist

# Everything the app writes, under one owner, so the volumes in docker-compose.yml can mount there.
RUN useradd --create-home --uid 1000 stoklore \
 && mkdir -p uploads backups local_data /data/hf \
 && chown -R stoklore uploads backups local_data /data/hf
USER stoklore
ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/data/hf \
    FRONTEND_URL=http://localhost:8010

EXPOSE 8010
# /api/auth/status is open before login, so it answers whether or not an account exists yet.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8010/api/auth/status', timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]

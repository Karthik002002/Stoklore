# Docker

[← Back to index](README.md)

Stoklore as two containers: the app (API plus the built frontend, on one port) and Postgres with
pgvector. Ollama, a LiteLLM proxy and self-hosted Langfuse are optional extras, each behind a
compose profile. Nothing else to install on the machine except Docker (Engine 24+, Compose 2.20+).

---

## Run it

```bash
cp .env.example .env     # then set POSTGRES_PASSWORD in it - compose refuses to start without one
docker compose up -d
```

Open <http://localhost:8010>. The first screen is *Create your login*, the same as a native
install. The port is bound to `127.0.0.1`, so only this machine can reach it; `PORT=...` in `.env`
moves it.

`docker compose up -d` pulls the published image from `ghcr.io/karthik002002/stoklore`. To build
from your own checkout instead:

```bash
docker compose up -d --build
```

Stop with `docker compose down`. Your data stays in Docker volumes until you run
`docker compose down -v`, **which deletes the database**. Logs: `docker compose logs -f app`.

## What lives where

| Volume | Holds |
|---|---|
| `pgdata` | The database: journal, watchlists, settings, everything |
| `backups` | The app's daily `pg_dump` files |
| `uploads` | Trade screenshots |
| `local_data` | Downloaded minute-data cache |
| `hf` | Hugging Face models (the Laya classifier, Whisper) |

`POSTGRES_PASSWORD` is only read when the database volume is first created; changing it later
means changing it inside Postgres too.

## Optional services

| Profile | Adds | Reach it at |
|---|---|---|
| *(none)* | `app`, `db` | <http://localhost:8010> |
| `ollama` | Ollama in a container | inside compose only, as `http://ollama:11434` |
| `litellm` | LiteLLM proxy for cloud models | <http://localhost:4000> |
| `tracing` | Langfuse: web, worker, Postgres, ClickHouse, MinIO, Redis | <http://localhost:3000> |
| `all` | everything above | |

```bash
docker compose --profile litellm up -d
```

Every published port is on `127.0.0.1`. Langfuse's own databases have no host port at all.

- **LiteLLM** reads `config/litellm.config.yaml` (`cp config/litellm.config.example.yaml
  config/litellm.config.yaml`) and the API keys in `.env`. Set `LITELLM_BASE_URL=http://litellm:4000`
  in `.env` so the app uses it, or point **Settings › LiteLLM** there.
- **Langfuse** ships placeholder secrets. Set the `LANGFUSE_*` secrets in `.env` (see
  `.env.example`) before its first start, then create a project at <http://localhost:3000> and copy
  its keys into `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`.

## Ollama and the AI features

By default the container uses Ollama on the host, at `http://host.docker.internal:11434`. Run
`ollama serve` on the host as usual. On a Mac this is the fast option: a container can't use the
Apple Silicon GPU. Without Ollama, only the AI features are unavailable.

To run Ollama in a container instead, set `OLLAMA_BASE_URL=http://ollama:11434` in `.env`, then:

```bash
docker compose --profile ollama up -d
docker compose exec ollama ollama pull nomic-embed-text
```

**Linux host Ollama:** it listens on `127.0.0.1` only, which a container can't reach. Use the
`ollama` profile, or make the host's Ollama listen on the Docker bridge address
(`OLLAMA_HOST=172.17.0.1` in its systemd unit) rather than `0.0.0.0`, which would open it to your
whole network.

## Moving an existing journal in

Your native install's database is not visible to the container. Copy it once, into an **empty**
container database (right after the first `docker compose up -d`):

```bash
pg_dump --format=custom crawler > stoklore.dump
docker compose exec -T db pg_restore -U stoklore -d stoklore --clean --if-exists < stoklore.dump
docker compose restart app
```

`--clean` replaces what's in the container database, so do this before you start using the
container, never after.

## Publishing the image

`.github/workflows/docker.yml` builds the image on GitHub Actions for `linux/amd64` and
`linux/arm64`:

- every push to `main` builds it, as a check, without publishing
- a version tag publishes it to `ghcr.io/karthik002002/stoklore`:

```bash
git tag v1.0.0
git push origin v1.0.0
```

That tag publishes `:1.0.0`, `:1.0` and `:latest`. **Actions → docker → Run workflow** publishes
the current commit as `:sha-<commit>`.

Publishing only from a tag is deliberate: this repo's `main` has been overwritten with malware
before, and an image built from every push would have shipped it.

The first publish creates the package as **private**. Either make it public under **GitHub →
your profile → Packages → stoklore → Package settings**, or log in before pulling:

```bash
echo <a token with read:packages> | docker login ghcr.io -u Karthik002002 --password-stdin
```

To build both architectures locally: `docker buildx build --platform linux/amd64,linux/arm64 -t
stoklore .`

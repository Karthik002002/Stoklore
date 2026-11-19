# Docker

[← Back to index](README.md)

Stoklore as two containers: the app (API plus the built frontend, on one port) and Postgres with
pgvector. Nothing else to install on the machine except Docker.

---

## Run it

```bash
docker compose up -d
```

Open <http://localhost:8010>. The first screen is *Create your login*, the same as a native
install. The port is bound to `127.0.0.1`, so only this machine can reach it.

`docker compose up -d` pulls the published image from `ghcr.io/karthik002002/stoklore`. To build
from your own checkout instead:

```bash
docker compose up -d --build
```

Stop with `docker compose down`. Your data stays in Docker volumes until you run
`docker compose down -v`, **which deletes the database**.

## What lives where

| Volume | Holds |
|---|---|
| `pgdata` | The database: journal, watchlists, settings, everything |
| `backups` | The app's daily `pg_dump` files |
| `uploads` | Trade screenshots |
| `local_data` | Downloaded minute-data cache |
| `hf` | Hugging Face models (the Laya classifier, Whisper) |

Set a real database password before the first start by putting `POSTGRES_PASSWORD=...` in `.env`.
It is only read when the database volume is created.

## Ollama and the AI features

The container reaches Ollama on the host at `http://host.docker.internal:11434` (set by
`OLLAMA_BASE` in `docker-compose.yml`). Run `ollama serve` on the host as usual. Without it, only
the AI features are unavailable.

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

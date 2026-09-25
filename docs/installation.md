# Installation

[← Back to index](README.md)

From a clean machine to a running app. Every command here is meant to be run from the repo root
unless it says otherwise.

Stoklore runs entirely on your own machine: a Python API (port **8010**), a React frontend
(**5180**), and Postgres. Nothing is hosted, and there is no account to create.

---

## 1. What you need

| | Version | Why |
|---|---|---|
| **Python** | **3.11 – 3.14** | 3.10 and older can't install the pinned deps (pandas needs ≥3.11); litellm caps it below 3.15. macOS's built-in `python3` is 3.9 — **don't use it** |
| **Node.js** | **≥ 20.19**, or **≥ 22.12** | Vite 8 and oxlint require it |
| **Postgres** | **16 or 17**, with the **pgvector** extension | Everything is stored here; reports are searched by embedding |
| **Ollama** | any recent | Optional. Only the AI chat, reports and embeddings need it — the rest of the app works without it |
| **Docker** | any recent | Optional, only for Langfuse tracing |

Disk: roughly 1 GB for Python packages (mostly PyTorch), 500 MB for `node_modules`, plus the
optional AI models in [step 9](#9-optional-ai-models-and-what-they-cost).

---

## 2. Install the prerequisites

### macOS (Homebrew)

```bash
brew install python@3.13 node postgresql@17 pgvector
brew services start postgresql@17
```

If `psql` isn't found afterwards, add Postgres to your PATH (Homebrew keeps versioned formulae out
of it):

```bash
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc && exec zsh
```

### Ubuntu / Debian

The distro's Postgres may be older than 16, so use the official PGDG repo:

```bash
sudo apt update && sudo apt install -y curl ca-certificates gnupg lsb-release
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update
sudo apt install -y python3 python3-venv postgresql-17 postgresql-17-pgvector
sudo systemctl enable --now postgresql
```

Check the Python you got — `python3 --version` must be **3.11 or newer** (Ubuntu 24.04 ships 3.12,
which is fine). If it's older, add the [deadsnakes PPA](https://launchpad.net/~deadsnakes/+archive/ubuntu/ppa)
and install `python3.12` plus `python3.12-venv`.

Node from [NodeSource](https://github.com/nodesource/distributions) (Ubuntu's own `nodejs` package
is usually too old):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### Windows

Use **WSL2** and then follow the Ubuntu steps above — the run/stop scripts are bash, and this is
the path that gets tested:

```powershell
wsl --install -d Ubuntu
```

Native Windows also works if you'd rather: install
[Python](https://www.python.org/downloads/windows/), [Node](https://nodejs.org/),
and [Postgres](https://www.postgresql.org/download/windows/) (tick **pgvector** in Stack Builder),
then use the manual two-terminal commands in [step 8](#8-run-it) with `\.venv\Scripts\` instead of
`.venv/bin/`.

---

## 3. Get the code

```bash
git clone <your-repo-url> stoklore && cd stoklore
```

---

## 4. Python environment

The run script expects the virtualenv to be at **`.venv`** in the repo root, with exactly that name.

```bash
python3.13 -m venv .venv          # any Python 3.11-3.14 (`python3` on Linux, `py -3.13` on native Windows)
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

This pulls PyTorch, so expect a few minutes and ~1 GB.

Check it worked:

```bash
.venv/bin/python -c "import fastapi, torch, transformers; print('deps ok')"
```

---

## 5. Database

The app connects to `postgresql:///crawler` by default — a local Unix socket, as your own OS user,
to a database named `crawler`. **Nothing creates that database for you.**

**macOS:**

```bash
createdb crawler
```

**Linux** (your OS user usually has no Postgres role yet):

```bash
sudo -u postgres createuser -s "$USER"
createdb crawler
```

Confirm pgvector is available to it — this must print `vector`:

```bash
psql -d crawler -c "CREATE EXTENSION IF NOT EXISTS vector" -Atc "SELECT extname FROM pg_extension WHERE extname='vector'"
```

Every table is created automatically the first time the API starts, and new columns are added the
same way on later upgrades. There are no migrations to run.

**A different host, port or database name?** Put it in `.env` (see the next step) as
`DATABASE_URL=postgresql://user:pass@host:5432/dbname`.

---

## 6. Frontend dependencies

```bash
cd frontend && npm ci && cd ..
```

`npm ci` installs exactly what the committed lockfile says. Use `npm install` only if you're
deliberately changing dependencies.

---

## 7. Environment file (optional)

Only needed for a non-default database, LiteLLM, or Langfuse. Skip it otherwise.

```bash
cp .env.example .env
```

---

## 8. Run it

### macOS

```bash
ollama serve      # optional, in its own terminal, if you want the AI features
./scripts/run.sh  # starts Postgres, API (:8010), frontend (:5180), plus LiteLLM/Langfuse if set up
./scripts/kill.sh # stops everything, by port
```

### Linux / Windows (WSL or native)

`scripts/run.sh` uses `brew services` to start Postgres, so it's macOS-only. Run the two processes
yourself instead, in two terminals:

```bash
# terminal 1 - API
.venv/bin/uvicorn app.main:app --port 8010 --reload

# terminal 2 - frontend
cd frontend && npm run dev -- --port 5180
```

(Make sure Postgres is running first: `sudo systemctl start postgresql`.)

**Then open <http://localhost:5180>.** The frontend proxies `/api` to port 8010 for you — there's
nothing to configure.

**First screen is *Create your login*** — one account: a display name, a password (8+ characters)
and a PIN (6–12 digits), created from this machine only. You'll then be shown a **one-time recovery
code** — save it. Day to day you sign in with the PIN alone; the password is asked for every 48
hours. Details and every reset path: [authentication.md](authentication.md).

The API does no scanning at startup, so the first page load is fast and empty. Add a stock from the
dashboard, or trigger a scan from the UI, to get data in.

---

## 9. Optional: AI models, and what they cost

Nothing below is required to start the app, and each downloads only when first used.

| Feature | Model | Size | When it downloads |
|---|---|---|---|
| Chat, reports, embeddings | Ollama models (below) | 1–6 GB | When you pull them |
| Sentiment scores | FinRoBERTa (Hugging Face) | ~1.4 GB | First sentiment score |
| Voice capture | `whisper-base.en` | ~150 MB | First time you hold the voice key |
| [Laya classifier](classifier.md) | `convaiinnovations/laya` | ~1.7 GB | First use **after** you enable it in Settings › Classifier (off by default) |

For chat, pull an embedding model and any chat model:

```bash
ollama pull nomic-embed-text        # embeddings - needed for report search
ollama pull llama3.1:8b             # or any chat model you prefer
```

Then open **Settings › Model** and pick the chat model you pulled. The code's built-in default
points at a model you almost certainly don't have
(`ollama/hf.co/empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF:Q4_K_M`), so chat will error until you
choose one from that list.

See [warning.md](warning.md) before running long sessions against a local model.

---

## 10. Verify the install

These need nothing running — no database, no models:

```bash
.venv/bin/python tests/classifier.selfcheck.py
.venv/bin/python tests/speech.selfcheck.py
.venv/bin/python tests/paper.selfcheck.py
node frontend/src/lib/tradeStats.selfcheck.mjs
node frontend/src/lib/voiceCommands.selfcheck.mjs
```

With the API running, this should print JSON rather than an error:

```bash
curl -s localhost:8010/api/stocks
```

And the frontend should build:

```bash
cd frontend && npm run build
```

---

## 11. Optional extras

**LiteLLM proxy** (for `litellm/*` models, already in `requirements.txt`):

```bash
cp config/litellm.config.example.yaml config/litellm.config.yaml
# fill in your model(s) - the template has step-by-step comments
# put API keys (OPENAI_API_KEY, ...) in .env; litellm loads it automatically
```

`scripts/run.sh` then starts it on port 4000; point **Settings › LiteLLM** at
`http://localhost:4000`.

**Langfuse tracing** needs Docker running. `scripts/run.sh` starts it from
`config/docker-compose.langfuse.yml` when Docker is available and skips it quietly otherwise. First
boot pulls several images, so <http://localhost:3000> takes a minute to answer.

**Git hooks** (formats and lints staged frontend files on commit), once per clone:

```bash
git config core.hooksPath .githooks
```

**CLI scan** — the original movers scan, standalone. Note it's a module, not a script path:

```bash
.venv/bin/python -m app.cli --skills movement,volume --limit 10
.venv/bin/python -m app.cli --watchlist
```

---

## 12. Troubleshooting

| What you see | Fix |
|---|---|
| `No matching distribution found for fastapi==0.139.2` | Your Python is too old. macOS's `python3` is 3.9 — rebuild the venv with 3.11+ |
| `database "crawler" does not exist` | [Step 5](#5-database): `createdb crawler` |
| `could not open extension control file ... vector.control` | pgvector isn't installed for this Postgres. macOS: `brew install pgvector`; Ubuntu: `sudo apt install postgresql-17-pgvector` (match your server's version) |
| `role "<your-user>" does not exist` | Linux: `sudo -u postgres createuser -s "$USER"` |
| `.venv/bin/uvicorn: No such file` | [Step 4](#4-python-environment) wasn't run, or the venv isn't named `.venv` |
| `ModuleNotFoundError: No module named 'app'` | Run from the repo root, and use `python -m app.cli`, not `python app/cli.py` |
| Frontend loads but every panel is empty or erroring | The API isn't up on 8010. Check terminal 1, or `curl localhost:8010/api/stocks` |
| Port already in use | `./scripts/kill.sh` (macOS), or `lsof -ti :8010 :5180 \| xargs kill -9` |
| Chat replies with a model error | **Settings › Model** — pick a model you've actually pulled ([step 9](#9-optional-ai-models-and-what-they-cost)) |
| `FileNotFoundError: local_data/scraped.json` | `mkdir local_data` in the repo root |
| Forgot the password or PIN | With your recovery code: *Use a recovery code* on the login screen. Without it, on the machine: `.venv/bin/python -m app.reset_login` |
| `no account configured yet` from every endpoint | Open the UI and complete *Create your login* — an instance with no account refuses everything |
| Voice key does nothing | The browser needs microphone permission, and a secure context — `localhost` counts |

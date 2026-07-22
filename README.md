<div align="center"><a name="readme-top"></a>

# 📈 Stoklore

**A fully local NSE India stock research app** — live market data, an
LLM chat agent that can actually *do things* (not just talk), watchlists,
event scanning, price history, and technical indicators.

Everything runs on your own machine. No cloud APIs required, no data
leaves localhost unless you point it at one yourself.

**Scraping** · **Local LLM chat with tool calling** · **Watchlists & events** ·
**Price history & EMA crossover** · **Sentiment analysis**

</div>

<details>
<summary><kbd>Table of Contents</kbd></summary>

#### TOC

- [👋🏻 What is Stoklore](#-what-is-stoklore)
- [✨ Features](#-features)
  - [`1` Live Dashboard & Watchlists](#1-live-dashboard--watchlists)
  - [`2` AI Chat Agent with Tool Calling](#2-ai-chat-agent-with-tool-calling)
  - [`3` Guard Rails](#3-guard-rails)
  - [`4` Stock Detail: Charts, Full History & EMA Crossover](#4-stock-detail-charts-full-history--ema-crossover)
  - [`5` Watchlist Events Feed](#5-watchlist-events-feed)
  - [`6` Sentiment Analysis](#6-sentiment-analysis)
  - [`7` Multi-Model Support](#7-multi-model-support)
  - [`*` What's more](#-whats-more)
- [🧱 Stack](#-stack)
- [🚀 Running It](#-running-it)
- [🧩 Adding a Custom Skill](#-adding-a-custom-skill)
- [⌨️ CLI Scan](#️-cli-scan)
- [🧹 Formatting & Pre-commit](#-formatting--pre-commit)

####

</details>

## 👋🏻 What is Stoklore

Stoklore scrapes NSE India market data (movers, per-stock news, financials,
OHLCV history), analyzes it with a local LLM, and stores everything in
Postgres/pgvector for retrieval-augmented chat. It started as a scrape-and-
report CLI and grew into a full app: a React dashboard, a per-stock detail
page with charts and indicators, a manual watchlist-events scanner, and a
chatbot that can actually execute research actions on your behalf — subject
to guard rails you can see and control.

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## ✨ Features

### `1` Live Dashboard & Watchlists

- **NIFTY 50 / SENSEX** index cards with a live sparkline chart on the home page
- Tracked-stocks table with live price + day change, refreshed via a shared
  TTL cache (`stock_cache`) instead of hitting Yahoo Finance on every request
- **Watchlists**: bookmark any tracked stock into named lists, move a stock
  between lists, filter the table by tab
- A minimal icon-rail sidebar nav (hover tooltips, active-route highlight) —
  Stocks dashboard, Events feed, Settings, theme toggle, and a **Reload**
  button that clears the shared cache on demand

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `2` AI Chat Agent with Tool Calling

The floating chat isn't just RAG — it's a real tool-calling agent that talks
directly to Ollama's or an OpenAI-compatible server's native function-calling
API (no LangChain, no framework):

- **Tools are auto-generated from the API itself** — every `/api/*` route
  becomes a callable tool automatically, named after its handler function,
  described from its docstring, and typed from its function signature. Add
  or change an endpoint and the agent picks it up on next restart; nothing
  to wire by hand.
- The chat panel is **resizable** (drag the top-left handle) and its own
  history is listable, reopenable, and deletable from a dropdown
- Slash commands: `/history SYMBOL FROM TO`, `/sentiment URL`,
  `/confirm <tool> [key=value ...]`

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `3` Guard Rails

Because the agent can call real endpoints, it ships with layered guard
rails instead of a blanket "trust the model":

- **Confirmation gate, decided by HTTP method** — `GET` routes (read-only by
  construction: price lookups, EMA signals, watchlist listing, report
  search) run immediately. `POST`/`PUT`/`DELETE` routes (writes, scrapes,
  background scans/syncs) return a `requires_confirmation` message instead
  of executing — the agent has to ask, and only your own explicit
  `/confirm <tool> ...` message actually runs it.
- **Prompt-injection defense** — every tool result (scraped news, stored
  reports) is wrapped in an explicit `<tool_result>...</tool_result>`
  data-not-instructions boundary before it re-enters the model's context,
  with a regex flag for obvious override phrasing ("ignore previous
  instructions", "reveal your system prompt", etc.)
- **LiteLLM proxy-level guardrails** (optional) — a starter
  `litellm.config.yaml` with a `presidio` PII-masking guardrail template,
  for when you're routing through a LiteLLM proxy instead of local Ollama

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `4` Stock Detail: Charts, Full History & EMA Crossover

- Shared `PriceChart` component (candlestick/line toggle, a TradingView-style
  volume pane, configurable EMA overlays, hover tooltip) — used both for the
  range-picker chart and the full-history chart, no duplicated logic
- **Price history is two-tier by design**: `price_history` is a cheap 1-year
  default window kept warm by the watchlist sync; `price_history_max` is a
  separate table populated only when you explicitly click **Collect max
  history** on a stock's detail page — the chart there only appears once
  that data actually exists
- **EMA crossover panel** — two period inputs (with 20/50, 20/100, 50/200
  presets) computing a golden/death cross, or the %-above/below spread when
  there's no crossover, entirely from cached data (no live re-fetch)

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `5` Watchlist Events Feed

A dedicated `/events` page: a manual, per-watchlist scan for news, price
moves, volume spikes, and corporate actions (dividends, splits, earnings
dates via `yfinance`) — **no LLM calls**, deduped per symbol/type/day so
re-running a scan never duplicates what it already found.

- Scan scope selector (one watchlist or all of them)
- From/to date-range filter with a presets popover (last 1 week / 1 month /
  3 months / 6 months)
- Sentiment badges on news events (local FinRoBERTa)

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `6` Sentiment Analysis

Local FinRoBERTa (`soleimanian/financial-roberta-large-sentiment`) scores
news headlines and arbitrary URLs — no network calls at inference time, no
API keys. The `/sentiment <url>` chat command scrapes the article, finds
which NSE-listed companies it's about, scores it, and asks the LLM for a
concrete rationale citing specifics from the article (the classifier itself
only outputs a label + score, no explanation).

**Setup:** the classifier needs `transformers` + a backend (`torch`) —
already in `requirements.txt`:

```bash
pip install -r requirements.txt
```

The model itself (~1.4GB) is *not* bundled — it's downloaded once from
Hugging Face on first use and cached locally (`~/.cache/huggingface`), not
at app startup (`sentiment.py` loads it lazily so a fresh `./run.sh` doesn't
pay that cost unless you actually trigger a sentiment score). First use will
be slow while it downloads; every call after that runs fully offline.

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `7` Multi-Model Support

Three interchangeable backends, picked via a `provider/model` id:

| Prefix | Backend | Notes |
|---|---|---|
| `ollama/*` | Local Ollama | Default. Full tool-calling agent support. |
| `litellm/*` | Your own [LiteLLM proxy][litellm-proxy] | Configure the proxy URL + API key in Settings → LiteLLM. Full tool-calling agent support once connected. |
| *(anything else)* | OmniRoute (local multi-provider proxy) | Falls back to plain retrieval-augmented chat — tool-calling support varies too much across OmniRoute's many upstream providers to guarantee. |

Settings is a tabbed dialog (**Model** / **LiteLLM**) — the Model tab's
dropdown lists whatever's actually reachable right now (Ollama is always
listed; OmniRoute's and LiteLLM's catalogs are queried live and degrade
quietly if either isn't running).

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `*` What's more

- Corporate-action, price-move, and volume-spike detection reuse the exact
  same threshold constants as the `skills/movement.py`/`skills/volume.py`
  filters used for movers scanning — no duplicated logic
- Session deletion for chat history, with cascade-delete of its messages
- An animated gradient app-logo mark and a redesigned icon-rail nav

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🧱 Stack

| Layer      | Tech                                                              |
|------------|--------------------------------------------------------------------|
| Scraping   | `scraper.py` — NSE India API + `yfinance`                          |
| Analysis   | `llm.py` — Ollama / OmniRoute / LiteLLM (chat + tool calling), `nomic-embed-text` for embeddings; `sentiment.py` — local FinRoBERTa classifier |
| Events     | `events.py` — watchlist-scoped news/price/volume/corporate-action scan |
| Prices     | `prices.py` — incremental daily OHLCV sync (1y + full-history tiers) + EMA crossover math |
| Storage    | Postgres + pgvector (`db.py`)                                      |
| API        | FastAPI (`api.py`) — chat streams over the AI SDK UI Message Stream protocol; chat tools are auto-generated from this same API's routes |
| Frontend   | React + Vite, shadcn/ui, AI Elements, `@ai-sdk/react`, lightweight-charts (`frontend/`) |

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🚀 Running It

```bash
ollama serve   # start Ollama first (if it isn't already running)

./run.sh   # starts Postgres, serves API (:8010) + frontend (:5180)
./kill.sh  # stops everything
```

The API starts immediately — it doesn't run any scan on startup. Trigger
scans manually from the UI (or `POST /api/events/scan` and
`POST /api/prices/sync`) whenever you want fresh data; a `main.py` CLI scan
is still available standalone (see below).

Requires Postgres (`postgresql@17` + `pgvector`) and Ollama with `llama3.1`
and `nomic-embed-text` pulled — `run.sh` checks Ollama is running and fails
fast with a clear message if it isn't.

**Optional:** to use `litellm/*` models, install and run a LiteLLM proxy
(`pip install 'litellm[proxy]'`, then `litellm --config litellm.config.yaml
--port 4000`), and point Settings → LiteLLM at it. See `litellm.config.yaml`
for a starter config with a PII-masking guardrail template.

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🧩 Adding a Custom Skill

Drop a `.py` file in `skills/` with a `filter(tickers) -> tickers` function,
then pass `--skills yourfilename` to `main.py`. No registration needed.

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## ⌨️ CLI Scan

`main.py` still runs the original movers-based scan standalone:

```bash
.venv/bin/python main.py --skills movement,volume --limit 10   # NSE movers
.venv/bin/python main.py --watchlist                           # every watchlisted symbol
.venv/bin/python main.py --watchlist "Banking"                 # one watchlist only
```

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🧹 Formatting & Pre-commit

Frontend JS/JSX is formatted with Biome and linted with `oxlint`:

```bash
cd frontend && npm run format        # biome format --write .
cd frontend && npm run lint          # oxlint
```

A tracked git hook formats + lints staged frontend files on commit — enable
it once per clone with:

```bash
git config core.hooksPath .githooks
```

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[back-to-top]: https://img.shields.io/badge/-BACK_TO_TOP-151515?style=flat-square
[litellm-proxy]: https://docs.litellm.ai/docs/simple_proxy

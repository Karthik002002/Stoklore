<div align="center"><a name="readme-top"></a>

<img src="frontend/public/favicon.svg" width="72" height="69" alt="Stoklore logo" />

# Stoklore

## **It watches. You decide.**

Your own market terminal. It reads the news, the filings, and the numbers — 
scrapes them continuously, makes sense of them with a local LLM, and only 
pokes you when something actually happened.

Runs entirely on your machine. No cloud. No APIs reaching out. No data 
leaving your laptop unless you tell it to.

**Scraping** · **Local LLM chat with tool calling** · **Watchlists & events** ·
**Price history & EMA crossover** · **Sentiment analysis** ·
**Broker-synced holdings** · **Backtesting**

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
  - [`8` Watch Rules](#8-watch-rules)
  - [`9` Top News](#9-top-news)
  - [`10` Holdings (Broker Sync)](#10-holdings-broker-sync)
  - [`11` Backtesting](#11-backtesting)
  - [`12` Bar Replay](#12-bar-replay)
  - [`*` What's more](#-whats-more)
- [🧱 Stack](#-stack)
- [🚀 Running It](#-running-it)
- [🧩 Adding a Custom Skill](#-adding-a-custom-skill)
- [⌨️ CLI Scan](#️-cli-scan)
- [🧹 Formatting & Pre-commit](#-formatting--pre-commit)
- [🙏 Credits](#-credits)

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
  Stocks dashboard, Events feed, Top news, Holdings, Backtesting, Settings,
  theme toggle, and a **Reload** button that clears the shared cache on demand

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `2` AI Chat Agent with Tool Calling

The floating chat isn't just RAG — it's a real tool-calling agent that talks
directly to Ollama's or an OpenAI-compatible server's native function-calling
API (no LangChain, no framework):

- **14 explicit tools** (`api.py`, `AGENT_TOOLS`/`REAL_TOOL_IMPLS`) covering
  live price/EMA/movers lookups, watchlist listing, broker-synced holdings
  (`get_holdings` — "how is my portfolio doing"), semantic report search,
  a live stock scrape+report, background event scans/price syncs, DuckDuckGo
  web search, recording a verified event, checking a user-defined watch
  rule, fetching/analyzing an arbitrary URL (`scrape_url`, nothing saved to
  disk — separate from `POST /api/scrape`, which does write one), and
  listing past chat session titles ("what have I asked about before")
- **`@` tag menu** in the chat input autocompletes stocks, watch rules, *and*
  events — tagging an event inserts its source URL (not just its headline),
  which is what makes `scrape_url` actually have something to fetch
- **"Tag in chat"** is also one click away from any event/news card (Events
  feed, Top News, a stock's Latest Events) via a shared "···" menu — opens
  the chat, drops the link in, autofocuses
- Every tool call renders as an **expandable chip** — click to see the exact
  input args and output the model got, not just a name and a checkmark
- Conversation history now carries **prior tool results forward** across
  turns (capped to the last 20 messages, older tool output truncated) — the
  agent reuses what it already found instead of silently losing it or
  re-running the same tool
- The chat panel is **resizable** (drag the top-left handle), autofocuses
  its input whenever opened, shows the **current session's title** in its
  header (not a static label), and its own history is listable, reopenable,
  and deletable from a dropdown
- Slash commands: `/history SYMBOL FROM TO`, `/sentiment URL`,
  `/rule NAME [SYMBOL]`, `/confirm <tool> [key=value ...]`, `/clear`

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `3` Guard Rails

Because the agent can call real endpoints, it ships with layered guard
rails instead of a blanket "trust the model":

- **Confirmation gate, one tool** — everything except adding a new stock
  (`scrape_stock`, a live scrape + report generation) runs immediately,
  including the background event scan/price sync tools. `scrape_stock`
  returns a `requires_confirmation` message instead of executing — the
  agent has to ask, and only your own explicit `/confirm <tool> ...`
  message (or the chat UI's inline **Confirm/Cancel** buttons, wired to the
  same mechanism) actually runs it.
- **Prompt-injection defense** — every tool result (scraped news, stored
  reports, replayed tool history from earlier turns) is wrapped in an
  explicit `<tool_result>...</tool_result>` data-not-instructions boundary
  before it re-enters the model's context, with a regex flag for obvious
  override phrasing ("ignore previous instructions", "reveal your system
  prompt", etc.)
- **LiteLLM proxy-level guardrails** (optional) — `litellm.config.example.yaml`
  is the tracked template (copy it to `litellm.config.yaml`, which is
  gitignored/per-developer); guardrails go under a top-level `guardrails:`
  key, not nested under `litellm_settings` — that nested form silently
  routes to LiteLLM's old legacy guardrails schema and crashes on this one

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
- **Backtest summary card** — the stock's latest saved backtest (return,
  win rate, trade count) plus your own lessons-learned note, surfaced
  passively so past homework resurfaces every time you look at the stock
  (see [`11` Backtesting](#11-backtesting))

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
- Each event with a source link gets a "···" menu: **Open** it, or **Tag in
  chat** to jump straight into asking the agent about it

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

Settings is a tabbed dialog (**Model** / **LiteLLM** / **Cogencis** /
**Broker** / **Watch rules**), with its open state and active tab in the
URL (`?settings=broker`) so any page can deep-link into a specific tab —
the Model tab's dropdown lists whatever's actually reachable right now
(Ollama is always listed; OmniRoute's and LiteLLM's catalogs are queried
live and degrade quietly if either isn't running).

A `model_name` ending in `/*` (e.g. `openai/*`) in `litellm.config.yaml`
expands into every model in LiteLLM's own bundled catalog for that provider
(~200 for OpenAI) instead of one pinned id — the app's model-list request
already passes `?return_wildcard_routes=true`, which is what makes LiteLLM
expand it at all. `litellm.config.example.yaml` is the tracked starting
template; `litellm.config.yaml` (gitignored) is where you actually configure
it, per-developer.

**Optional: Langfuse tracing.** `docker-compose.langfuse.yml` runs a
self-hosted Langfuse (its official multi-container stack: Postgres,
ClickHouse, Redis, MinIO, web + worker) — `run.sh` starts it and `kill.sh`
tears it down automatically whenever Docker is running, and skips it quietly
otherwise. Point `litellm.config.yaml`'s `success_callback`/`failure_callback`
at `["langfuse"]` and set `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/
`LANGFUSE_HOST` in `.env` (from a project created at `http://localhost:3000`;
`cp .env.example .env` for the full list of vars this app reads, including
`OPENAI_API_KEY` for LiteLLM) to see every LiteLLM call traced — prompts,
tool calls, latency, cost. `LANGFUSE_HOST` must be that exact name (not
`LANGFUSE_BASE_URL`) — litellm falls back to Langfuse Cloud otherwise, so
traces silently go to the wrong place instead of your local instance.

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `8` Watch Rules

User-defined criteria (Settings → Watch rules) checked against live data on
demand — not tied to any one stock, and never a buy/sell recommendation,
just pass/fail against *your own* stated criteria:

- `/rule NAME [SYMBOL]` chat command, and a `check_watch_rule` agent tool —
  omit the symbol to run it as a screener across the whole watchlist instead
  of one stock
- The one thing the agent will do when asked "is it a good time to buy" —
  it can't give advice, but it can point at a rule you've set up and report
  whether it currently holds

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `9` Top News

A `/top-news` page: Cogencis's general market news feed (not scoped to a
watchlist), configured with a token in Settings → Cogencis.

- Cached wholesale for 24h (paginated fetch, 5 pages × 20 stories, 2s gap
  between requests) — a manual **Reload** bypasses the cache
- Each story is tagged with `affected_symbols`, matched by ISIN against your
  current watchlist, recomputed fresh on every call so watchlist changes
  show up immediately even against cached stories
- **"Affecting my watchlist only"** filter toggle
- Same "···" Open/Tag-in-chat menu as the Events feed

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `10` Holdings (Broker Sync)

A `/holdings` page that mirrors your **actual broker account** — read-only,
no order placement, no funds movement:

- **Dashboard cards**: available balance, invested value, current value,
  and total P&L, computed from live positions
- **Positions table**: qty, entry price, current price, invested/current
  value, and per-row P&L (₹ and %) — click any row to jump to that stock's
  detail page
- **Two brokers**, switchable from a logo dropdown whose selection lives in
  the URL (`?broker=dhan|kite`):
  - **Dhan** — client ID + long-lived access token (Settings → Broker → Dhan)
  - **Kite (Zerodha)** — API key/secret + a per-trading-day login redirect
    (Kite Connect issues no long-lived tokens; "Connect to Kite" in Settings
    routes through Zerodha's login and back to `/api/kite/callback`)
- **No paid market-data APIs** — Dhan's live-price feed is a separately-paid
  plan, so current prices come from the app's own yfinance price cache
  (same one the dashboard uses); Kite's holdings response already includes
  `last_price` for free
- Snapshot cached for 5 minutes (`stock_cache`), manual reload bypasses it;
  if the active broker isn't configured, the page shows a **Configure**
  button that deep-links straight into Settings → Broker with the right
  sub-tab focused
- The chat agent gets the same data via its `get_holdings` tool — ask
  "how is my portfolio doing" without leaving the chat

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `11` Backtesting

A `/backtesting` page split into **Auto** and **Manual** tabs
(`?tab=auto|manual`, deep-linkable).

**Auto** — write a Pine Script strategy or indicator and run it against real
OHLCV, no backend execution involved:

- Powered by [PineTS](https://github.com/LuxAlgo/PineTS) (`pinets` npm
  package) — a real Pine v5 transpiler/runtime that runs entirely in the
  browser. Strategy scripts (`strategy.entry`/`strategy.close`) come back as
  `{trades, summary}` and render through the same trade table/return badge
  as any other backtest result; indicator-only scripts (just `plot()`) show
  their plotted series instead
- **Add script** modal: a Pine Script editor plus a live preview (pick a
  symbol, run against its default 1y `price_history`) before saving; Save
  persists the script as a reusable template (`auto_backtest_scripts` table)
- Saved scripts list as a table on the Auto tab; click through to
  `/backtest/auto/:script_id` for the full editor + run view
- **Symbol picker** is a searchable combobox over already-tracked stocks,
  with a fallback "Add SYMBOL" option that validates the ticker actually
  exists (a live NSE scrape, same check `POST /api/stocks` always did)
  before it can be selected
- Detail-page runs use the *full* collected history (`price_history_max`),
  not the default 1y window: a **Collect max data** button next to the
  symbol picker kicks off the same background collection job the stock
  detail page uses, polls until it finishes, and only then enables
  **Execute** — until max data exists for the picked symbol, Execute stays
  disabled with an inline message

**Manual** — reserved for now, tab content is intentionally empty. The
original single-strategy backtest (long-only EMA-crossover: buys the golden
cross, sells the next death cross; Run vs. Save with an optional
lessons-learned note; results surfaced on a stock's detail page) still lives
in `backtest.py` and `api.py`'s `/api/backtest*` endpoints, just not wired
into this tab yet.

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `12` Bar Replay

A `/backtest/replay` page (linked from Backtesting → Manual): step through a
stock's real history one bar at a time and paper-trade it, like TradingView's
Bar Replay.

- **Playback** — step forward/back, play/pause at 0.5×–4×, or jump to a date.
  Shortcuts: `B`/`S` buy/sell, `Shift+↓` play/pause, `Shift+→` step forward
- **Trading** — Market or Limit orders with optional stop-loss/target;
  validated so a target/SL on the wrong side of entry is rejected up front.
  If a bar gaps clean past a level instead of touching it, the trade still
  closes — filled at the bar's open, not the skipped level
- Stop-loss/target lines are **draggable directly on the chart** to adjust
  them after the fact
- **Indicators**: EMA, SMA, and RSI (its own pane below the candles, via
  lightweight-charts' multi-pane support)
- **Settings modal** — candle colors, default order quantity, RSI reference
  levels, all editable
- Every closed trade is logged to the same manual trade journal as the rest
  of Backtesting → Manual (tagged `replay`), with a screenshot of the chart
  at close time attached automatically
- All session state (symbol, timeframe, bar position, orders, indicators,
  settings) lives in one persisted store (`localStorage`) — reload the page
  or navigate away and it resumes exactly where you left off

<div align="right">

[![][back-to-top]](#readme-top)

</div>

### `*` What's more

- Corporate-action, price-move, and volume-spike detection reuse the exact
  same threshold constants as the `skills/movement.py`/`skills/volume.py`
  filters used for movers scanning — no duplicated logic
- Session deletion for chat history, with cascade-delete of its messages
- `scraper.py`'s article scraper checks a page's `schema.org` JSON-LD
  (`articleBody`) before falling back to scraping `<p>` tags — many news
  sites (this includes Economic Times/ETEnergyworld) don't put their actual
  article text in `<p>` tags at all, so the old approach picked up
  nav/comment-policy boilerplate instead of the article
- `kill.sh` kills by port (backend/frontend/LiteLLM/Postgres/Langfuse)
  instead of pattern-matching process names, so a stale or reload-spawned
  worker still gets cleaned up
- `warning.md` — a local-model sizing note: don't run large prompts/long
  sessions against the local Ollama model, switch to a LiteLLM-routed model
  for anything reading a lot of text at once
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
| Brokers    | `broker.py` (Dhan v2) + `kite.py` (Kite Connect v3) — read-only holdings/margin, normalized to one shape |
| Backtests  | Manual: `backtest.py` — long-only EMA-crossover backtest over stored `price_history` (not yet wired into the UI). Auto: user-written Pine Script run client-side via `pinets` (PineTS) against `price_history`/`price_history_max`, saved as templates in `auto_backtest_scripts` |
| Storage    | Postgres + pgvector (`db.py`)                                      |
| API        | FastAPI (`api.py`) — chat streams over the AI SDK UI Message Stream protocol; 14 explicit agent tools (`AGENT_TOOLS`/`REAL_TOOL_IMPLS`) |
| Frontend   | React + Vite, shadcn/ui, AI Elements, `@ai-sdk/react`, lightweight-charts, `pinets` (in-browser Pine Script v5 runtime) (`frontend/`) |
| Tracing    | Langfuse (optional, self-hosted via `docker-compose.langfuse.yml`) — traces every LiteLLM call: prompts, tool calls, latency, cost |

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🚀 Running It

```bash
ollama serve   # start Ollama first (if it isn't already running)

./run.sh   # starts Postgres, API (:8010), frontend (:5180) - plus LiteLLM
           # (:4000) and self-hosted Langfuse if they're set up, see below
./kill.sh  # stops everything - by port, so a stale process still gets killed
```

The API starts immediately — it doesn't run any scan on startup. Trigger
scans manually from the UI (or `POST /api/events/scan` and
`POST /api/prices/sync`) whenever you want fresh data; a `main.py` CLI scan
is still available standalone (see below).

Requires Postgres (`postgresql@17` + `pgvector`) and Ollama with `llama3.1`
and `nomic-embed-text` pulled. See `warning.md` before running large
prompts/long sessions against the local model.

**Optional: LiteLLM proxy** (for `litellm/*` models) — install with
`pip install 'litellm[proxy]'` (already in `requirements.txt`), then
`cp litellm.config.example.yaml litellm.config.yaml` and fill in your
model(s) (the template has step-by-step comments). API key env vars
(`OPENAI_API_KEY`, `LITELLM_MASTER_KEY`, ...) go in `.env`
(`cp .env.example .env`) — litellm loads it automatically, no need to
`export` anything. `run.sh` starts the proxy on port 4000 automatically
once `litellm.config.yaml` exists; point Settings → LiteLLM at
`http://localhost:4000`.

**Optional: Langfuse tracing** — needs Docker running. `run.sh`/`kill.sh`
start/stop a self-hosted instance (`docker-compose.langfuse.yml`)
automatically whenever Docker is available, and skip it quietly otherwise.
First boot pulls several images and runs migrations, so
`http://localhost:3000` takes a minute to answer the first time. See
`.env.example` for the Langfuse keys once you've created a project there.

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

## 🙏 Credits

**Design & product inspiration:**

- [TradesViz](https://www.tradesviz.com/) — trade journaling/analytics UX
- [OpenBB](https://openbb.co/) — open-source market terminal approach
- [Fincept](https://fincept.in/) — terminal-style dashboard layout
- [Bloomberg Terminal](https://www.bloomberg.com/professional/products/bloomberg-terminal/) — density and information hierarchy

**Built on top of:**

- [PineTS](https://github.com/LuxAlgo/PineTS) — in-browser Pine Script v5 runtime powering Auto Backtesting
- [lightweight-charts](https://github.com/tradingview/lightweight-charts) — candlestick/volume/RSI charting (Stock Detail, Bar Replay)
- [shadcn/ui](https://ui.shadcn.com/) + [AI Elements](https://ai-sdk.dev/elements) + [Vercel AI SDK](https://ai-sdk.dev/) — frontend components and chat streaming protocol
- [Ollama](https://ollama.com/) — local LLM inference and tool calling
- [LiteLLM](https://www.litellm.ai/) — multi-provider proxy, guardrails, wildcard model routing
- [Langfuse](https://langfuse.com/) — self-hosted LLM tracing
- [FinRoBERTa](https://huggingface.co/soleimanian/financial-roberta-large-sentiment) — local financial sentiment classifier
- [yfinance](https://github.com/ranaroussi/yfinance) — OHLCV price history
- [NSE India](https://www.nseindia.com/) — market movers, per-stock financials
- [Cogencis](https://www.cogencis.com/) — general market news feed
- [Dhan](https://dhanhq.co/) & [Kite Connect](https://kite.trade/) — broker holdings sync
- [Postgres](https://www.postgresql.org/) + [pgvector](https://github.com/pgvector/pgvector) — storage and RAG retrieval
- [Biome](https://biomejs.dev/) & [oxlint](https://oxc.rs/docs/guide/usage/linter.html) — frontend formatting/linting

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[back-to-top]: https://img.shields.io/badge/-BACK_TO_TOP-151515?style=flat-square
[litellm-proxy]: https://docs.litellm.ai/docs/simple_proxy

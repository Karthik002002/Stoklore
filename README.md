# Stoklore

Locally-hosted NSE market scraper with local-LLM analysis, custom skills, and fine-tuning.

Everything runs on your machine — NSE India scraping, financial data via Yahoo
Finance, analysis and chat via a local Ollama model (llama3.1), vector search
via Postgres/pgvector. No cloud APIs, no API keys.

## What it does

- Scrapes NSE India movers (gainers/losers/volume spikes) and filters them
  through pluggable **skills** (`skills/movement.py`, `skills/volume.py` —
  drop in your own filter functions to extend it)
- Pulls live price, fundamentals, and news per stock from Yahoo Finance
- Generates a Markdown report per stock with a local LLM (Ollama, llama3.1)
- Stores reports + embeddings (nomic-embed-text) in Postgres/pgvector, with a
  14-day auto-expiry
- **Watchlists**: save any tracked stock into named lists from the home page,
  move a stock between lists, filter the table by list
- **Events feed** (`events.py`, `/events` page): a manual, per-watchlist scan
  for news, price moves, volume spikes, and corporate actions (dividends,
  splits, earnings dates via `yfinance`) — no LLM calls, deduped per
  symbol/type/day so re-running a scan never duplicates what it already found
- **Price history & EMA crossover** (`prices.py`): a durable daily-OHLCV
  cache per symbol — backfills a year once, then only fetches the gap on
  every later sync. The stock detail chart reads from this cache first and
  only calls Yahoo Finance live when the requested range isn't covered yet.
  The EMA crossover panel takes two period inputs (with 20/50, 20/100, 50/200
  presets) and computes a golden/death cross — or the %, above/below spread
  when there's no crossover — entirely from cached data
- Local FinRoBERTa sentiment scoring on news headlines and on arbitrary
  articles via the `/sentiment <url>` chat command, with an LLM-written
  rationale for the score
- A generic TTL cache (`stock_cache`) in front of live price/quote/chart/
  financials calls, with a "Reload" button in the nav to clear it on demand
- Serves a React UI: a stock list with live prices, a per-stock detail page
  (fundamentals grid, chart, EMA crossover, news, AI reports), an events
  page, and a floating RAG chatbot that can live-scrape any NSE ticker
  mentioned in the conversation

## Stack

| Layer      | Tech                                                              |
|------------|--------------------------------------------------------------------|
| Scraping   | `scraper.py` — NSE India API + `yfinance`                          |
| Analysis   | `llm.py` — Ollama (llama3.1 for chat/reports, nomic-embed-text for embeddings); `sentiment.py` — local FinRoBERTa classifier |
| Events     | `events.py` — watchlist-scoped news/price/volume/corporate-action scan |
| Prices     | `prices.py` — incremental daily OHLCV sync + EMA crossover math    |
| Storage    | Postgres + pgvector (`db.py`)                                      |
| API        | FastAPI (`api.py`), streams chat over the AI SDK UI Message Stream protocol |
| Frontend   | React + Vite, shadcn/ui, AI Elements, `@ai-sdk/react` (`frontend/`) |

## Running it

```bash
ollama serve   # start Ollama first (if it isn't already running)

./run.sh   # starts Postgres, serves API (:8010) + frontend (:5180)
./kill.sh  # stops everything
```

The API starts immediately — it no longer runs a movers scan on startup.
Trigger scans manually from the UI (or `POST /api/events/scan` and
`POST /api/prices/sync`) whenever you want fresh data; a `main.py` CLI scan
is still available standalone (see below).

Requires Postgres (`postgresql@17` + `pgvector`) and Ollama with `llama3.1`
and `nomic-embed-text` pulled — `run.sh` checks Ollama is running and fails
fast with a clear message if it isn't.

## Adding a custom skill

Drop a `.py` file in `skills/` with a `filter(tickers) -> tickers` function,
then pass `--skills yourfilename` to `main.py`. No registration needed.

## CLI scan

`main.py` still runs the original movers-based scan standalone:

```bash
.venv/bin/python main.py --skills movement,volume --limit 10   # NSE movers
.venv/bin/python main.py --watchlist                           # every watchlisted symbol
.venv/bin/python main.py --watchlist "Banking"                 # one watchlist only
```

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
- Serves a React UI: a stock list with live prices, a per-stock detail page
  (fundamentals grid, news, AI reports), and a floating RAG chatbot that can
  live-scrape any NSE ticker mentioned in the conversation

## Stack

| Layer      | Tech                                                              |
|------------|--------------------------------------------------------------------|
| Scraping   | `scraper.py` — NSE India API + `yfinance`                          |
| Analysis   | `llm.py` — Ollama (llama3.1 for chat/reports, nomic-embed-text for embeddings) |
| Storage    | Postgres + pgvector (`db.py`)                                      |
| API        | FastAPI (`api.py`), streams chat over the AI SDK UI Message Stream protocol |
| Frontend   | React + Vite, shadcn/ui, AI Elements, `@ai-sdk/react` (`frontend/`) |

## Running it

```bash
ollama serve   # start Ollama first (if it isn't already running)

./run.sh   # starts Postgres, runs a scan, serves API (:8010) + frontend (:5180)
./kill.sh  # stops everything
```


Requires Postgres (`postgresql@17` + `pgvector`) and Ollama with `llama3.1`
and `nomic-embed-text` pulled — `run.sh` checks Ollama is running and fails
fast with a clear message if it isn't.

## Adding a custom skill

Drop a `.py` file in `skills/` with a `filter(tickers) -> tickers` function,
then pass `--skills yourfilename` to `main.py`. No registration needed.

# Local model warning (`ollama/llama3.1`)

This app defaults to a local Ollama model (`ollama/llama3.1`) when no LiteLLM model is selected.
It runs entirely on your own machine's CPU/GPU - there's no cloud infrastructure behind it, so it
is far more sensitive to prompt size than a hosted model.

## What makes a prompt "large" in this app specifically

- Asking about a stock with a lot of scraped history (`scrape_stock` returns a full markdown
  report - news + financials - not a short snippet).
- A long-running chat session. Every turn resends up to the last 20 messages
  (`MAX_HISTORY_MESSAGES` in `api.py`) including prior tool results, so a session full of
  `scrape_stock`/`get_movers`/`scrape_url` calls keeps growing until that window caps it.
- Broad tool results: `get_movers`, `search_reports`, or `web_search` returning many rows/hits in
  one call.
- Pasting a long article/URL for `scrape_url` or `/sentiment` to analyze.

## Why it matters

A local model has no request queue or autoscaling - one large prompt occupies your CPU/GPU for
the entire generation, which can noticeably slow down anything else running on the same machine
(this dev server included) until it finishes.

## What to do instead

- For quick lookups (price, EMA, watchlist, a single stock's news) the local model is fine.
- For anything reading a lot of text at once - long research chats, scraped articles, market-wide
  scans - switch the chat's model dropdown to a LiteLLM-routed model (see
  `litellm.config.example.yaml` for setup). Those run on the provider's own infrastructure, so a
  large prompt costs you latency/API spend, not your machine's CPU.
- If a local-model response is taking too long, it's not stuck - large prompts just take
  proportionally longer on local hardware. Switch models for the next turn rather than waiting it
  out repeatedly.

# Sentiment (`/sentiment`)

[← Back to index](README.md)

## Using it

- In chat: `/sentiment <url>` scores an article's sentiment and gives a
  rationale citing specifics from it.
- First call after a fresh install downloads the classifier model (~1.4GB,
  one-time); every call after that runs offline.

## How it works

The classifier is `soleimanian/financial-roberta-large-sentiment`, loaded
via `transformers.pipeline("text-classification", ..., top_k=None)` — the
`top_k=None` matters: it returns a score for *every* sentiment class, not
just the top one, so `sentiment.analyze()` can pick the actual max itself.

**Lazy loading**: the `transformers` import and the pipeline construction
both live inside a function wrapped in `@lru_cache(maxsize=1)`. Since
`api.py` imports `sentiment` unconditionally at startup, that import alone
costs nothing — the ~1.4GB weights only download/load the first time
`analyze()` is actually called, and the `lru_cache` means every call after
that reuses the same in-memory pipeline instead of reloading it.

**`/sentiment <url>` is three separate steps, only one of which is the
classifier**:
1. `scraper.scrape_article(url)` fetches and extracts the article text.
2. `llm.extract_tickers(article_text, model)` — an **LLM call** asking
   which NSE-listed companies the article is about.
3. `sentiment.analyze(article_text)` — the local classifier scores the
   *whole article* (not per-ticker), returning `{label, score}`.
4. `llm.explain_sentiment(article_text, label, model)` — a **second,
   separate LLM call**. The classifier only ever outputs a label and a
   number; this call is what asks the model to write 2-3 sentences citing
   specific facts/numbers/quotes from the article that justify that label.
   Without this step you'd just get "negative, 0.87" with no explanation.

So a single `/sentiment` call touches the local classifier once and the
active chat model twice (ticker extraction, then rationale) — worth
knowing if you're watching for how many requests a slow local model has to
serve per command.

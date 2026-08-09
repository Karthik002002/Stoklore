# Dashboard & Watchlists

[← Back to index](README.md)

## Using it

- Home page (`/`) lists tracked stocks with live price + day change.
- Bookmark a stock into a watchlist from its row menu; switch watchlists via
  the tabs above the table.
- **Reload** (sidebar) clears the shared price cache and re-fetches.
- Sidebar icons: Stocks, Events, Top news, Holdings, Backtesting, Settings,
  theme toggle.

## How it works

**Live price/day-change** comes from `GET /api/stocks` (`app/routers/`), which
lists tracked symbols (`db.list_symbols()`) and, per symbol, calls
`_cached(symbol, "price", 15, lambda: scraper.get_price(symbol))`
(`app/routers/`). `_cached` is a cache-aside helper over the `stock_cache`
table (`app/core/db.py:610` `get_cached` / `app/core/db.py:622` `set_cached`): it returns the
cached row only if `cached_at` is newer than "now minus TTL," otherwise it
calls the live fetcher (a yfinance `.NS` lookup, `app/core/scraper.py:188`) and
upserts the fresh value keyed on `(symbol, kind)`. **TTL is 15 minutes** for
price/quote/chart/index data; financials use a 24h TTL; Holdings snapshots
use a separate 5-minute TTL (see [Holdings](holdings.md)).

**Reload** hits `POST /api/cache/clear` → `db.clear_cache()` (`app/core/db.py:631`),
a blunt `DELETE FROM stock_cache` — every symbol and every cached kind, not
just price — so the next read of anything cached re-fetches live.

**Watchlists** are plain rows mapping a symbol to a named list; adding a
symbol to a list, or the "all" view, is a straightforward join/filter over
that table — no caching layer of its own beyond the price cache above.

**Behind the scenes for every stock**, two independent OHLCV tiers exist:
- `price_history` — a rolling ~1-year window, kept warm incrementally.
  `prices.sync_symbol(symbol)` (`app/core/prices.py:12`) checks
  `db.latest_price_date(symbol)` (the `MAX(date)` already stored) and only
  fetches bars *after* that date — a fresh symbol backfills the full 1y
  once, everything after is a small incremental pull. `prices.sync_all`
  drives this for every watchlisted symbol, one at a time (not
  concurrently, to stay polite to Yahoo's rate limits), via
  `POST /api/prices/sync` → a background thread polled at
  `GET /api/prices/sync/status`.
- `price_history_max` — the *full* listed history, populated only when you
  explicitly trigger it (the "Collect max history"/"Collect max data"
  button wherever it appears — stock detail, Auto-backtest detail, Bar
  Replay). That's `prices.collect_max_history(symbol)` (`app/core/prices.py:41`),
  also a background thread, polled per-symbol via
  `GET /api/prices/{symbol}/max/status`. Nothing else touches this table
  automatically — it's a deliberate, per-symbol, one-time pull.

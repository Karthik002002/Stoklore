# Dashboard & Watchlists

[← Back to index](README.md)

## Using it

- Home page (`/`) lists tracked stocks with live price + day change.
- Bookmark a stock into a watchlist from its row menu; switch watchlists via
  the tabs above the table.
- **⌘/Ctrl+B opens the watchlist canvas from anywhere in the app** — symbols
  down the left, lists down the right, one edge per membership. **Drag from a
  symbol to a list to file it; select an edge and press Delete to unfile it.**
  Both writes hit the watchlist immediately — there is no Save.
- A stock can sit in **any number of lists**, which is the whole reason this is
  a graph and not a picker: two edges off one symbol is the state a
  single-select dropdown can't show.
- The panel top-left adds a **stock** (scraped live via `POST /api/stocks`, so a
  bad ticker fails there instead of landing as an empty node) and a **new
  watchlist** (an empty list is a real thing — it persists as a tab).
- Nodes drag freely and keep their positions while the canvas is open; layout
  isn't saved, so it re-columns on reopen.
- Rebindable in Settings › Shortcuts; also in the ⌘K palette as **Watchlists**.
- **Reload** (sidebar) clears the shared price cache and re-fetches.
- Sidebar icons: Stocks, Events, Top news, Holdings, Backtesting, Settings,
  theme toggle.

## How it works

**The watchlist canvas** (`frontend/src/WatchlistManager.tsx`) is React Flow
(`@xyflow/react`). Mounted once in `App` and opened by a window event — the same
trick `Profile` uses, and what lets the command palette open it without a
callback threaded through App's tree. It reads the `['stocks']`, `['watchlist']`
and `['watchlists']` queries the Stocks page already has, so it shares that
cache and an edit here updates that page underneath.

**A node per symbol comes from the union of two sets, not from `GET /api/stocks`
alone.** `watchlist` rows are not foreign-keyed to `symbols`, so a list can (and
does) hold symbols that were never scraped — driving the canvas off the tracked
list would silently hide most of the mapping it exists to show. Those nodes
render as **Not tracked** rather than being dropped.

Node ids are prefixed (`s:SYMBOL`, `l:NAME`) because `onConnect` receives two
bare ids and a symbol could otherwise collide with a list name. Nodes and edges
are rebuilt from server data after every write, but each node keeps the position
it already had — otherwise filing one stock would throw away every node the user
had dragged. Nodes are `deletable: false`: deleting a *symbol* is
`DELETE /api/stocks/{symbol}` and lives on the Stocks page, and losing one to a
stray Backspace on a canvas is not a mistake worth making available.

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

**The symbol universe: main board + EMERGE (SME).** `stocks_master` is NSE's
own listed-equity master, imported from the exchange's `EQUITY_L.csv` in
**Settings › Manage stocks**. The SME board ships as a second, identically
shaped CSV, and one parser covers both: which board a row belongs to is read
off its `SERIES` code (`SM`/`ST` are EMERGE) rather than from which file it
arrived in, so importing either file lands rows on the right board and
re-importing just upserts. `MARKET LOT` and `FACE VALUE` are kept, because an
SME scrip trades only in fixed lots — a quantity that isn't a multiple of the
lot is not a real trade.

Every symbol picker in the app (the trade form, the bar-replay quick-switcher,
Settings) renders the same `StockBadges`/`StockSubline` pair, so a ticker never
reads as one thing in one picker and another somewhere else: an **SME** badge
first (it changes how the scrip trades), the series when it isn't plain `EQ`,
the lot size, and ISIN + listing date on the roomier pickers. Search can be
narrowed to one board, and exact-symbol and prefix matches sort first —
alphabetical order buried the ticker you typed under every SME name containing
it once the universe grew.

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

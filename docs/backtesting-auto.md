# Backtesting — Auto

[← Back to index](README.md)

> **Currently disabled.** The Backtesting page (`/backtesting`) now renders
> only [Manual](backtesting-manual.md) — the Auto tab's UI is commented out
> in `frontend/src/Backtesting.jsx` (not deleted), and its command-palette
> entry is commented out in `frontend/src/CommandPalette.jsx`. Everything
> below still describes how it works; `AutoBacktesting.jsx`, the
> `/backtest/auto/$scriptId` detail route, and the backend's
> `auto_backtest_scripts` endpoints are all untouched, so re-enabling it is
> just restoring the commented-out Tabs block in `Backtesting.jsx`.

## Using it

- `/backtesting?tab=auto` → **Add script** → write a Pine Script strategy
  (`strategy.entry`/`strategy.close`) or indicator (`plot()`), pick a
  symbol to preview against, **Save** to keep it as a reusable template.
- Click a saved script to open its detail page. Before running a full
  backtest there, click **Collect max data** for the symbol (same one-time
  history pull as the stock detail page) — **Execute** stays disabled
  until that finishes.

## How it works

**Your script never reaches the backend.** The whole point of PineTS
(`pinets` npm package) is that Pine Script v5 runs entirely in the browser,
directly against OHLCV rows already fetched from `/api/prices/{symbol}`.
The backend's `auto_backtest_scripts` endpoints are plain CRUD over the
script *text* — saving, loading, listing, deleting — with no execution
involved on that side at all.

**Strategy vs. indicator-only isn't decided by parsing your source code**
— it's structural, based on what PineTS actually returns after running it.
If your script called `strategy.entry`/`strategy.close` anywhere, PineTS
hands back a populated `strategy` object, which gets reshaped into
`{trades, summary}` (per-trade entry/exit dates and prices, return %, plus
overall total-return/win-rate/trade-count). If your script only called
`plot()` (no strategy calls), `strategy` comes back empty and the result is
just `{plots}` instead — rendered as time-series lines rather than a trade
table. The frontend picks which view to show purely by checking whether
`result.trades` exists.

**"Collect max data" on a script's detail page is the exact same job** as
the one on the Stock Detail page and Bar Replay — same endpoints, same
background-thread-plus-polling pattern, just triggered from wherever you
happen to need it. There's no separate "auto-backtest history" data source;
once a symbol's max history exists, every feature that needs it can use it.

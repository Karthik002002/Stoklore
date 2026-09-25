# Engine (C++ algo trading)

[← Back to index](README.md)

`/engine` drives an external C++ trading engine. Stoklore supplies the bars and the UI, and the
engine supplies the trading logic. A strategy you backtest here is the same compiled code that
trades live on a VPS, and its paper/live sessions show up on this page next to the backtests.

## Setup

1. Clone the engine repo anywhere and build it: `make` (the backtester has no dependencies).
2. Open **Settings › Algo engine** (or the gear on the engine page) and set **Engine folder** to that
   checkout (e.g. `~/code/hft`). Give it a **Name** too. The sidebar and page title use it.
3. Optional, for paper/live results: set **VPS** to the `user@host` you deployed the engine to,
   and **VPS reports folder** if you changed `REPORT_DIR` there (default `/var/lib/algo/reports`).
   Sync runs `rsync` over ssh non-interactively, so your ssh key must already work for that host.

Any field left empty falls back to an environment variable, which is handy for headless setups:

| Setting | Env var | Default |
|---|---|---|
| Name | `ENGINE_NAME` | `Algo Engine` |
| Engine folder | `ENGINE_DIR` | none (the page asks for it) |
| VPS | `ENGINE_VPS` | none (Sync live is hidden) |
| VPS reports folder | `ENGINE_VPS_REPORTS` | `/var/lib/algo/reports` |

## Using it

- **New backtest:** pick a strategy, symbols, and bar size (1m–4H, from the same minute dataset
  Bar Replay uses). Every strategy param takes one value `9`, a list `5,9,13`, or a range `5:20:5`.
  Every combination runs in parallel as one *sweep* (max 200 runs).
- **Sweep heatmap:** net P&L, Sharpe, max drawdown, or win rate for each param combination,
  coloured best to worst within the sweep. Click a cell to open that run. With more than two varied
  params, pick the two axes, and each cell shows its best run over the rest.
- **Compare:** tick runs in the table to overlay their equity or drawdown curves.
- **Run detail:** summary tiles, equity with drawdown, daily P&L, per-symbol P&L, the executions
  chart (below), and the latest 300 trades. Paper/live runs refresh every minute while open.
- **Executions on candles:** the run's own bars with every fill marked — ▲ for a buy, ▼ for a sell,
  and each exit arrow green when that trade made money, red when it didn't. One tab per symbol when
  a run traded several.

  The candles come from the same source the backtest ran on (`minute_data`, at the run's interval),
  so an arrow sits on the exact bar that filled rather than on a resampled approximation of it —
  entry prices in the trade table are that bar's open.

  It marks the **latest 300 trades** and opens framed on the last 20 of them (~500 bars). Markers
  are drawn for the whole series, so thousands of them cost more than they tell you, and at a
  four-month zoom every arrow is a smear; pan or zoom out to walk back through the rest.

## Where the data lives

Runs are the engine's own JSON reports, stored as files in the engine folder and never in
Stoklore's database:

```
<engine folder>/data/SYMBOL_5m.csv     bars written for the backtester
<engine folder>/runs/bt-<batch>-<n>.json  backtests from this page
<engine folder>/runs/live/*.json        paper/live sessions pulled by Sync live
```

Deleting a run or a sweep deletes those files. The only database rows are the settings above.

## Limits

- Stoklore serves the newest 30,000 bars per symbol and interval, which covers the full history at
  15m+, about 400 sessions at 5m, and about 80 at 1m.
- Backtests fill at the next bar's open with a flat cost in bps per side. That is realistic for
  liquid NSE cash stocks, optimistic for illiquid ones.

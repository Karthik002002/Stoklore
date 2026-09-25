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
  coloured best to worst within the sweep, with each cell's trade count under its value and the best
  cell ringed. Click a cell to open that run. With more than two varied params, pick the two axes,
  and each cell shows its best run over the rest. Parameter sets that took **no trades** are drawn
  dashed and grey and are held out of the colour scale — see [Runs that never traded](#runs-that-never-traded).
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

## Calibrating a strategy (sweeps)

Pick **Mode** on the run form:

- **One at a time:** give the params you want to calibrate a range (`5:20:1`) or a list. Each swept
  param walks its range while every other param stays at its **base**: the strategy default, or the
  value in the small *base* field under it. A param with a single value is fixed. The run count is
  1 base run plus one run per swept value.
- **Grid:** every combination of the swept values, to see how params interact.

The engine runs a sweep in one process on all cores (up to 20,000 runs, typically seconds). The
result opens in a calibration view:

- **Equity of every run:** one curve per parameter set on a shared scale, the best in green and the
  worst in red (click either to open it). This is the view that says whether the sweep found a
  *strategy* or a *parameter*: a tight bundle means the edge survives the params, while one curve
  climbing out of a flat mess is that run getting lucky. Above 200 runs it draws every Nth of the
  ranked runs — the ends are always kept, so the spread stays honest.
- **Metric across the sweep:** the chosen metric bucketed into a histogram, coloured on the same
  scale as the heatmap, with the median called out. One tall bar with a lone straggler out to the
  right is an overfit; a broad hump means most parameter sets land in the same place.
- **Parameter impact** (one at a time): each param's spread in the chosen metric across its range.
  A big spread means the strategy is sensitive to that param and it needs care. A flat one can be left alone.
- **Per-param charts** (one at a time): the metric at every value with the others at base. The base run is
  outlined. A smooth hill is a robust optimum; a lone spike is usually overfitting.
- **Heatmap** (grid): any two swept params; each cell is the best run over the others.
- **All runs:** sortable by net P&L, Sharpe, return/drawdown, profit factor, expectancy, max
  drawdown, win rate, trades, trades/day and average holding time, each with an equity sparkline.

The tiles above them read: best and **median** of the chosen metric over the runs that traded, the
base run (one at a time), how many runs made money, and how many took no trades.

### Runs that never traded

A parameter set can be so strict that the strategy never fires — an `entry_z` no move ever reaches,
a lookback longer than the data. That run reports zero for *every* metric, which is not a result but
looks exactly like a flat one, and on a shared colour scale it both drags the scale and paints the
grid with red zeroes.

So everywhere they appear, runs with **0 trades** are:

- left out of the colour scale, out of "best", and out of the median;
- drawn as a dashed grey `—` cell labelled *no trades*, not as a red `0`;
- sorted to the bottom of the all-runs table, greyed, with their metric columns collapsed to
  *no trades taken*;
- counted on their own tile and in the heatmap legend.

If a whole sweep comes back this way, the range being swept is outside what the strategy can act on
— widen it rather than reading the zeroes.

Sweeps store summaries only. Clicking any bar, cell or row re-runs that exact parameter set as a full
backtest with the equity chart, executions and trade list. Sweeps are listed under **Sweeps** and
saved as `<engine folder>/runs/sweeps/*.json`.

## Exporting (Excel / CSV)

Every view has an **Export** button with two options. **Excel** gives one workbook with every sheet. **CSV** gives only the main table:

| View | Excel sheets | CSV |
|---|---|---|
| Run detail (backtest, paper or live) | Summary (params + every metric), Trades, Daily (with cumulative), By symbol, Equity (with drawdown) | Trades |
| Sweep (one at a time or grid) | Sweep (mode, base/fixed/swept values), Runs (every param + every metric), Impact (one at a time only: each param's best value and spread) | Runs |
| Runs list | Runs: every run currently shown by the source filter, with every metric | Runs |

Numbers are written as numbers, so Excel can sort, sum and chart them. Times are IST. CSVs are
UTF-8 with a BOM so Excel opens them correctly.

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

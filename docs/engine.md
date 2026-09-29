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

- **New backtest:** pick a strategy, symbols, and bar size (1m–4H or **1D**, all from the same minute
  dataset Bar Replay uses). Every strategy param takes one value `9`, a list `5,9,13`, or a range `5:20:5`.
  Every combination runs in parallel as one *sweep* (max 200 runs).
  - **History** picks the stretch of bars a run uses, for backtests, sweeps and Auto-tune alike:
    **All available** (the default here), **Last N years** (counted back from today; `0.5` is six
    months), or a **Date range** (either end may be left open; an end after today is today).
    Every stock has its own history, and the run handles that per stock:
    - a stock listed after the range starts, or whose data ends before it does, uses what it has,
      and the run's *History* line says so (`QPOWER only from 2025-02-24`) - its share of a
      multi-stock result covers less time than the others';
    - a stock with **no bars at all** in the range is skipped with the reason (toast, and on the
      run), and the rest still run; if every stock is empty, nothing runs and the error says why;
    - on *All available*, a stock starting well after the earliest one is noted the same way;
    - sessions the official daily record has that a stock's bars lack are counted
      (`QPOWER missing 168 sessions (2026-01-22 → 2026-09-25)` on intraday bars - no feed has
      its 1m there). **On 1D those days are filled from the daily record**, so a daily run gets a
      stock's whole history: DHARIWAL (an SME stock the minute dataset doesn't carry) from its
      2024-08-08 listing, QPOWER without the hole;
    - splits and bonuses neither feed adjusted for are **back-adjusted** and noted
      (`DHARIWAL split/bonus on 2026-02-06 - earlier prices ×0.2`); a 25%+ overnight jump matching
      no known ratio is left alone and flagged to check. Details in
      [bar-replay.md](bar-replay.md#how-it-works).

    Every report keeps the range resolved to dates and what each stock actually had. Opening a
    sweep's cell as a full backtest re-runs it on **the sweep's own bars** (its start, and an end
    pinned to its last bar), so the numbers match the cell even after new days have come in.
    The executions chart loads candles for the run's own period, so an old range still shows its
    arrows on real candles. Runs from before ranges read *Newest 30,000 bars*, which is what they used.
  - **1D (daily bars)** cover each stock's whole history in the dataset - RELIANCE from 2000-01-03,
    INFY from 2003 - not just 2022 onward: from 2022 they're built from the same 1m bars
    (09:15-stamped, one per session), so a daily run agrees with its intraday siblings there, and
    before that they come from the dataset's own daily split, same source and price basis (the two
    agree to ~0.1% where they overlap). The first 1D request for a stock pulls its daily rows once
    (seconds, occasionally a minute when HuggingFace is slow); after that they're cached. Daily is
    **positional**: a position is held across days until the strategy exits, where every intraday
    interval squares off at 15:15 (the engine gets `--overnight`; without it each daily trade would be
    closed one bar after it opened). Cost defaults to **12 bps a side** on 1D against 3 intraday:
    delivery pays STT on both sides. Holding times read in days. The live engine is still
    intraday-only, so a 1D result is research, not something to deploy as-is.
  - **Symbols** is a multi-select, not free text: your watchlist first, grouped by list, then any
    listed NSE stock by typing its symbol or company name (stocks outside a watchlist show as outlined
    chips). Any symbol can be picked whether or not its bars have been fetched yet: the first backtest that
    needs an uncached symbol pulls and caches its bars automatically (a few extra seconds for that
    run, same as any other first use of a symbol - see [Limits](#limits)), so there's nothing
    separate to "prepare" before running. The selection is remembered per browser (`localStorage`),
    so the page reopens with the same symbols next time. The Auto-tune tab remembers its own list,
    and the rest of its form too (strategy, bars, history, walk numbers, param ranges).
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

Sweeps store summaries only. Clicking any bar, cell or row re-runs that exact parameter set as a full
backtest with the equity chart, executions and trade list. Sweeps are listed under **Sweeps** and
saved as `<engine folder>/runs/sweeps/*.json`.

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

## Auto-tune (walk-forward)

Instead of reading a sweep and choosing parameters yourself, let a walk-forward choose them and
show whether that choice held up on sessions it had never seen. It's a report: nothing is deployed.
The design and the later phases are in [autotune-blueprint.md](autotune-blueprint.md).

The page has two tabs: **Backtests** (everything above) and **Auto-tune** (`/engine?tab=autotune`,
also in the command palette as *Algo engine > Auto-tune*). A link to an open report
(`?autotune=<id>`) opens on the Auto-tune tab.

In **New walk-forward** on that tab, pick a strategy, one or more stocks (up to 30, same picker as
above) and the bar size. Give the
params to tune a range or list, like a sweep, and leave the rest at one value (fixed). Then:

- **Train / Test sessions** (60 / 5): each window tunes on `train` sessions, then trades the pick on
  the next `test` sessions, and the walk moves on by `test`, so test periods never overlap.
- **History**: the same picker as backtests. It defaults to the **last year** on intraday bars and
  **all available** on 1D. A stock with fewer sessions in the range than train + test can't be
  walked: it's reported with what it had (`only 225 sessions in this range (2025-02-24 → 2026-09-28)
  - a walk needs train + test = 270`) and the other stocks still run.
- **Min trades** (30): a cell with fewer in-sample trades is never picked.
- **Switch margin** (15%): the current pick is kept unless another cell scores that much better,
  so the parameters don't flip between near-equal cells every week.

How a window picks: every cell of the grid is scored on its **neighbourhood**, the median of
`expectancy × √trades` over itself and every cell one step away. Dead cells, and cells past the
edge of the grid, count as the worst value. A lone spike among losers scores low; a broad area
that works scores high. Ties go to the middle of the area. **Only a positive score is ever
traded**: when no cell made money in-sample, the window is sat out and counted as flat days.

The test window is backtested with the pick on the train bars plus the test bars, with
`--trade-from` set to the test start. The strategy warms up on the train bars, but only trades
entered in the test window count. The same window is also traded with the strategy's **fixed
defaults** (your fixed values applied), which is the baseline tuning has to beat.

On **1D** a session is one bar, so the walk's defaults switch to a year of train (250), a month of test
(20), all available history and at least 10 trades, with delivery costs. Fields you've typed in
keep your value. Two stocks' daily walks take about 2s.

The report shows:

- **Verdict**: what happened, in numbers. Beating fixed defaults while losing money usually just
  means the tuner sat out more of the losing windows.
- **Tuned vs fixed**, out-of-sample: net, trades, profit factor, max drawdown.
- **Walk-forward efficiency**: out-of-sample net per session ÷ in-sample net per session. Below
  ~0.5, most of the in-sample result was fit to noise.
- **Deflated Sharpe**: the probability the out-of-sample Sharpe is real, allowing for having
  picked from every cell of the grid in each window (Bailey & López de Prado).
- **Param stability**: how often consecutive picks were within one grid step of each other.
  Picks jumping around the grid mean there's no stable optimum to tune toward.
- **Equity chart**: tuned and fixed out-of-sample, plus the *in-sample promise* (each pick's
  in-sample net per session, carried over its test window). The gap between tuned and promise
  is the overfit.
- **What the tuner picked**: each parameter set it traded, over how many windows, how many of those
  made money, and what they made out-of-sample.
- **Every combination, traded unchanged in every window** (hindsight): each window also sweeps the
  whole grid on its unseen test bars (one more engine call), so every combination has an
  out-of-sample net, trades, profit factor, win rate and windows won, plus how often the tuner
  picked it and its mean in-sample net. Sort by any of them; picked rows are highlighted. No walk
  could have known the winner in advance - the point is to see whether the picks came from the part
  of the grid that held up (a 1D INFY walk: best combination fast=11 slow=30, ₹801 over 111
  windows, never picked; the tuner mostly picked fast=5 slow=20, ₹177).
- **Executed trades**: every out-of-sample trade on the stock's candles (the same executions chart
  as a backtest), tuned or fixed defaults, and as a table with the window it was taken in and the
  parameters in force. Click a window row to see just its trades, zoomed to it with its train
  period as context; click a trade to zoom to it.
- **Parameter path** and one row per window: the pick, how many cells were eligible, in-sample
  vs out-of-sample net, the fixed-defaults net, the **pick's rank** among every combination on that
  window's unseen bars (`3/20`; green in the top third, red in the bottom), and the **best
  combination** there with hindsight.

Reports keep all of this from now on; ones run before it show a note to re-run them.

**Several stocks** are walked one by one with the same settings, and **each gets its own parameters**:
nothing is pooled or averaged across stocks while tuning. They're saved as one batch, which opens in
a batch view with:

- a row per stock: its verdict, windows traded, tuned vs fixed net, profit factor, WFE, deflated
  Sharpe, stability, its best combination with hindsight (and whether the tuner ever picked it),
  plus an all-stocks total. Click a row for that stock's full report. The verdict
  is **held up** (made money out-of-sample *and* beat fixed defaults), **no edge** (anything else,
  including losing less than the defaults) or **never traded**;
- the batch as one book: every stock's out-of-sample P&L summed day by day, tuned vs fixed;
- Export (one sheet, a row per stock) and **Delete all**.

A stock that can't be walked (no bars, too little history) is reported and the rest still run. In the
Reports list, a batch's rows carry an **n stocks** button that reopens its batch view (`?tunebatch=`).

A year of 5m sessions in one-week steps is about 40 windows and takes a few seconds per stock
(three stocks: ~6s), plus ~11s the first time a stock's bars are fetched. Reports are
saved as `<engine folder>/runs/autotune/<strategy>/<SYMBOL>/wf-*.json`. **The engine must have
`--trade-from`** (`make` in the engine folder); an older build is caught and refused rather than
allowed to count the warm-up as out-of-sample.

## Exporting (Excel / CSV)

Every view has an **Export** button with two options. **Excel** gives one workbook with every sheet. **CSV** gives only the main table:

| View | Excel sheets | CSV |
|---|---|---|
| Run detail (backtest, paper or live) | Summary (params + every metric), Trades, Daily (with cumulative), By symbol, Equity (with drawdown) | Trades |
| Sweep (one at a time or grid) | Sweep (mode, base/fixed/swept values), Runs (every param + every metric), Impact (one at a time only: each param's best value and spread) | Runs |
| Auto-tune report | Walk-forward (settings, tuned ranges, fixed defaults, every verdict number), Tuned vs fixed (every metric side by side), Windows (one row per window, with pick rank and the hindsight-best combination), Combinations (every cell out-of-sample across all windows), Trades (every executed trade with its window and params) | Windows |
| Auto-tune batch | Stocks: one row per stock with its verdict, tuned vs fixed net and profit factor, WFE, deflated Sharpe, stability | Stocks |
| Runs list | Runs: every run currently shown by the source filter, with every metric | Runs |

Numbers are written as numbers, so Excel can sort, sum and chart them. Times are IST. CSVs are
UTF-8 with a BOM so Excel opens them correctly.

## Where the data lives

Runs are the engine's own JSON reports, stored as files in the engine folder and never in
Stoklore's database:

```
(bars for each run are written to a temporary folder, cut to its history range, and removed after)
<engine folder>/runs/bt-<batch>-<n>.json  backtests from this page
<engine folder>/runs/live/*.json        paper/live sessions pulled by Sync live
<engine folder>/runs/sweeps/*.json      parameter sweeps
<engine folder>/runs/autotune/<strategy>/<SYMBOL>/wf-*.json  walk-forward reports
```

Deleting a run, sweep or walk-forward report deletes its file. The only database rows are the settings above.

## Limits

- Backtests, sweeps and walk-forwards read the whole range asked for, uncapped: all of a stock's 1m
  history is ~440k bars and loads in ~2s. Charts in the browser still get at most the newest 30,000
  bars of whatever period they ask for.
- Bars run up to today: the minute dataset ends in January 2026 and newer bars are topped up from
  moneycontrol (yfinance as the fallback), at most every 6 hours per symbol. See
  [bar-replay.md](bar-replay.md#how-it-works).
- Backtests fill at the next bar's open with a flat cost in bps per side. That is realistic for
  liquid NSE cash stocks, optimistic for illiquid ones.

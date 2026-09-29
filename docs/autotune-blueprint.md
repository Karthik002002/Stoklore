# Auto-tune — Blueprint

[← Back to index](README.md) · builds on [engine.md](engine.md), [trade-simulation.md](trade-simulation.md) and [workflows.md](workflows.md)

A loop that keeps each stock's strategy parameters tuned by itself, deploys only the ones that hold
up on data they were **not** tuned on, and pulls them the moment live trading stops matching the
backtest. Status: **Phase 0 and Phase 1 built** (see [engine.md › Auto-tune](engine.md#auto-tune-walk-forward));
Phases 2–3 are design only.

## The one idea this whole design rests on

Auto-adjusting parameters doesn't find an edge. It keeps a real edge tuned, and on a strategy
without one it picks the luckiest noise every week and trades it with confidence. The grid sweep in
the screenshots is the warning: 30 parameter sets, 0 profitable, and the best profit factor (1.32)
comes from 8 trades. A tuner that deployed "the best cell" there would have deployed a coin flip.

So the design is built around one question, asked every week for every stock: **how do the
parameters picked on past data do on the data that came after?** Three things follow from it:

1. **Walk-forward, never in-sample.** Tune on a window, trade the *next* window untouched, roll on.
   The only performance number that counts is the joined-up out-of-sample (OOS) curve.
2. **Pick a plateau, not a peak.** Score each cell by its neighbourhood, so a lone spike surrounded
   by losers loses to a broad area of "fine".
3. **Most stocks should fail the gates.** "High-probability setups" means the stock/parameter
   combinations that survive, not the ones that look best. A week where nothing passes is the tuner
   working.

## Architecture

```
                    ┌──────────────────────── Stoklore (Mac) — research + control ───────────────────────┐
  bars              │                                                                                     │
  ─────────────▶    │  app/core/autotune.py            app/routers/engine.py         frontend: /engine    │
  HF dataset        │  ┌──────────────────────┐        /api/engine/autotune/*        tab=autotune         │
  + fresh bars      │  │ windows()            │        ┌────────────────────┐        ┌─────────────────┐ │
  (Phase 0)         │  │ plateau_score()      │◀──────▶│ run / status /     │◀──────▶│ portfolio table │ │
                    │  │ pick() + hysteresis  │        │ promote / demote   │        │ stock drilldown │ │
                    │  │ wfe(), dsr(), gates()│        └─────────┬──────────┘        │ promote button  │ │
                    │  └──────────┬───────────┘                  │                   └─────────────────┘ │
                    │             │ per window                   │ writes                                │
                    │             ▼                              ▼                                       │
                    │  build/backtest --sweep=grid      <engine>/runs/autotune/…/wf-*.json  (reports)    │
                    │  build/backtest --json            <engine>/deploy/manifest.json      (what's live) │
                    │   --trade-from=<ts>  (new flag)          │                                          │
                    │                                          │ rsync push (mirror of Sync live)         │
                    │  jobs.py schedule loop: nightly 18:00 IST, once-per-IST-day guard                    │
                    └──────────────────────────────────────────┼──────────────────────────────────────────┘
                                                               ▼
                    ┌──────────────────────── VPS — execution (hft repo) ─────────────────────────────────┐
                    │  engine reads manifest.json at SESSION START only → trades → writes live report      │
                    │  (report.params = the deployed set, report.version = manifest version)              │
                    │  persists the 1m bars it received that day → rsynced back (Phase 0 data source)      │
                    └──────────────────────────────────────────┬──────────────────────────────────────────┘
                                                               │ existing Sync live (rsync pull)
                                                               ▼
                                  drift monitor: live vs OOS expectations → auto-demote + alert
```

The split stays what it is today: **Stoklore researches and decides, the C++ engine executes.**
Nothing in Stoklore places orders for the engine, and the engine never tunes itself.

## Phase 0 — blockers before anything else (done)

**Built:** fresh bars came from moneycontrol rather than VPS recording. Its chart feed serves about a
year of 1m history, which covers the dataset's gap in one request and matches the dataset's prices
where they overlap. `minute_data` tops the cache up at most every 6 hours per symbol, with yfinance's
7-day 1m window as the fallback. Recording on the VPS is still worth doing for symbols moneycontrol
maps differently, and as the exact bars the live strategy saw. `--trade-from` is in the engine.

### Fresh bars (hard blocker)

`app/core/minute_data.py` reads the HF dataset, which **ends 2026-01**, and caches each symbol
forever. A symbol the dataset covers never gets newer bars (yfinance is only the fallback for
symbols it *doesn't* cover). Tuning on it would tune for January, every night, indefinitely.

| Option | Cost | Verdict |
|---|---|---|
| VPS engine writes the 1m bars it already receives each day to `bars/<SYM>/<date>.csv`; the existing rsync pulls them with the reports | free, small hft change | **Recommended.** It's literally the data the live strategy saw. Only covers subscribed symbols, from the day recording starts |
| Dhan historical intraday endpoint | Data API subscription (the same paid plan `live-trading.md` mentions for LTP) | Fills the Feb→now gap in one go. Worth it only if Phase 1 says the tuner works |
| yfinance top-up | free | 60 days at 5m, no gap fill. Fine as a stopgap for the most recent test window only |

`minute_data` then needs a merge step: dataset parquet + recorded daily CSVs → one series. The tuner
reads that parquet directly, **without** the `MAX_BARS = 30_000` cap, which exists to protect the
browser and doesn't apply server-side.

### `--trade-from=<ts>` in the engine (one small hft change)

A test window needs warm-up bars before it (a `lookback=25` indicator needs 25 bars of history)
but must not count trades that *enter* during the warm-up. Filtering trades in Python and
recomputing the summary would duplicate the engine's cost and metric math in a second language,
and those always drift. The engine should skip entries before `ts` itself, so every summary stays
engine-owned.

## Phase 1 — walk-forward for one stock (the experiment that decides the rest) (built)

**Built** as `app/core/autotune.py` (self-check: `tests/autotune.selfcheck.py`), `POST /api/engine/autotune`
and the Auto-tune panel on `/engine`. Two changes from the plan below, both found by running it:

- **Only a positive plateau is traded.** The first real run traded the least-bad cell of grids
  where every cell lost in-sample. A window with no positive score is now sat out and counted as
  flat days.
- **Ties go to the middle.** A flat plateau scored the same at its rim as at its centre and the rim
  was picked. Cells past the grid's edge now count as the worst value, and ties break on the
  neighbourhood mean.

First readings (250 sessions to 2026-09-28, 5m, train 60 / test 5): INFY `ema_cross` traded 9 of 38
windows and lost ₹51 out-of-sample (fixed defaults lost ₹565), WFE −0.28, deflated Sharpe 5%.
RELIANCE `zscore_mr` never had a positive plateau and sat out all 38. Neither is an edge yet, so
per the decision point below, Phase 2 waits.

**Multi-stock** runs are in too: one walk per stock, each with its own parameters, saved as one batch
with a per-stock verdict and the batch summed into one book. That's the "more than one stock" half of
the decision point, answerable in one run.

Report-only. No deployment, no scheduler, no UI beyond a table. The output answers one question:
**does re-tuning every week beat fixed default parameters out-of-sample?** If it doesn't, stop
here and work on the strategy instead — Phases 2–3 only make a working tuner safer to run.

### The loop

```
sessions:  |------------- train 60 -------------|-- test 5 --|
                     |------------- train 60 -------------|-- test 5 --|
                                |------------- train 60 -------------|-- test 5 --|  …

for each window:
  1. grid = backtest --sweep=grid on train bars          (existing, seconds)
  2. live = cells with trades >= MIN_TRADES               (noTrades() + a floor)
  3. score = plateau_score(grid, objective)               (neighbourhood median)
  4. chosen = pick(score, incumbent, margin)              (hysteresis)
  5. oos = backtest --json chosen on warmup+test bars, --trade-from=test_start
  6. append oos to the stitched OOS equity
```

Train 60 / test 5 sessions is the starting point; both are knobs, and the report should show
whether the result is sensitive to them (it usually is — that's itself a finding).

### Choosing parameters (`app/core/autotune.py`, pure functions)

| Function | Does | Why |
|---|---|---|
| `windows(sessions, train, test, step)` | the rolling train/test splits | one place that decides boundaries, asserted in the self-check |
| `plateau_score(runs, axes, objective)` | each cell's score = median of the objective over its ±1-step neighbours in every swept param; dead runs count as the worst value, not skipped | a peak next to losers scores badly; a flat good region scores well |
| `pick(scored, incumbent, margin=0.15)` | switch only when the new best beats the incumbent's *current* score by the margin | stops parameters thrashing week to week on noise, which costs real slippage |
| `objective` | default `expectancy × sqrt(trades)` subject to `trades >= 30`, `profit_factor >= 1.1`, `max_dd <= cap` | rewards a per-trade edge that has been seen enough times; net P&L alone rewards one lucky trade |

### What the report must show

- **Stitched OOS equity vs in-sample equity.** The gap between them *is* the overfit, drawn.
- **Walk-forward efficiency** = OOS return per session ÷ IS return per session. Below ~0.5 the
  tuner is mostly fitting noise.
- **Baseline:** the same OOS windows traded with fixed defaults. The tuner has to beat this, not zero.
- **Parameter path:** chosen value per param per window. Values jumping across the grid mean there's
  no stable optimum, so no edge to tune.
- **Deflated Sharpe** (Bailey & López de Prado): the OOS Sharpe corrected for how many parameter
  sets were tried. 30 cells × 40 windows is 1,200 trials, and the best of 1,200 random strategies
  has a very respectable-looking Sharpe.

## Phase 2 — portfolio, gates and lifecycle

Only if Phase 1 beats its baseline on more than one stock.

### Lifecycle per (stock, strategy)

```
 candidate ──gates pass──▶ paper ──N sessions + you click Promote──▶ live
     ▲                      │                                        │
     └──── re-tune ◀── demoted ◀──────── drift trigger (automatic) ──┘
```

**Automatic in the safe direction, human in the risky one.** Demotion (live → paper) happens by
itself the moment a trigger fires. Promotion to live always needs a click, because it puts money at
risk and the tuner can't know about things outside the bars (results day, a circuit limit, news).

### Gates (candidate → paper)

All must pass on the stitched OOS, never on in-sample:

- ≥ 60 OOS trades
- WFE ≥ 0.5 and beats the fixed-defaults baseline
- deflated Sharpe probability ≥ 0.9
- OOS max drawdown ≤ the per-stock risk cap
- parameter path stable: the chosen cell stayed in one neighbourhood for ≥ 70% of windows

### Paper → live

≥ 20 paper sessions, and paper results inside the backtest's bootstrap band. The band is what
`frontend/src/lib/tradeSimulation.js` already computes from a trade log; the backend only needs the
5th percentile line, a small port.

### Drift triggers (live → demoted, automatic)

- live drawdown > 1.5 × the OOS max drawdown
- rolling 30-trade expectancy below zero at z < −2
- the engine's own `halted` flag
- the deployed version is older than 2 re-tune cycles (the market moved on and nobody promoted
  the new set)

Each trigger writes an alert through the existing alerts/Telegram path in `workflows.md`.

### Deployment

`<engine>/deploy/manifest.json` holds, per symbol: strategy, params, version, status, promoted_at.
Stoklore rsyncs it to the VPS (the reverse of today's Sync live). The engine reads it **at session
start only**, never mid-session, so a position is never managed by parameters it wasn't opened with.
The live report already echoes `params`; adding `version` ties every live trade to the exact
deployment that produced it, which is what makes drift attributable.

### Schedule

One more once-per-IST-day guard in `_workflow_schedule_loop` (`app/services/jobs.py`), same shape as
the daily digest: at 18:00 IST, after bars are synced, run the newest window for every tracked
stock. Only the new window is computed nightly — the full-history walk-forward runs once, when a
stock is added. Budget: ~20 stocks × one grid sweep each = a few minutes of C++.

### Storage

Files, not rows, as every other engine output:

```
<engine>/runs/autotune/<strategy>/<SYMBOL>/wf-<ts>.json   windows, chosen params, OOS summaries, gates
<engine>/deploy/manifest.json                             what is paper/live right now, versioned
```

The one piece of DB state is `last_autotune_date`, for the once-per-day guard.

## Phase 3 — the "self-learning" part: meta-labelling

This is where learning genuinely helps, and only after Phase 1 has shown the base strategy has an
out-of-sample edge. It doesn't create an edge; it filters an existing one down to its
higher-probability occurrences.

- The strategy (with tuned params) still decides **when** a setup exists.
- A small classifier decides **whether to take it**: features at signal time (realised-vol
  percentile, trend strength, gap %, time of day, distance from VWAP, day's range so far) →
  probability the trade wins.
- Take the trade only above a threshold picked on validation data, never on test data.
- Training uses **purged, embargoed** cross-validation: trades whose holding periods overlap the
  test fold are dropped from training, or the model learns tomorrow's answer from today's labels.
- Start with logistic regression; move to gradient boosting only if it wins on OOS. Pool signals
  across stocks, since one stock rarely has the hundreds of signals a model needs.
- Retrain on the same weekly cadence, gated the same way: the filtered strategy has to beat the
  unfiltered one on OOS or the filter is switched off.

Regime conditioning (separate parameter sets per volatility or trend regime) is the obvious
next step, and a trap early on: it splits an already small sample several ways. It's worth
revisiting only when a stock has a few hundred OOS trades.

## Frontend — `/engine?tab=autotune`

Built from what's already on the page (`SeriesChart`, the heatmap cell style, `noTrades`,
`ExportMenu`). Add the tab to `frontend/src/lib/navTargets.ts` so the command palette stays in sync.

- **Portfolio table:** stock · strategy · status chip · deployed params · OOS WFE · OOS profit factor
  and expectancy · OOS trades · parameter-stability % · last re-tune · the one gate that failed.
- **Stock drilldown:** stitched OOS vs in-sample equity on one chart, parameter path (a step line per
  param across windows), the per-window table, the gate checklist with the actual number next to
  each threshold, and Promote / Demote. Promote asks for confirmation and states the risk cap.

## Explicitly not doing

- **Reinforcement learning.** It needs orders of magnitude more independent episodes than a few
  years of intraday bars on a few dozen stocks can supply, and it overfits more quietly than a grid.
- **LLM-chosen parameters.** Costly per run, no statistical footing, and against this app's own rule
  that AI assists your analysis rather than issuing verdicts.
- **Re-tuning intraday.** Parameters change between sessions only.
- **Tuning on the last N days alone.** Recent-only windows give the tuner the fewest trades exactly
  where it most needs many.
- **Auto-promotion to live.** See the lifecycle: the risky direction stays a click.

## Order of work

| # | Work | Where | Size |
|---|---|---|---|
| 0a | Engine records daily 1m bars; rsync pulls them; `minute_data` merges them | hft + `minute_data.py` | S |
| 0b | `--trade-from=<ts>` | hft | S |
| 1 | `autotune.py` pure functions + self-check; walk-forward for one stock; report JSON + a plain table in the UI | Stoklore | M |
| — | **Decision:** does it beat fixed defaults OOS on more than one stock? No → stop and fix the strategy | you | — |
| 2a | Gates, lifecycle, manifest, manual promote | Stoklore | M |
| 2b | Manifest reader at session start + `version` in live reports | hft | S |
| 2c | Nightly job + drift triggers + alerts | Stoklore | S |
| 2d | Portfolio + drilldown UI | Stoklore | M |
| 3 | Meta-labelling filter | Stoklore (Python) | L |

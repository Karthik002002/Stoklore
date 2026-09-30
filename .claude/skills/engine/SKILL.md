---
name: engine
description: Use when creating or modifying anything on the Algo Engine surface of this repo - the /engine page, its backend adapter (app/routers/engine.py), the JSON contract with the external C++ trading engine, or the sweep/calibration views. Covers both "add a field/metric/param" changes and "build a new view" changes, backend and frontend.
---

# Algo Engine (C++ engine integration)

`/engine` drives an **external** C++ trading engine (a separate repo, called `hft` in comments -
not this codebase). Stoklore supplies intraday bars and the UI; the engine supplies strategies and
the backtester binary. **There is no C++ source in this repo** - "the engine" here always means the
adapter (backend router) and the UI that renders its output. If a task is actually about a
strategy's trading logic, that's a change in the other repo, not this one.

Full user-facing behavior: [docs/engine.md](../../../docs/engine.md). This skill is the
implementation map for changing it.

**Building or changing the engine itself** (a new engine, a new strategy, a new CLI flag or output
field): see the `algo-engine-contract` skill - the full CLI/CSV/JSON contract and a conformance
checker (`.claude/skills/algo-engine-contract/check_engine.py <engine folder>`).

## The three layers

```
C++ binary (external repo)  →  app/routers/engine.py  →  frontend/src/Engine.tsx
  runs/backtests, sweeps        adapter: shells out,        renders it, drives new runs
  writes JSON reports           validates, stores files      through frontend/src/services/api.ts
```

1. **The engine binary** — `<engine_dir>/build/backtest`, built by the user with `make` in their own
   checkout. Invoked as a subprocess (`_engine()` in engine.py), never linked or vendored.
   - `backtest --list` → strategies + default params (`EngineStrategy`)
   - `backtest <strategy> <bars.csv>... k=v k=v ... cost_bps=N --json` → one backtest report
   - `backtest <strategy> <bars.csv>... k=<val|list|range> ... --sweep=oat|grid` → a sweep report
     (values as typed: `"9"`, `"5,9,13"`, `"5:20:5"` - the engine parses the range syntax, not us)
   - Reports are the engine's own JSON, written to files under `<engine_dir>/runs/`, and read back
     as-is - the backend does not reshape trade/equity data, only adds bookkeeping fields
     (`id`, `created`, `batch`, `source`, `varied`, `symbols`, `interval`, `label`).
2. **Backend adapter** — `app/routers/engine.py` + `app/schemas.py`. A thin layer: validates
   strategy/symbol/param input, writes the bars CSV the engine reads (`minute_data.get_minute_bars`),
   invokes the binary, stores/serves the resulting JSON files, and holds the four engine settings
   (`engine_dir`, `engine_name`, `engine_vps`, `engine_vps_reports`) in the app DB. **No trade/run
   data is ever written to Stoklore's own database** - runs are files, deleting a run/sweep deletes
   its file. There's a small mtime-keyed cache (`_rows`) so listing runs doesn't re-parse every
   trade array on every request.
3. **Frontend** — `frontend/src/Engine.tsx` (~1900 lines: run form, run detail, executions chart,
   sweep heatmap, sweep calibration view, runs/sweeps lists) + `frontend/src/lib/engine.ts` (pure
   helpers, no React/DOM - sweep grids, drawdown, trade markers, sweep math, xlsx sheet builders) +
   `frontend/src/lib/engine.selfcheck.mjs` (asserts every pure helper; run with
   `node src/lib/engine.selfcheck.mjs` from `frontend/`). Talks to the backend through
   `frontend/src/services/api.ts` (`EngineRun`, `EngineSweep`, etc.) and the generated
   `api.types.ts` (regenerate with `npm run types:api` against a running backend, per existing repo
   convention - never hand-edit the generated file, only the hand-written types in `api.ts`).

## Where a change lands

| You're changing... | Touch these |
|---|---|
| A CLI arg / report field the engine already emits, just not read yet | `app/routers/engine.py` (pass it through) → `frontend/src/services/api.ts` types → the `Engine.tsx` view that shows it |
| A new **summary metric** (e.g. a new ratio) | `EngineSummary` in `api.ts`, `SUMMARY_COLUMNS` in `lib/engine.ts` (export sheets), `METRICS`/`SWEEP_METRICS` in `Engine.tsx` (heatmap/table dropdowns) - all three, or the metric is invisible in one of run detail / sweep / export |
| A new **strategy param field** on the run form | `RunForm` in `Engine.tsx` reads params off `EngineStrategy.params` dynamically already - usually **no frontend change needed**, it renders whatever `backtest --list` reports |
| A new **chart/view** (sweep or run detail) | Add a small presentational function in `Engine.tsx` near its siblings (see `EquityFan`, `MetricSpread`, `AxisBars` for the pattern: pure props in, SVG/table out, no own data fetching) and a pure data-shaping helper in `lib/engine.ts` if the math is non-trivial - keeps it asserted in the self-check instead of only eyeballed |
| Settings (new engine setting) | `SETTINGS` dict + `EngineSettingsRequest` in schemas.py + `EngineSettings` type/form in `Engine.tsx`'s settings panel (see `frontend/src/Settings.tsx` "Algo engine" tab) |
| A new route/tab under `/engine` | `frontend/src/router.tsx` (`engineRoute`) + `frontend/src/lib/navTargets.ts` (`PAGES`) so the command palette stays in sync - this repo's convention, see CLAUDE.md |

Auto-tuning parameters per stock (walk-forward, gates, lifecycle, VPS deploy) has a design in
[docs/autotune-blueprint.md](../../../docs/autotune-blueprint.md) - read it before building any of it.
Phase 1 is built: `app/core/autotune.py` (pure functions + the walk, engine injected, asserted by
`.venv/bin/python tests/autotune.selfcheck.py`), routes under `/api/engine/autotune`, and the
Auto-tune tab in `Engine.tsx` (`tab` search param in router.tsx; `ENGINE_TABS` in navTargets.ts).
Each window also sweeps the grid on its test bars (`--sweep=grid --trade-from`) -> `tally_cells` /
`cell_table` give every cell's out-of-sample result (`report.cells`, hindsight) and the pick's `rank`/
`of`/`best` per window; `stitch` keeps every executed trade (`oos.trades`, `baseline.trades`). The UI
drills down with `pickedSets`, `windowOfTrade` and the backtest `ExecutionsChart` fed a synthesized run.
Multi-stock: `POST /api/engine/autotune` takes `symbols`, walks each separately (bars loaded
sequentially - DuckDB's default connection isn't thread-safe - walks in parallel) and saves them as
`wf-<batch>-<n>`; `AutotuneBatchView` compares them. The POST streams NDJSON (`start`, then a
`report` row or `error` per stock as it finishes, then `done`; bad requests still 4xx up front) -
`runEngineAutotune(req, onEvent)` reads it and the form refreshes the list per report. Loading is pipelined: a
loader thread fetches bars one stock at a time and submits each walk the moment its bars are in; results
reach the stream through a queue. **Sizing** (`Sizing` in schemas.py -> `_sizing()` -> engine
`sizing=0|1|2 capital=` params, hft `src/core.hpp` `Sizing`): fixed / scale qty / all-in, on backtest,
sweep and autotune. Autotune sizes only the OOS + baseline runs and carries each account across
windows with the engine's `carry=` param; tuning sweeps stay fixed-size. Fixed sends no args, so an
unsized run's report is byte-identical to before.

**Auto-tune run page** `/engine/autotune/$runId` (`EngineAutotunePage.tsx`, default export
`EngineAutotuneRunPage`): the run id is `runIdOf(report)` = its batch, or its own id for pre-batch
reports (an old report-id link redirects to its run with `?stocks=<symbol>`). All stocks' OOS
equity + `portfolioCurve` book, a per-stock table with checkboxes (selection in `?stocks=`), and a
`StockReport` tab per picked stock - `WalkForward` plus `runAnalytics` over `sideRun(r, 'oos'|'baseline')`,
reusing the run page's exported sections. The Auto-tune tab's `AutotuneList` is one row per run;
old `?autotune=` / `?tunebatch=` links redirect to the run page.
**Run page** `/engine/runs/$runId` (`EngineRunPage.tsx`, route in router.tsx): everything derives
from the run file via `runAnalytics` / `drawdownPeriods` / `excursions` / `tradeCost` in
`lib/engine.ts` (asserted in the self-check). Shared pieces (Panel, Stat, ExportMenu, ExecutionsChart,
DailyBars, HistoryLine, runName, PREFILL_KEY) live in `engineUi.tsx` so Engine.tsx, the run page and
`EngineJobs.tsx` don't import each other. New backtests also save `job`, `engine` {cmd, build, ms},
`sizing` and `request` into the run file; `PATCH /api/engine/runs/{id}` saves `note`/`tags` into it.
**Jobs**: `engine_jobs` table (db.py accessors, claim is `FOR UPDATE SKIP LOCKED`), worker threads
in `app/services/engine_jobs.py` calling `run_backtest` / `run_sweep` / `autotune_events` in
engine.py (the endpoints are thin wrappers over those), routes `/api/engine/jobs*`, `JobsPanel` +
`useQueueJob` in EngineJobs.tsx, `tab=jobs`. Worker count is the `engine_workers` setting (1-8,
live). **Bar cache TTL**: `minute_cache` table - `get_minute_bars` slides the 14-day expiry,
`minute_data.sweep_expired()` deletes expired symbols' parquet files, `_full_days` reloads the 1D
series from Postgres after a restart. `SymbolPicker` (both forms) lists the watchlist
first, then the stocks master on search; `useStoredSymbols` remembers each form's list. It needs the engine's `--trade-from=<ts>` flag (warm-up bars feed
the strategy, only later entries count). Bars reach today because `minute_data` tops the dataset
(ends 2026-01) up from moneycontrol, yfinance as fallback - `get_minute_bars(..., limit=None)` for
server-side callers that need the whole history.

**1D bars** reach back to each stock's first day in the dataset (2000+): the minutes' days, then the
dataset's own `day/` split (`<SYM>.dataset-day.parquet`, extracted on the first 1D request), then
moneycontrol's daily record for the rest (`_full_days`). They're `minute_data` BUCKETS["1D"] (resampled from 1m, stamped 09:15 - strategies flatten
from 15:00, so a close-stamped daily bar would flatten every bar). `_hold(interval)` in engine.py adds
`--overnight` for 1D at every engine call (backtest, sweep, autotune): daily is positional. The live
engine stays intraday.

**History ranges**: every run request carries `range` (`BarRange`: all | years | dates). engine.py
`_history` resolves it (`minute_data.range_bounds`), `_stock_bars` loads each stock inside it
(date filter in the DuckDB query; empty = skipped with a reason, not fatal), and bars go to a
per-request temp folder - never a shared `data/` CSV, which two ranges would clobber. Reports keep
`history` (resolved dates), `coverage` (each stock's own from/to/sessions) and `skipped`. Re-running
a sweep cell uses `pinnedRange` so it gets the sweep's exact bars.
Coverage also carries `missing` (sessions the daily record has that the bars lack), `adjusted`
(splits/bonuses back-adjusted) and `jumps` (25%+ gaps matching no ratio) - all from
`minute_data` (`<SYM>.daily.parquet`, `fill_days`, `split_events`, `back_adjust`). 1D bars are filled
and bad-print-repaired from the daily record; intraday bars are only split-adjusted.

## Conventions specific to this feature

- **Runs/sweeps are files, not rows.** Never add a table for run data. If something needs to be
  queried across runs that files can't answer cheaply, that's a sign the feature belongs in the
  engine binary (it already computes per-run summaries), not in Stoklore's DB.
- **Dead runs (0 trades).** A parameter set that never fires reports every metric as exactly `0`,
  which reads as a loss on a colour scale. `noTrades()` in `lib/engine.ts` is the check; every
  heatmap/table/stat in `SweepView` and `SweepHeatmap` already routes through it. Keep using it for
  any new aggregate view rather than re-deriving "did this run trade" ad hoc.
- **IDs are meaningful**: `bt-<batch>-<n>` (backtest), `sw-<timestamp>-<hex>` (sweep), live reports
  are named by the engine itself (`paper-<date>.json` / `live-<date>.json`). `SAFE_ID` in engine.py
  gates what's accepted as a path component - never build a path from user input without it.
- **No backend tests exist for `app/routers/engine.py`** (it shells out to a binary that isn't
  present in CI/dev). Verify backend changes by hand against a real engine checkout (set
  `ENGINE_DIR` or Settings > Algo engine) rather than expecting `pytest` coverage. Frontend logic
  that doesn't need the binary - sweep math, markers, exports, dead-run handling - belongs in
  `lib/engine.ts` precisely so it *can* be asserted in `engine.selfcheck.mjs` without one.
- **This repo's general rules still apply** (from CLAUDE.md): update `docs/engine.md` +
  `README.md`'s engine section with every behavior change, run
  `node src/lib/engine.selfcheck.mjs` after touching `lib/engine.ts`, and never treat `DATABASE_URL`
  writes here as disposable - the engine settings rows are the only DB state this feature has, but
  the same live-journal caution in CLAUDE.md applies to any other table you touch while working here.

## Quick orientation commands

```bash
graphify query "how does the engine backend talk to the frontend"
graphify explain "sweep dead run handling"
```

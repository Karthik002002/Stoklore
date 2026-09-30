---
name: algo-engine-contract
description: Use when building a new algo/trading engine (or a new strategy, or changing the existing C++ engine in ~/Coding/hft) that Stoklore's /engine page should drive - covers the binary layout, the CLI it must accept, the bars CSV it reads, and the exact JSON it must print for strategies, backtests, sweeps, walk-forward windows and paper/live reports. Includes a conformance checker to run against any engine before pointing Stoklore at it.
---

# Building an algo engine Stoklore can drive

Stoklore never links an engine. It **shells out to one binary**, hands it bars as CSV files, and
reads **JSON from stdout**. Any language works (C++ today, Rust/Go/Python tomorrow) as long as the
binary honours the contract below. Everything Stoklore shows - run pages, sweeps, heatmaps,
walk-forward, compounding, exports - is computed from these outputs, so an engine that emits them
exactly gets the whole `/engine` UI for free.

The reference engine is `~/Coding/hft` (`src/backtest.cpp`, `src/core.hpp`). The Stoklore side is
`app/routers/engine.py` (adapter) and `app/core/autotune.py` (walk-forward); see the `engine` skill
for changing *those*. This skill is the other side of the wire.

**Before pointing Stoklore at a new or changed engine, run the checker:**

```bash
.venv/bin/python .claude/skills/algo-engine-contract/check_engine.py <engine folder> [strategy]
```

It builds a synthetic bars CSV, calls every entry point below, and fails loudly on any shape,
type or behaviour Stoklore depends on. A strategy whose filters take no trades on the plain
synthetic wave (zscore_mr) gets `skip` for the trade-level checks, not a failure - the contract
checks still run. All three hft strategies pass.

## 1. Layout

```
<engine folder>/                 set in Settings > Algo engine (or ENGINE_DIR)
  build/backtest                 THE binary Stoklore runs (must exist and be executable)
  runs/                          Stoklore writes backtest reports here (bt-<batch>-<n>.json)
  runs/sweeps/  runs/autotune/   ...and sweeps / walk-forward reports
  runs/live/                     paper/live session reports, rsynced from the VPS
  .git                           optional - Stoklore records `git rev-parse --short HEAD`
                                 (+"+dirty" if src/ has uncommitted changes) as each run's build
```

The binary runs with `cwd = <engine folder>`, a **600 s timeout**, stdout and stderr captured.
`build/backtest` missing -> Stoklore says "Engine not built - run `make`".

## 2. Input: bars CSV

Stoklore writes one CSV per symbol into a temp folder and passes the paths:

```
<SYMBOL>_<interval>.csv          e.g. INFY_5m.csv, M&M_1D.csv  (the engine takes the symbol
time,open,high,low,close,volume     from the file name: everything before the LAST "_")
1743479100,1520.5,1524,1519.1,1522.3,48213
```

- `time` = the bar's **open** time, **IST-shifted epoch seconds** (IST wall clock read as UTC), so
  `time % 86400` is seconds since IST midnight and 09:15 is `33300`. Every time the engine prints
  must use this same clock.
- Header row first; ascending time; intervals `1m 5m 15m 1H 4H 1D`. Several files = several
  symbols in **one book** (sort all bars by time, stable).
- Prices are split/bonus back-adjusted and may be bad-print repaired by Stoklore; the engine just
  trades what it gets.

## 3. CLI

| Call | Prints (stdout) |
|---|---|
| `backtest --list` | strategies + default params (§4.1) |
| `backtest <strategy> <csv>... k=v ... --json` | one run report (§4.2) |
| `backtest <strategy> <csv>... k=<values> ... --sweep=oat\|grid` | a sweep (§4.3) |

Arguments, in any order after the strategy name:

- **`key=value`** - a strategy param, or an engine param. Values are numbers. In a sweep, a value
  may be a list or range: `9`, `5,9,13`, `5:20:5` (from:to:step inclusive), or a mix
  `3,10:12:1` - deduped, in order given. **The engine parses ranges, not Stoklore.**
- **`base.<param>=v`** - oat sweeps only: the value a swept param holds while others walk.
- Engine params every engine must accept (and report back in `params`):

| Param | Meaning | Default |
|---|---|---|
| `cost_bps` | cost per side, bps of each fill's notional (`|qty| * px * bps / 1e4`) | 3 |
| `sizing` | 0 fixed qty, 1 qty scaled by account growth, 2 all-in on the account | 0 |
| `capital` | starting account (₹) for sizing 1/2; required > 0 when sizing ≠ 0 | - |
| `carry` | P&L the account already made before this run (walk-forward windows) | 0 |

- **Flags**:
  - `--json` - machine output for a single run (without it, human text is fine).
  - `--sweep=oat|grid` - see §4.3.
  - `--trade-from=<ts>` - warm-up: bars before `ts` feed the strategy but nothing it orders on
    them fills, and the equity curve starts at `ts`. Works with `--json` and `--sweep`.
    Walk-forward depends on it and **checks**: if the equity starts before `ts`, the walk is
    refused ("the engine ignored --trade-from").
  - `--overnight` - positional: no intraday square-off, positions carry across days. Stoklore
    always passes it for `1D` bars.
- An unknown `k=v` must not crash: pass it through into `params`.

**Errors**: exit non-zero with a one-line human message on **stderr** ("sizing needs capital > 0",
"sweep is over 20000 runs - narrow the ranges"). Stoklore shows that text to the user as-is
(422 for sweeps). Never print a partial JSON on failure. A sweep's validation must happen
**before** any worker threads start.

## 4. Output

All JSON on stdout, one document, numbers as JSON numbers (never NaN/Infinity - write 0), times
as integer IST-shifted epoch seconds.

### 4.1 `--list`

```json
[{"name": "ema_cross", "params": {"fast": 9, "qty": 1, "slow": 21}}, ...]
```

`params` are the defaults, and they **become the form fields** on Stoklore's run, sweep and
auto-tune forms - one numeric field each, pre-filled. Only numbers. Include `qty` (shares per
unit) in every strategy so sizing has something to scale. Don't list engine params here.

### 4.2 A run report (`--json`, and every paper/live report)

```json
{
  "strategy": "ema_cross",
  "params": {"cost_bps": 3, "fast": 9, "qty": 1, "slow": 21},
  "summary": {
    "net": 1234.5, "gross": 1500.0, "costs": 265.5, "trades": 40,
    "win_rate": 52.5, "avg_win": 120.1, "avg_loss": -80.3, "max_dd": 900.0, "sharpe": 1.12,
    "profit_factor": 1.4, "expectancy": 30.8, "avg_hold_min": 95.0, "trades_per_day": 0.8,
    "ret_dd": 1.37, "days": 50, "from": 1743479100, "to": 1747887300
  },
  "equity":    [[1743479100, 0], [1743479400, 12.5], ...],
  "daily":     [[1743465600, 120.0], ...],
  "by_symbol": {"INFY": {"pnl": 800.0, "trades": 22}},
  "trades":    [["INFY", 1743479400, 1743483000, 10, 1520.5, 1531.0, 105.0], ...]
}
```

| Field | Rule |
|---|---|
| `params` | the **merged** set actually used: the strategy defaults plus every `k=v` passed, engine params included. Stoklore always passes `cost_bps` (and `sizing`/`capital`/`carry` when compounding), so they appear; it re-runs a run from these. |
| `summary.net` | P&L after costs; `gross = net + costs`; `costs` = total charged |
| `summary.trades` | = `len(trades)` |
| `win_rate` | % of trades with **gross** pnl > 0; `avg_win`/`avg_loss` gross, loss negative |
| `max_dd` | largest peak-to-trough fall of the **full** equity curve (₹, positive) |
| `sharpe` | mean / sd of `daily`, × √252; 0 when sd = 0 |
| `profit_factor` | gross wins / -gross losses; **99** when there are wins and no loss; 0 with no trades |
| `expectancy` | `net / trades` (0 with none) |
| `avg_hold_min`, `trades_per_day` | mean (exit-entry)/60; trades / `days` |
| `ret_dd` | `net / max_dd` (0 when max_dd = 0) |
| `days`, `from`, `to` | `len(daily)`; first and last equity time |
| `equity` | `[time, P&L so far]`, marked to market, **strictly increasing times**, starting at 0 (or at `--trade-from`). Thin to ~2000 points, but compute `max_dd`/`daily` on the full curve first. |
| `daily` | `[day start (time - time % 86400), that day's P&L]`, one per trading day |
| `by_symbol` | per symbol gross pnl and trade count |
| `trades` | `[symbol, entry time, exit time, signed qty (+long/-short), entry px, exit px, GROSS pnl]` - one per closed position (a partial close or flip closes the overlap as its own trade) |

A run that never trades is valid: every summary field 0, `trades: []`. Stoklore treats that as a
"dead" run, not a losing one - don't invent anything for it.

Paper/live reports use the same shape plus `"source": "paper"|"live"` and `"halted": bool`, written
atomically (tmp + rename) as `<REPORT_DIR>/<strategy>-<paper|live>-<YYYY-MM-DD>.json` - the id's last
10 chars must be the date. Stoklore rsyncs that folder into `runs/live/`.

### 4.3 A sweep (`--sweep=oat|grid`)

```json
{
  "strategy": "ema_cross", "mode": "grid",
  "base": {"cost_bps": 3, "fast": 9, "qty": 1, "slow": 21},
  "axes": {"fast": [5, 9, 13], "slow": [21, 34]},
  "runs": [
    {"params": {...merged...}, "axis": "", "summary": {...as 4.2...}, "spark": [0, 12, ..., 1234]}
  ]
}
```

- A param given one value is **fixed** (goes into `base`); several values make an **axis**. No axis
  -> error "nothing to sweep".
- `oat`: first the base run (`axis: ""`), then each axis walks its values with the rest at base
  (`axis: "<param>"`, the base point itself not repeated). `grid`: every combination, `axis: ""`.
- `base[k]` for a swept engine param with no default (e.g. `cost_bps` swept) = its first value.
- `spark`: ~40 rounded equity points ending with the net - the table's sparkline.
- Cap at **20,000 runs** (error beyond). Load bars once; run sets in parallel - Stoklore's
  walk-forward calls a grid sweep **twice per window** (train, and every cell on the unseen test
  bars with `--trade-from`), so speed here is the walk's speed.

## 5. Trading semantics Stoklore assumes

Stoklore's charts and verdicts are only honest if the engine does this:

1. **No lookahead**: `on_bar` fires after a bar closes; orders fill at the **next bar's open**.
2. **Intraday** (no `--overnight`): square off at the first bar opening at/after **15:15 IST**; a
   position still open when a new day starts (data gap) is closed at that day's first open.
3. **Costs** on every fill, both sides, `cost_bps` of notional.
4. **Sizing** is decided when a position opens (from flat or on a flip) and held until it closes, so
   exits close exactly what was bought. `sizing=0` must give output **byte-identical** to an engine
   without sizing - Stoklore sends no sizing args for fixed runs.
5. **Deterministic**: same args + same CSVs -> same stdout. Stoklore diffs and re-runs.

## 6. Adding a strategy (the hft layout)

One file, `src/strategies/<name>.hpp`, ending in

```cpp
inline const StrategyInfo strategy_<name>{"<name>", {{"qty", 1}, {"fast", 9}}, factory};
```

`make` generates the registry from the folder (no list to edit); `make STRATEGY=<name>` builds a
one-strategy release binary. Strategies see only `Ctx::position(sym)` and `Ctx::order(sym, qty)`
/`target(sym, want)` in **their own qty units** - never read the book or equity (sizing is the
engine's job). Then `make && make test`, and run the checker.

## 7. What NOT to build into the engine

Stoklore already computes these from the outputs above - duplicating them in the engine just
creates two answers: walk-forward windows/picks/WFE/deflated Sharpe (`app/core/autotune.py`), the
run page's CAGR/Sortino/Calmar/SQN/Kelly/MAE-MFE/heatmaps (`frontend/src/lib/engine.ts
runAnalytics`), exports, per-trade net-of-cost, portfolio books across stocks. If a new metric
needs per-bar state only the engine has, add it to `summary` (then follow the `engine` skill's
"new summary metric" row on the Stoklore side).

## 8. Changing the contract

A new flag, param or field is a change on **both** repos, committed together (see the
commit-to-main memory): the engine + its README, and in Stoklore `engine.py` (pass it through),
`api.ts` types, the views, `docs/engine.md`, this skill, and `check_engine.py` so the checker
enforces it.

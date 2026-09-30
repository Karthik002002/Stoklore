"""Walk-forward parameter tuning for one stock - Phase 1 of docs/autotune-blueprint.md.

Tune on `train` sessions, trade the next `test` sessions with what was picked, never having seen
them, then roll forward by `test` and do it again. The stitched out-of-sample (OOS) curve is the
only performance number this reports as real; the in-sample figures are shown only as the promise
the OOS curve is measured against.

    sessions  |------ train ------|-- test --|
                         |------ train ------|-- test --|           ...
    per window: grid sweep on train -> plateau score -> pick (with hysteresis)
                -> backtest the pick on warm-up + test bars with --trade-from=<test start>
                -> the same for the strategy's fixed defaults (the baseline to beat)

The engine is injected (`engine(*args) -> parsed JSON`), so tests/autotune.selfcheck.py can run
the whole loop against a fake one. Everything else here is pure.

Summaries of single runs are the engine's own. Only the stitching of several windows into one OOS
figure is computed here (`stitch`), with the engine's definitions (core.hpp `summarize`): profit
factor and win rate on per-trade gross P&L, Sharpe on daily P&L annualised by sqrt(252).
"""
import csv
import itertools
import math
import statistics
import tempfile
from pathlib import Path

EULER_GAMMA = 0.5772156649015329
MAX_CELLS = 5000  # per window; past this the per-window scoring, not the C++, is what's slow


def sessions_of(bars):
    """The distinct IST dates in `bars`, oldest first."""
    return sorted({b["date"] for b in bars})


def windows(n, train, test):
    """(train_from, test_from, test_to) session indices, test_to exclusive. Steps by `test`, so
    test periods tile the history without overlapping; a tail shorter than `test` is left out."""
    return [(i, i + train, i + train + test) for i in range(0, n - train - test + 1, test)]


def objective(summary, min_trades):
    """Net per trade scaled by sqrt(trades) - a per-trade edge that has been seen many times beats
    the same edge seen twice. None below `min_trades`: too few to rank at all."""
    n = summary.get("trades") or 0
    return summary.get("expectancy", 0) * math.sqrt(n) if n >= min_trades else None


def plateau_scores(runs, axes, min_trades):
    """Per run, (median, mean) of the objective over its neighbourhood: itself and every cell one
    grid step away on any swept axis. The median ranks - a lone spike among losers scores low, a
    broad good area high - and the mean breaks ties toward the middle of a plateau, not its rim.
    An ineligible neighbour, or one past the edge of the grid, counts as the worst eligible value,
    never as missing: a peak with dead cells around it isn't a plateau, and nothing is known about
    what lies beyond the grid. None for ineligible runs."""
    keys = list(axes)
    pos = {k: {v: i for i, v in enumerate(axes[k])} for k in keys}
    cell = [tuple(pos[k][r["params"][k]] for k in keys) for r in runs]
    obj = [objective(r["summary"], min_trades) for r in runs]
    live = [o for o in obj if o is not None]
    if not live:
        return [None] * len(runs)
    floor = min(live)
    grid = {c: (o if o is not None else floor) for c, o in zip(cell, obj)}
    offsets = list(itertools.product((-1, 0, 1), repeat=len(keys)))
    scores = []
    for c, o in zip(cell, obj):
        if o is None:
            scores.append(None)
            continue
        near = [grid.get(tuple(a + d for a, d in zip(c, off)), floor) for off in offsets]
        scores.append((statistics.median(near), statistics.mean(near)))
    return scores


def pick(runs, scores, incumbent, margin):
    """Index of the run to trade next, or None to sit the window out: only a cell whose plateau
    scored above zero - one that made money in-sample, with neighbours that did too - is ever
    traded. The least-bad of a losing grid is still a losing grid.
    Keeps the incumbent unless the best beats the incumbent's CURRENT median score by `margin`
    (relative) - otherwise the pick flips between near-equal cells on noise and pays for it in
    whipsaw. `scores` are plateau_scores' (median, mean) pairs."""
    ok = [i for i, s in enumerate(scores) if s is not None and s[0] > 0]
    if not ok:
        return None
    best = max(ok, key=lambda i: scores[i])
    if incumbent is not None:
        inc = next((i for i in ok if runs[i]["params"] == incumbent), None)
        if inc is not None and scores[best][0] <= scores[inc][0] + margin * abs(scores[inc][0]):
            return inc
    return best


def near(a, b, axes):
    """Whether two param sets are within one grid step of each other on every swept axis."""
    return all(abs(axes[k].index(a[k]) - axes[k].index(b[k])) <= 1 for k in axes)


def summarize(net, costs, trades, equity, daily):
    """One summary for stitched windows, with the engine's definitions (see module doc)."""
    n = len(trades)
    wins = [t[6] for t in trades if t[6] > 0]
    gw = sum(wins)
    gl = sum(t[6] for t in trades if t[6] <= 0)
    peak = dd = 0.0
    for _, e in equity:
        peak = max(peak, e)
        dd = max(dd, peak - e)
    vals = [v for _, v in daily]
    mean = sum(vals) / len(vals) if vals else 0
    sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / len(vals)) if vals else 0
    return {
        "net": net,
        "gross": net + costs,
        "costs": costs,
        "trades": n,
        "win_rate": 100 * len(wins) / n if n else 0,
        "avg_win": gw / len(wins) if wins else 0,
        "avg_loss": gl / (n - len(wins)) if n > len(wins) else 0,
        "profit_factor": gw / -gl if gl < 0 else (99 if gw > 0 else 0),
        "expectancy": net / n if n else 0,
        "max_dd": dd,
        "ret_dd": net / dd if dd > 0 else 0,
        "sharpe": mean / sd * math.sqrt(252) if sd > 0 else 0,
        "days": len(vals),
    }


def stitch(segments):
    """Window reports -> one OOS curve. A segment is {"report": engine JSON or None, "start",
    "end", "days"}; None means the tuner sat that window out, which is drawn flat and counted as
    zero-P&L days - idle capital is part of the result, not a gap in it."""
    equity, daily, trades = [], [], []
    level = costs = 0.0

    def point(t, v):
        if equity and equity[-1][0] >= t:  # the chart wants strictly increasing times
            equity[-1][1] = v
        else:
            equity.append([t, v])

    for seg in segments:
        rep = seg["report"]
        if rep is None:
            point(seg["start"], level)
            point(seg["end"], level)
            daily += [[d, 0.0] for d in seg["days"]]
            continue
        for t, e in rep["equity"]:
            point(t, level + e)
        daily += rep["daily"]
        trades += rep["trades"]
        level += rep["summary"]["net"]
        costs += rep["summary"]["costs"]
    # summarised on the full curve (drawdown needs every point), stored thinned for the chart; the
    # trades are kept whole - they're what the report's executions chart and trade list show
    step = len(equity) // 2000 + 1
    thin = equity[::step] + ([equity[-1]] if equity and (len(equity) - 1) % step else [])
    return {"summary": summarize(level, costs, trades, equity, daily), "equity": thin, "daily": daily, "trades": trades}


def cell_key(params, axes):
    """A grid cell's identity: its value on each swept axis, in axis order."""
    return tuple(params[k] for k in axes)


def tally_cells(acc, is_runs, oos_runs, axes, chosen):
    """Adds one window to the per-cell tally `acc` (cell key -> running sums): every cell's
    out-of-sample result on that window (`oos_runs`, the grid swept on the unseen test bars), its
    in-sample net (`is_runs`), and whether it was the pick. Returns the window's own verdict on the
    pick: its rank among the cells by out-of-sample net (1 = best), the cell count, and the best
    cell - what the tuner would have picked with hindsight."""
    is_net = {cell_key(r["params"], axes): r["summary"].get("net", 0) for r in is_runs}
    ranked = sorted(oos_runs, key=lambda r: r["summary"].get("net", 0), reverse=True)
    for r in oos_runs:
        k, sm = cell_key(r["params"], axes), r["summary"]
        n = sm.get("trades", 0)
        wins = round(sm.get("win_rate", 0) * n / 100)
        a = acc.setdefault(k, {"params": {ax: v for ax, v in zip(axes, k)}, "net": 0.0, "trades": 0, "wins": 0,
                               "gw": 0.0, "gl": 0.0, "windows": 0, "positive": 0, "picked": 0, "is_net": 0.0})
        a["net"] += sm.get("net", 0)
        a["trades"] += n
        a["wins"] += wins
        a["gw"] += sm.get("avg_win", 0) * wins
        a["gl"] += sm.get("avg_loss", 0) * (n - wins)
        a["windows"] += 1
        a["positive"] += sm.get("net", 0) > 0
        a["is_net"] += is_net.get(k, 0)
        a["picked"] += chosen is not None and cell_key(chosen, axes) == k
    best = ranked[0] if ranked else None
    verdict = {"of": len(ranked), "best": {"params": {ax: best["params"][ax] for ax in axes},
                                          "net": best["summary"].get("net", 0)} if best else None}
    if chosen is not None:
        mine = next((r["summary"].get("net", 0) for r in oos_runs if cell_key(r["params"], axes) == cell_key(chosen, axes)), None)
        verdict["rank"] = 1 + sum(r["summary"].get("net", 0) > mine for r in oos_runs) if mine is not None else None
    return verdict


def cell_table(acc):
    """The tally as a table, best out-of-sample net first: every combination as if it had been
    traded, unchanged, in every test window. Hindsight - no walk could have known which one - but it
    says which part of the grid actually held up, and how the tuner's picks compare."""
    rows = []
    for a in acc.values():
        n, w = a["trades"], a["wins"]
        rows.append({
            "params": a["params"],
            "net": a["net"],
            "trades": n,
            "win_rate": 100 * w / n if n else 0,
            "profit_factor": a["gw"] / -a["gl"] if a["gl"] < 0 else (99 if a["gw"] > 0 else 0),
            "expectancy": a["net"] / n if n else 0,
            "windows": a["windows"],
            "positive_windows": a["positive"],
            "picked": a["picked"],
            "is_net": a["is_net"] / a["windows"] if a["windows"] else 0,
        })
    return sorted(rows, key=lambda r: r["net"], reverse=True)


def deflated_sharpe(daily, trials=1, trial_var=0.0):
    """Probability that the true daily Sharpe of `daily` is above zero after allowing for having
    picked it out of `trials` tries whose Sharpes varied by `trial_var` (Bailey & Lopez de Prado,
    2014). With one trial it is the plain probabilistic Sharpe ratio. Per-day Sharpes throughout,
    not annualised. None when there are too few days or no variation to say anything."""
    from statistics import NormalDist

    x = [v for _, v in daily]
    n = len(x)
    if n < 3:
        return None
    mean = sum(x) / n
    sd = math.sqrt(sum((v - mean) ** 2 for v in x) / n)
    if sd == 0:
        return None
    sr = mean / sd
    skew = sum(((v - mean) / sd) ** 3 for v in x) / n
    kurt = sum(((v - mean) / sd) ** 4 for v in x) / n
    nd = NormalDist()
    sr0 = 0.0  # the Sharpe the best of `trials` no-skill tries would show by luck alone
    if trials > 1 and trial_var > 0:
        sr0 = math.sqrt(trial_var) * (
            (1 - EULER_GAMMA) * nd.inv_cdf(1 - 1 / trials) + EULER_GAMMA * nd.inv_cdf(1 - 1 / (trials * math.e))
        )
    denom = math.sqrt(max(1 - skew * sr + (kurt - 1) / 4 * sr**2, 1e-12))
    return nd.cdf((sr - sr0) * math.sqrt(n - 1) / denom)


def _write_csv(path, bars):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["time", "open", "high", "low", "close", "volume"])
        w.writerows([b["time"], b["open"], b["high"], b["low"], b["close"], b["volume"]] for b in bars)


def _kv(params):
    return [f"{k}={v:g}" for k, v in params.items()]


def walk_forward(engine, bars, *, symbol, interval, strategy, params, defaults, train, test, min_trades, margin, cost_bps,
                 sizing=()):
    """The whole walk. `params` is as typed ({name: "9" | "5,9,13" | "5:20:5"}): several values are
    swept, one value is fixed. `defaults` are the strategy's own (from `backtest --list`); fixed
    values override them for the baseline too, so the baseline differs only in not being tuned.
    `sizing` is the engine's compounding args (["sizing=1", "capital=..."], empty = fixed qty). Only
    the traded windows use it - tuned and baseline alike, each carrying its own account from one
    window into the next (`carry` = its P&L so far), so the stitched curve compounds end to end.
    Tuning sweeps and the hindsight grid stay fixed-size: a pick is made on the strategy's edge, not
    on how big the account happened to be when a cell traded."""
    days = sessions_of(bars)
    spans = windows(len(days), train, test)
    if not spans:
        raise ValueError(f"{len(days)} sessions of {symbol} - need at least train + test = {train + test}")
    by_day = {}
    for b in bars:
        by_day.setdefault(b["date"], []).append(b)
    fixed = {k: float(v) for k, v in params.items() if "," not in v and ":" not in v}
    baseline = {**defaults, **fixed, "cost_bps": cost_bps}
    swept_args = [f"{k}={v}" for k, v in params.items() if k not in fixed]
    if not swept_args:
        raise ValueError("give at least one param a range or list to tune")

    rows, tuned_segs, base_segs, promise = [], [], [], []
    acc = {}  # cell -> running out-of-sample tally across windows (see tally_cells)
    trial_sr = []  # per-day Sharpes of every eligible cell, per window - the trials DSR deflates by
    incumbent = None
    promised = 0.0
    tuned_pnl = base_pnl = 0.0  # each account's P&L so far, carried into the next window's capital
    with tempfile.TemporaryDirectory() as tmp:
        csv_path = str(Path(tmp) / f"{symbol}_{interval}.csv")  # the engine names the symbol from the file
        for train_from, test_from, test_to in spans:
            train_bars = [b for d in days[train_from:test_from] for b in by_day[d]]
            span_bars = [b for d in days[train_from:test_to] for b in by_day[d]]
            test_days = days[test_from:test_to]
            start = by_day[test_days[0]][0]["time"]
            end = by_day[test_days[-1]][-1]["time"]
            seg = {"start": start, "end": end, "days": sorted({b["time"] - b["time"] % 86400 for d in test_days for b in by_day[d]})}

            _write_csv(csv_path, train_bars)
            sweep = engine(strategy, csv_path, *swept_args, *_kv(fixed), f"cost_bps={cost_bps:g}", "--sweep=grid")
            runs, axes = sweep["runs"], sweep["axes"]
            if len(runs) > MAX_CELLS:
                raise ValueError(f"{len(runs)} cells per window - keep the grid under {MAX_CELLS}")
            scores = plateau_scores(runs, axes, min_trades)
            trial_sr.append([r["summary"]["sharpe"] / math.sqrt(252) for r, s in zip(runs, scores) if s is not None])
            i = pick(runs, scores, incumbent, margin)
            chosen = runs[i]["params"] if i is not None else None

            _write_csv(csv_path, span_bars)
            trade_from = f"--trade-from={start}"
            def sized(pnl):  # the sizing args, carrying this account's P&L from the earlier windows
                return [*sizing, f"carry={pnl:.10g}"] if sizing else []

            oos = engine(strategy, csv_path, *_kv(chosen), *sized(tuned_pnl), "--json", trade_from) if chosen else None
            base = engine(strategy, csv_path, *_kv(baseline), *sized(base_pnl), "--json", trade_from)
            tuned_pnl += oos["summary"]["net"] if oos else 0
            base_pnl += base["summary"]["net"]
            for rep in (oos, base):
                # an engine built before --trade-from takes it for a param and trades the warm-up
                if rep and rep["equity"] and rep["equity"][0][0] < start:
                    raise RuntimeError("the engine ignored --trade-from - run `make` in the engine folder")
            # every cell on the same unseen bars, in one sweep: which combination would have done
            # best here, and where the pick ranked - one more engine call per window
            grid_oos = engine(strategy, csv_path, *swept_args, *_kv(fixed), f"cost_bps={cost_bps:g}", "--sweep=grid", trade_from)
            verdict = tally_cells(acc, runs, grid_oos["runs"], list(axes), chosen)

            tuned_segs.append({**seg, "report": oos})
            base_segs.append({**seg, "report": base})
            if chosen:
                promised += runs[i]["summary"]["net"] / (test_from - train_from) * len(test_days)
            promise.append([end, promised])
            rows.append({
                "train": [days[train_from], days[test_from - 1]],
                "test": [test_days[0], test_days[-1]],
                "chosen": chosen,
                "switched": chosen is not None and incumbent is not None and chosen != incumbent,
                "cells": len(runs),
                "eligible": sum(s is not None for s in scores),
                "is": runs[i]["summary"] if chosen else None,
                "oos": oos["summary"] if oos else None,
                "baseline": base["summary"],
                "start": start,
                "end": end,
                **verdict,
            })
            incumbent = chosen or incumbent

    tuned, fixed_run = stitch(tuned_segs), stitch(base_segs)
    return {
        "strategy": strategy,
        "symbol": symbol,
        "interval": interval,
        "params": params,
        "defaults": baseline,
        "axes": axes,
        "train": train,
        "test": test,
        "min_trades": min_trades,
        "margin": margin,
        "cost_bps": cost_bps,
        "sizing": list(sizing) or None,
        "sessions": [days[spans[0][0]], days[spans[-1][2] - 1]],
        "windows": rows,
        "oos": tuned,
        "baseline": fixed_run,
        "promised": promise,
        "cells": cell_table(acc),
        "stats": stats(rows, tuned, fixed_run, trial_sr, axes, test),
    }


def stats(rows, tuned, baseline, trial_sr, axes, test):
    """The report's verdict numbers - see the blueprint's "What the report must show"."""
    traded = [r for r in rows if r["chosen"]]
    oos_per_session = tuned["summary"]["net"] / (len(rows) * test)
    is_rates = [r["is"]["net"] / r["is"]["days"] for r in traded if r["is"].get("days")]
    is_per_session = statistics.mean(is_rates) if is_rates else None
    pairs = [(a["chosen"], b["chosen"]) for a, b in zip(rows, rows[1:]) if a["chosen"] and b["chosen"]]
    # DSR's trials: the cells a window picks from, and how widely their Sharpes spread - the
    # typical window's, since every window picks from the same grid
    spreads = [statistics.pvariance(t) for t in trial_sr if len(t) > 1]
    trials = round(statistics.mean(len(t) for t in trial_sr)) if trial_sr else 1
    return {
        "windows": len(rows),
        "traded_windows": len(traded),
        "sat_out": len(rows) - len(traded),
        "switches": sum(r["switched"] for r in rows),
        "wfe": oos_per_session / is_per_session if is_per_session and is_per_session > 0 else None,
        "beats_baseline": tuned["summary"]["net"] > baseline["summary"]["net"],
        "stability": sum(near(a, b, axes) for a, b in pairs) / len(pairs) if pairs else None,
        "dsr": deflated_sharpe(tuned["daily"], trials, statistics.mean(spreads) if spreads else 0.0),
        "trials": trials,
    }

"""Walk-forward tuning's pure half, and the whole loop against a fake engine. Plain asserts:

    .venv/bin/python tests/autotune.selfcheck.py

The cases worth pinning are the ones that decide whether an OOS number means anything: windows
that never overlap, a spike losing to a plateau, dead cells not flattering their neighbours, the
pick not thrashing, sat-out windows counted as idle days, and an old engine that ignores
--trade-from being caught instead of silently trading the warm-up.
"""
import csv
import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import autotune as at  # noqa: E402

# --- windows ------------------------------------------------------------------------------------
assert at.windows(10, 4, 2) == [(0, 4, 6), (2, 6, 8), (4, 8, 10)], "test periods tile, never overlap"
assert at.windows(9, 4, 2) == [(0, 4, 6), (2, 6, 8)], "a tail shorter than one test period is left out"
assert at.windows(5, 4, 2) == [], "not enough history for one window"

# --- objective + plateau ------------------------------------------------------------------------
assert at.objective({"trades": 9, "expectancy": 2}, 10) is None, "below min_trades: not ranked"
assert at.objective({"trades": 16, "expectancy": 2}, 10) == 8


def grid1(objs):
    """One swept axis, values 1..n, with the given objective per cell (None = too few trades)."""
    runs = [
        {"params": {"x": float(i + 1)}, "summary": {"trades": 0} if o is None else {"trades": 1, "expectancy": o}}
        for i, o in enumerate(objs)
    ]
    return runs, {"x": [float(i + 1) for i in range(len(objs))]}


runs, axes = grid1([0, 9, 0, 0, 5, 5, 5])
s = at.plateau_scores(runs, axes, 1)
assert s[1][0] == 0 and s[5][0] == 5 and s[4][0] == 5 and s[6][0] == 5, s
assert at.pick(runs, s, None, 0) == 5, "the plateau beats the lone spike, and its middle beats its rims"

runs, axes = grid1([None, 8, None, 4, 4, 4, 1])
s = at.plateau_scores(runs, axes, 1)
assert s[0] is None and s[2] is None, "ineligible cells are never picked"
assert s[1][0] == 1, "dead neighbours count as the grid's worst value, not as missing"
assert at.pick(runs, s, None, 0) == 4

runs, axes = grid1([-3, -1, -2])
assert at.pick(runs, at.plateau_scores(runs, axes, 1), None, 0) is None, "a losing grid's least-bad cell is not traded"
assert at.plateau_scores(*grid1([None, None]), 1) == [None, None]
assert at.pick(*grid1([None])[:1], [None], None, 0) is None, "nothing eligible: sit the window out"

# two axes: the neighbourhood includes the diagonals
runs = [
    {"params": {"a": float(a), "b": float(b)}, "summary": {"trades": 1, "expectancy": 10 if (a, b) == (0, 0) else 1}}
    for a, b in itertools.product(range(3), range(3))
]
s = at.plateau_scores(runs, {"a": [0.0, 1.0, 2.0], "b": [0.0, 1.0, 2.0]}, 1)
assert s[4] == (1, 2), "the centre sees all nine cells, the corner spike among them"
assert s[0] == (1, 2), "the corner: 10 and three 1s in the grid, five off-grid cells at the floor (1)"

# --- hysteresis ---------------------------------------------------------------------------------
runs, axes = grid1([1, 1])
inc = runs[0]["params"]
assert at.pick(runs, [(10, 0), (11, 0)], inc, 0.15) == 0, "within the margin: keep the incumbent"
assert at.pick(runs, [(10, 0), (12, 0)], inc, 0.15) == 1, "past the margin: switch"
assert at.pick(runs, [None, (3, 0)], inc, 0.15) == 1, "an incumbent gone ineligible is dropped"
assert at.pick(runs, [(10, 0), (11, 0)], {"x": 99.0}, 0.15) == 1, "an incumbent not in this grid is ignored"
assert at.near({"x": 1.0}, {"x": 2.0}, axes) and not at.near({"x": 1.0}, {"x": 3.0}, {"x": [1.0, 2.0, 3.0]})

# --- stitching ----------------------------------------------------------------------------------
rep = lambda net, t0: {  # noqa: E731
    "summary": {"net": net, "costs": 1.0},
    "equity": [[t0, 0], [t0 + 60, net]],
    "daily": [[t0 - t0 % 86400, net]],
    "trades": [["X", t0, t0 + 60, 1, 10, 10 + net, net + 0.5]],
}
st = at.stitch([
    {"report": rep(5.0, 86400), "start": 86400, "end": 86460, "days": [86400]},
    {"report": None, "start": 2 * 86400, "end": 2 * 86400 + 60, "days": [2 * 86400]},
    {"report": rep(-2.0, 3 * 86400), "start": 3 * 86400, "end": 3 * 86400 + 60, "days": [3 * 86400]},
])
assert [e[1] for e in st["equity"]] == [0, 5, 5, 5, 5, 3], st["equity"]
assert all(a[0] < b[0] for a, b in zip(st["equity"], st["equity"][1:])), "strictly increasing times"
long = at.stitch([{"report": {"summary": {"net": 0.0, "costs": 0.0}, "equity": [[t, (t % 7) - 3] for t in range(1, 5001)],
                              "daily": [], "trades": []}, "start": 1, "end": 5000, "days": []}])
assert len(long["equity"]) <= 2001 and long["equity"][-1] == [5000, 5000 % 7 - 3], "thinned, last point kept"
assert long["summary"]["max_dd"] == 6, "drawdown measured on the full curve, not the thinned one"
assert [d[1] for d in st["daily"]] == [5, 0, -2], "a sat-out window is an idle day, not a gap"
sm = st["summary"]
assert (sm["net"], sm["costs"], sm["gross"], sm["trades"]) == (3, 2, 5, 2)
assert sm["max_dd"] == 2 and sm["expectancy"] == 1.5
assert sm["win_rate"] == 50 and sm["profit_factor"] == 5.5 / 1.5, "engine's definitions: on gross P&L"

# --- every cell out-of-sample: the tally, the pick's rank, the hindsight table ---------------------
ax = {"x": [1.0, 2.0, 3.0]}
cellrun = lambda x, net, n=4, wr=50, aw=5, al=-2: {"params": {"x": x, "qty": 1.0}, "summary": {  # noqa: E731
    "net": net, "trades": n, "win_rate": wr, "avg_win": aw, "avg_loss": al}}
acc = {}
v = at.tally_cells(acc, [cellrun(1.0, 9), cellrun(2.0, 3), cellrun(3.0, 1)],
                   [cellrun(1.0, -4), cellrun(2.0, 6), cellrun(3.0, 2)], ["x"], {"x": 1.0, "qty": 1.0})
assert v == {"of": 3, "best": {"params": {"x": 2.0}, "net": 6}, "rank": 3}, "the pick (x=1) came last on unseen bars"
v = at.tally_cells(acc, [cellrun(1.0, 9)], [cellrun(1.0, 5), cellrun(2.0, 5), cellrun(3.0, 0, n=0)], ["x"], None)
assert "rank" not in v, "a sat-out window has no pick to rank"
table = at.cell_table(acc)
assert [r["params"]["x"] for r in table] == [2.0, 3.0, 1.0], "best out-of-sample net first"
x2 = table[0]
assert (x2["net"], x2["trades"], x2["windows"], x2["positive_windows"], x2["picked"]) == (11, 8, 2, 2, 0)
assert x2["win_rate"] == 50 and x2["profit_factor"] == (5 * 4) / (2 * 4), "summed from each window's wins/losses"
assert table[2]["picked"] == 1 and table[2]["is_net"] == 9, "x=1 was picked once; its mean in-sample net"
assert table[1]["trades"] == 4 and table[1]["windows"] == 2, "a dead window still counts as a window"

# --- deflated Sharpe ----------------------------------------------------------------------------
up = [[i, 1.0 + (i % 3)] for i in range(60)]
flat_noise = [[i, (-1) ** i] for i in range(60)]
assert at.deflated_sharpe(up) > 0.99, "a steady positive series is almost surely positive"
assert 0.4 < at.deflated_sharpe(flat_noise) < 0.6, "zero-mean noise sits near a coin flip"
assert at.deflated_sharpe(up, 1000, 1.0) < at.deflated_sharpe(up), "more tries, less credit"
assert at.deflated_sharpe([[0, 1], [1, 1], [2, 1]]) is None, "no variation: nothing to say"
assert at.deflated_sharpe([[0, 1], [1, 2]]) is None, "too few days"

# --- the whole loop, against a fake engine ------------------------------------------------------
DAYS = 30
BARS = [
    {"date": f"2026-01-{d + 1:02d}", "time": d * 86400 + 9 * 3600 + 15 * 60 + k * 300, "open": 1, "high": 1,
     "low": 1, "close": 1, "volume": 1}
    for d in range(DAYS)
    for k in range(3)
]


def edge(p):
    return 1.0 if p["fast"] >= 9 else -1.0  # fast >= 9 wins, the default (5) loses


calls = []


def fake_engine(*args, honour_from=True):
    calls.append(args)
    _, path, *rest = args
    with open(path) as f:
        times = [int(r["time"]) for r in csv.DictReader(f)]
    kv = dict(a.split("=", 1) for a in rest if not a.startswith("--"))
    if "--sweep=grid" in rest:
        axes = {k: [float(x) for x in v.split(",")] for k, v in kv.items() if "," in v}
        fixed = {k: float(v) for k, v in kv.items() if "," not in v}
        runs = []
        for combo in itertools.product(*axes.values()):
            p = {**fixed, **dict(zip(axes, combo))}
            e = edge(p)
            days = len({t // 86400 for t in times})
            runs.append({"params": p, "axis": "", "summary": {"trades": 40, "expectancy": e, "net": 40 * e, "sharpe": e, "days": days}})
        return {"axes": axes, "runs": runs}
    frm = next(int(a.split("=")[1]) for a in rest if a.startswith("--trade-from="))
    kept = [t for t in times if t >= frm or not honour_from]
    p = {k: float(v) for k, v in kv.items()}
    days = sorted({t - t % 86400 for t in kept})
    e = edge(p)
    return {
        "summary": {"net": e * len(days), "costs": 0.1 * len(days)},
        "equity": [[t, e * (i + 1) / 3] for i, t in enumerate(kept)],
        "daily": [[d, e] for d in days],
        "trades": [["X", d + 33300, d + 33600, 1, 1, 1, e] for d in days],
    }


kw = dict(symbol="X", interval="5m", strategy="s", params={"fast": "5,7,9,11,13", "qty": "2"}, defaults={"fast": 5.0, "qty": 1.0},
          train=10, test=5, min_trades=30, margin=0.15, cost_bps=3)
r = at.walk_forward(fake_engine, BARS, **kw)
assert r["stats"]["windows"] == 4 and len(r["windows"]) == 4, r["stats"]
assert r["windows"][0]["test"] == ["2026-01-11", "2026-01-15"] and r["windows"][-1]["test"][1] == "2026-01-30"
assert all(w["chosen"]["fast"] >= 9 for w in r["windows"]), "tuned onto the winning region"
assert r["stats"]["switches"] == 0, "same grid every window: no reason to switch"
assert r["defaults"] == {"fast": 5.0, "qty": 2.0, "cost_bps": 3}, "baseline = defaults + the user's fixed values"
assert r["stats"]["beats_baseline"] and r["oos"]["summary"]["net"] == 20 and r["baseline"]["summary"]["net"] == -20
assert r["oos"]["summary"]["days"] == 20, "only test sessions count, never the warm-up"
assert len(r["oos"]["trades"]) == 20 and len(r["baseline"]["trades"]) == 20, "every executed trade is kept"
assert all(w["start"] <= t[1] for w in r["windows"] for t in r["oos"]["trades"] if w["test"][0] <= f"2026-01-{t[1] // 86400 + 1:02d}" <= w["test"][1])
assert all(w["of"] == 5 and w["rank"] == 1 for w in r["windows"]), "the pick tied the best cells on every window"
assert [c["params"]["fast"] >= 9 for c in r["cells"]] == [True, True, True, False, False], "winning cells ranked first"
assert sum(c["picked"] for c in r["cells"]) == r["stats"]["traded_windows"], "each traded window picked one cell"
assert all(set(c["params"]) == {"fast"} for c in r["cells"]), "cells carry only the swept params"
json_calls = [c for c in calls if "--json" in c]
assert all(any(a.startswith("--trade-from=") for a in c) for c in json_calls), "every OOS run is cut at the test start"
assert any("qty=2" in c for c in calls if "--sweep=grid" in c), "fixed params reach the sweep"

# compounding: tuning sweeps stay fixed-size; each traded window starts from its own account's P&L
# over the windows before it (tuned and baseline apart), so the stitched curve compounds end to end
calls.clear()
r = at.walk_forward(fake_engine, BARS, **kw, sizing=["sizing=1", "capital=100000"])
assert not any("sizing=1" in c for c in calls if "--sweep=grid" in c), "tuning and the hindsight grid are never sized"
json_calls = [c for c in calls if "--json" in c]
assert all("sizing=1" in c and "capital=100000" in c for c in json_calls), "every traded window is sized"
carry = [float(next(a for a in c if a.startswith("carry="))[6:]) for c in json_calls]
tuned_carry, base_carry = carry[0::2], carry[1::2]  # per window: the tuned run, then the baseline
assert tuned_carry == list(itertools.accumulate([0] + [w["oos"]["net"] for w in r["windows"][:-1]])), tuned_carry
assert base_carry == list(itertools.accumulate([0] + [w["baseline"]["net"] for w in r["windows"][:-1]])), base_carry
assert r["sizing"] == ["sizing=1", "capital=100000"] and at.walk_forward(fake_engine, BARS, **kw)["sizing"] is None

# nothing eligible (min_trades above what any cell has): every window sat out, flat and counted
r = at.walk_forward(fake_engine, BARS, **{**kw, "min_trades": 1000})
assert r["stats"]["sat_out"] == 4 and r["oos"]["summary"]["net"] == 0 and r["oos"]["summary"]["days"] == 20

# an engine built before --trade-from trades the warm-up: caught, not reported
try:
    at.walk_forward(lambda *a: fake_engine(*a, honour_from=False), BARS, **kw)
    raise AssertionError("an engine ignoring --trade-from must fail the walk")
except RuntimeError as e:
    assert "make" in str(e)

for bad in ({**kw, "params": {"fast": "9"}}, {**kw, "train": 40}):
    try:
        at.walk_forward(fake_engine, BARS, **bad)
        raise AssertionError(f"should refuse {bad}")
    except ValueError:
        pass

print("autotune selfcheck passed")

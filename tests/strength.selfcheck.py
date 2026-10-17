"""Self-check for app/core/strength.py. Pure: no network, no database.

    .venv/bin/python tests/strength.selfcheck.py
"""
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import strength as s

# split detection: a 2:1 split halves the close overnight; an ordinary 8% day doesn't count
assert s.split_gap([100, 101, 50.4, 51])
assert not s.split_gap([100, 108, 99, 102])
assert s.split_gap([100, 66.8]), "1:2 bonus (1.5x)"
assert not s.split_gap([100, 80, 64]), "20% lower circuits are trades, not a 1:4 bonus"
assert not s.split_gap([50, 100]), "a doubling is a move up, never a split"

# weighted return: the latest quarter counts 40%
flat_then_up = [100.0] * 200 + [100.0 + i for i in range(1, 64)]
assert s.weighted_return(flat_then_up) > s.weighted_return([100.0 + i * 0.25 for i in range(264)]) * 0  # sanity
assert abs(s.weighted_return([100.0] * 300)) < 1e-12

# ratings: 1..99, best gets 99, worst 1, order kept
r = s.percentile_ratings({"a": -0.2, "b": 0.1, "c": 0.5})
assert (r["a"], r["b"], r["c"]) == (1, 50, 99), r

# trend template on a steady uptrend: everything passes but RS when RS is low
up = [100 * 1.002**i for i in range(300)]
tt = s.trend_template(up, [c * 1.01 for c in up], [c * 0.99 for c in up], 80)
assert all(tt.values()), tt
assert s.trend_template(up, [c * 1.01 for c in up], [c * 0.99 for c in up], 40)["rs_70_plus"] is False

# VCP: three successively shallower pullbacks (20%, 10%, 5%) then a tight close near the pivot,
# with volume drying up at the end
path = []
for top, depth in ((100, 0.20), (100, 0.10), (100, 0.05)):
    path += [top * (1 - depth * k / 10) for k in range(11)] + [top * (1 - depth) + top * depth * k / 10 for k in range(1, 11)]
path += [99.0] * 8
highs = [p * 1.005 for p in [80.0] * 60 + path]
lows = [p * 0.995 for p in [80.0] * 60 + path]
closes = [80.0] * 60 + path
vols = [1000] * (len(closes) - 10) + [500] * 10
v = s.vcp(highs, lows, closes, vols)
assert len(v["contractions"]) >= 2 and v["contractions"] == sorted(v["contractions"], reverse=True), v
assert v["tightening"] and v["volume_dry"] and v["near_pivot"] and v["vcp"], v
# loud volume at the end: not drying up, not a VCP
assert not s.vcp(highs, lows, closes, [1000] * (len(closes) - 10) + [3000] * 10)["vcp"]

# sector index: cap-weighted, members missing a day sit it out
d0 = date(2026, 1, 1)
days = [d0 + timedelta(days=i) for i in range(3)]
idx = s.sector_index({"A": {days[0]: 100, days[1]: 110, days[2]: 110}, "B": {days[0]: 50, days[1]: 50}}, {"A": 3, "B": 1})
assert abs(idx[1][1] - 100 * (1 + 0.75 * 0.10)) < 1e-9, idx  # 3/4 weight on A's +10%

# RRG: a sector that keeps beating the benchmark ends up leading
dates = [d0 + timedelta(days=i) for i in range(60)]
bench = [(d, 100.0) for d in dates]
strong = [(d, 100 * 1.004**i) for i, d in enumerate(dates)]
pts = s.rrg(strong, bench)
assert pts and pts[-1]["ratio"] > 100, pts[-1]
# accelerating outperformance: the lead is growing, so momentum is above 100 too -> leading
accel = [(d, 100 * 1.0005 ** (i * i / 10)) for i, d in enumerate(dates)]
last = s.rrg(accel, bench)[-1]
assert s.quadrant(last["ratio"], last["momentum"]) == "leading", last
# a sector falling behind ends up lagging
weak = [(d, 100 * 0.996**i) for i, d in enumerate(dates)]
assert s.rrg(weak, bench)[-1]["ratio"] < 100
assert s.quadrant(101, 99) == "weakening" and s.quadrant(99, 101) == "improving"
assert s.rrg(strong[:5], bench) == [], "too short"

# corporate actions: subject lines -> price divisor, and back-adjustment across the ex-date
from app.core import bhavcopy as bc
assert bc.ca_factor("Bonus 1:4") == 1.25 and bc.ca_factor("Bonus 1:1") == 2
assert bc.ca_factor("Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share") == 5
assert bc.ca_factor("Fv Splt Frm Rs10 To Re1") == 10
assert bc.ca_factor("Dividend - Rs 5 Per Share") is None
rows = [(dates[0], 100, 100, 100, 100, 10), (dates[1], 50, 50, 50, 50, 20)]
adj = bc.adjust(rows, [(dates[1], 2.0)])
assert adj[0][4] == 50 and adj[0][5] == 20 and adj[1] == rows[1], adj
assert not s.split_gap([r[4] for r in adj])

print("ok - strength: corporate actions, split gaps, RS ratings, trend template, VCP, sector index, RRG")

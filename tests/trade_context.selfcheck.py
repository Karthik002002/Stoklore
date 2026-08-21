"""Self-check for trade_context's math and its degradation paths. Plain asserts, no framework:

    .venv/bin/python tests/trade_context.selfcheck.py

The degradation cases matter as much as the arithmetic here: a half-filled snapshot that reads
like a real one is worse than no snapshot, because it silently pollutes the very analysis this
feature exists to support.
"""
import sys
from pathlib import Path

# Run as a script, so the repo root has to go on sys.path before importing app.* - the package
# is not installed, it just sits at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import trade_context as tc


def bar(date, o, h, l, c, v=1000):
    return {"date": date, "open": o, "high": h, "low": l, "close": c, "volume": v}


def flat_bars(n, price=100.0, spread=1.0, volume=1000):
    """n identical bars - ATR is exactly `spread`, both EMAs sit exactly on `price`."""
    return [bar(f"2026-01-{i + 1:02d}", price, price + spread, price - spread, price, volume) for i in range(n)]


# --- ATR ---------------------------------------------------------------------------------------
# On a series with no gaps, true range is high-low every bar, so Wilder's ATR converges to it
# exactly and stays there.
atr = tc._atr([101] * 50, [99] * 50, [100] * 50)
assert abs(float(atr.iloc[-1]) - 2.0) < 1e-9, float(atr.iloc[-1])

# A gap must widen ATR beyond the bar's own range: yesterday closed at 100, today trades 110-112,
# so the true range is 12 (high vs prev close), not 2.
gapped = tc._atr([101] * 20 + [112], [99] * 20 + [110], [100] * 20 + [111])
assert float(gapped.iloc[-1]) > 2.0, float(gapped.iloc[-1])

# --- percentile rank ----------------------------------------------------------------------------
assert tc._percentile_rank([1, 2, 3, 4], 0) == 0.0
assert tc._percentile_rank([1, 2, 3, 4], 5) == 100.0
assert tc._percentile_rank([1, 2, 3, 4], 3) == 50.0
assert tc._percentile_rank([], 1) is None

# --- volume spike ------------------------------------------------------------------------------
# A flat tape has no spike: every bar is exactly its own baseline.
flat = tc.volume_spike(flat_bars(60))
assert flat["max_ratio"] == 1.0 and flat["count"] == 0, flat

# One 3x bar, three bars before entry.
spiky = flat_bars(60)
spiky[-3]["volume"] = 3000
hit = tc.volume_spike(spiky)
assert hit["max_ratio"] == 3.0 and hit["bars_ago"] == 3 and hit["count"] == 1, hit
assert hit["multiple"] == 2.0 and hit["lookback"] == 10, "the config used must be stored"

# The account's config is what decides, not the module default.
assert tc.volume_spike(spiky, multiple=4)["count"] == 0, "a 3x bar is no spike at a 4x threshold"
assert tc.volume_spike(spiky, lookback=2)["count"] == 0, "a bar outside the window must not count"
assert tc.volume_spike(spiky, lookback=2)["bars_ago"] == 1, "the window's own loudest bar instead"

# The baseline rolls: a spike can't be measured against itself, so two adjacent 3x bars both clear.
twin = flat_bars(60)
twin[-2]["volume"] = twin[-1]["volume"] = 3000
assert tc.volume_spike(twin)["count"] == 2, tc.volume_spike(twin)

# Not computable without a full baseline behind at least one candidate bar.
assert tc.volume_spike(flat_bars(20)) == {}, "20 bars leaves no candidate with 20 behind it"
assert tc.volume_spike(flat_bars(21))["bars_ago"] == 1
assert tc.volume_spike([]) == {}
assert tc.volume_spike(flat_bars(60, volume=0)) == {}, "zero-volume history must not divide"

# It rides the snapshot, carrying the config it was computed with.
ctx_spike = tc.compute(spiky, None, "long", 100.0, spike_multiple=2.5, spike_lookback=5)
assert ctx_spike["vol_spike"]["multiple"] == 2.5 and ctx_spike["vol_spike"]["count"] == 1
# ...and is absent, not zeroed, when the history is too thin to read.
assert "vol_spike" not in tc.entry_context(flat_bars(10), "long", 100)

# --- entry context: degradation comes first, it's the part that silently lies ------------------
assert tc.entry_context([], "long", 100) is None
assert tc.compute([], None, "long", 100) is None, "no bars must be NULL, not an empty dict"

short_sample = tc.entry_context(flat_bars(10), "long", 100)
assert short_sample == {"bars_used": 10, "context_insufficient": True}, short_sample
# The whole point: nothing that looks like a real reading leaks through on a thin sample.
for key in ("trend", "vol_regime", "extension_atr", "range_pos"):
    assert key not in short_sample, key

# Exactly at the threshold it becomes a real snapshot.
assert "context_insufficient" not in tc.entry_context(flat_bars(tc.MIN_BARS), "long", 100)

# --- entry context: values ----------------------------------------------------------------------
ctx = tc.entry_context(flat_bars(100), "long", 100.0)
assert ctx["bars_used"] == 100
assert ctx["atr"] == 2.0, ctx["atr"]
assert ctx["atr_pct"] == 2.0, ctx["atr_pct"]  # 2.0 / 100 * 100
assert ctx["extension_atr"] == 0.0, ctx["extension_atr"]  # entered exactly at the EMA
assert ctx["extended"] is False
assert ctx["range_pos"] == 0.5, ctx["range_pos"]  # dead centre of a flat range
assert ctx["vol_ratio"] == 1.0, ctx["vol_ratio"]

# Entering 6 above a 100 EMA with ATR 2 = 3 ATRs extended, and that is "extended".
ext = tc.entry_context(flat_bars(100), "long", 106.0)
assert ext["extension_atr"] == 3.0, ext["extension_atr"]
assert ext["extended"] is True

# Direction flips the sign: the SAME entry, 6 above the mean, is 3 ATRs *early* for a short.
ext_short = tc.entry_context(flat_bars(100), "short", 106.0)
assert ext_short["extension_atr"] == -3.0, ext_short["extension_atr"]
assert ext_short["extended"] is False

# range_pos is direction-relative too: at the top of the range it's 1 for a long, 0 for a short.
# The range here runs low=99 to high=200, so entering at 200 is exactly the high.
rising = [bar(f"2026-03-{i + 1:02d}", 100 + i, 101 + i, 99 + i, 100 + i) for i in range(100)]
assert tc.entry_context(rising, "long", 200.0)["range_pos"] == 1.0
assert tc.entry_context(rising, "short", 200.0)["range_pos"] == 0.0
for d in ("long", "short"):
    pos = tc.entry_context(rising, d, 150.0)["range_pos"]
    assert 0.0 <= pos <= 1.0, pos
# Outside the prior range it is deliberately NOT clamped - >1 for a long is a breakout entry, and
# clamping would make it indistinguishable from simply entering at the range high.
assert tc.entry_context(rising, "long", 250.0)["range_pos"] > 1.0
assert tc.entry_context(rising, "short", 250.0)["range_pos"] < 0.0

# Trend, and whether the trade sided with it.
assert tc.entry_context(rising, "long", 200.0)["trend"] == "up"
assert tc.entry_context(rising, "long", 200.0)["with_trend"] is True
assert tc.entry_context(rising, "short", 200.0)["with_trend"] is False
falling = list(reversed(rising))
assert tc.entry_context(falling, "long", 100.0)["trend"] == "down"
assert tc.entry_context(falling, "short", 100.0)["with_trend"] is True

# Volatility regime: a quiet stretch ending in one violent bar must read "high".
quiet = flat_bars(99, spread=0.5)
quiet.append(bar("2026-02-01", 100, 130, 70, 100))
assert tc.entry_context(quiet, "long", 100.0)["vol_regime"] == "high"

# --- MAE / MFE ------------------------------------------------------------------------------------
held = [bar("2026-04-01", 100, 104, 96, 102), bar("2026-04-02", 102, 110, 101, 108)]

long_x = tc.excursion(held, "long", 100.0)
assert long_x["mae_pct"] == 4.0, long_x  # dipped to 96
assert long_x["mfe_pct"] == 10.0, long_x  # ran to 110
assert long_x["excursion_bars"] == 2

# A short in the same window has adverse and favourable exactly swapped.
short_x = tc.excursion(held, "short", 100.0)
assert short_x["mae_pct"] == 10.0, short_x
assert short_x["mfe_pct"] == 4.0, short_x

# R units: a 2-point stop makes the 4-point drawdown 2R of heat.
with_stop = tc.excursion(held, "long", 100.0, stop_loss=98.0)
assert with_stop["mae_r"] == 2.0, with_stop
assert with_stop["mfe_r"] == 5.0, with_stop
# No stop set, no R - a percentage isn't comparable across symbols, so it isn't faked.
assert "mae_r" not in tc.excursion(held, "long", 100.0)
assert "mae_r" not in tc.excursion(held, "long", 100.0, stop_loss=100.0), "zero risk must not divide"

# Never negative: a trade that gapped straight up never went against you.
gap_up = [bar("2026-04-01", 105, 112, 104, 110)]
assert tc.excursion(gap_up, "long", 100.0)["mae_pct"] == 0.0
assert tc.excursion([], "long", 100.0) == {}

# --- compute(): the two halves, and the absent-not-zero rule --------------------------------------
full = tc.compute(flat_bars(100), held, "long", 100.0, stop_loss=98.0, source="price_history_max")
assert full["source"] == "price_history_max"
assert full["trend"] == "chop" and full["mae_pct"] == 4.0

no_exit = tc.compute(flat_bars(100), None, "long", 100.0, stop_loss=98.0)
assert no_exit["trend"] == "chop", "entry context must still be stored without an exit"
# The critical one: an unknown holding window leaves the keys OUT. A 0.0 would read as "never went
# against me", which is a real and very different finding.
for key in ("mae_pct", "mfe_pct", "mae_r", "mfe_r"):
    assert key not in no_exit, key

# Thin pre-entry history plus a known exit: the entry-context keys stay out, but MAE/MFE is still
# recorded. It's computed from the holding bars alone, so a short lookback says nothing about it -
# hence the flag names the context, not the whole snapshot.
thin = tc.compute(flat_bars(5), held, "long", 100.0)
assert thin["context_insufficient"] is True and thin["bars_used"] == 5, thin
assert thin["mae_pct"] == 4.0 and thin["mfe_pct"] == 10.0, thin
for key in ("trend", "vol_regime", "extension_atr", "range_pos"):
    assert key not in thin, key

print("ok - trade_context: ATR, percentile, entry context, volume spike, direction flips, MAE/MFE, degradation")

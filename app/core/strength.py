"""Relative strength, trend template, base (VCP) detection and sector rotation, computed from the
bhavcopy cache (bhavcopy.py). Pure functions over plain lists - no network, no database - checked by
tests/strength.selfcheck.py.

Everything here REPORTS objective conditions (a percentile, a pass/fail checklist, a measured
contraction); none of it is a buy signal. The trader reads the chart.

Conventions: bars are (date, open, high, low, close, volume) tuples, ascending. One trading day = one
bar; a year is 252 bars.
"""
import math
from statistics import mean

YEAR = 252
# RS rating lookbacks (bars) and weights - the newest quarter counts double, as in IBD's rating.
RS_WINDOWS = ((63, 0.4), (126, 0.2), (189, 0.2), (252, 0.2))
MIN_BARS = 200  # fewer than this and a stock isn't rated (a recent listing)
# An overnight FALL of exactly one of these ratios is a split or bonus, not a trade. 1:4 and 1:3 bonuses
# (1.25x, 1.33x) are left out on purpose: a 20% lower circuit looks just like them, and wrongly dropping
# a genuine faller is worse than the rare bonus slipping through.
SPLIT_RATIOS = (1.5, 2, 3, 4, 5, 10)
SPLIT_TOLERANCE = 0.04


def _sma(xs, n):
    return mean(xs[-n:]) if len(xs) >= n else None


def split_gap(closes):
    """True when the series contains a close-to-close jump matching a split/bonus ratio (price
    unadjusted in the bhavcopy) - such a stock's returns and 52-week high would be fiction."""
    for a, b in zip(closes, closes[1:]):
        if not a or not b or b >= a:
            continue  # only a fall can be a split/bonus
        ratio = a / b
        if ratio < 1.4:
            continue
        if any(abs(ratio - r) / r <= SPLIT_TOLERANCE for r in SPLIT_RATIOS):
            return True
    return False


def weighted_return(closes):
    """IBD-style performance score: returns over 3/6/9/12 months, the latest quarter weighted 40%.
    A window longer than the history uses the oldest bar there is."""
    last = closes[-1]
    score = 0.0
    for n, w in RS_WINDOWS:
        base = closes[-n - 1] if len(closes) > n else closes[0]
        score += w * (last / base - 1)
    return score


def percentile_ratings(scores):
    """{key: score} -> {key: 1..99}, the share of the universe each one beats."""
    ranked = sorted(scores.items(), key=lambda kv: kv[1])
    n = len(ranked)
    if n == 1:
        return {ranked[0][0]: 99}
    return {k: max(1, min(99, round(1 + 98 * i / (n - 1)))) for i, (k, _) in enumerate(ranked)}


def trend_template(closes, highs, lows, rs_rating):
    """Minervini's 8 trend-template checks, each True/False/None (None = not enough history)."""
    c = closes[-1]
    s50, s150, s200 = _sma(closes, 50), _sma(closes, 150), _sma(closes, 200)
    s200_month_ago = mean(closes[-221:-21]) if len(closes) >= 221 else None
    hi52, lo52 = max(highs[-YEAR:]), min(lows[-YEAR:])
    known = lambda *v: all(x is not None for x in v)  # noqa: E731
    return {
        "above_150_200": (c > s150 and c > s200) if known(s150, s200) else None,
        "150_above_200": (s150 > s200) if known(s150, s200) else None,
        "200_rising": (s200 > s200_month_ago) if known(s200, s200_month_ago) else None,
        "50_above_150_200": (s50 > s150 and s50 > s200) if known(s50, s150, s200) else None,
        "above_50": (c > s50) if known(s50) else None,
        "30pct_above_low": c >= 1.3 * lo52,
        "within_25pct_of_high": c >= 0.75 * hi52,
        "rs_70_plus": (rs_rating >= 70) if rs_rating is not None else None,
    }


def swings(highs, lows, threshold=0.03):
    """Zigzag pivots [(index, 'H'|'L', price)] - a turn counts once price reverses `threshold` (3%)
    from the running extreme."""
    pivots = []
    direction = None
    ext_i, ext_p = 0, highs[0]
    for i in range(1, len(highs)):
        if direction in (None, "up"):
            if highs[i] >= ext_p:
                ext_i, ext_p = i, highs[i]
            elif lows[i] <= ext_p * (1 - threshold):
                pivots.append((ext_i, "H", ext_p))
                direction, ext_i, ext_p = "down", i, lows[i]
        if direction == "down":
            if lows[i] <= ext_p:
                ext_i, ext_p = i, lows[i]
            elif highs[i] >= ext_p * (1 + threshold):
                pivots.append((ext_i, "L", ext_p))
                direction, ext_i, ext_p = "up", i, highs[i]
    return pivots


def contractions(highs, lows, lookback=120):
    """The pullbacks of the base formed in the last `lookback` bars: [(depth%, peak index, peak price)]
    for each high-to-next-low drop, oldest first."""
    h, low = highs[-lookback:], lows[-lookback:]
    piv = swings(h, low)
    out = []
    for (i, kind, p), (_, kind2, p2) in zip(piv, piv[1:]):
        if kind == "H" and kind2 == "L":
            out.append((round((p - p2) / p * 100, 2), len(highs) - len(h) + i, p))
    return out


def vcp(highs, lows, closes, volumes):
    """Volatility-contraction read: the last 2-4 pullbacks each shallower than the one before, the
    last one tight (<= 12%), volume drying up (10-day average <= 75% of the 50-day), and price within
    5% under the pivot (the last contraction's high) or up to 3% through it."""
    cs = contractions(highs, lows)
    tail = cs[-4:]
    # the run of successively shallower pullbacks ending at the latest one
    run = [tail[-1]] if tail else []
    for prev in reversed(tail[:-1]):
        if prev[0] > run[0][0]:
            run.insert(0, prev)
        else:
            break
    vol_ratio = (mean(volumes[-10:]) / mean(volumes[-50:])) if len(volumes) >= 50 and mean(volumes[-50:]) else None
    pivot = run[-1][2] if run else None
    dist = (closes[-1] / pivot - 1) * 100 if pivot else None
    tightening = len(run) >= 2 and run[-1][0] <= 12
    dry = vol_ratio is not None and vol_ratio <= 0.75
    near = dist is not None and -5 <= dist <= 3
    return {
        "contractions": [c[0] for c in run],
        "pivot": round(pivot, 2) if pivot else None,
        "to_pivot_pct": round(dist, 2) if dist is not None else None,
        "vol_ratio": round(vol_ratio, 2) if vol_ratio is not None else None,
        "tightening": tightening,
        "volume_dry": dry,
        "near_pivot": near,
        "vcp": tightening and dry and near,
    }


# --- money flow ---------------------------------------------------------------------------------
# A bar can't say who bought - every trade has both sides. What it can say is where the day closed in
# its range: near the high on heavy volume, buyers were pushing; near the low, sellers. These weigh
# volume (or turnover) by that close location.


def close_location(h, low, c):
    """-1 (closed on the low) .. +1 (closed on the high); 0 for a bar with no range."""
    return ((c - low) - (h - c)) / (h - low) if h > low else 0.0


def cmf(highs, lows, closes, volumes, n=21):
    """Chaikin Money Flow over `n` bars: volume-weighted close location, -1..+1. Above ~0.1 is
    steady accumulation, below ~-0.1 distribution."""
    if len(closes) < n:
        return None
    v = sum(volumes[-n:])
    if not v:
        return None
    return sum(close_location(h, lo, c) * vol for h, lo, c, vol in
               zip(highs[-n:], lows[-n:], closes[-n:], volumes[-n:])) / v


def up_down_volume(closes, volumes, n=50):
    """Volume on up days / volume on down days over `n` bars. Above 1 = demand outweighs supply."""
    if len(closes) < n + 1:
        return None
    up = down = 0
    for i in range(len(closes) - n, len(closes)):
        if closes[i] > closes[i - 1]:
            up += volumes[i]
        elif closes[i] < closes[i - 1]:
            down += volumes[i]
    return up / down if down else None


def daily_flow(rows):
    """{date: net ₹ flow} for one stock: each day's turnover (typical price x volume) signed by its
    close location. Rows are (date, o, h, l, c, v)."""
    return {r[0]: close_location(r[2], r[3], r[4]) * (r[2] + r[3] + r[4]) / 3 * r[5] for r in rows}


def stock_table(bars, nifty_closes=None, min_bars=MIN_BARS):
    """Every stock with enough clean history: RS rating, returns, 52-week position, trend template
    and VCP read. `bars` = {symbol: [(date, o, h, l, c, v), ...]}. Stocks with a split-like gap in the
    window are left out (listed under `skipped`)."""
    usable, skipped = {}, []
    for sym, rows in bars.items():
        rows = rows[-(YEAR + 40):]
        if len(rows) < min_bars:
            continue
        closes = [r[4] for r in rows]
        if split_gap(closes):
            skipped.append(sym)
            continue
        usable[sym] = rows
    scores = {s: weighted_return([r[4] for r in rows]) for s, rows in usable.items()}
    ratings = percentile_ratings(scores) if scores else {}
    n_ret = lambda xs, n: (xs[-1] / (xs[-n - 1] if len(xs) > n else xs[0]) - 1) * 100  # noqa: E731
    nifty6 = n_ret(nifty_closes, 126) if nifty_closes and len(nifty_closes) > 2 else None
    out = []
    for sym, rows in usable.items():
        closes, highs, lows, vols = ([r[k] for r in rows] for k in (4, 2, 3, 5))
        hi52 = max(highs[-YEAR:])
        tt = trend_template(closes, highs, lows, ratings[sym])
        r6 = n_ret(closes, 126)
        out.append({
            "symbol": sym,
            "close": closes[-1],
            "rs": ratings[sym],
            "r1m": round(n_ret(closes, 21), 2),
            "r3m": round(n_ret(closes, 63), 2),
            "r6m": round(r6, 2),
            "r12m": round(n_ret(closes, 252), 2),
            "vs_nifty_6m": round(r6 - nifty6, 2) if nifty6 is not None else None,
            "high_52w": hi52,
            "from_high_pct": round((closes[-1] / hi52 - 1) * 100, 2),
            "template": tt,
            "template_score": sum(1 for v in tt.values() if v),
            "avg_value_cr": round(mean(c * v for c, v in zip(closes[-20:], vols[-20:])) / 1e7, 2),
            "cmf": _r(cmf(highs, lows, closes, vols), 3),
            "ud_ratio": _r(up_down_volume(closes, vols), 2),
            **vcp(highs, lows, closes, vols),
        })
    out.sort(key=lambda r: -r["rs"])
    return {"stocks": out, "skipped": sorted(skipped)}


# --- sector rotation ----------------------------------------------------------------------------


def sector_index(member_bars, weights):
    """A sector's daily level from its members: each day the cap-weighted average of the members'
    returns that day, compounded from 100. `member_bars` = {symbol: {date: close}}; a member missing a
    day just sits that day out."""
    days = sorted({d for closes in member_bars.values() for d in closes})
    level, out, prev = 100.0, [], {}
    for d in days:
        num = den = 0.0
        for s, closes in member_bars.items():
            c = closes.get(d)
            p = prev.get(s)
            if c and p:
                w = weights.get(s, 1.0)
                num += w * (c / p - 1)
                den += w
            if c:
                prev[s] = c
        if den:
            level *= 1 + num / den
        out.append((d, level))
    return out


def rrg(series, bench, window=10, momentum=5, tail=8):
    """Relative Rotation Graph coordinates - an open approximation of JdK RS-Ratio / RS-Momentum, whose
    exact formula is proprietary:
      RS          = sector / benchmark
      RS-Ratio    = 100 * RS / its `window`-bar average      (above 100 = outperforming its trend)
      RS-Momentum = 100 * RS-Ratio / RS-Ratio `momentum` bars ago (above 100 = the lead is growing)
    Both inputs are [(date, level)]. Returns the last `tail` points, oldest first."""
    b = dict(bench)
    pts = [(d, v / b[d]) for d, v in series if b.get(d)]
    if len(pts) < window + momentum + 1:
        return []
    rs = [p[1] for p in pts]
    ratio = [100 * rs[i] / mean(rs[max(0, i - window + 1): i + 1]) for i in range(len(rs))]
    out = []
    for i in range(max(window + momentum, len(pts) - tail), len(pts)):
        mom = 100 * ratio[i] / ratio[i - momentum]
        out.append({"date": str(pts[i][0]), "ratio": round(ratio[i], 3), "momentum": round(mom, 3)})
    return out


def quadrant(ratio, momentum):
    if ratio >= 100:
        return "leading" if momentum >= 100 else "weakening"
    return "improving" if momentum >= 100 else "lagging"


def weekly(series):
    """[(date, level)] daily -> the last level of each ISO week."""
    out = {}
    for d, v in series:
        y, w, _ = d.isocalendar()
        out[(y, w)] = (d, v)
    return [out[k] for k in sorted(out)]


def _r(x, n):
    return None if x is None else round(x, n)


def safe(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else x

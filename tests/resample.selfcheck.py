"""prices.resample: daily candles -> TradingView-style 1W / 1M. Run: python tests/resample.selfcheck.py"""
from datetime import datetime, timezone

from app.core import prices


def bar(day, o, h, low, c, v, ist_midnight=False):
    # Yahoo stamps a session at 00:00 UTC, price_history at IST midnight (18:30 UTC the day before)
    t = int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())
    return {"time": t - 19800 if ist_midnight else t, "open": o, "high": h, "low": low, "close": c, "volume": v}


days = {"bars": [
    bar("2026-09-29", 10, 12, 9, 11, 100),  # Tue - week 40, September
    bar("2026-09-30", 11, 13, 10, 12, 100),  # Wed - week 40, September
    bar("2026-10-01", 12, 15, 8, 14, 100, ist_midnight=True),  # Thu - week 40, October
    bar("2026-10-05", 14, 14, 13, 13, 50),  # Mon - week 41, October
], "interval": "1d", "visibleFrom": None}

w = prices.resample(days, "W")
assert w["interval"] == "1wk" and len(w["bars"]) == 2, w
assert {k: w["bars"][0][k] for k in ("open", "high", "low", "close", "volume")} == \
    {"open": 10, "high": 15, "low": 8, "close": 14, "volume": 300}, w["bars"][0]
assert w["bars"][0]["time"] == days["bars"][0]["time"], "stamped with the bucket's first session"

m = prices.resample(days, "M")
assert m["interval"] == "1mo" and [b["close"] for b in m["bars"]] == [12, 13], m
assert m["bars"][1]["open"] == 12 and m["bars"][1]["high"] == 15, "IST-midnight stamp lands on Oct 1"
assert days["bars"][0]["volume"] == 100, "input bars aren't mutated"
assert prices.resample({"bars": []}, "W")["bars"] == []
print("PASSED: resample selfcheck")

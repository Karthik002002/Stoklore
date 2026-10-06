"""Self-check for the daily chart top-up (prices.merge_recent_daily). Pure: no DB, no network.

    .venv/bin/python tests/chart_topup.selfcheck.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timedelta, timezone

from app.core.prices import merge_recent_daily

IST = timezone(timedelta(hours=5, minutes=30))


def utc_midnight(d):  # Yahoo / moneycontrol: a session stamped 00:00 UTC
    return int(datetime(2026, 10, d, tzinfo=timezone.utc).timestamp())


def ist_midnight(d):  # price_history: a session stamped at IST midnight (18:30 UTC the day before)
    return int(datetime(2026, 10, d, tzinfo=IST).timestamp())


def bar(t, close):
    return {"time": t, "open": close, "high": close, "low": close, "close": close, "volume": 1}


yahoo = [bar(utc_midnight(1), 99.06)]
mc = [bar(utc_midnight(1), 99.06), bar(utc_midnight(5), 114.5)]

# the missing session is appended (SMCGLOBAL: Yahoo stopped at 1 Oct, 5 Oct had traded)
out = merge_recent_daily(yahoo, mc)
assert [b["close"] for b in out] == [99.06, 114.5], out
assert out[-1]["time"] == utc_midnight(5)

# the last session is replaced by the later print (a mid-session partial bar)
assert merge_recent_daily([bar(utc_midnight(5), 110)], [bar(utc_midnight(5), 114.5)])[-1]["close"] == 114.5

# older sessions are never touched, even if the fresh feed disagrees about them
hist = [bar(utc_midnight(1), 99.06), bar(utc_midnight(5), 114.5)]
assert merge_recent_daily(hist, [bar(utc_midnight(1), 1.0)]) == hist

# a price_history chart keeps its own clock: the new bar is stamped at IST midnight too, so it is
# one session later than the last one, not a second bar on the same day
db = [bar(ist_midnight(1), 99.06)]
out = merge_recent_daily(db, mc)
assert [b["time"] for b in out] == [ist_midnight(1), ist_midnight(5)], out

# nothing to merge, or nothing to merge into
assert merge_recent_daily(yahoo, []) == yahoo
assert merge_recent_daily([], mc) == []
assert yahoo == [bar(utc_midnight(1), 99.06)], "input not mutated"

print("ok - chart top-up: appends missing sessions, refreshes the last, keeps older bars and the clock")

"""When a workflow is due, and whether it tells you. Plain asserts, no database, no network:

    .venv/bin/python tests/workflow_triggers.selfcheck.py

Every function checked here takes `now` and a holiday set as arguments, which is what lets the whole
calendar - month ends, holidays, windows, catch-up after downtime - be pinned without a clock.
"""
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import IST  # noqa: E402
from app.services import workflow_notify as wn  # noqa: E402
from app.services import workflow_triggers as wt  # noqa: E402


def at(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IST)


# 2026-09-18 is a Friday.
FRI = at(2026, 9, 18, 10, 0)

# --- validation -----------------------------------------------------------------------------------
assert wt.validate({"kind": "schedule", "time": "09:15"}) is None
assert wt.validate({"kind": "nope"})
assert wt.validate({"kind": "interval", "every": 0, "unit": "minutes"}), "every 0 is not a loop"
assert wt.validate({"kind": "interval", "every": 5, "unit": "days"}), "only minutes or hours"
assert wt.validate({"kind": "interval", "every": 5, "unit": "minutes", "window": {"start": "15:30", "end": "09:15"}})
assert wt.validate({"kind": "weekly", "days": [], "time": "08:30"}), "a week with no days"
assert wt.validate({"kind": "monthly", "day": 32, "time": "10:00"})
assert wt.validate({"kind": "monthly", "day": "last", "time": "10:00"}) is None
assert wt.validate({"kind": "cron", "expr": "every tuesday"}), "cron is checked at save time"
assert wt.validate({"kind": "cron", "expr": "*/15 9-15 * * 1-5"}) is None
assert wt.validate({"kind": "workflow_done", "on": "success"}), "a chain needs its upstream"
assert wt.validate({"kind": "order_event", "events": ["exploded"]})
assert wt.validate({"kind": "schedule", "time": "9am"}), "a time is HH:MM"

# --- daily ----------------------------------------------------------------------------------------
daily = {"kind": "schedule", "time": "09:15"}
assert wt.next_run(daily, at(2026, 9, 18, 9, 0)) == at(2026, 9, 18, 9, 15)
assert wt.next_run(daily, at(2026, 9, 18, 9, 15)) == at(2026, 9, 19, 9, 15), "strictly after"

# --- interval, with a window ----------------------------------------------------------------------
loop = {"kind": "interval", "every": 15, "unit": "minutes", "window": {"start": "09:15", "end": "15:30"}}
assert wt.next_run(loop, at(2026, 9, 18, 10, 0)) == at(2026, 9, 18, 10, 15)
assert wt.next_run(loop, at(2026, 9, 18, 8, 0)) == at(2026, 9, 18, 9, 15), "before the window -> its start"
assert wt.next_run(loop, at(2026, 9, 18, 15, 20)) == at(2026, 9, 19, 9, 15), "past the end -> tomorrow"
hourly = {"kind": "interval", "every": 2, "unit": "hours"}
assert wt.next_run(hourly, at(2026, 9, 18, 23, 0)) == at(2026, 9, 19, 1, 0), "no window crosses midnight"

# An interval that never ran is due at once - but only inside its window.
assert wt.is_due({"enabled": True, "trigger": loop}, at(2026, 9, 18, 11, 0))
assert not wt.is_due({"enabled": True, "trigger": loop}, at(2026, 9, 18, 20, 0))

# --- trading days ---------------------------------------------------------------------------------
HOLIDAYS = frozenset({date(2026, 9, 21)})  # pretend Monday is a holiday
guarded = {**loop, "trading_days_only": True}
assert wt.next_run(guarded, at(2026, 9, 18, 15, 20), HOLIDAYS) == at(2026, 9, 22, 9, 15), \
    "Fri close -> skips Sat, Sun and the Monday holiday"
assert wt.next_run({**daily, "trading_days_only": True}, at(2026, 9, 19, 12, 0), HOLIDAYS) == at(2026, 9, 22, 9, 15)
assert wt.next_run(daily, at(2026, 9, 19, 12, 0), HOLIDAYS) == at(2026, 9, 20, 9, 15), "unguarded runs on Sunday"

market = {"kind": "market", "anchor": "open", "offset": 10}
assert wt.next_run(market, at(2026, 9, 18, 9, 0)) == at(2026, 9, 18, 9, 25)
assert wt.next_run(market, at(2026, 9, 18, 10, 0), HOLIDAYS) == at(2026, 9, 22, 9, 25), "always trading days"
assert wt.next_run({"kind": "market", "anchor": "close", "offset": -5}, FRI) == at(2026, 9, 18, 15, 25)

# --- weekly ---------------------------------------------------------------------------------------
weekly = {"kind": "weekly", "days": [0, 3], "time": "08:30"}  # Mon, Thu
assert wt.next_run(weekly, FRI) == at(2026, 9, 21, 8, 30)
assert wt.next_run(weekly, at(2026, 9, 17, 8, 0)) == at(2026, 9, 17, 8, 30), "later the same day"

# --- monthly --------------------------------------------------------------------------------------
monthly = {"kind": "monthly", "day": 20, "time": "10:00"}
assert wt.next_run(monthly, FRI) == at(2026, 9, 20, 10, 0)
assert wt.next_run(monthly, at(2026, 9, 20, 10, 0)) == at(2026, 10, 20, 10, 0)
assert wt.next_run({"kind": "monthly", "day": 31, "time": "10:00"}, at(2026, 2, 1)) == at(2026, 2, 28, 10, 0), \
    "the 31st in February is its last day"
assert wt.next_run({"kind": "monthly", "day": "last", "time": "10:00"}, at(2026, 12, 31, 11)) == at(2027, 1, 31, 10, 0), \
    "rolls the year"

# --- cron -----------------------------------------------------------------------------------------
cron = {"kind": "cron", "expr": "*/15 9-15 * * 1-5"}
assert wt.next_run(cron, at(2026, 9, 18, 15, 50)) == at(2026, 9, 21, 9, 0)
assert wt.next_run({**cron, "trading_days_only": True}, at(2026, 9, 18, 15, 50), HOLIDAYS) == at(2026, 9, 22, 9, 0)

# --- catch-up, never pile-up ----------------------------------------------------------------------
# Last ran Monday 09:15; the machine slept until Thursday noon. Due - once.
slept = {"enabled": True, "trigger": daily, "last_triggered_at": at(2026, 9, 14, 9, 15)}
assert wt.is_due(slept, at(2026, 9, 17, 12, 0))
ran_now = {**slept, "last_triggered_at": at(2026, 9, 17, 12, 0)}
assert not wt.is_due(ran_now, at(2026, 9, 17, 12, 1)), "running it once clears every missed slot"
assert wt.next_run_at(ran_now, at(2026, 9, 17, 12, 1)) == at(2026, 9, 18, 9, 15)

# A row from before last_triggered_at existed only knows the date it ran.
legacy = {"enabled": True, "trigger": daily, "last_run_date": date(2026, 9, 18)}
assert not wt.is_due(legacy, at(2026, 9, 18, 16, 0)), "already ran today"
assert wt.is_due(legacy, at(2026, 9, 19, 9, 16))

# Armed after today's slot: runs today (what the old daily schedule did), never backfills older ones.
fresh_monthly = {"enabled": True, "trigger": {"kind": "monthly", "day": 1, "time": "10:00"}}
assert not wt.is_due(fresh_monthly, FRI), "the 1st of this month is not owed"
assert wt.is_due({"enabled": True, "trigger": daily}, FRI)

assert wt.next_run_at({"enabled": False, "trigger": daily}, FRI) is None, "disarmed has no next run"
assert [r.day for r in wt.upcoming(weekly, FRI, 3)] == [21, 24, 28]

# --- events ---------------------------------------------------------------------------------------
assert wt.matches_event({"kind": "price_alert"}, "price_alert", {"alert_id": 4, "symbol": "TCS"}), "empty = any"
assert not wt.matches_event({"kind": "price_alert", "symbols": ["INFY"]}, "price_alert", {"symbol": "TCS"})
assert wt.matches_event({"kind": "price_alert", "alert_ids": [4]}, "price_alert", {"alert_id": 4})
assert not wt.matches_event({"kind": "order_event", "events": ["filled"]}, "order_event", {"event": "rejected"})
chain = {"kind": "workflow_done", "workflow_id": "a", "on": "failure"}
assert wt.matches_event(chain, "workflow_done", {"workflow_id": "a", "status": "failed"})
assert not wt.matches_event(chain, "workflow_done", {"workflow_id": "a", "status": "done"})
assert not wt.matches_event(chain, "workflow_done", {"workflow_id": "b", "status": "failed"})
assert not wt.matches_event(daily, "price_alert", {}), "a schedule never answers an event"

# --- labels ---------------------------------------------------------------------------------------
assert wt.label(guarded) == "Every 15 min, 09:15–15:30 · trading days"
assert wt.label(weekly) == "Mon, Thu at 08:30 IST"
assert wt.label({"kind": "monthly", "day": 22, "time": "10:00"}) == "The 22nd of each month at 10:00 IST"
assert wt.label(chain, {"a": "Morning movers"}) == "After 'Morning movers' fails"

# --- notification rules ---------------------------------------------------------------------------
noon = at(2026, 9, 18, 12, 0)
assert wn.decide({}, "failure", noon) == ("deliver", None)
assert wn.decide({}, "success", noon)[0] == "skip", "success is only news if asked for"
assert wn.decide({"on_output": False}, "output", noon)[0] == "silent", "kept, not delivered"
assert wn.decide({"muted": True}, "failure", noon)[0] == "silent"
assert wn.decide({"snooze_until": (noon + timedelta(hours=1)).isoformat()}, "failure", noon)[0] == "silent"
assert wn.decide({"snooze_until": (noon - timedelta(hours=1)).isoformat()}, "failure", noon)[0] == "deliver"
night = {"quiet_start": "22:00", "quiet_end": "07:00"}
assert wn.decide(night, "output", at(2026, 9, 18, 23, 30)) == ("hold", at(2026, 9, 19, 7, 0)), "wraps midnight"
assert wn.decide(night, "output", at(2026, 9, 18, 6, 0)) == ("hold", at(2026, 9, 18, 7, 0))
assert wn.decide(night, "output", noon)[0] == "deliver"
assert wn.validate({"quiet_start": "22:00"})[1], "half a quiet window"
assert wn.validate({"bogus": 1, "muted": True})[0] == {**wn.DEFAULT_NOTIFY, "muted": True}, "unknown keys dropped"

print("ok - workflow triggers: validate, daily/interval/weekly/monthly/cron/market, trading days, "
      "catch-up, events, labels, notification rules")

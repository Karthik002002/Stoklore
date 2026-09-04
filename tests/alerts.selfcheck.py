"""Every alert condition, against a table of prices. Plain asserts, no framework, no database:

    .venv/bin/python tests/alerts.selfcheck.py

`condition_holds` is pure on purpose (see app/core/alerts.py), which is what lets the whole
thirteen-condition vocabulary be checked here in one file. The cases worth pinning are the edges:
what happens exactly AT a level, what a stateful condition does before it has seen anything, and
that the stateless conditions never depend on the previous price - because those are the ones that
still work when a poll lands late.
"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import alerts  # noqa: E402
from app.core.config import IST  # noqa: E402

holds = alerts.condition_holds


def alert(condition, price=100.0, **extra):
    return {"kind": "price", "active": True, "symbol": "TEST", "condition": condition,
            "price": price, **extra}


# --- level conditions: no history, so they can never be missed by a slow poll --------------------
greater = alert("greater")
assert holds(greater, 100.0), "at the level counts - 'tell me at 100' means 100"
assert holds(greater, 100.01) and not holds(greater, 99.99)
less = alert("less")
assert holds(less, 100.0) and holds(less, 99.99) and not holds(less, 100.01)

# The two spellings the app shipped with are the same conditions, and every alert armed before
# today still carries them.
assert holds(alert("above"), 100.0) and not holds(alert("above"), 99.0)
assert holds(alert("below"), 100.0) and not holds(alert("below"), 101.0)
assert alerts.describe(alert("above")) == "Greater than ₹100.00"
# The level conditions ignore history entirely - that is the whole reason to pick one.
assert holds(greater, 101.0, previous=None) == holds(greater, 101.0, previous=50.0)
assert not holds(alert("greater", price=None), 500.0), "no level, nothing to compare"

# --- crossings: need somewhere to have come from ------------------------------------------------
up = alert("crossing_up")
assert holds(up, 100.0, previous=99.0), "landing exactly on the level is a cross"
assert holds(up, 101.0, previous=99.0)
assert not holds(up, 101.0, previous=100.5), "already above - it did not cross this tick"
assert not holds(up, 99.0, previous=101.0), "that is a cross down"
assert not holds(up, 101.0, previous=None), "freshly armed has no history, and must not guess"

down = alert("crossing_down")
assert holds(down, 100.0, previous=101.0) and holds(down, 99.0, previous=101.0)
assert not holds(down, 99.0, previous=98.0)

both = alert("crossing")
assert holds(both, 101.0, previous=99.0) and holds(both, 99.0, previous=101.0)
assert not holds(both, 101.0, previous=100.5)

# The documented cost of a stateful condition: a round trip inside one poll interval is invisible.
# Two observations, both above the level - nothing here can know it dipped in between.
assert not holds(up, 101.0, previous=100.5), "a move the poll never saw cannot fire"

# --- channels -------------------------------------------------------------------------------------
channel = alert("inside_channel", price=90.0, price2=110.0)
assert holds(channel, 90.0) and holds(channel, 110.0), "the bounds are inside the channel"
assert holds(channel, 100.0) and not holds(channel, 89.9) and not holds(channel, 110.1)

# Typed in either order, it is the same channel.
flipped = alert("inside_channel", price=110.0, price2=90.0)
assert alerts.bounds(flipped) == (90.0, 110.0) and holds(flipped, 100.0)

outside = alert("outside_channel", price=90.0, price2=110.0)
assert holds(outside, 89.9) and holds(outside, 110.1) and not holds(outside, 100.0)

entering = alert("entering_channel", price=90.0, price2=110.0)
assert holds(entering, 95.0, previous=80.0), "in from below"
assert holds(entering, 95.0, previous=120.0), "in from above"
assert not holds(entering, 95.0, previous=100.0), "already in - it did not enter"
assert not holds(entering, 80.0, previous=120.0), "crossed the whole channel between two polls"

exiting = alert("exiting_channel", price=80.0, price2=None)
assert not holds(exiting, 80.0, previous=100.0), "half a channel is not a channel"
exiting = alert("exiting_channel", price=90.0, price2=110.0)
assert holds(exiting, 120.0, previous=100.0) and holds(exiting, 80.0, previous=100.0)
assert not holds(exiting, 120.0, previous=130.0)
assert not holds(exiting, 120.0, previous=None)

# --- moves: measured from the alert's own reference, not from a bar -------------------------------
mover = alert("moving_up", price=5.0, reference_price=100.0)
assert holds(mover, 105.0) and holds(mover, 110.0), "at the move and past it"
assert not holds(mover, 104.99) and not holds(mover, 95.0)

faller = alert("moving_down", price=5.0, reference_price=100.0)
assert holds(faller, 95.0) and not holds(faller, 96.0) and not holds(faller, 105.0)

up_pct = alert("moving_up_pct", price=10.0, reference_price=200.0)
assert holds(up_pct, 220.0) and not holds(up_pct, 219.99)
down_pct = alert("moving_down_pct", price=10.0, reference_price=200.0)
assert holds(down_pct, 180.0) and not holds(down_pct, 180.01)

# Nothing to measure from yet - an alert armed on a symbol that would not quote.
assert not holds(alert("moving_up", price=5.0, reference_price=None), 500.0)
assert not holds(alert("moving_up_pct", price=5.0, reference_price=0), 500.0), "no dividing by zero"

# --- arming, expiry and trigger modes ---------------------------------------------------------------
armed = alert("greater")
assert alerts.should_fire(armed, 101.0)
assert not alerts.should_fire({**armed, "active": False}, 101.0), "a paused alert stays quiet"
assert not alerts.should_fire({**armed, "kind": "order"}, 101.0), "order events aren't conditions"
assert not alerts.should_fire(armed, None), "no quote is not a trigger"

now = datetime.now(IST)
assert alerts.expired({"expires_at": now - timedelta(minutes=1)}, now)
assert not alerts.expired({"expires_at": now + timedelta(minutes=1)}, now)
assert not alerts.expired({"expires_at": None}, now), "no expiry means it watches until told"
assert not alerts.should_fire({**armed, "expires_at": now - timedelta(days=1)}, 101.0, now=now)

# once_per_day: one firing per calendar day, then it waits for tomorrow.
daily = {**armed, "trigger_mode": "once_per_day"}
assert alerts.should_fire({**daily, "triggered_at": None}, 101.0, now=now)
assert not alerts.should_fire({**daily, "triggered_at": now - timedelta(hours=1)}, 101.0, now=now)
assert alerts.should_fire({**daily, "triggered_at": now - timedelta(days=1)}, 101.0, now=now)

# Rows written before trigger_mode existed carry only `recurring`.
assert alerts.trigger_of({"recurring": True}) == "every_time"
assert alerts.trigger_of({"recurring": False}) == "once"
assert alerts.trigger_of({"recurring": False, "trigger_mode": "once_per_day"}) == "once_per_day"

# --- what it says ------------------------------------------------------------------------------------
assert alerts.describe(alert("greater")) == "Greater than ₹100.00"
assert alerts.describe(alert("inside_channel", price=110.0, price2=90.0)) == (
    "Inside channel ₹90.00–₹110.00"
)
assert alerts.describe(alert("moving_up_pct", price=2.5)) == "Moving up % 2.5%"
fired = alerts.message_for({**alert("crossing_up"), "note": "watch for volume"}, 100.5)
assert "TEST" in fired and "100.50" in fired and "watch for volume" in fired

# Every condition in the vocabulary is answerable: each one fires for SOME price, and none of them
# fires for every price. A condition the engine forgot about would fail both halves silently.
GRID = [1.0, 50.0, 89.0, 95.0, 100.0, 105.0, 111.0, 200.0]
for condition in alerts.CONDITIONS:
    probe = alert(condition, price=5.0 if condition in alerts.MOVE_CONDITIONS else 100.0,
                  price2=110.0, reference_price=100.0)
    answers = [holds(probe, price, previous=prev) for price in GRID for prev in GRID]
    assert any(answers), f"{condition} can never fire"
    assert not all(answers), f"{condition} fires on everything"

print("ok - alerts: 13 conditions, channels, moves, expiry, trigger modes, wording")

"""Self-check for the paper engine's trigger logic. Plain asserts, no framework:

    .venv/bin/python tests/paper.selfcheck.py

Only the pure half is exercised - check_position, fill pricing, classification, market hours.
Everything that writes (apply_fills, close_position) is deliberately excluded: it needs a database,
and this has to stay runnable without one.
"""
import datetime
import sys
from pathlib import Path

# Run as a script, so the repo root has to go on sys.path before importing app.* - the package
# is not installed, it just sits at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import paper


def pos(**over):
    base = {
        "id": 1, "account_id": 1, "symbol": "TCS", "direction": "long", "order_type": "market",
        "status": "open", "quantity": 100, "entry_price": 100.0,
        "stop_losses": [{"id": "s1", "price": 95.0, "qty": 100}],
        "targets": [{"id": "t1", "price": 110.0, "qty": 100}],
        "opened_at": None,
    }
    base.update(over)
    return base


def reasons(fills):
    return [f["reason"] for f in fills]


# --- long: nothing triggers in between -----------------------------------------------------------
fills, filled = paper.check_position(pos(), 102.0)
assert fills == [] and filled is False

# --- long: stop and target ------------------------------------------------------------------------
fills, _ = paper.check_position(pos(), 95.0)
assert reasons(fills) == ["stop_loss"] and fills[0]["price"] == 95.0
fills, _ = paper.check_position(pos(), 110.0)
assert reasons(fills) == ["target"] and fills[0]["price"] == 110.0

# --- short: everything inverts ---------------------------------------------------------------------
short = pos(direction="short", stop_losses=[{"id": "s1", "price": 105.0, "qty": 100}],
            targets=[{"id": "t1", "price": 90.0, "qty": 100}])
assert reasons(paper.check_position(short, 105.0)[0]) == ["stop_loss"]
assert reasons(paper.check_position(short, 90.0)[0]) == ["target"]
assert paper.check_position(short, 100.0)[0] == []

# --- fill pricing: never better than the level, never better than what we saw ----------------------
# Polling can jump straight past a stop. Crediting the stop price would hand out a fill that never
# existed, so the worse observed price is used instead.
fills, _ = paper.check_position(pos(), 80.0)
assert fills[0]["price"] == 80.0, fills
# The same jump past a TARGET does not get credited the spike - the target is what was planned.
fills, _ = paper.check_position(pos(), 130.0)
assert fills[0]["price"] == 110.0, fills
# Mirrored for a short.
fills, _ = paper.check_position(short, 120.0)
assert fills[0]["price"] == 120.0, fills
fills, _ = paper.check_position(short, 70.0)
assert fills[0]["price"] == 90.0, fills

# --- laddered exits: only the legs actually reached ------------------------------------------------
ladder = pos(targets=[{"id": "t1", "price": 110.0, "qty": 50}, {"id": "t2", "price": 120.0, "qty": 50}])
fills, _ = paper.check_position(ladder, 110.0)
assert len(fills) == 1 and fills[0]["qty"] == 50, fills  # near target only
fills, _ = paper.check_position(ladder, 125.0)
assert len(fills) == 2, fills                            # a jump through both takes both
assert [f["leg"]["id"] for f in fills] == ["t1", "t2"], "nearest leg first"
assert sum(f["qty"] for f in fills) == 100

# --- stop-loss wins the tick -----------------------------------------------------------------------
# A price that has reached both sides is unresolvable from one sample, so the pessimistic reading
# is taken - same conservative rule as Bar Replay's bar engine.
both = pos(stop_losses=[{"id": "s1", "price": 95.0, "qty": 100}],
           targets=[{"id": "t1", "price": 96.0, "qty": 100}])
fills, _ = paper.check_position(both, 94.0)
assert reasons(fills) == ["stop_loss"], fills

# --- resting limit orders ---------------------------------------------------------------------------
pending = pos(status="pending", order_type="limit", entry_price=95.0)
assert paper.check_position(pending, 96.0) == ([], False)   # not reached
assert paper.check_position(pending, 95.0) == ([], True)    # touched
assert paper.check_position(pending, 90.0) == ([], True)    # gapped through still fills
pending_short = pos(status="pending", order_type="limit", direction="short", entry_price=105.0)
assert paper.check_position(pending_short, 104.0) == ([], False)
assert paper.check_position(pending_short, 106.0) == ([], True)
# A pending order has no exposure yet, so no stop/target can fire on it.
assert paper.check_position(pos(status="pending", entry_price=95.0), 80.0)[0] == []

# --- unrealized P&L ----------------------------------------------------------------------------------
assert paper.unrealized_pnl(pos(), 105.0) == 500.0
assert paper.unrealized_pnl(pos(direction="short"), 105.0) == -500.0
assert paper.unrealized_pnl(pos(status="pending"), 105.0) is None, "a resting order has no P&L"
assert paper.unrealized_pnl(pos(), None) is None

# --- result classification matches the journal's band --------------------------------------------------
assert paper.NEUTRAL_PNL_BAND == 20
assert paper.classify("long", 100, 100.0, 110.0) == "profit"
assert paper.classify("long", 100, 100.0, 90.0) == "loss"
assert paper.classify("long", 1, 100.0, 100.1) == "neutral", "+₹0.10 is a scratch, not a win"
assert paper.classify("short", 100, 100.0, 90.0) == "profit"
assert paper.classify("short", 100, 100.0, 110.0) == "loss"

# --- market hours ----------------------------------------------------------------------------------------
mon = datetime.datetime(2026, 8, 3, tzinfo=paper.IST)          # a Monday
assert paper.market_is_open(mon.replace(hour=10, minute=0))
assert paper.market_is_open(mon.replace(hour=9, minute=15))    # exactly the open
assert paper.market_is_open(mon.replace(hour=15, minute=30))   # exactly the close
assert not paper.market_is_open(mon.replace(hour=9, minute=14))
assert not paper.market_is_open(mon.replace(hour=15, minute=31))
sat = datetime.datetime(2026, 8, 8, 10, 0, tzinfo=paper.IST)
assert not paper.market_is_open(sat), "weekend"

# --- catching up on bars the poller never saw -------------------------------------------------------------
# The bug this exists for, from the real thing: TANLA long 10 @ 582.75 with a stop at 554.15, opened
# 17-Aug and STILL OPEN on 26-Aug at 526.05 - eight sessions below its own stop. The live poller only
# ever sees the current price while the market is open, so every crossing that happened while the app
# was shut simply never existed as far as the engine was concerned.
def bar(day, o, h, l, c):
    return {"date": datetime.date(2026, 8, day), "open": o, "high": h, "low": l, "close": c}


tanla = pos(symbol="TANLA", quantity=10, entry_price=582.75,
            stop_losses=[{"id": "s1", "price": 554.15, "qty": 10}],
            targets=[{"id": "t1", "price": 641.25, "qty": 10}])

missed = paper.catch_up(tanla, [
    bar(18, 585.0, 590.0, 580.0, 583.0),   # quiet
    bar(19, 583.0, 588.0, 556.0, 560.0),   # dips close to the stop, never reaches it
    bar(20, 560.0, 562.0, 548.0, 551.0),   # LOW takes the stop out intrabar
    bar(21, 551.0, 555.0, 540.0, 545.0),   # already gone by here
])
assert len(missed) == 1 and missed[0]["reason"] == "stop_loss", missed
assert missed[0]["at"] == datetime.date(2026, 8, 20), "closed on the day it was hit, not today"
assert missed[0]["price"] == 554.15, "traded through intrabar - fills at the level"
assert missed[0]["qty"] == 10

# The bar's LOW is what matters, not its close: a bar that dipped through the stop and recovered
# still took the trade out, and closing prices are exactly what a daily-close check would miss.
recovered = paper.missed_fills(tanla, bar(20, 560.0, 575.0, 550.0, 574.0))
assert reasons(recovered) == ["stop_loss"], recovered

# A gap-down open fills at the GAP, never at the level nobody could have traded at - same
# pessimistic rule the live path uses.
gapped = paper.missed_fills(tanla, bar(20, 530.0, 540.0, 525.0, 528.0))
assert gapped[0]["price"] == 530.0, gapped

# A target that gapped up still fills at the target, not at the spike - the mirror rule.
target_gap = paper.missed_fills(tanla, bar(20, 660.0, 680.0, 655.0, 670.0))
assert target_gap[0]["reason"] == "target" and target_gap[0]["price"] == 641.25, target_gap

# One bar that reached BOTH: which came first inside it is unknowable, so the stop wins.
both = paper.missed_fills(tanla, bar(20, 580.0, 645.0, 550.0, 600.0))
assert reasons(both) == ["stop_loss"], both

# Nothing reached: no fills, and no position closed for a quiet stretch.
assert paper.catch_up(tanla, [bar(18, 585.0, 590.0, 560.0, 583.0)]) == []
assert paper.catch_up(tanla, []) == [], "no history yet is not a fill"

# Only the FIRST triggering bar is returned - the position changes shape once a leg fills, and
# replaying later bars against a stale snapshot would close quantity that no longer exists.
laddered = pos(symbol="TANLA", quantity=10, entry_price=582.75,
               stop_losses=[{"id": "s1", "price": 554.15, "qty": 5},
                            {"id": "s2", "price": 540.00, "qty": 5}],
               targets=[])
first = paper.catch_up(laddered, [bar(20, 560.0, 562.0, 548.0, 551.0), bar(21, 545.0, 546.0, 520.0, 525.0)])
assert [f["leg"]["id"] for f in first] == ["s1"], first
assert first[0]["at"] == datetime.date(2026, 8, 20)

# A short is mirrored: its stop is above, and the bar's HIGH is what takes it out.
short_pos = pos(direction="short", entry_price=100.0,
                stop_losses=[{"id": "s1", "price": 105.0, "qty": 100}],
                targets=[{"id": "t1", "price": 90.0, "qty": 100}])
assert reasons(paper.missed_fills(short_pos, bar(20, 101.0, 106.0, 99.0, 100.0))) == ["stop_loss"]
assert reasons(paper.missed_fills(short_pos, bar(20, 99.0, 99.5, 88.0, 91.0))) == ["target"]
# Gapped UP through a short's stop: fills at the open, which is worse than the level.
assert paper.missed_fills(short_pos, bar(20, 112.0, 115.0, 110.0, 113.0))[0]["price"] == 112.0

print("ok - paper: triggers, fill pricing, ladders, stop-wins, limits, P&L, classification, hours, catch-up")

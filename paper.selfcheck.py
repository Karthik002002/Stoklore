"""Self-check for the paper engine's trigger logic. Plain asserts, no framework:

    .venv/bin/python paper.selfcheck.py

Only the pure half is exercised - check_position, fill pricing, classification, market hours.
Everything that writes (apply_fills, close_position) is deliberately excluded: it needs a database,
and this has to stay runnable without one.
"""
import datetime

import paper


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

print("ok - paper: triggers, fill pricing, ladders, stop-wins, limits, P&L, classification, hours")

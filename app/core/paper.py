"""Paper trading engine: watches open positions against live prices and fires simulated exits.

Relationship to Bar Replay's orderEngine.js - the two are deliberately NOT shared code, and it's
worth knowing why before "deduplicating" them. Bar Replay matches against a *bar*: it has an OHLC
range, so a level is hit when [low, high] contains it, and a bar whose whole range sits past a
level counts as gapping through and fills at the bar's open. Here there is no range - polling
yields a sequence of last-traded prices - so a level is hit when the latest price has crossed it,
and there is no "open" to fall back to. Same semantics (laddered legs, per-leg quantities,
stop-loss wins), genuinely different arithmetic. What IS shared is the leg shape: {id, price, qty},
so a ladder means the same thing in both places and the frontend can render either.

A closed position becomes a manual_trades row (tagged 'paper', under the paper account) rather
than living in a paper-specific history table - so every statistic the journal already computes
applies to paper trades with no second implementation.
"""
import threading
import time
from datetime import datetime

from zoneinfo import ZoneInfo

from app.core import db

IST = ZoneInfo("Asia/Kolkata")

# yfinance quotes are delayed anyway, so polling faster buys nothing but rate-limit risk.
POLL_SECONDS = 20

# NSE cash market hours. Outside them prices don't move, so the loop idles instead of burning
# requests on a stale quote - the same reason the app caches quotes rather than re-fetching.
MARKET_OPEN = (9, 15)
MARKET_CLOSE = (15, 30)

CLOSE_REASONS = {"stop_loss": "Hit SL", "target": "Hit Target", "manual": "Manual Close"}


def market_is_open(now=None):
    now = now or datetime.now(IST)
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return MARKET_OPEN[0] * 60 + MARKET_OPEN[1] <= minutes <= MARKET_CLOSE[0] * 60 + MARKET_CLOSE[1]


def _fill_price(direction, level, price, is_stop):
    """What a triggered leg actually fills at.

    Never better than the level, and never better than the price we actually observed. Polling
    means the price can jump well past a level between samples; crediting the level in that case
    would quietly hand the user fills they'd never have got. A stop that gapped through fills at
    the worse observed price; a target that gapped through fills at the target, not the spike.

    ponytail: this is the honest-but-pessimistic reading of a polled feed. A tick-level feed would
    remove the ambiguity entirely - until then, erring against the trader is the right direction
    for a practice tool.
    """
    if is_stop:
        return min(level, price) if direction == "long" else max(level, price)
    return level


def legs_by_proximity(legs, entry_price):
    """Nearest-to-entry first. Mirrors orderEngine.js's orderLegsByProximity - sorting by plain
    distance puts stop and target legs in the right order for both directions without special
    casing either."""
    return sorted(legs, key=lambda leg: abs(leg["price"] - entry_price))


def check_position(position, price):
    """Which legs of one position the latest price has triggered.

    Returns (fills, filled_entry) where `fills` is a list of {leg, price, reason, qty} - one per
    triggered leg, not one per position, because a laddered exit closes only its own slice - and
    `filled_entry` is True when a resting limit order just became a live position.

    Stop-loss legs are checked first and, if any hit, target legs are skipped for this tick: which
    came first between two samples is unknowable, so the pessimistic reading wins. Same rule as
    orderEngine.js.
    """
    direction = position["direction"]
    entry = position["entry_price"]

    if position["status"] == "pending":
        # A resting limit fills once price reaches it - through it counts, same as touching it.
        hit = price <= entry if direction == "long" else price >= entry
        return [], bool(hit)

    def reached(level, is_stop):
        if direction == "long":
            return price <= level if is_stop else price >= level
        return price >= level if is_stop else price <= level

    fills = []
    for leg in legs_by_proximity(position.get("stop_losses") or [], entry):
        if reached(leg["price"], True):
            fills.append({
                "leg": leg,
                "price": _fill_price(direction, leg["price"], price, True),
                "reason": "stop_loss",
                "qty": leg["qty"],
            })
    if fills:
        return fills, False

    for leg in legs_by_proximity(position.get("targets") or [], entry):
        if reached(leg["price"], False):
            fills.append({
                "leg": leg,
                "price": _fill_price(direction, leg["price"], price, False),
                "reason": "target",
                "qty": leg["qty"],
            })
    return fills, False


def unrealized_pnl(position, price):
    if price is None or position["status"] != "open":
        return None
    diff = price - position["entry_price"]
    if position["direction"] == "short":
        diff = -diff
    return round(diff * position["quantity"], 2)


# --- Applying fills -----------------------------------------------------------------------------
# Kept separate from check_position so the decision ("what triggered") stays pure and testable
# while the effects ("write a trade, shrink the position") are the only part that touches the DB.


# Mirrors NEUTRAL_PNL_BAND in frontend/src/lib/manualTrades.js. Duplicated across the stack
# because the engine creates closed trades server-side while every other path classifies them in
# the browser - and a paper trade that scratches out at +₹12 must be counted "neutral" by the same
# rule as a hand-logged one, or the win rate means two different things depending on origin.
NEUTRAL_PNL_BAND = 20


def classify(direction, quantity, entry_price, exit_price, band=NEUTRAL_PNL_BAND):
    diff = exit_price - entry_price
    if direction == "short":
        diff = -diff
    pnl = diff * quantity
    if pnl > band:
        return "profit"
    if pnl < -band:
        return "loss"
    return "neutral"


def _journal_close(position, fill, account_id):
    """One closed slice -> one manual_trades row. Quantity is the leg's own, not the position's,
    so a two-leg ladder unwinding produces two rows - which is what actually happened."""
    now = datetime.now(IST).isoformat()
    leg_id = fill["leg"]["id"]
    remaining_stops = [s for s in (position.get("stop_losses") or []) if s["id"] != leg_id]
    remaining_targets = [t for t in (position.get("targets") or []) if t["id"] != leg_id]
    # Report the level that actually triggered THIS close, falling back to whatever is still
    # protecting the rest - same rule (and same reason) as Bar Replay's CloseTradeDialog.
    stop_price = fill["leg"]["price"] if fill["reason"] == "stop_loss" else (
        remaining_stops[0]["price"] if remaining_stops else None
    )
    target_price = fill["leg"]["price"] if fill["reason"] == "target" else (
        remaining_targets[0]["price"] if remaining_targets else None
    )
    opened = position.get("opened_at")
    return db.create_manual_trade(
        position["symbol"], position["direction"], fill["qty"], position["entry_price"],
        fill["price"], stop_price, target_price, False,
        classify(position["direction"], fill["qty"], position["entry_price"], fill["price"]),
        None, ["paper", CLOSE_REASONS[fill["reason"]]], None,
        opened.isoformat() if hasattr(opened, "isoformat") else (opened or now),
        account_id=account_id, exited_at=now,
    )


def apply_fills(position, fills):
    """Journal each triggered leg and shrink (or delete) the position. Returns the trade ids."""
    trade_ids = []
    remaining = position["quantity"]
    stops = list(position.get("stop_losses") or [])
    targets = list(position.get("targets") or [])

    for fill in fills:
        trade_ids.append(_journal_close(position, fill, position["account_id"]))
        remaining -= fill["qty"]
        leg_id = fill["leg"]["id"]
        stops = [s for s in stops if s["id"] != leg_id]
        targets = [t for t in targets if t["id"] != leg_id]

    if remaining > 0:
        db.update_paper_position(
            position["id"], quantity=remaining, stop_losses=stops, targets=targets
        )
    else:
        # Nothing left uncovered - the ladder fully unwound, so the position is gone. Any legs
        # still listed on the other side are moot and go with it.
        db.delete_paper_position(position["id"])
    return trade_ids


def close_position(position, price, qty=None, reason="manual"):
    """Manual close, in whole or in part. Routed through the same journalling path as a triggered
    exit so a hand-closed position produces an identically-shaped trade."""
    qty = min(qty or position["quantity"], position["quantity"])
    fill = {"leg": {"id": None, "price": price, "qty": qty}, "price": price, "reason": reason, "qty": qty}
    trade_ids = [_journal_close(position, fill, position["account_id"])]
    remaining = position["quantity"] - qty
    if remaining > 0:
        db.update_paper_position(position["id"], quantity=remaining)
    else:
        db.delete_paper_position(position["id"])
    return trade_ids


# --- The polling loop ----------------------------------------------------------------------------

state = {"running": False, "last_poll": None, "last_error": None, "prices": {}, "checked": 0}


def poll_once(quote_fn):
    """One sweep: quote every symbol that has something open, trigger what the price reached.

    `quote_fn(symbol) -> price | None` is injected rather than imported so this can be exercised
    without a network (see paper.selfcheck.py). One symbol failing to quote must not stop the
    others - a single delisted ticker shouldn't freeze the whole engine.
    """
    triggered = []
    for symbol in db.paper_position_symbols():
        try:
            price = quote_fn(symbol)
        except Exception as e:  # noqa: BLE001 - one bad symbol must not halt the sweep
            state["last_error"] = f"{symbol}: {e}"
            continue
        if price is None:
            continue
        state["prices"][symbol] = price

        for position in db.list_paper_positions():
            if position["symbol"] != symbol:
                continue
            fills, filled_entry = check_position(position, price)
            if filled_entry:
                db.update_paper_position(
                    position["id"], status="open", opened_at=datetime.now(IST).isoformat()
                )
                continue
            if fills:
                apply_fills(position, fills)
                triggered.extend(f["reason"] for f in fills)
    state["last_poll"] = datetime.now(IST).isoformat()
    state["checked"] += 1
    return triggered


def _loop(quote_fn):
    while True:
        try:
            if market_is_open():
                poll_once(quote_fn)
        except Exception as e:  # noqa: BLE001 - the loop must outlive any single failure
            state["last_error"] = str(e)
        time.sleep(POLL_SECONDS)


def start(quote_fn):
    """Idempotent - a reload-spawned second call must not start a second poller racing the first
    on the same positions."""
    if state["running"]:
        return
    state["running"] = True
    threading.Thread(target=_loop, args=(quote_fn,), daemon=True).start()

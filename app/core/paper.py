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
from datetime import date, datetime

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


# --- catching up on what the poller never saw -----------------------------------------------------
# The live poller only ever sees the CURRENT price, and only while the market is open. That leaves a
# hole it cannot close by itself: if the app is not running when a level is crossed - a laptop shut
# for the evening, a restart, ./scripts/kill.sh, a weekend - the crossing simply never happens as far
# as the engine is concerned, and the position stays open indefinitely with its stop long since
# blown. That is not a rare edge: a local tool is off far more often than it is on.
#
# So every open position is also reconciled against the daily bars that printed while nobody was
# watching. Same pessimistic rule as the live path (see _fill_price): a gap through a stop fills at
# the gap, never at the level.


def missed_fills(position, bar):
    """Which legs a single already-printed daily bar would have triggered, oldest-first semantics.

    Reads the bar's HIGH and LOW, not its close: a stop is hit intrabar, and a bar that dipped
    through the level and recovered still took the trade out. That is precisely what a poller
    sampling every 20s (or not running at all) misses.

    Stops win over targets within one bar - which came first inside it is unknowable, so the
    pessimistic reading wins, the same rule check_position applies to a live tick.
    """
    direction = position["direction"]
    entry = position["entry_price"]
    low, high = bar["low"], bar["high"]

    fills = []
    for leg in legs_by_proximity(position.get("stop_losses") or [], entry):
        hit = low <= leg["price"] if direction == "long" else high >= leg["price"]
        if hit:
            # A bar that OPENED past the stop gapped through it overnight; _fill_price takes the
            # worse of the level and that open, so the fill is the gap, not a level nobody could
            # have traded at.
            fills.append({
                "leg": leg,
                "price": _fill_price(direction, leg["price"], bar["open"], True),
                "reason": "stop_loss",
                "qty": leg["qty"],
                "at": bar["date"],
            })
    if fills:
        return fills

    for leg in legs_by_proximity(position.get("targets") or [], entry):
        hit = high >= leg["price"] if direction == "long" else low <= leg["price"]
        if hit:
            fills.append({
                "leg": leg,
                "price": _fill_price(direction, leg["price"], bar["open"], False),
                "reason": "target",
                "qty": leg["qty"],
                "at": bar["date"],
            })
    return fills


def catch_up(position, bars):
    """The fills from the FIRST bar that would have triggered anything, or [].

    Only the first: once a leg fills the position changes shape, and replaying later bars against a
    stale snapshot would close quantity that no longer exists. The caller re-reads and can run
    again, so a ladder unwinds one bar per pass rather than all at once from stale state.
    """
    for bar in bars:
        fills = missed_fills(position, bar)
        if fills:
            return fills
    return []


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
        # A live fill closed just now; a CATCH-UP fill closed on the bar it was found on, possibly
        # days ago. Stamping that one with now() would file a trade the journal then dates, sorts
        # and charts on the wrong day - and the equity curve reads market dates.
        account_id=account_id, exited_at=fill.get("at") or now,
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


def _synced_bars(symbol, start):
    """This symbol's daily bars from `start`, after making sure the table actually reaches today.

    The sync is the part that is easy to leave out and fatal to omit. price_history is only filled
    by an explicit price sync, so on a machine where nobody ran one it can sit days behind - and a
    catch-up reading a table that stops before the crossing finds nothing wrong and leaves the
    position open, which is the same bug wearing a different hat. sync_symbol is incremental and
    returns immediately when there is nothing new, so this costs one request per open symbol per
    day at most.
    """
    from app.core import prices  # local import: prices imports scraper, which imports db

    try:
        prices.sync_symbol(symbol)
    except Exception as e:  # noqa: BLE001 - stale bars are better than no reconciliation at all
        state["last_error"] = f"{symbol} sync: {e}"
    # price_history_since, NOT bars_between: that one prefers price_history_max, which is a
    # one-shot "Collect max history" table nothing refreshes afterwards. Reading it here found bars
    # stopping days before the crossing and cheerfully reported nothing wrong - the deepest history
    # is the wrong thing to want when the question is "what happened since Monday". price_history is
    # the incrementally-synced one, and the sync above has just brought it to today.
    return db.price_history_since(symbol, start)


def reconcile(bars_fn=None):
    """Close whatever the poller was not around to see. Returns the number of legs filled.

    Scanning from the position's own open date each time makes it idempotent: a level that was
    already honoured has no position left to close, and one that was missed gets closed on the day
    it was actually hit.
    """
    bars_fn = bars_fn or _synced_bars
    filled = 0
    for position in db.list_paper_positions():
        if position["status"] != "open":
            continue
        opened = position.get("opened_at")
        start = opened.date() if hasattr(opened, "date") else date.today()
        try:
            bars = bars_fn(position["symbol"], start)
        except Exception as e:  # noqa: BLE001 - one unreadable symbol must not stop the rest
            state["last_error"] = f"{position['symbol']} catch-up: {e}"
            continue
        fills = catch_up(position, bars)
        if fills:
            apply_fills(position, fills)
            filled += len(fills)
    if filled:
        state["last_error"] = None
    return filled


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
    # Reconciled once per calendar day, not every tick: the daily bars it reads only change
    # overnight, and re-scanning them 1,080 times a session would be pure waste. Running it before
    # the first poll of a day is what covers everything the engine slept through.
    caught_up_on = None
    while True:
        try:
            today = datetime.now(IST).date()
            if caught_up_on != today:
                caught_up_on = today
                reconcile()
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

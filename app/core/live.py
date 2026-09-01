"""Live trading orchestration: send intent, mirror what the broker did, tell the user, journal it.

The shape mirrors app/core/paper.py on purpose - a poller, a `state` dict, `poll_once()` injected
with its data source so it can be exercised without a network - but the resemblance stops at the
shape. The paper engine DECIDES fills. This one never does: it asks Dhan what happened and writes
that down. Anywhere the two disagree, Dhan is right and this file has a bug.

What lives here rather than in dhan_orders.py: anything that touches the database or has to happen
in an order. dhan_orders.py is payloads, guardrails and parsing; this is the sequence.
"""
import threading
import time
from datetime import date, datetime

from app.core import alerts, broker, db, dhan_orders
from app.core.config import IST
from app.core.paper import market_is_open

# Same cadence as the paper engine's poller. Dhan allows 10 order-API requests a second; this uses
# two per tick, which leaves the whole budget for the user actually placing orders.
POLL_SECONDS = 5

# The wallet, cached. The status endpoint is polled every 10s by the open page and the balance
# only moves when an order fills, so re-asking Dhan on every poll would spend the quote budget on a
# number that barely changes. A failed fetch keeps the last good reading rather than blanking it -
# a stale balance is still the right order of magnitude for the size warnings that read it.
_funds = {"available": None, "at": None, "error": None}
FUNDS_TTL_SECONDS = 30

state = {
    "running": False,
    "last_poll": None,
    "last_error": None,
    "orders": 0,
    "positions": 0,
}


def credentials():
    return db.get_dhan_credentials()


def limits():
    """The user's own ceilings, from Settings › Live trading. Every one of them defaults to the
    cautious end: a fresh install cannot place an order at all until it is switched on."""
    return db.get_live_trading_settings()


def runtime_state():
    """Today's reality, as the guardrails need it: how much has been sent, how the day is going,
    and whether trading has been halted. Halt is stored with the date it was set so it lifts by
    itself overnight - a kill switch that stays down until someone remembers it is a kill switch
    that gets disabled permanently the next morning."""
    halted_on = db.get_setting_value("live_halted_on")
    today = date.today().isoformat()
    return {
        "halted": halted_on == today,
        "halt_reason": db.get_setting_value("live_halt_reason") if halted_on == today else None,
        "orders_today": db.count_live_orders_today(),
        "realised_today": db.live_realised_today(),
    }


def available_balance(force=False):
    """Cash the account can actually deploy, as Dhan reports it. None when there are no
    credentials or the call has never succeeded - the UI shows nothing rather than a zero, which
    would read as an empty account."""
    creds = credentials()
    if not creds:
        return None
    fresh = _funds["at"] and (datetime.now(IST) - _funds["at"]).total_seconds() < FUNDS_TTL_SECONDS
    if fresh and not force:
        return _funds["available"]
    try:
        limits_ = broker.fetch_fund_limit(creds["client_id"], creds["access_token"])
        # Dhan's own documented typo, kept verbatim in broker.py for the same reason.
        _funds["available"] = limits_.get("availabelBalance", limits_.get("availableBalance"))
        _funds["error"] = None
    except broker.DhanError as e:
        _funds["error"] = str(e)
    _funds["at"] = datetime.now(IST)
    return _funds["available"]


def halt(reason):
    """Stop sending. Does not touch anything already resting at the broker - see `panic` for that.
    Deliberately separate: "place nothing further" and "cancel everything" are different decisions,
    and a daily-loss stop should not also close a position that still has a plan attached to it.
    """
    db.set_setting_value("live_halted_on", date.today().isoformat())
    db.set_setting_value("live_halt_reason", reason)
    alerts.record("order", f"Live trading halted: {reason}")


def resume():
    db.set_setting_value("live_halted_on", "")
    db.set_setting_value("live_halt_reason", "")


def panic(creds=None):
    """The kill switch: halt, then cancel every order still working at the broker.

    Cancels are attempted one by one and failures are collected rather than raised - the point of
    this button is that it does as much as it can. What it cannot do is close an open position;
    that is a market order the user must choose to send, because a panic click should never
    liquidate a position by itself.
    """
    creds = creds or credentials()
    halt("kill switch")
    if not creds:
        return {"cancelled": 0, "errors": ["No Dhan credentials configured."]}
    cancelled, errors = 0, []
    for order in db.list_live_orders(open_only=True):
        try:
            dhan_orders.cancel(creds, order["order_id"], order.get("leg") if order.get("parent_order_id") else None)
            cancelled += 1
        except dhan_orders.DhanOrderError as e:
            errors.append(f"{order['order_id']}: {e}")
    return {"cancelled": cancelled, "errors": errors}


# --- sending intent ---------------------------------------------------------------------------------


def place_intent(intent, super_order=True):
    """Guardrails, then one network call, then mirror what came back.

    Returns {ok, order_id, correlation_id, errors}. Nothing is retried: if the POST times out the
    order may already be live, so the caller is handed the correlation id and told to reconcile.
    """
    creds = credentials()
    intent = dict(intent)
    intent["client_id"] = (creds or {}).get("client_id")
    intent["correlation_id"] = dhan_orders.correlation_id(
        "SL", datetime.now(IST), str(db.count_live_orders_today() + 1)
    )

    errors = dhan_orders.guardrail_errors(intent, limits(), runtime_state())
    # The symbol lookup is last and only if everything else passed: it can mean downloading Dhan's
    # whole scrip master, which is not worth doing to refuse an order the caps already refused.
    sec_id = None
    if not errors:
        sec_id = dhan_orders.security_id(intent["symbol"]) if intent.get("symbol") else None
        if not sec_id:
            errors.append(f"{intent.get('symbol')} isn't an NSE cash equity Dhan will trade.")
    if errors:
        return {"ok": False, "errors": errors}

    wants_exits = intent.get("stop_price") is not None or intent.get("target_price") is not None
    use_super = super_order and wants_exits
    payload = (
        dhan_orders.build_super_order(intent, sec_id)
        if use_super
        else dhan_orders.build_order(intent, sec_id)
    )

    db.record_live_intent(intent["correlation_id"], intent["symbol"], payload)
    try:
        answer = dhan_orders.place(creds, payload, super_order=use_super)
    except dhan_orders.DhanOrderError as e:
        # Not a failure to place - a failure to HEAR. The order may be live.
        db.mark_live_intent_unconfirmed(intent["correlation_id"], str(e))
        return {
            "ok": False,
            "correlation_id": intent["correlation_id"],
            "unconfirmed": True,
            "errors": [
                f"{e} — the order may still have reached the exchange. "
                "Nothing was re-sent; reconcile before trying again."
            ],
        }

    order_id = str(answer.get("orderId") or "")
    db.confirm_live_intent(intent["correlation_id"], order_id, answer.get("orderStatus"))
    alerts.record(
        "order",
        f"{intent['direction'].upper()} {intent['quantity']} {intent['symbol']} sent "
        f"({answer.get('orderStatus') or 'accepted'})",
        symbol=intent["symbol"],
        meta={"order_id": order_id, "correlation_id": intent["correlation_id"]},
    )
    sync_once(creds)
    return {"ok": True, "order_id": order_id, "correlation_id": intent["correlation_id"], "errors": []}


def recover(correlation_id, creds=None):
    """What actually happened to an intent whose POST never came back. Reads the order book and
    matches on the correlation id - the one identifier this app controls end to end."""
    creds = creds or credentials()
    if not creds:
        return None
    for order in dhan_orders.order_book(creds) + dhan_orders.super_order_book(creds):
        if order.get("correlation_id") == correlation_id:
            db.upsert_live_order(order)
            db.confirm_live_intent(correlation_id, order["order_id"], order["status"])
            return order
    return None


# --- mirroring --------------------------------------------------------------------------------------


def sync_once(creds=None):
    """One sweep of the broker's own books into the mirror, raising an alert for anything that
    changed and journalling anything that went flat. Returns a small summary for the status line.
    """
    creds = creds or credentials()
    if not creds:
        return {"orders": 0, "positions": 0}

    previous_orders = {o["order_id"]: o for o in db.list_live_orders()}
    orders = dhan_orders.order_book(creds) + dhan_orders.super_order_book(creds)
    for order in orders:
        db.upsert_live_order(order)

    for order, was in dhan_orders.status_changes(previous_orders, orders):
        if order["status"] == "TRADED":
            alerts.record(
                "order",
                f"Filled: {order['side']} {order.get('filled_qty') or order.get('quantity')} "
                f"{order.get('symbol')} at ₹{order.get('avg_price') or 0:,.2f}",
                symbol=order.get("symbol"),
                meta={"order_id": order["order_id"], "was": was},
            )
        elif order["status"] in ("REJECTED", "CANCELLED", "EXPIRED"):
            detail = order.get("error") or order["status"].lower()
            alerts.record(
                "order",
                f"{order['status'].title()}: {order.get('symbol')} — {detail}",
                symbol=order.get("symbol"),
                meta={"order_id": order["order_id"], "was": was},
            )

    previous_positions = {p["security_id"]: p for p in db.list_live_positions()}
    positions = dhan_orders.positions(creds)
    db.replace_live_positions(positions)

    for closed in dhan_orders.closed_positions(previous_positions, positions):
        _journal(closed)

    _check_daily_loss(positions)
    state["orders"], state["positions"] = len(orders), len([p for p in positions if p["net_qty"]])
    return {"orders": state["orders"], "positions": state["positions"]}


def _journal(closed):
    """A round trip that finished becomes a journal row, exactly once.

    The account it lands in is the one nominated in Settings; without one the trade is still
    announced but not written, because guessing which account a real trade belongs to is worse
    than leaving it for the user to file.
    """
    trade = dhan_orders.journal_trade(closed)
    if not trade:
        return
    account_id = limits().get("account_id")
    alerts.record(
        "order",
        f"Closed {trade['symbol']}: {trade['quantity']} @ ₹{trade['entry_price']:,.2f} → "
        f"₹{trade['exit_price']:,.2f}",
        symbol=trade["symbol"],
        meta={"security_id": closed.get("security_id")},
    )
    if not account_id:
        return
    db.create_manual_trade_from_live(
        account_id=account_id,
        symbol=trade["symbol"],
        direction=trade["direction"],
        quantity=trade["quantity"],
        entry_price=trade["entry_price"],
        exit_price=trade["exit_price"],
        source_ref=closed.get("security_id"),
    )


def _check_daily_loss(positions):
    """Trip the halt when the day's realised loss reaches the user's own limit. Realised only:
    an open position moving against you is not yet a loss, and halting on unrealised P&L would
    stop trading over a wick."""
    limit = limits().get("daily_loss_limit")
    if not limit or runtime_state()["halted"]:
        return
    realised = sum(p.get("realised") or 0 for p in positions)
    if realised <= -abs(limit):
        halt(f"daily loss limit reached (₹{abs(realised):,.0f})")


# --- the loop ----------------------------------------------------------------------------------------


def poll_once(price_fn):
    """Mirror the broker, then check price alerts. Alerts run even when live trading is switched
    off - watching a level is not trading, and the user may well be watching for the moment they
    want to switch it on."""
    fired = alerts.sweep(price_fn)
    if credentials() and limits().get("enabled"):
        sync_once()
    state["last_poll"] = datetime.now(IST).isoformat()
    return fired


def _loop(price_fn):
    while True:
        try:
            if market_is_open():
                poll_once(price_fn)
        except Exception as e:  # noqa: BLE001 - the loop must outlive any single failure
            state["last_error"] = str(e)
        time.sleep(POLL_SECONDS)


def start(price_fn):
    """Idempotent, like paper.start - a reload-spawned second poller would double every alert."""
    if state["running"]:
        return
    state["running"] = True
    threading.Thread(target=_loop, args=(price_fn,), daemon=True, name="live-poller").start()

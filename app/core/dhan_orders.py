"""Dhan v2 order API - the write half of app/core/broker.py, which only ever reads.

This module never simulates anything. app/core/paper.py owns a position and decides when it fills;
here the BROKER owns the position and this is a mirror plus a way to send intent. Nothing in the
app may infer a fill: a fill is what Dhan's order book says it is, and everything downstream (the
positions screen, the journal, the alerts) reads that mirror rather than a local guess. Two
sources of truth for one position is how an account ends up sold twice.

Money moves through these functions, so they are arranged for one property above all others: the
network call is the last thing that happens. Everything that can be decided without it - the
payload, every guardrail, the symbol lookup - is a pure function above the line, checked by
tests/live_trading.selfcheck.py without credentials or a socket. `send()` at the bottom is the
only thing that talks to Dhan.

Fields follow https://dhanhq.co/docs/v2/orders/ and /super-order/.
"""
import csv
import io
import threading
from datetime import date

import requests

from app.core import db

LIVE_BASE_URL = "https://api.dhan.co/v2"

# Dhan's whole tradable universe as a CSV, refreshed daily. It is the only way to turn "RELIANCE"
# into the securityId every order endpoint actually wants.
SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master.csv"

EXCHANGE_SEGMENT = "NSE_EQ"
ORDER_LEGS = ("ENTRY_LEG", "TARGET_LEG", "STOP_LOSS_LEG")
# Dhan's own vocabulary, kept verbatim rather than translated: a status this app doesn't recognise
# must still be displayable, because the alternative is showing "unknown" next to real money.
OPEN_STATUSES = ("TRANSIT", "PENDING", "PART_TRADED")
DONE_STATUSES = ("TRADED", "REJECTED", "CANCELLED", "EXPIRED")


class DhanOrderError(Exception):
    pass


# --- the instrument map ---------------------------------------------------------------------------
# In memory, not a table: it is derived data with a daily refresh and no history worth keeping, and
# a table would need a migration, an importer and a staleness rule to hold the same dictionary.

_master = {"day": None, "map": {}}
_master_lock = threading.Lock()


def parse_scrip_master(csv_text):
    """{TRADINGSYMBOL: securityId} for NSE cash equities.

    The series filter is the load-bearing part: NSE lists SDL bonds, SME scrips and ETFs in the
    same file under the same EQUITY instrument name, and an order routed to a bond because it
    shared a ticker prefix is not a bug anyone wants to debug from a contract note.
    """
    out = {}
    for row in csv.DictReader(io.StringIO(csv_text)):
        if (
            row.get("SEM_EXM_EXCH_ID") == "NSE"
            and row.get("SEM_INSTRUMENT_NAME") == "EQUITY"
            and row.get("SEM_SERIES") == "EQ"
        ):
            symbol = (row.get("SEM_TRADING_SYMBOL") or "").strip().upper()
            security_id = (row.get("SEM_SMST_SECURITY_ID") or "").strip()
            if symbol and security_id:
                out[symbol] = security_id
    return out


def security_id(symbol, today=None):
    """Dhan's id for an NSE cash symbol, or None if it isn't one. Refreshed once a day; a failed
    refresh keeps yesterday's map rather than blanking it, because a stale id is still tradable
    and an empty map would refuse every order at the open."""
    today = today or date.today()
    with _master_lock:
        if _master["day"] != today:
            try:
                res = requests.get(SCRIP_MASTER_URL, timeout=60)
                res.raise_for_status()
                parsed = parse_scrip_master(res.text)
                if parsed:
                    _master.update(day=today, map=parsed)
            except (requests.RequestException, csv.Error):
                pass
        return _master["map"].get((symbol or "").strip().upper())


# --- what an order looks like before it is sent ----------------------------------------------------


def build_order(intent, sec_id):
    """A plain order (no attached exits) as Dhan's POST /orders wants it.

    `price` is sent as 0 for a market order because the field is required and Dhan ignores it -
    sending the last traded price instead would look like a limit at a price nobody asked for.
    """
    payload = {
        "dhanClientId": intent["client_id"],
        "correlationId": intent["correlation_id"],
        "transactionType": "BUY" if intent["direction"] == "long" else "SELL",
        "exchangeSegment": EXCHANGE_SEGMENT,
        "productType": intent.get("product", "INTRADAY"),
        "orderType": "LIMIT" if intent.get("limit_price") else "MARKET",
        "validity": "DAY",
        "securityId": sec_id,
        "quantity": int(intent["quantity"]),
        "price": float(intent.get("limit_price") or 0),
    }
    return payload


def build_super_order(intent, sec_id):
    """Entry + target + stop as ONE order, which is the whole reason to prefer it: the exits live
    at the broker, so they survive this app being closed, the laptop sleeping and the poller
    dying. A stop that only exists in a Python process is not a stop.

    trailingJump is optional and omitted when zero - Dhan reads 0 as "no trail", but leaving the
    key out says the same thing without relying on that.
    """
    payload = build_order(intent, sec_id)
    payload["targetPrice"] = float(intent["target_price"])
    payload["stopLossPrice"] = float(intent["stop_price"])
    if intent.get("trailing_jump"):
        payload["trailingJump"] = float(intent["trailing_jump"])
    return payload


def modify_payload(client_id, order_id, leg, **fields):
    """One leg of a live super order. Which fields are legal depends on the leg and on how far the
    order has got: the entry leg can be moved wholesale while it is still PENDING/PART_TRADED, but
    once it has TRADED only the exit legs' prices can change - the shares are already yours."""
    if leg not in ORDER_LEGS:
        raise ValueError(f"unknown leg {leg!r}")
    payload = {"dhanClientId": client_id, "orderId": str(order_id), "legName": leg}
    allowed = {
        "ENTRY_LEG": ("orderType", "quantity", "price", "targetPrice", "stopLossPrice", "trailingJump"),
        "TARGET_LEG": ("targetPrice",),
        "STOP_LOSS_LEG": ("stopLossPrice", "trailingJump"),
    }[leg]
    for key, value in fields.items():
        if value is None:
            continue
        if key not in allowed:
            raise ValueError(f"{key} cannot be modified on {leg}")
        payload[key] = value
    return payload


def exit_intent(position, correlation_id, client_id):
    """A market order that flattens whatever is open. Direction is read off the position rather
    than passed in: "close this" must never depend on the caller remembering which way it was."""
    net = position["net_qty"]
    return {
        "client_id": client_id,
        "correlation_id": correlation_id,
        "direction": "short" if net > 0 else "long",
        "quantity": abs(net),
        "product": position.get("product") or "INTRADAY",
        "limit_price": None,
    }


# --- the guardrails --------------------------------------------------------------------------------
# Every one of these is a refusal, not a warning, and they are checked in the same pass so the
# screen can list everything wrong with an order at once instead of one thing per attempt.


def guardrail_errors(intent, limits, state):
    """Human-readable reasons this order must not be sent. Empty list means it may go.

    `limits` is the user's own configuration (see Settings › Live trading); `state` is today's
    reality - orders already sent, realised P&L so far, whether the kill switch is down.
    """
    errors = []
    if not limits.get("enabled"):
        errors.append("Live trading is switched off - turn it on in Settings › Live trading.")
    if state.get("halted"):
        errors.append(f"Trading is halted for today: {state.get('halt_reason') or 'kill switch'}.")
    if not intent.get("client_id"):
        errors.append("No Dhan credentials configured.")

    quantity = intent.get("quantity") or 0
    if quantity <= 0:
        errors.append("Quantity must be above 0.")
    if quantity != int(quantity):
        errors.append("Quantity must be a whole number of shares.")

    reference = intent.get("limit_price") or intent.get("reference_price")
    if not reference:
        errors.append("No price to size this order against.")
    else:
        notional = abs(quantity * reference)
        cap = limits.get("max_order_value")
        if cap and notional > cap:
            errors.append(f"₹{notional:,.0f} is over the ₹{cap:,.0f} per-order cap.")

    sent = state.get("orders_today") or 0
    max_orders = limits.get("max_orders_per_day")
    if max_orders and sent >= max_orders:
        errors.append(f"{sent} orders already sent today, cap is {max_orders}.")

    loss_limit = limits.get("daily_loss_limit")
    realised = state.get("realised_today")
    if loss_limit and realised is not None and realised <= -abs(loss_limit):
        errors.append(f"Down ₹{abs(realised):,.0f} today, at or past the ₹{abs(loss_limit):,.0f} stop.")

    # A stop on the wrong side of entry fires on the next tick - that is a typo, not a plan. Same
    # check the paper engine makes, for the same reason, except here it costs real money.
    stop, target = intent.get("stop_price"), intent.get("target_price")
    if reference and stop is not None:
        wrong = stop >= reference if intent["direction"] == "long" else stop <= reference
        if wrong:
            errors.append("Stop-loss must be below entry for a buy, above it for a sell.")
    if reference and target is not None:
        wrong = target <= reference if intent["direction"] == "long" else target >= reference
        if wrong:
            errors.append("Target must be above entry for a buy, below it for a sell.")
    return errors


def correlation_id(prefix, when, nonce):
    """The id this app can find its own order by. Dhan caps it at 30 characters.

    It exists for one moment: a POST that times out. The order may or may not have reached the
    exchange, and the only safe move is to look for this id in the order book - never to send the
    order again, which is how one intent becomes two positions.
    """
    return f"{prefix}{when:%y%m%d%H%M%S}{nonce}"[:30]


# --- reading the broker's answer back ---------------------------------------------------------------


def normalize_order(row):
    """Dhan's order row in this app's vocabulary, with the raw row kept alongside - the fields
    below are what the UI needs, not what the broker said, and when those disagree the raw row is
    the one to trust."""
    return {
        "order_id": str(row.get("orderId") or ""),
        "correlation_id": row.get("correlationId"),
        "status": row.get("orderStatus"),
        "symbol": row.get("tradingSymbol"),
        "security_id": str(row.get("securityId") or ""),
        "side": row.get("transactionType"),
        "product": row.get("productType"),
        "order_type": row.get("orderType"),
        "leg": row.get("legName"),
        "quantity": row.get("quantity"),
        "filled_qty": row.get("filledQty"),
        "remaining_qty": row.get("remainingQuantity"),
        "avg_price": row.get("averageTradedPrice"),
        "price": row.get("price"),
        "trigger_price": row.get("triggerPrice"),
        "error": row.get("omsErrorDescription"),
        "updated_at": row.get("updateTime") or row.get("createTime"),
    }


def normalize_position(row):
    """Dhan's position row, reduced to what a position screen and the journal need."""
    net = row.get("netQty")
    return {
        "security_id": str(row.get("securityId") or ""),
        "symbol": row.get("tradingSymbol"),
        "product": row.get("productType"),
        "position_type": row.get("positionType"),
        "net_qty": int(net or 0),
        "buy_qty": int(row.get("buyQty") or 0),
        "sell_qty": int(row.get("sellQty") or 0),
        "buy_avg": row.get("buyAvg"),
        "sell_avg": row.get("sellAvg"),
        "realised": row.get("realizedProfit"),
        "unrealised": row.get("unrealizedProfit"),
    }


def status_changes(previous, current):
    """Orders whose status moved since the last sweep, as (order, was) pairs.

    `previous` is what the mirror last stored, keyed by order id. An order appearing for the first
    time already TRADED counts as a change - the app was asleep when it filled, and the whole
    point of this is that the user still finds out.
    """
    changes = []
    for order in current:
        was = (previous.get(order["order_id"]) or {}).get("status")
        if was != order["status"]:
            changes.append((order, was))
    return changes


def closed_positions(previous, current):
    """Positions that went flat since the last sweep - the moment a round trip becomes a journal
    entry. Read from the position, not by stitching orders together: partial exits, averaging in
    and a stop that filled in three prints all still land on one net quantity of zero.
    """
    by_id = {p["security_id"]: p for p in current}
    out = []
    for security_id_, before in previous.items():
        if not before.get("net_qty"):
            continue
        after = by_id.get(security_id_)
        # Gone from the book entirely also means flat: Dhan drops closed intraday positions from
        # the day's book after settlement rather than reporting them at zero.
        if after is None or after["net_qty"] == 0:
            out.append({**before, **(after or {}), "net_qty": 0})
    return out


def journal_trade(position):
    """A closed position as a manual_trades row: what was bought, what it was sold for, which way
    round. Returns None when the numbers can't make a trade - a position with no fill price is a
    reconciliation problem, and inventing a zero would quietly corrupt the journal it feeds."""
    quantity = min(position.get("buy_qty") or 0, position.get("sell_qty") or 0)
    entry = position.get("buy_avg")
    exit_price = position.get("sell_avg")
    if not quantity or not entry or not exit_price:
        return None
    short = (position.get("position_type") or "").upper() == "SHORT"
    if short:
        entry, exit_price = exit_price, entry
    return {
        "symbol": position.get("symbol"),
        "direction": "short" if short else "long",
        "quantity": quantity,
        "entry_price": entry,
        "exit_price": exit_price,
    }


# --- the network -----------------------------------------------------------------------------------
# Everything above is decided before this point. Below, one function talks to Dhan.


def base_url():
    """Live unless a sandbox URL has been configured. Sandbox credentials are issued separately
    (developer.dhanhq.co) and its base URL is printed there - this app does not hardcode one,
    because guessing a URL that receives orders is not a guess worth making."""
    return db.get_dhan_api_base_url() or LIVE_BASE_URL


def _headers(client_id, access_token):
    return {"access-token": access_token, "client-id": client_id, "Content-Type": "application/json"}


def send(method, path, credentials, payload=None):
    """The only thing in this module that reaches the network.

    A timeout is deliberately NOT retried. The request may have placed an order; asking again
    could place a second. Callers reconcile against the order book by correlation id instead -
    see live.py's `recover_timeout`.
    """
    url = f"{base_url()}{path}"
    try:
        res = requests.request(
            method,
            url,
            headers=_headers(credentials["client_id"], credentials["access_token"]),
            json=payload,
            timeout=15,
        )
    except requests.RequestException as e:
        raise DhanOrderError(f"Couldn't reach Dhan: {e}") from e
    if not res.ok:
        raise DhanOrderError(f"Dhan API error ({res.status_code}): {res.text[:300]}")
    if not res.content:
        return {}
    try:
        return res.json()
    except ValueError:
        return {}


def order_book(credentials):
    return [normalize_order(r) for r in send("GET", "/orders", credentials) or []]


def super_order_book(credentials):
    """Super orders come back nested: the entry order with its target and stop hanging off it.
    Flattened here so the mirror stores one row per order id whatever shape it arrived in."""
    out = []
    for parent in send("GET", "/super/orders", credentials) or []:
        entry = normalize_order(parent)
        entry["leg"] = entry["leg"] or "ENTRY_LEG"
        out.append(entry)
        for leg in parent.get("legDetails") or []:
            child = normalize_order({**parent, **leg})
            child["parent_order_id"] = entry["order_id"]
            out.append(child)
    return out


def positions(credentials):
    return [normalize_position(r) for r in send("GET", "/positions", credentials) or []]


def place(credentials, payload, super_order=False):
    return send("POST", "/super/orders" if super_order else "/orders", credentials, payload)


def modify(credentials, order_id, payload, super_order=False):
    path = f"/super/orders/{order_id}" if super_order else f"/orders/{order_id}"
    return send("PUT", path, credentials, payload)


def cancel(credentials, order_id, leg=None):
    """Cancelling the entry leg cancels the whole super order, which is what the kill switch
    wants; naming a leg cancels only that one - and Dhan will not let it be added back."""
    path = f"/super/orders/{order_id}/{leg}" if leg else f"/orders/{order_id}"
    return send("DELETE", path, credentials)

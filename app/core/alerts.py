"""Alerts: a price level worth being told about, and the things the broker did while you weren't
looking.

Two kinds share one table and one feed, because they answer the same question - "what happened
that I should know about" - and a trader watching a position does not want two inboxes:

- **price** alerts are the ones you set: symbol, above/below, a level.
- **order** alerts are written by the live mirror when Dhan reports a fill, a rejection or a
  position going flat. Nobody sets those; they are what the account did.

Deliberately not a rule engine. app/core/rules.py already evaluates multi-criterion watch rules
against fundamentals and events; that is a research question asked on demand. This is one number
against one level, swept every few seconds while the market is open, and the two would only be one
feature if you squint from far enough away to miss that one of them costs a scrape per check.
"""
from datetime import datetime

from app.core import db
from app.core.config import IST

CONDITIONS = ("above", "below")


def should_fire(alert, price):
    """True when this price satisfies the alert. Level comparison, not crossing detection: a
    crossing needs a previous price, and a poller that missed the tick either side of the level
    would then never fire at all - the failure mode of a stop that "never triggered" because
    nobody was watching at the exact moment. `>=` is the honest reading of "tell me at 100"."""
    if price is None or not alert.get("active") or alert.get("kind", "price") != "price":
        return False
    level = alert.get("price")
    if level is None:
        return False
    return price >= level if alert.get("condition") == "above" else price <= level


def message_for(alert, price):
    direction = "at or above" if alert.get("condition") == "above" else "at or below"
    text = f"{alert['symbol']} is {direction} ₹{alert['price']:,.2f} (₹{price:,.2f})"
    return f"{text} - {alert['note']}" if alert.get("note") else text


def sweep(price_fn):
    """Check every armed price alert once. Returns how many fired.

    `price_fn(symbol) -> price | None` is injected so this runs in the self-check without a
    network. One symbol failing to quote must not stop the sweep: an unquotable ticker is not a
    reason to stop watching the other nine.
    """
    fired = 0
    alerts = [a for a in db.list_alerts(active=True) if a["kind"] == "price"]
    for symbol in sorted({a["symbol"] for a in alerts if a["symbol"]}):
        try:
            price = price_fn(symbol)
        except Exception:  # noqa: BLE001 - one bad symbol must not halt the sweep
            continue
        if price is None:
            continue
        for alert in alerts:
            if alert["symbol"] != symbol or not should_fire(alert, price):
                continue
            db.fire_alert(alert["id"], price, message_for(alert, price))
            fired += 1
    return fired


def record(kind, message, symbol=None, meta=None):
    """An alert that has already happened - a fill, a rejection, a halt. Written straight to the
    feed in the triggered state, because there was never a condition to arm."""
    return db.create_alert(
        kind=kind,
        symbol=symbol,
        condition=None,
        price=None,
        note=None,
        recurring=False,
        active=False,
        triggered_at=datetime.now(IST).isoformat(),
        message=message,
        meta=meta or {},
    )

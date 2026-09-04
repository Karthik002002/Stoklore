"""Alerts: a price condition worth being told about, and the things the broker did while you
weren't looking.

Two kinds share one table and one feed, because they answer the same question - "what happened
that I should know about" - and a trader watching a position does not want two inboxes:

- **price** alerts are the ones you set: a symbol, a condition, and one or two levels.
- **order** alerts are written by the live mirror when Dhan reports a fill, a rejection or a
  position going flat. Nobody sets those; they are what the account did.

Deliberately not a rule engine. app/core/rules.py already evaluates multi-criterion watch rules
against fundamentals and events; that is a research question asked on demand. This is one number
against one or two levels, swept every few seconds while the market is open, and the two would
only be one feature if you squint from far enough away to miss that one of them costs a scrape
per check.

--- what a condition can be, and what that costs -------------------------------------------------

Nine of the thirteen conditions are STATELESS - they read the current price and nothing else, so a
poll that lands late still fires. Four are STATEFUL: crossing, crossing up, crossing down and the
two channel-transition ones need to know where the price was last time, which this stores per
alert as `last_price`.

The stateful ones can miss. The sweep sees the price every POLL_SECONDS on a delayed feed, so a
price that crosses 100 and comes back inside one interval never produces two observations either
side of the level, and the alert stays quiet. That is not a bug to be fixed here; it is what
polling a delayed quote can see. Which is exactly why `greater`/`less` exist beside
`crossing_up`/`crossing_down`: for "tell me if it gets there at all", a level test cannot miss,
and it is the one to pick when being told matters more than being told at the instant.

The moving_* conditions measure from the alert's own `reference_price` - the price when it was
armed, re-captured each time it fires - NOT from the previous bar the way a charting package
does. A bar's move is invisible to a poller that only ever sees a last price, and "it moved 5%
since I set this" is both answerable and the question a swing trader is actually asking.
"""
from datetime import datetime

from app.core import db
from app.core.config import IST

# --- the vocabulary ------------------------------------------------------------------------------

#: The two conditions the app shipped with. Kept as first-class aliases of greater/less rather
#: than migrated away: they are the condition string on every alert armed before today, and an
#: alert that silently stops firing because its spelling went out of fashion is the worst possible
#: failure for this feature.
ALIASES = {"above": "greater", "below": "less"}

#: Conditions that need only the current price. These can never be missed by a slow poll.
STATELESS = (
    "greater",
    "less",
    "inside_channel",
    "outside_channel",
    "moving_up",
    "moving_down",
    "moving_up_pct",
    "moving_down_pct",
)
#: Conditions that compare the current price against the previous observation.
STATEFUL = ("crossing", "crossing_up", "crossing_down", "entering_channel", "exiting_channel")
CONDITIONS = STATELESS + STATEFUL

#: Conditions that read a second level - the channel ones, whose two bounds are `price`/`price2`.
CHANNEL_CONDITIONS = (
    "inside_channel",
    "outside_channel",
    "entering_channel",
    "exiting_channel",
)
#: Conditions whose "value" is a move from the reference price, not a level on the chart.
MOVE_CONDITIONS = ("moving_up", "moving_down", "moving_up_pct", "moving_down_pct")

#: How often an armed alert may fire.
#:   once         - fires and disarms. The default, and what a target or a stop wants.
#:   once_per_day - at most one per trading day, then re-arms overnight. The nearest honest
#:                  equivalent of a charting package's "once per bar" when the bar is a day.
#:   every_time   - fires on every sweep the condition holds for. Noisy on purpose.
TRIGGERS = ("once", "once_per_day", "every_time")

#: What each condition reads, in the order the UI asks for it.
CONDITION_LABELS = {
    "crossing": "Crossing",
    "crossing_up": "Crossing up",
    "crossing_down": "Crossing down",
    "greater": "Greater than",
    "less": "Less than",
    "entering_channel": "Entering channel",
    "exiting_channel": "Exiting channel",
    "inside_channel": "Inside channel",
    "outside_channel": "Outside channel",
    "moving_up": "Moving up",
    "moving_down": "Moving down",
    "moving_up_pct": "Moving up %",
    "moving_down_pct": "Moving down %",
}


def trigger_of(alert):
    """The alert's trigger mode. Rows written before trigger_mode existed carry only `recurring`,
    which said exactly one thing: re-arm, or don't."""
    return alert.get("trigger_mode") or ("every_time" if alert.get("recurring") else "once")


def bounds(alert):
    """A channel's two levels, low first, however they were typed in."""
    lo, hi = alert.get("price"), alert.get("price2")
    if lo is None or hi is None:
        return None
    return (lo, hi) if lo <= hi else (hi, lo)


def _inside(price, alert):
    b = bounds(alert)
    return None if b is None else b[0] <= price <= b[1]


# --- the condition itself -------------------------------------------------------------------------


def condition_holds(alert, price, previous=None):
    """Whether this alert's condition is satisfied by `price`, given the previous observation.

    Pure: no clock, no database, no notion of whether the alert is armed or has fired before. That
    is `should_fire`'s job below, and keeping the two apart is what makes the whole table of
    conditions checkable in the self-check without a fixture.

    `previous` is the last price this alert saw. A stateful condition with no previous observation
    (freshly armed, or the first sweep after a restart) cannot answer yet and stays quiet rather
    than guessing - the alternative is firing "crossing up" on arming, for a level the price has
    been above all week.
    """
    if price is None:
        return False
    condition = ALIASES.get(alert.get("condition"), alert.get("condition"))
    level = alert.get("price")

    if condition in ("greater", "less"):
        if level is None:
            return False
        # Inclusive, both ways. "Tell me at 100" means 100 - the same reading this has always had,
        # and the one that matches how a stop or a target is actually thought about.
        return price >= level if condition == "greater" else price <= level

    if condition in ("inside_channel", "outside_channel"):
        inside = _inside(price, alert)
        if inside is None:
            return False
        return inside if condition == "inside_channel" else not inside

    if condition in MOVE_CONDITIONS:
        reference, amount = alert.get("reference_price"), level
        if reference is None or amount is None or reference <= 0:
            return False
        move = price - reference
        if condition.endswith("_pct"):
            move = move / reference * 100
        return move >= amount if condition.startswith("moving_up") else -move >= amount

    # Everything below needs somewhere to have come from.
    if previous is None:
        return False

    if condition in ("crossing", "crossing_up", "crossing_down"):
        if level is None:
            return False
        up = previous < level <= price
        down = previous > level >= price
        if condition == "crossing_up":
            return up
        if condition == "crossing_down":
            return down
        return up or down

    if condition in ("entering_channel", "exiting_channel"):
        now_inside, was_inside = _inside(price, alert), _inside(previous, alert)
        if now_inside is None or was_inside is None:
            return False
        return now_inside and not was_inside if condition == "entering_channel" else (
            was_inside and not now_inside
        )

    return False


def expired(alert, now=None):
    """Past its expiry. An expired alert is disarmed by the sweep rather than deleted: the record
    of what was being watched, and that it never happened, is worth keeping."""
    at = alert.get("expires_at")
    if not at:
        return False
    if isinstance(at, str):
        at = datetime.fromisoformat(at)
    now = now or datetime.now(IST)
    if at.tzinfo is None:
        at = at.replace(tzinfo=now.tzinfo)
    return at <= now


def trigger_allows(alert, now=None):
    """Whether this alert's trigger mode lets it fire again right now."""
    trigger = trigger_of(alert)
    if trigger != "once_per_day":
        # 'once' disarms itself on firing, so reaching here means it is still armed; 'every_time'
        # has nothing to check.
        return True
    last = alert.get("triggered_at")
    if not last:
        return True
    if isinstance(last, str):
        last = datetime.fromisoformat(last)
    now = now or datetime.now(IST)
    return last.date() < now.date()


def should_fire(alert, price, previous=None, now=None):
    """The whole question: is this an armed, unexpired, price alert whose condition holds and
    whose trigger mode permits another firing."""
    if not alert.get("active") or alert.get("kind", "price") != "price":
        return False
    if expired(alert, now) or not trigger_allows(alert, now):
        return False
    return condition_holds(alert, price, previous)


# --- what it says when it fires --------------------------------------------------------------------


def describe(alert):
    """The condition in words, for the table and for the fired message. Deliberately spells out
    the numbers: an alert row that says only "Crossing" is a row you have to click to understand.
    """
    condition = ALIASES.get(alert.get("condition"), alert.get("condition"))
    label = CONDITION_LABELS.get(condition, condition or "?")
    if condition in CHANNEL_CONDITIONS:
        b = bounds(alert)
        return f"{label} ₹{b[0]:,.2f}–₹{b[1]:,.2f}" if b else label
    level = alert.get("price")
    if level is None:
        return label
    if condition in ("moving_up_pct", "moving_down_pct"):
        return f"{label} {level:g}%"
    if condition in ("moving_up", "moving_down"):
        return f"{label} ₹{level:,.2f}"
    return f"{label} ₹{level:,.2f}"


def message_for(alert, price):
    text = f"{alert['symbol']} — {describe(alert)} (₹{price:,.2f})"
    return f"{text} · {alert['note']}" if alert.get("note") else text


# --- the sweep ------------------------------------------------------------------------------------


def sweep(price_fn):
    """Check every armed price alert once. Returns how many fired.

    `price_fn(symbol) -> price | None` is injected so this runs in the self-check without a
    network. One symbol failing to quote must not stop the sweep: an unquotable ticker is not a
    reason to stop watching the other nine.

    The previous price is remembered PER ALERT rather than per symbol, so arming a crossing alert
    starts its history at the moment it was armed - not at whatever the symbol happened to print
    for some other alert an hour ago.
    """
    fired = 0
    alerts = [a for a in db.list_alerts(active=True) if a["kind"] == "price"]
    now = datetime.now(IST)

    for symbol in sorted({a["symbol"] for a in alerts if a["symbol"]}):
        try:
            price = price_fn(symbol)
        except Exception:  # noqa: BLE001 - one bad symbol must not halt the sweep
            continue
        if price is None:
            continue
        for alert in alerts:
            if alert["symbol"] != symbol:
                continue
            if expired(alert, now):
                db.disarm_alert(alert["id"])
                continue
            if should_fire(alert, price, alert.get("last_price"), now):
                # A repeating move alert re-references itself where it fired, so "up 5%" means
                # another 5% from here rather than firing on every sweep for the rest of the day.
                reference = price if alert["condition"] in MOVE_CONDITIONS else None
                db.fire_alert(
                    alert["id"],
                    price,
                    message_for(alert, price),
                    rearm=trigger_of(alert) != "once",
                    reference_price=reference,
                )
                fired += 1
            db.record_alert_price(alert["id"], price)
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
        active=False,
        triggered_at=datetime.now(IST).isoformat(),
        message=message,
        meta=meta or {},
    )

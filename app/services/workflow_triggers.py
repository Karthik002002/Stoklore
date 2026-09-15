"""What sets a workflow off, and when it is next due.

Two families of trigger, stored whole on `workflows.trigger`:

    time    schedule   {"time": "09:15"}                                   daily
            interval   {"every": 15, "unit": "minutes"|"hours",
                        "window": {"start": "09:15", "end": "15:30"}}      window optional
            weekly     {"days": [0, 3], "time": "08:30"}                  0 = Monday
            monthly    {"day": 20 | "last", "time": "10:00"}              31 in a short month = last
            cron       {"expr": "*/15 9-15 * * 1-5"}
            market     {"anchor": "open"|"close", "offset": -10}          minutes; trading days only
    event   event_scan     after the daily watchlist event scan
            price_alert    {"alert_ids": [..], "symbols": [..]}           empty = any alert
            order_event    {"events": ["filled", "rejected", ..]}         empty = any
            workflow_done  {"workflow_id": "..", "on": "success"|"failure"|"any"}

Any time trigger can carry `"trading_days_only": true` - weekends and NSE trading holidays are
skipped (`market` always is: "the open" on a holiday is not a time).

**Catch-up, never pile-up.** A trigger is due when its next slot after the LAST trigger is in the
past. A machine asleep through three slots runs once when it wakes, not three times, and a
restart can't double-fire because `last_triggered_at` is a column, not memory.

The pure half - validate, next_run, is_due, matches_event, label - takes `now` and a holiday set as
arguments and is checked in tests/workflow_triggers.selfcheck.py.
"""
import json
import threading
from calendar import monthrange
from datetime import date, datetime, time, timedelta

from croniter import croniter

from app.core import db
from app.core.config import IST

TIME_KINDS = ("schedule", "interval", "weekly", "monthly", "cron", "market")
EVENT_KINDS = ("event_scan", "price_alert", "order_event", "workflow_done")
TRIGGER_KINDS = ("manual", *TIME_KINDS, *EVENT_KINDS)

#: What an order event can be - the tags app/core/live.py puts on each order alert it records.
ORDER_EVENTS = ("sent", "filled", "rejected", "cancelled", "expired", "closed", "halted")

MARKET_OPEN = time(9, 15)
MARKET_CLOSE = time(15, 30)

#: A chain A -> B -> C stops here. Without a cap, A -> B -> A is an infinite loop of real tool calls.
MAX_CHAIN_DEPTH = 5

WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _hm(value):
    """'HH:MM' -> time. Raises ValueError on anything else, which validate() turns into a message."""
    hours, minutes = str(value).split(":")
    return time(int(hours), int(minutes))


def _at(day, at):
    return datetime.combine(day, at, tzinfo=IST)


def _market_time(trigger):
    anchor = MARKET_CLOSE if trigger.get("anchor") == "close" else MARKET_OPEN
    moment = datetime.combine(date(2000, 1, 1), anchor) + timedelta(minutes=int(trigger.get("offset") or 0))
    return moment.time()


def _step(trigger):
    every = int(trigger.get("every") or 0)
    return timedelta(hours=every) if trigger.get("unit") == "hours" else timedelta(minutes=every)


def validate(trigger):
    """None when the trigger can run, otherwise what's wrong - said at save time, not at 9am."""
    if not isinstance(trigger, dict):
        return "a trigger must be an object"
    kind = trigger.get("kind")
    if kind not in TRIGGER_KINDS:
        return f"unknown trigger '{kind}'"
    try:
        if kind in ("schedule", "weekly", "monthly"):
            _hm(trigger.get("time") or "09:15")
        if kind == "interval":
            if int(trigger.get("every") or 0) < 1:
                return "an interval needs to repeat every 1 or more"
            if trigger.get("unit") not in ("minutes", "hours"):
                return "an interval's unit is minutes or hours"
            window = trigger.get("window")
            if window and _hm(window["start"]) >= _hm(window["end"]):
                return "the window has to start before it ends"
        if kind == "weekly":
            days = trigger.get("days") or []
            if not days or any(d not in range(7) for d in days):
                return "pick at least one weekday"
        if kind == "monthly":
            day = trigger.get("day")
            if day != "last" and int(day or 0) not in range(1, 32):
                return "a monthly day is 1-31 or 'last'"
        if kind == "cron" and not croniter.is_valid(str(trigger.get("expr") or "")):
            return "that isn't a valid cron expression (minute hour day month weekday)"
        if kind == "market":
            if trigger.get("anchor") not in ("open", "close"):
                return "anchor to the market open or close"
            if abs(int(trigger.get("offset") or 0)) > 360:
                return "an offset is at most 6 hours either way"
        if kind == "order_event" and any(e not in ORDER_EVENTS for e in trigger.get("events") or []):
            return f"order events are {', '.join(ORDER_EVENTS)}"
        if kind == "workflow_done":
            if not trigger.get("workflow_id"):
                return "pick the workflow this one runs after"
            if (trigger.get("on") or "success") not in ("success", "failure", "any"):
                return "run on success, failure or any"
        if kind == "price_alert":
            [int(i) for i in trigger.get("alert_ids") or []]
    except (ValueError, TypeError, KeyError):
        return "a time is HH:MM and a count is a whole number"
    return None


def is_trading_day(day, holidays):
    return day.weekday() < 5 and day not in holidays


def _next_slot(trigger, after):
    """The next time this trigger's clock says go, strictly after `after`, ignoring trading days."""
    kind = trigger.get("kind")
    after = after.astimezone(IST)

    if kind in ("schedule", "market"):
        at = _market_time(trigger) if kind == "market" else _hm(trigger.get("time") or "09:15")
        slot = _at(after.date(), at)
        return slot if slot > after else _at(after.date() + timedelta(days=1), at)

    if kind == "weekly":
        at, days = _hm(trigger.get("time") or "09:15"), set(trigger.get("days") or [])
        for offset in range(8):
            day = after.date() + timedelta(days=offset)
            if day.weekday() in days and _at(day, at) > after:
                return _at(day, at)
        return None

    if kind == "monthly":
        at, wanted = _hm(trigger.get("time") or "09:15"), trigger.get("day")
        year, month = after.year, after.month
        for _ in range(13):
            last = monthrange(year, month)[1]
            slot = _at(date(year, month, last if wanted == "last" else min(int(wanted), last)), at)
            if slot > after:
                return slot
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        return None

    if kind == "cron":
        return croniter(trigger["expr"], after).get_next(datetime).astimezone(IST)

    if kind == "interval":
        slot = after + _step(trigger)
        window = trigger.get("window")
        if window:
            start, end = _hm(window["start"]), _hm(window["end"])
            if slot < _at(slot.date(), start):
                slot = _at(slot.date(), start)
            elif slot > _at(slot.date(), end):
                slot = _at(slot.date() + timedelta(days=1), start)
        return slot

    return None


def _guarded(trigger):
    return trigger.get("kind") == "market" or bool(trigger.get("trading_days_only"))


def next_run(trigger, after, holidays=frozenset()):
    """The next run strictly after `after`, with weekends and holidays skipped when asked to."""
    if trigger.get("kind") not in TIME_KINDS:
        return None
    slot = _next_slot(trigger, after)
    # Bounded: a year of holidays in a row is not a schedule, it's a bug.
    for _ in range(400):
        if slot is None or not _guarded(trigger) or is_trading_day(slot.date(), holidays):
            return slot
        if trigger["kind"] == "interval":
            window = trigger.get("window")
            slot = _at(slot.date() + timedelta(days=1), _hm(window["start"]) if window else time(0, 0))
        else:
            slot = _next_slot(trigger, _at(slot.date(), time(23, 59, 59)))
    return None


def _allowed_now(trigger, now, holidays):
    """For an interval that has never run: may it start right now?"""
    if _guarded(trigger) and not is_trading_day(now.date(), holidays):
        return False
    window = trigger.get("window")
    return not window or _hm(window["start"]) <= now.time() <= _hm(window["end"])


def baseline(workflow, now):
    """The moment the next run is counted from. None means "never ran, due as soon as allowed" -
    only an interval gets that; a calendar trigger never backfills slots from before it existed."""
    last = workflow.get("last_triggered_at")
    if last:
        return last if isinstance(last, datetime) else datetime.fromisoformat(str(last))
    if workflow.get("last_run_date"):
        # Rows from before last_triggered_at existed: "ran that day" is all they know.
        ran = workflow["last_run_date"]
        ran = ran if isinstance(ran, date) else date.fromisoformat(str(ran))
        return _at(ran, time(23, 59, 59))
    if (workflow.get("trigger") or {}).get("kind") == "interval":
        return None
    # Start of today, so today's slot still counts if it has already passed - the same thing the
    # old daily schedule did when armed after its time.
    return _at(now.date(), time(0, 0)) - timedelta(seconds=1)


def is_due(workflow, now, holidays=frozenset()):
    trigger = workflow.get("trigger") or {}
    if trigger.get("kind") not in TIME_KINDS:
        return False
    base = baseline(workflow, now)
    if base is None:
        return _allowed_now(trigger, now, holidays)
    slot = next_run(trigger, base, holidays)
    return slot is not None and slot <= now


def next_run_at(workflow, now, holidays=frozenset()):
    """When an armed time-triggered workflow will next go, for the UI. Overdue means the next tick."""
    trigger = workflow.get("trigger") or {}
    if not workflow.get("enabled") or trigger.get("kind") not in TIME_KINDS:
        return None
    base = baseline(workflow, now)
    if base is None:
        return now if _allowed_now(trigger, now, holidays) else next_run(trigger, now, holidays)
    slot = next_run(trigger, base, holidays)
    return max(slot, now) if slot else None


def upcoming(trigger, now, count=5, holidays=frozenset()):
    """The next `count` runs from now - what the editor previews before you arm anything."""
    runs, after = [], now
    for _ in range(count):
        slot = next_run(trigger, after, holidays)
        if slot is None:
            break
        runs.append(slot)
        after = slot
    return runs


def matches_event(trigger, kind, payload):
    if trigger.get("kind") != kind:
        return False
    if kind == "price_alert":
        ids = [int(i) for i in trigger.get("alert_ids") or []]
        symbols = {s.upper() for s in trigger.get("symbols") or []}
        return (not ids or payload.get("alert_id") in ids) and (
            not symbols or (payload.get("symbol") or "").upper() in symbols
        )
    if kind == "order_event":
        events = trigger.get("events") or []
        return not events or payload.get("event") in events
    if kind == "workflow_done":
        if trigger.get("workflow_id") != payload.get("workflow_id"):
            return False
        on = trigger.get("on") or "success"
        return on == "any" or on == ("success" if payload.get("status") == "done" else "failure")
    return True


def _ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def label(trigger, names=None):
    """One line saying when it runs - the list, the overview and the editor all read this."""
    kind = trigger.get("kind")
    at = trigger.get("time") or "09:15"
    text = {
        "manual": "Manual only",
        "schedule": f"Daily at {at} IST",
        "event_scan": "After the daily event scan",
    }.get(kind)
    if kind == "interval":
        unit = "min" if trigger.get("unit") != "hours" else ("hour" if trigger.get("every") == 1 else "hours")
        text = f"Every {trigger.get('every')} {unit}"
        if trigger.get("window"):
            text += f", {trigger['window']['start']}–{trigger['window']['end']}"
    elif kind == "weekly":
        text = f"{', '.join(WEEKDAYS[d] for d in sorted(trigger.get('days') or []))} at {at} IST"
    elif kind == "monthly":
        day = trigger.get("day")
        text = f"{'Last day' if day == 'last' else f'The {_ordinal(int(day or 1))}'} of each month at {at} IST"
    elif kind == "cron":
        text = f"Cron {trigger.get('expr')}"
    elif kind == "market":
        offset = int(trigger.get("offset") or 0)
        text = f"Market {trigger.get('anchor') or 'open'}" + (
            f" {'+' if offset > 0 else '−'}{abs(offset)} min" if offset else ""
        )
    elif kind == "price_alert":
        symbols = trigger.get("symbols") or []
        text = "When a price alert fires" + (f" ({', '.join(symbols)})" if symbols else "")
    elif kind == "order_event":
        events = trigger.get("events") or []
        text = f"On order {'/'.join(events) if events else 'events'}"
    elif kind == "workflow_done":
        name = (names or {}).get(trigger.get("workflow_id"), "another workflow")
        on = trigger.get("on") or "success"
        text = f"After '{name}' {'finishes' if on == 'any' else ('succeeds' if on == 'success' else 'fails')}"
    if text and kind in TIME_KINDS and kind != "market" and trigger.get("trading_days_only"):
        text += " · trading days"
    return text or str(kind)


# --- the impure half ---------------------------------------------------------------------------------

_holidays = {"on": None, "dates": frozenset()}


def trading_holidays():
    """NSE's trading holidays, from its own holiday master. Cached in settings for a week and in
    memory for the day - the minute tick asks constantly, NSE should be asked rarely. A failed
    fetch keeps the last good list; with none at all, only weekends are skipped."""
    today = datetime.now(IST).date()
    if _holidays["on"] == today:
        return _holidays["dates"]
    stored = db.get_setting_value("nse_trading_holidays")
    data = json.loads(stored) if stored else None
    if not data or (today - date.fromisoformat(data["fetched"])).days >= 7:
        try:
            from app.core import shareholding

            rows = (shareholding._nse_json("/api/holiday-master?type=trading") or {}).get("CM") or []
            dates = sorted({
                datetime.strptime(r["tradingDate"], "%d-%b-%Y").date().isoformat()
                for r in rows if r.get("tradingDate")
            })
            if dates:
                data = {"fetched": today.isoformat(), "dates": dates}
                db.set_setting_value("nse_trading_holidays", json.dumps(data))
        except Exception:  # noqa: BLE001 - a holiday list we can't refresh is not a reason to stop
            pass
    _holidays.update(on=today, dates=frozenset(date.fromisoformat(d) for d in (data or {}).get("dates", [])))
    return _holidays["dates"]


def _start(workflow, now, payload):
    from app.services.workflow_engine import workflow_engine_run

    db.mark_workflow_triggered(workflow["id"], now)
    threading.Thread(
        target=workflow_engine_run, args=(workflow,), kwargs={"payload": payload}, daemon=True
    ).start()


def run_due(now=None):
    """Every armed time-triggered workflow whose slot has come. Called by the minute tick."""
    now = now or datetime.now(IST)
    workflows = [w for w in db.list_workflows()
                 if w.get("enabled") and (w.get("trigger") or {}).get("kind") in TIME_KINDS]
    holidays = trading_holidays() if any(_guarded(w["trigger"]) for w in workflows) else frozenset()
    started = 0
    for workflow in workflows:
        if not is_due(workflow, now, holidays):
            continue
        if db.running_workflow_run(workflow["id"]):
            # Still going from last time. Skipped, not queued - it becomes due again on the next
            # tick, so it starts the moment the previous run ends instead of stacking copies.
            continue
        _start(workflow, now, {"trigger": workflow["trigger"]["kind"], "scheduled_for": now.isoformat()})
        started += 1
    return started


def fire_event(kind, payload=None):
    """Something happened; start every armed workflow listening for it. Returns how many."""
    payload = payload or {}
    now = datetime.now(IST)
    depth = int(payload.get("chain_depth") or 0)
    started = 0
    for workflow in db.list_workflows():
        if not workflow.get("enabled") or not matches_event(workflow.get("trigger") or {}, kind, payload):
            continue
        if kind == "workflow_done" and (workflow["id"] == payload.get("workflow_id") or depth >= MAX_CHAIN_DEPTH):
            continue
        if db.running_workflow_run(workflow["id"]):
            continue
        _start(workflow, now, {**payload, "trigger": kind})
        started += 1
    return started


def fire_event_quietly(kind, payload=None):
    """For hooks inside other subsystems (the alert sweep, the order mirror): a workflow problem must
    never break the thing that noticed the event."""
    try:
        return fire_event(kind, payload)
    except Exception:  # noqa: BLE001
        return 0

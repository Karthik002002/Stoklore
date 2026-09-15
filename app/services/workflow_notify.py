"""What a workflow tells you, and when.

Every notification a workflow makes is an `alerts` row of kind 'workflow' carrying
`meta.workflow_id` and `meta.run_id` - which is what lets the workflow's own inbox list them and a
click open the run that made one. Whether it is DELIVERED (shown in the global feed, sent to
Telegram, popped on the desktop) is decided here, per workflow, from `workflows.notify`:

    on_failure / on_output   off -> still kept in the workflow's inbox, just not delivered
    on_success               off -> not kept at all; a success is only news if you asked for it
    muted / snooze_until     kept, not delivered
    quiet_start/quiet_end    held, then delivered when the quiet window ends
    digest                   whether it goes into the 18:00 roll-up
    telegram                 also send it to the Telegram chat in Settings

`decide` is pure and checked in tests/workflow_triggers.selfcheck.py.
"""
import threading
from datetime import datetime, timedelta

import requests

from app.core import alerts, db
from app.core.config import IST

DEFAULT_NOTIFY = {
    "on_failure": True,
    "on_success": False,
    "on_output": True,
    "muted": False,
    "snooze_until": None,
    "quiet_start": None,
    "quiet_end": None,
    "digest": True,
    "telegram": False,
}
EVENTS = ("failure", "success", "output")


def rules(workflow):
    return {**DEFAULT_NOTIFY, **(workflow.get("notify") or {})}


def _hm(value):
    hours, minutes = str(value).split(":")
    return int(hours) * 60 + int(minutes)


def validate(notify):
    """(clean rules, None) or (None, what's wrong). Unknown keys are dropped rather than stored."""
    clean = {**DEFAULT_NOTIFY, **{k: v for k, v in (notify or {}).items() if k in DEFAULT_NOTIFY}}
    try:
        if bool(clean["quiet_start"]) != bool(clean["quiet_end"]):
            return None, "quiet hours need both a start and an end"
        if clean["quiet_start"] and _hm(clean["quiet_start"]) == _hm(clean["quiet_end"]):
            return None, "quiet hours can't start and end at the same time"
        if clean["snooze_until"]:
            datetime.fromisoformat(clean["snooze_until"])
    except (ValueError, TypeError):
        return None, "times are HH:MM and a snooze is an ISO date-time"
    return clean, None


def _quiet_until(start, end, now):
    """When the quiet window containing `now` ends, or None if `now` isn't in one. A window may
    wrap midnight (22:00-07:00)."""
    minute, lo, hi = now.hour * 60 + now.minute, _hm(start), _hm(end)
    inside = lo <= minute < hi if lo < hi else (minute >= lo or minute < hi)
    if not inside:
        return None
    ends = now.replace(hour=hi // 60, minute=hi % 60, second=0, microsecond=0)
    return ends if ends > now else ends + timedelta(days=1)


def decide(notify, event, now):
    """('skip' | 'silent' | 'hold' | 'deliver', held_until)."""
    r = {**DEFAULT_NOTIFY, **(notify or {})}
    if not r.get(f"on_{event}"):
        return ("skip" if event == "success" else "silent"), None
    if r["muted"]:
        return "silent", None
    if r["snooze_until"] and datetime.fromisoformat(r["snooze_until"]) > now:
        return "silent", None
    if r["quiet_start"] and r["quiet_end"]:
        until = _quiet_until(r["quiet_start"], r["quiet_end"], now)
        if until:
            return "hold", until
    return "deliver", None


def notify(workflow, event, message, run_id=None, symbol=None, extra=None, now=None):
    """Records one notification for a workflow and delivers it if its rules allow. Returns the row
    id, or None when the rules said not to keep it."""
    if not workflow.get("id"):
        # A graph executed outside a saved workflow (the self-checks) has no rules and no inbox.
        return alerts.record("workflow", message, symbol=symbol, meta=extra)
    now = now or datetime.now(IST)
    action, held_until = decide(workflow.get("notify"), event, now)
    if action == "skip":
        return None
    meta = {**(extra or {}), "workflow_id": workflow["id"], "run_id": run_id, "event": event,
            "delivered": action == "deliver"}
    if held_until:
        meta["held_until"] = held_until.isoformat()
    if action == "deliver":
        meta["delivered_at"] = now.isoformat()
    alert_id = alerts.record("workflow", message, symbol=symbol, meta=meta)
    if action == "deliver" and rules(workflow)["telegram"]:
        send_telegram_async(f"{workflow['name']}\n{message}")
    return alert_id


def release_held(now=None):
    """Delivers everything whose quiet window has ended. Called by the minute tick."""
    now = now or datetime.now(IST)
    workflows = {w["id"]: w for w in db.list_workflows()}
    released = 0
    for row in db.list_held_workflow_notifications(now):
        db.merge_alert_meta(row["id"], {"delivered": True, "delivered_at": now.isoformat(), "held_until": None})
        workflow = workflows.get((row.get("meta") or {}).get("workflow_id"))
        if workflow and rules(workflow)["telegram"]:
            send_telegram_async(f"{workflow['name']}\n{row['message']}")
        released += 1
    return released


# --- Telegram -------------------------------------------------------------------------------------


def send_telegram(text):
    """Sends one message to the chat in Settings. Returns None, or the error - also remembered, so
    the Settings tab can say why nothing is arriving."""
    token = db.get_setting_value("telegram_bot_token")
    chat_id = db.get_setting_value("telegram_chat_id")
    if not token or not chat_id:
        return "Telegram isn't set up - add a bot token and chat id in Settings"
    try:
        response = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text[:4000], "disable_web_page_preview": True},
            timeout=10,
        )
        body = response.json() if response.content else {}
        error = None if body.get("ok") else (body.get("description") or f"HTTP {response.status_code}")
    except (requests.RequestException, ValueError) as e:
        error = str(e)
    db.set_setting_value("telegram_last_error", error or "")
    return error


def send_telegram_async(text):
    # A slow Telegram must not hold up the run that is reporting.
    threading.Thread(target=send_telegram, args=(text,), daemon=True).start()

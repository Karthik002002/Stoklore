# Workflows

[← Back to index](README.md)

`/workflows` — the agent's tools, wired into a graph and run **without you**. It
used to be a tab on `/agent`. It moved to its own section once workflows grew
triggers, a run history, collected data and an inbox, and each of those is a
screen of its own. Building the graph itself (node kinds, templates, conditions,
fan-out) is covered in [Agent](agent.md#building-a-workflow).

## Pages

Every screen is a URL, so a reload, a bookmark, or a click on a notification
lands exactly where it points.

| Screen | URL |
|---|---|
| All workflows | `/workflows?status=running\|succeeded\|failed\|never\|armed` |
| New workflow | `/workflows/new`, which moves to `/workflows/<id>/editor` on first save |
| Overview | `/workflows/<id>` |
| Editor | `/workflows/<id>/editor?node=<nodeId>` |
| Runs | `/workflows/<id>/runs?status=failed\|done\|running` |
| One run | `/workflows/<id>/runs/<runId>?node=<nodeId>` (`node` is the step open in the drawer) |
| Data | `/workflows/<id>/data?series=&column=&by=` |
| Notifications | `/workflows/<id>/notifications?filter=unread&open=<notificationId>` |

Every old `/agent/workflows/…` link redirects to the same screen at its new
address. A bare `/agent/workflows/<id>` opened the editor, so it still does.
`/agent?view=workflow` goes to `/workflows`.

**The list** shows status counts that double as filters, each workflow's newest
run, when it runs next, and an unread-notifications bell. It polls every 5
seconds, because a scheduled run starts on the server with nobody clicking
anything.

**A workflow's header** carries its name, last-run status, trigger, next run,
**Run now** and the **arm** switch, above five tabs:

- **Overview**
  - when it runs, with the next five slots
  - the last run
  - health (runs kept, failures, average duration, worst node, a bar per run)
  - the latest notifications
  - collected series
  - what it's chained to
  - details
- **Editor** — the canvas. Its own **Save & run** replaces the header's Run
  button there, because the header would run the saved copy while the canvas
  may hold unsaved edits.
- **Runs** — every kept run, filterable. A row opens its diagram. Pressing
  **Run now** while on this tab jumps straight to the new run.
- **Data** — the collected series, as a chart and a table.
- **Notifications** — the inbox and the delivery rules (below).

## Triggers

Picked in the editor's **When it runs** panel. Under the fields, a preview asks
the server for the **next five runs**, with holidays skipped, so a bad cron or
"the 31st" shows its consequence before anything is armed.

| Trigger | Stored as | Example |
|---|---|---|
| Manual only | `{"kind": "manual"}` | Run now, nothing else |
| Daily | `{"kind": "schedule", "time": "09:15"}` | every day at 09:15 |
| Interval | `{"kind": "interval", "every": 15, "unit": "minutes", "window": {"start": "09:15", "end": "15:30"}}` | every 15 min during market hours; the window is optional |
| Weekly | `{"kind": "weekly", "days": [0, 3], "time": "08:30"}` | Mon & Thu (0 = Monday) |
| Monthly | `{"kind": "monthly", "day": 20, "time": "10:00"}` | the 20th; `"day": "last"` for month end |
| Market | `{"kind": "market", "anchor": "open", "offset": 10}` | 09:25; a negative offset runs before |
| Cron | `{"kind": "cron", "expr": "*/15 9-15 * * 1-5"}` | anything the pickers can't say |
| After the event scan | `{"kind": "event_scan"}` | on what the daily scan just found |
| Price alert fires | `{"kind": "price_alert", "alert_ids": [], "symbols": ["RELIANCE"]}` | empty lists mean any alert |
| Live order event | `{"kind": "order_event", "events": ["filled", "rejected"]}` | `sent filled rejected cancelled expired closed halted` |
| After another workflow | `{"kind": "workflow_done", "workflow_id": "…", "on": "success"}` | `success`, `failure` or `any` |

**Trading days only.** Any clock trigger can set `trading_days_only`. It skips
weekends and **NSE trading holidays**, taken from NSE's own holiday master
(`/api/holiday-master`, the `CM` segment). The list is cached in settings for a
week and in memory for the day. A failed refresh keeps the last good list; with
no list at all, only weekends are skipped. `market` is always trading-days-only,
since "the open" on a holiday is not a time.

A 31st in a short month runs on that month's last day.

**Catch-up, never pile-up.** A clock trigger is due when its next slot *after the
last time it started* has passed. That moment is stored in
`workflows.last_triggered_at`.

- A machine asleep through three slots runs **once** when it wakes.
- A restart can't double-fire.
- A calendar trigger armed today never backfills slots from before it existed.
  If today's slot has already passed, it runs today, as the old daily schedule
  did.
- An interval that has never run starts on the next tick, if it's inside its
  window.

**One run at a time.** A workflow whose previous run is still going is skipped
on that tick and becomes due again on the next, so it starts the moment the
earlier run ends instead of stacking copies. The scheduler ticks **every
minute**, the shortest an interval can be; with nothing due, a tick is one
indexed query.

### What a trigger passes in

Event triggers hand their details to the **trigger node**, so the rest of the
graph can use them. The editor shows the exact references for your graph.

| Trigger | `{{ triggerNode.… }}` |
|---|---|
| Price alert | `symbol` `price` `condition` `message` `alert_id` |
| Order event | `event` `symbol` `message` `order_id` |
| After another workflow | `workflow_name` `status` `summary` `run_id` |
| Clock triggers | `scheduled_for` |

For example: *RELIANCE crossed 3000 → `get_recent_events` for
`{{ t.symbol }}` → an agent step asks why → file it.*

**Chains stop at depth 5.** A workflow can't be chained after itself; the save
is refused. A loop like A → B → A ends after five hops instead of running real
tool calls forever.

**Hooks.** The price-alert sweep (`alerts.sweep`) and the order mirror
(`live.py`, through `alerts.record` with `meta.event`) start matching workflows.
A workflow problem never breaks the sweep or the mirror
(`fire_event_quietly`).

## Notifications

Everything a workflow tells you is an alerts row of kind `workflow` carrying
`meta.workflow_id` and `meta.run_id`. That's what gives each workflow its own
inbox, and what lets a click open the run that made a notification.

### The inbox

- **All / Unread**, **Mark all read**, and delete (hover a row).
- **Opening one** (`?open=<id>`) marks it read and shows:
  - the full message, with copy
  - how it was delivered: delivered, held until the end of quiet hours, or kept
    quiet
  - **the run** — status and duration, with a link to its diagram. If a step
    failed, the link opens that step's details directly.
  - **the data that run collected**, as a table, with **Open in Data**
  - the workflow's details: trigger, arm state, next run, nodes
- A notification in the global **Alerts** feed opens here too, as does a desktop
  notification.

### Delivery rules

Each workflow has its own rules, on the right of its Notifications tab. They save
on change and are stored as `workflows.notify`.

| Rule | Off / on means |
|---|---|
| Tell me when it fails | off → still **kept** in the inbox, just not delivered |
| …files something (output node) | off → kept, not delivered |
| …succeeds | off (the default) → not kept at all; a success is only news if you asked |
| Mute | kept, not delivered, until you turn it back on |
| Snooze | 1 h / 4 h / until tomorrow 09:00 / a week; kept, not delivered, until then |
| Quiet hours | e.g. 22:00–07:00 (wraps midnight); **held**, then delivered when the window ends |
| Daily digest | whether it's rolled into the 18:00 summary |
| Send to Telegram | also send delivered notifications to the Telegram chat in Settings |

"Delivered" means it shows in the global alerts feed, pops up as a desktop
notification if permission is granted, and goes to Telegram if that's on. The
inbox always has everything, so muting a workflow never loses what it said. Held
notifications are released by the same minute tick.

### Telegram

Settings → **Telegram**.

1. Message `@BotFather`, send `/newbot`, and paste the token.
2. Send your new bot any message (a bot can't write to you first).
3. Open `https://api.telegram.org/bot<token>/getUpdates` and copy
   `message.chat.id`.
4. Save, then **Send test message**.
5. Turn on **Send to Telegram** per workflow.

The token is write-only; the settings endpoint never returns it. A failed send
is remembered and shown in the tab, so silence has a reason you can see.

## What is checked

```bash
.venv/bin/python tests/workflow_triggers.selfcheck.py
```

Pure, with no clock, database or network: every trigger's validation, the next
run for each kind, and trading days with a pretend holiday. It also covers:

- month ends: the 31st in February, and `last` rolling the year
- catch-up after a three-day sleep
- rows from before `last_triggered_at` existed
- no backfill for a freshly armed monthly
- event matching
- trigger labels
- every notification rule, including quiet hours that wrap midnight

The database side was verified against a throwaway database, never the live one:

- notify, mute, hold and release
- one workflow unable to read or delete another's notifications
- the delivered-only global feed
- the run-scoped data query

**Not covered:** the minute loop itself and Telegram delivery. They need a
running server and a real bot.

| Piece | Job |
|---|---|
| `app/services/workflow_triggers.py` | Trigger kinds, next run, due check, event matching, NSE holidays, starting runs |
| `app/services/workflow_notify.py` | Delivery rules, quiet-hours release, Telegram |
| `app/services/jobs.py` | The minute tick: due workflows, held notifications, the digest |
| `app/routers/workflows.py` | Trigger preview, notify rules, per-workflow inbox endpoints |
| `frontend/src/workflows/WorkflowLayout.tsx` | The section shell, one workflow's header and tabs |
| `frontend/src/workflows/TriggerForm.tsx` | The trigger picker and next-runs preview |
| `frontend/src/workflows/WorkflowOverview.tsx` | The overview cards |
| `frontend/src/workflows/WorkflowRuns.tsx` | The run history |
| `frontend/src/workflows/WorkflowNotifications.tsx` | Inbox, detail drawer, delivery rules |
| `frontend/src/workflows/status.ts` | Shared run state, trigger icons, the polled list, run/arm/delete |

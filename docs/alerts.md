# Alerts

[← Back to index](README.md)

A price condition worth being told about, and one feed for everything that has already happened.

`/alerts` — the table of what is being watched, and the log of what fired. Alerts run **whether or
not live trading is switched on**: watching a level is not trading, and usually precedes deciding
to.

## The thirteen conditions

Set on the current price of one symbol. Nine of them read only the current price; four compare it
against the previous check, which is the difference that decides which one you should pick.

| Condition | Fires when | Needs history |
|---|---|:--:|
| Greater than | price is at or above the level | |
| Less than | price is at or below the level | |
| Crossing | the level sits between the last check and this one | ● |
| Crossing up | it was below the level, now it is at or above | ● |
| Crossing down | it was above the level, now it is at or below | ● |
| Inside channel | price is between the two bounds | |
| Outside channel | price is beyond either bound | |
| Entering channel | it was outside the bounds, now it is inside | ● |
| Exiting channel | it was inside the bounds, now it is outside | ● |
| Moving up | price is up by ₹X from the reference | |
| Moving down | price is down by ₹X from the reference | |
| Moving up % | price is up by X% from the reference | |
| Moving down % | price is down by X% from the reference | |

**Greater than / Less than are inclusive.** "Tell me at 100" means 100 — the same reading these
have always had, and the way a stop or a target is actually thought about.

**A channel's bounds go in either order.** 90–110 and 110–90 are the same channel.

### The one thing a crossing can't do

The sweep sees the price every few seconds, from a delayed quote. A price that crosses 100 and
comes back inside one interval never produces two observations either side of the level, and a
crossing alert stays quiet. That is not a bug waiting to be fixed — it is what polling a delayed
feed can see, and it is exactly why **Greater than** exists beside **Crossing up**: a level test
cannot be missed. Pick it when being told matters more than being told at the instant. The dialog
says so where the choice is made.

### What "moving" measures from

Not the previous candle — this app never sees a candle in the sweep, only a last price. A move is
measured from the alert's **reference price**: what the symbol was worth when the alert was armed,
re-captured each time it fires. So a repeating "Moving up 5%" means another 5% from wherever it
last went off, not 5% from Monday for the rest of the week.

## Trigger and expiry

- **Only once** — fires and disarms. The default, and what a target wants.
- **Once per day** — at most one firing per trading day, then it re-arms overnight. The honest
  equivalent of a charting package's "once per bar" when the bar is a day.
- **Every time** — fires on every sweep the condition holds for. Noisy on purpose.

**Expires** disarms the alert at a date and time. An expired alert is disarmed, not deleted: what
was being watched, and that it never happened, is worth keeping.

**Message** is your own line, and it travels into the notification.

## The table

One row per armed or paused alert: the symbol, the condition spelled out with its numbers, the
trigger and how many times it has fired, the expiry, and the **last check** — the price this alert
last saw. On a crossing condition that column is not decoration; it is the other half of the
comparison the next sweep will make.

Pause, edit and delete are per row. Pausing is the same operation as editing (`active: false`), so
a paused alert keeps everything it was watching for.

## What happened

Fired alerts and everything the broker did, in one list. Two kinds share one table and one feed
because they answer the same question — "what happened that I should know about" — and a trader
watching a position does not want two inboxes:

- **price** alerts are the ones you set.
- **order** alerts are written by the live mirror when Dhan reports a fill, a rejection, or a
  position going flat. Nobody sets those; they are what the account did.

## How it runs

The sweep lives in the live poller (`app/core/live.py`), every few seconds while the market is
open, on the same quote cache the rest of the app uses so the poller and the screen can't disagree
about what "now" is. One symbol failing to quote is skipped — an unquotable ticker is not a reason
to stop watching the other nine.

The previous price is remembered **per alert**, not per symbol, so arming a crossing alert starts
its history at the moment it was armed rather than at whatever that symbol last printed for some
other alert an hour ago.

| Piece | Job |
|---|---|
| `app/core/alerts.py` | The condition vocabulary, `condition_holds`, and the sweep |
| `app/routers/alerts.py` | `/api/alerts`, and `/api/alerts/conditions` — which the picker is built from |
| `frontend/src/Alerts.tsx` | The page |

The UI fetches the condition list from the backend rather than hardcoding it, so a condition can
never appear in the picker without the engine knowing how to evaluate it.

## What is checked

```bash
.venv/bin/python tests/alerts.selfcheck.py
```

Every condition against a table of prices: what happens exactly *at* a level, what a stateful
condition does before it has seen anything (it stays quiet — it must not fire "crossing up" on
arming, for a level the price has been above all week), channels typed in either order, moves with
no reference price, expiry, the three trigger modes, and that each condition fires for some price
and not for every price.

**Not covered:** the sweep itself against a live quote feed. `condition_holds` is pure and fully
checked; the loop around it is exercised by using the app.

## Older alerts

The two conditions this shipped with — `above` and `below` — are still first-class, and every
alert armed before the rest existed keeps firing exactly as it did. They read as Greater than and
Less than in the UI.

# Live Trading (Dhan)

[← Back to index](README.md)

Real orders, from the app, against your own Dhan account — plus the alert feed that tells you what
the broker did while you were looking at something else.

> **This spends real money.** It ships switched **off**, with caps, a kill switch and a daily loss
> stop. Read [Before the first real order](#before-the-first-real-order) before you turn it on.

## Using it

- `/live` — the state bar says whether an order can be sent at all, then the ticket, your positions,
  today's orders, and the alerts panel.
- Click a position to open `/live/:symbol` — the Bar Replay chart with the position on it. Drag the
  stop or target line and the change goes to the broker.
- **Kill switch** halts for the rest of the day and cancels every working order. It does **not**
  close open positions (see [why](#what-the-kill-switch-does-not-do)).
- Alerts: type a symbol, a level, above/below. Fills, rejections and closed positions arrive in the
  same feed without being asked for.

## How it works

**Nothing here simulates anything.** [Paper trading](paper-trading.md) owns a position and decides
when it fills; this owns nothing. `app/core/live.py` asks Dhan what happened and writes it down,
and every screen reads that mirror. Where the app and the broker disagree, the broker is right and
this is a bug — which is why there is no local fill logic to disagree *with*.

| Piece | Job |
|---|---|
| `app/core/dhan_orders.py` | Payloads, guardrails, parsing. Pure functions above the line, one `send()` below it |
| `app/core/live.py` | The sequence: guardrails → send → mirror → alert → journal |
| `app/core/alerts.py` | Price levels and the notification feed |
| `app/routers/live_trading.py` | `/api/live/*` |
| `app/routers/alerts.py` | `/api/alerts` |

**Orders are Super Orders** when a stop or target is set: entry, target and stop go to Dhan as one
order, so the exits live at the broker. A stop that only exists in this app's poller is not a stop —
it dies with the process, the laptop lid, or the wifi.

**Symbols are resolved through Dhan's scrip master**, cached in memory and refreshed daily. Only
NSE cash equities with series `EQ` are tradable here; the same file lists SDL bonds and SME scrips
under the same instrument name, and the series filter is what stops an order being routed to one.

**The mirror runs every 5 seconds** while the market is open (same cadence and shape as the paper
poller). Each sweep reads the order book, the super-order book and the position book; anything whose
status moved raises an alert, and any position that went **flat** becomes a journal entry.

**A super order's legs are rows of their own**, keyed `<order id>:<leg>`, because Dhan gives every
leg the *same* `orderId` as its entry — key the mirror on that alone and the resting stop lands on
the entry's row, which then reads half entry and half stop and no stop exists anywhere. The real id
is in `parent_order_id`, which is what a cancel sends; the daily order count ignores leg rows, since
a super order is one order against the limit, not three. `omsErrorDescription` is only shown when
the status says the order failed: Dhan puts `TRADE CONFIRMED` in that field on orders that worked.

**Journalling reads positions, not orders.** A round trip is "net quantity reached zero", which is
true however it got there — averaging in, three partial exits, a stop that filled in two prints. It
lands in `manual_trades` tagged `live`, so real trades show up in Statistics and Simulation next to
everything else. Set the account under Settings; without one the trade is announced but not filed,
because guessing which account a real trade belongs to is worse than leaving it to you.

**The wallet is on screen.** Dhan's fund limit (deployable cash) sits in the state bar, cached for
30 seconds server-side — the status endpoint is polled every 10s by the open page and the balance
only moves when an order fills. A failed fetch keeps the last good reading rather than blanking it:
a slightly stale balance is still the right order of magnitude for the size warnings that read it,
and a blank one would read as an empty account.

**The order ticket sizes against it as you type.** It shows the position's rupee value and its
share of the wallet, and warns — never blocks — when the position costs more than the account
holds, is over the per-order rupee cap, or takes more than `max_position_pct` of the wallet. The
percentage is the one that travels: ₹20,000 is nothing on one account and most of another. The
rupee cap warning is worded exactly as the backend's refusal, so the guardrail is never the first
time you hear about it (`frontend/src/lib/liveSizing.ts`, checked by
`node frontend/src/lib/liveSizing.selfcheck.ts`).

**Price alerts run whether or not live trading is on** — watching a level is not trading, and
usually precedes deciding to.

### The guardrails

Every one is a refusal, checked before the network call, all in one pass so a wrong order tells you
everything that's wrong with it at once (`guardrail_errors`):

- live trading switched off, or halted for the day
- no credentials, quantity ≤ 0, a fractional quantity, no price to size against
- order value over the per-order cap (`max_position_pct` is advisory and warns instead)
- more orders today than the daily count
- realised loss today at or past the daily loss limit
- a stop or target on the wrong side of the entry — a typo that would fire on the next tick

The daily loss stop also trips **by itself**: every sweep sums realised P&L, and hitting the limit
halts trading and writes an alert. Realised only — an open position moving against you is not yet a
loss, and halting on unrealised P&L means halting on a wick.

### Timeouts, and why nothing is retried

A `POST` that times out may have placed an order. Sending it again is how one intention becomes two
positions. So:

1. Every intent is written to `live_intents` **before** the request goes out, with a correlation id.
2. If the send fails, the intent is marked `unconfirmed` and the app says so on the page, loudly.
3. The only supported next step is **Check with broker** (`POST /api/live/recover`), which looks for
   that correlation id in the broker's own order book.

There is no retry button anywhere, deliberately.

### What the kill switch does not do

It halts and cancels working orders. It does not liquidate. Cancelling an unfilled order takes back
an intention; closing a position is a trade — and a panic button that trades on your behalf, in a
moment you pressed it because something was wrong, is a worse feature than the problem it solves.
Closing is one click away on each position, and that click is yours.

### Chart management

`/live/:symbol` reuses the Bar Replay chart with the broker's legs drawn on it. Dragging the stop
line sends a modify for `STOP_LOSS_LEG`; the target line sends `TARGET_LEG`. There is no local copy
to update, so a refused modify simply snaps the line back on the next poll.

Two chart actions are answered with an explanation instead of an order: placing a *second* level,
and resizing a leg. A Super Order carries one stop and one target sized to the entry — scaling out
is a different order, and a chart drag is not enough intent to send one.

## Before the first real order

1. **Use the sandbox.** Dhan's simulated environment is free and needs no Dhan account
   (developer.dhanhq.co). Put its base URL in Settings › Live trading (`api_base_url`) and the app
   sends everything there instead. The page shows a **Sandbox** badge while it's set. Order flow,
   statuses and rejections all work there; streaming quotes don't.
2. **Set the caps first** — per-order value, orders per day, daily loss limit, and the advisory
   share-of-wallet limit. They default to ₹25,000 / 20 / ₹5,000 / 20%.
3. **Then one small live order**, watched, with the broker's own app open next to it.

Rate limits, for reference: order APIs 10 req/s, data 5 req/s, quotes 1 req/s, 7,000 orders/day.
The poller uses two data requests per tick.

## What is checked, and what isn't

```bash
.venv/bin/python tests/live_trading.selfcheck.py
```

Covers everything decided before the network: the scrip-master series filter, order and super-order
payloads, which fields each leg legally accepts, every guardrail (including the loss limit tripping
*at* the limit and the wrong-side stop check flipping with direction), reading the broker's answer
back, detecting fills and flat positions, and the alert predicate.

**Not covered, and it matters:** no request has ever been sent to Dhan from this code. The payloads
match the published API and the sequence has been exercised end to end against a stubbed broker,
but the sandbox is where it meets the real thing. Treat the first sandbox run as the actual test.

Also not built (deliberate, not forgotten):

- **No WebSocket.** The order-update and market-feed streams exist; this polls instead, because a
  reconnecting socket client is a lot of moving parts for a 5-second refresh. Latency-sensitive use
  is the reason to add one.
- **Kite is not wired for orders.** Its token dies daily and it has no single-order bracket
  equivalent, so it would be a second, worse integration. Holdings sync still supports both.
- **Prices are the app's own delayed quotes.** Dhan's live LTP is a separately-paid Data API plan
  (see `app/core/broker.py`), so the mark-to-market on screen is delayed. No order is priced from
  it — fills come from the broker.
- **NSE cash equities only.** No F&O, no MTF-specific handling beyond the product code.

# Paper Trading

[← Back to index](README.md)

`/paper` — place orders against **live prices** and let a backend engine
fill, stop out, and journal them while you're away. Bar Replay simulates the
past; this simulates right now.

## Using it

**Setup**
1. Create a paper account in **Settings › Paper accounts** (the page links
   there; there's no second, thinner account form on the page itself). Same
   fields as a journal account — name, strategy, opening balance, position
   caps — but a completely separate wallet.
2. Pick the account from the dropdown top-right. It lives in the URL
   (`?account=3`), as does the active tab (`?view=overview|holdings|trades`).

**The badge next to the title** is the engine's heartbeat: *Live* while the
last sweep is recent, *Market closed* outside 09:15–15:30 IST, or
*Stale (Nm ago)* if the poller has gone quiet. **Refresh prices** forces one
sweep immediately — that's how you get fills outside market hours, or without
waiting out the poll interval.

**Trades tab — placing an order**
- Ticker, quantity, direction (long/short), and Market or Limit. A market
  order fills at the current quote right away; a limit order rests until the
  live price reaches it, showing as **Limit resting** in Holdings until then.
- **Stop loss** and **Targets** are ladders: click **Add level** for each rung
  and give it a price and the number of shares it closes. Two target levels =
  scale out in two pieces. A running `covered / quantity` counter turns red
  once the levels cover more shares than you hold, which the backend rejects.
- Levels may cover *less* than the position — the uncovered slice just runs
  unprotected.
- A level on the wrong side of entry is rejected (a stop above entry on a long
  would fire on the very next tick). Unlike the journal, which records history
  and must accept whatever you say happened, this is an order being placed now.

**Holdings tab — the open book**
- One row per position: entry, current price (flashing green/red the moment it
  actually moves), quantity, value, unrealized P&L, and each side's levels.
- **Modify** edits the ladder in place — add, retune, or remove levels on a
  live position.
- **Close** exits the whole position at the current quote, immediately. A
  resting limit order can't be closed; it hasn't filled.

**Overview tab**
Net portfolio value, unrealized/realized P&L, win rate, available cash
(opening balance + deposits + realized − cash deployed in open positions), max
drawdown, and an equity curve of realized P&L day by day.

**Where closed trades go**
Every exit — stop, target, or manual — is written to the **same
`manual_trades` journal** as everything else, tagged `paper` plus the reason
(`Hit SL` / `Hit Target` / `Manual Close`), filed under the paper account. The
Trades tab shows them; so does
[Backtesting → Manual](backtesting-manual.md), where the Statistics and Goals
tabs work on them like any other trade — filter by the paper account there for
the deeper breakdowns.

## How it works

`paper.py` is a background thread started at API startup (`paper.start`,
idempotent so a reload-spawned second call can't race the first on the same
positions). Every `POLL_SECONDS` (20) it quotes each symbol that has an open
position through the app's **existing TTL quote cache** — the poller and the UI
therefore can never disagree about what "now" costs — and checks each position
against that price. Outside NSE hours it idles rather than burning requests on
a quote that isn't moving. `POST /api/paper/poll` runs one sweep on demand,
which is what **Refresh prices** calls and how a test drives the engine without
waiting.

The browser re-reads positions every 10s (`REFRESH_MS`). That interval only
controls how fast the screen catches up — the engine, not the tab, is what
fires exits, so closing the browser doesn't stop anything.

### Why it isn't Bar Replay's order engine

`paper.py` and `orderEngine.js` are deliberately **not** shared code:

- Bar Replay matches against a *bar*. It has an OHLC range, so a level is hit
  when `[low, high]` contains it, and a bar entirely past a level counts as
  gapping through — filled at that bar's open.
- Here there is no range, only a sequence of last-traded prices. A level is hit
  when the latest price has crossed it, and there's no "open" to fall back to.

Same semantics (laddered legs, per-leg quantities, stop-loss wins), genuinely
different arithmetic. What *is* shared is the leg shape — `{id, price, qty}` —
so a ladder means the same thing in both places and the same UI renders either.

**Fills are honest-but-pessimistic.** Polling means price can jump well past a
level between samples. A stop that gapped through fills at the *worse observed
price*, not the stop you set; a target that gapped through fills at the target,
not the spike. Crediting the level in the stop case would hand out fills you'd
never have got, and for a practice tool erring against the trader is the right
direction. A tick-level feed would remove the ambiguity; until then this is the
deliberate choice.

**Stop-loss wins.** If any stop leg triggers on a tick, target legs aren't
checked that tick — which came first between two samples is unknowable, so the
pessimistic reading applies. Same rule as Bar Replay.

**Laddered exits close per leg.** Each triggered leg becomes its own
`manual_trades` row, carrying that leg's own quantity, and the position shrinks
by exactly that slice with its remaining legs still active. A two-leg ladder
unwinding produces two rows — which is what actually happened. Only when
nothing is left does the position disappear.

### Journal rows, not a paper history table

A closed paper position is a `manual_trades` row rather than a paper-specific
table, so every statistic the journal already computes — equity curve,
drawdown, R-multiples, goals — applies with no second implementation. The cost
is one duplicated constant: `NEUTRAL_PNL_BAND` (₹20) exists in both `paper.py`
and `frontend/src/lib/manualTrades.js`, because the engine classifies trades
server-side while every other path classifies in the browser. A paper trade
that scratches out at +₹12 has to count "neutral" by the same rule as a
hand-logged one, or win rate means two different things depending on origin.

### Two kinds of account, one table

`trade_accounts.kind` is `'journal'` or `'paper'`. The two lists never mix — a
paper account appearing in the journal's account picker would let a
hand-logged trade be filed against a simulated wallet. `kind` is set at
creation and never editable afterwards; flipping it would reassign every trade
filed under it to a different mode.

Both Settings tabs render the *same* `TradeAccountsTab` component with a
different `kind` and different copy. The account types are identical in every
way that matters (name, strategy, wallet, deposits/withdrawals, position caps);
only which trades count against them differs, and that's already keyed on
`account_id`.

**Deleting a paper account with open positions is refused (409).** Journal
trades survive account deletion (`ON DELETE SET NULL`), but `paper_positions`
is `ON DELETE CASCADE` — a simulated open position means nothing without its
wallet. That asymmetry would make the delete silently discard live positions,
so the endpoint refuses and says how many are in the way.

### Endpoints

| Method | Path | What |
|---|---|---|
| `GET` | `/api/paper/accounts` | Paper-kind accounts |
| `POST` | `/api/paper/accounts` | Create one |
| `GET` | `/api/paper/positions?account_id=` | Open positions, marked to the latest price (`current_price`, `pnl`, `pnl_pct`, `value`) |
| `POST` | `/api/paper/orders` | Place a market/limit order with its ladders |
| `PUT` | `/api/paper/positions/{id}` | Replace the stop/target ladders |
| `POST` | `/api/paper/positions/{id}/close` | Close now at the live quote (whole or partial) |
| `GET` | `/api/paper/status` | Engine heartbeat: `last_poll`, `market_open`, `poll_seconds`, `last_error` |
| `POST` | `/api/paper/poll` | Force one sweep |

`pnl` is `null` (not `0`) for a resting limit order — it has no exposure yet,
and zero would read as "flat" rather than "not started".

### Self-check

```bash
.venv/bin/python paper.selfcheck.py
```

Plain asserts, no framework. Only the pure half is exercised —
`check_position`, fill pricing, classification, market hours. Everything that
writes (`apply_fills`, `close_position`) is deliberately excluded so the check
stays runnable without a database.

# Backtesting — Manual (Trade Journal)

[← Back to index](README.md)

## Using it

- `/backtesting` (currently the only mode on this page — see
  [Backtesting — Auto](backtesting-auto.md) for why), with four sub-tabs:
  **Overview**, **Trades**, **Statistics**, **Goals**.
- **Add Trade** to log a trade by hand (symbol, direction, quantity,
  entry/exit, stop-loss/target, ideal risk ₹, emotion, tags, notes, an
  optional screenshot). Result (profit/loss/neutral) auto-computes from
  entry/exit/direction, but overriding it by hand stops it from silently
  recomputing on further edits. Tick "still open" to skip the exit price.
  A closed trade also gets an optional **Closed** date next to **Opened** —
  optional, but it's what unlocks MAE/MFE ("how far it ran") in the detail
  view, since the excursion needs a holding window to measure over.
- **Clicking a row opens the trade's detail view** (read-only), not the edit
  form — reviewing a trade is the common action, editing it the rare one, so
  editing is one click further in (the **Edit** button inside that modal).
  See [Trade detail](#trade-detail-what-the-trade-did-vs-what-you-did) below.
- **Bulk Trades** to import several trades at once from screenshots — each
  image is analyzed and its fields pre-filled for you to confirm.
- The **Trades** tab lists every trade with a filter bar (setup, NSE
  session, risk discipline, expected-R range), row checkboxes for **Bulk
  edit** (set a setup and/or add a tag across the selection in one go), and
  two exports (see [Exports](#exports-csv-excel-markdown) below).
- **The list is ordered newest-logged first**, and the first column is
  **Logged** — when the row was written, not the market date. A Bar Replay
  trade taken on 2013 bars but journaled this morning belongs at the top;
  ordering by market date buried it forty rows down. When the two differ, the
  market date sits underneath as a muted `traded …` line.
- The **Overview** tab shows P&L stats, daily win/loss and cumulative P&L
  charts, a calendar heatmap (opens on the month of your most recent trade,
  not necessarily this month), a goals-progress strip (see Goals below), and
  a **Risk & expectancy** section (see below).
- The **Statistics** tab (see below) is a deeper, TradesViz-style drill-down
  across many angles, all driven by the same closed trades.
- The **Goals** tab (see below) scores your trades against targets/limits
  you define, per day/week/month — bucketed by when each trade was **logged**,
  so replayed and paper trades count toward the day you actually did the work.
- **Bar Replay** button opens the bar-by-bar replay tool ([docs](bar-replay.md))
  — trades you log there land in this same journal, tagged `replay`. Live-price
  [Paper Trading](paper-trading.md) trades land here too, tagged `paper`.
- The **account picker** (top right, next to the export buttons) scopes all four
  sub-tabs to one trading account, or "All accounts". The choice lives in the
  URL (`?account=3`), so a per-strategy view is shareable and survives a
  reload. Accounts themselves are managed in **Settings › Trade accounts**.

### Exports: CSV, Excel, Markdown

- **CSV** (`GET /api/manual-trades/export?format=csv`) — the raw backend dump
  of every trade, ignoring what's on screen.
- **Excel** — a real `.xlsx` of exactly the rows in front of you: the account
  picker and every active filter already applied, with the derived numbers as
  their own columns (gross P&L, costs, net P&L, return %, R:R and whether it's
  planned or realised, hours held) so nothing has to be rebuilt in a formula.
  Static column set by design — the on-screen table hides columns depending on
  the account, and an export that did the same would produce two files with the
  same name and different columns. Screenshots are not exported; they aren't
  data.
- **Markdown** — on the **Statistics** tab and on
  [Trade Simulation](trade-simulation.md): **Copy MD** puts the panel's numbers
  on the clipboard, **Markdown** downloads them as a file. Statistics exports
  every section of Overall statistics plus net P&L broken down by *every*
  dimension, not just the one currently on screen.

The writer behind the `.xlsx` is hand-rolled (`frontend/src/lib/exportFile.js`,
~60 lines): an xlsx is a zip of a few XML parts, and writing one with no
compression was cheaper than a megabyte-class spreadsheet dependency. Numbers
are written as numbers, so a P&L column sums in Excel without retyping.
`node frontend/src/lib/exportFile.selfcheck.mjs` checks it against a real zip
reader.

## How it works

**P&L, R:R, and return% are never stored** — the `manual_trades` table
holds only the raw inputs (direction, quantity, entry/exit, stop-loss,
target). Every derived number is recomputed at read time from those raw
fields, so editing a trade's exit price later can never leave a stale P&L
sitting around from before the edit.

**Screenshots** upload to a local `uploads/` folder (mounted and served
directly at `/uploads/...`) named `{trade_id}-{random}`. The trades API
response includes a ready-to-use `image_url` (built server-side from the
request's own host) for every trade that has one, rather than the frontend
having to guess the upload path itself.

**Bulk import is one LLM vision call per screenshot**, not OCR or a
template matcher: the image is base64-encoded and sent with a prompt asking
for whichever of `symbol`, `direction`, `entry_price`, `exit_price`,
`stop_loss`, `target`, `traded_at`, `notes` it can actually read off the
image — explicitly instructed never to guess or invent a number. Each
returned field is only kept if it passes a basic type/non-empty check, so
a partially-malformed reply degrades to some fields left blank for you to
fill in, rather than the whole import failing.

**Overview's stats**: `totalPnl` sums every closed trade's P&L (long:
`(exit-entry)*qty`, short: sign-flipped). `winRate` is wins ÷ closed trades.
`profitFactor` is gross profit ÷ gross loss (`null` if you have no losing
trades yet — dividing by zero would be misleading, not infinite-good).
`avgPnl` is total P&L ÷ number of closed trades.

### Risk & expectancy: the one forward-looking section

Everything else on Overview reduces trades you already took. This section
(bottom of the tab, needs **5+ closed trades**) goes the other way: it takes
three numbers off your real history — win rate, payoff ratio, and risk per
trade — and asks what they imply about trades you haven't taken yet. The math
is `frontend/src/lib/tradeMath.js`, pure and dependency-free
(`node src/lib/tradeMath.selfcheck.mjs` to verify it).

The three inputs, and where they come from:

- **Win rate** — wins ÷ closed trades, same as the stat card above.
- **Payoff ratio** — average winning R ÷ average losing R when trades carry
  an "Ideal risk ₹", otherwise the plain average-win-₹ ÷ average-loss-₹.
- **Risk per trade** — average planned risk (or, without one, what an average
  loss actually costs) as a % of the account's opening balance.

All three are clamped to sane ranges so one degenerate trade can't produce a
nonsense curve.

The six views:

1. **Expectancy by win rate × payoff** — a heatmap of expectancy in R for
   every combination, with your own cell ringed. The sign flip across the
   grid is the breakeven boundary (`1 / (1 + payoff)`).
2. **Surviving your longest losing streak** — your actual longest losing
   streak (floored at 5) replayed from today at your risk size, then trading
   on at your own expectancy. Reports the trough and how many trades until
   breakeven — or says plainly that it never recovers, which means the edge
   is the problem, not the streak.
3. **Same trades, different position size** — one simulated sequence, sized
   0.5% / 1% / 2%. The curves share the identical win/loss sequence, so they
   differ by amplitude only.
4. **Achievable win rate vs target size** — an *empirical rule of thumb*
   (labelled as such in the UI, not a computed fit) that bigger targets get
   hit less often, plotted against the breakeven win rate, with your own
   point marked and a 3R–6R sweet spot band.
5. **Why drawdowns cost more than they look** — your average win % and loss %
   compounded 100 times each. Losses approach −100% and never pass it; gains
   have no ceiling.
6. **Chance of a 50% drawdown** — probability by risk per trade, over 2,000
   simulated runs of 500 trades. **Simulated, not derived**: the tempting
   closed form (probability of a long enough *losing streak*) is wrong here
   by an order of magnitude, because real drawdowns come from choppy mixed
   sequences rather than clean runs of losses. On a chart whose whole job is
   to show that 5% risk is dangerous, that error points the wrong way.

Every simulation uses a seeded PRNG (`rng()`, mulberry32) with a fixed seed,
so the curves are identical on every render — `Math.random()` would reshuffle
them on any parent re-render, which reads as the numbers being unstable
rather than as one sample.

**The calendar heatmap defaults to today's month, then jumps once** to the
month containing your most recent trade the moment trade data actually
loads — this is what stops it from opening on an empty "current month"
when, say, all your logged trades are from a Bar Replay session set years
in the past. A "Today" button is still there to get back to the real
current month.

### Trade detail: what the trade did vs what you did

Clicking a row opens `TradeDetailDialog` — a read-only review of one trade in
four sections:

- **The trade** — entry/exit/stop/target, opened and closed timestamps,
  planned R:R, result in R.
- **Execution** — risk taken vs planned, risk deviation %, target capture %,
  stop overrun %. All of it independent of whether the trade made money.
- **How far it ran** — MAE/MFE (below).
- **Market at entry** — the entry-context snapshot (below), rendered as
  sentences rather than raw numbers: "+3.81 ATR from the 20-EMA — well past the
  mean, chasing a move that had already happened."

The modal re-reads the trade from the live list rather than the snapshot
captured when the row was clicked, so an edit made from inside it is reflected
immediately.

### Four timestamps, four different questions

`traded_at` is the market date the trade happened on and is what every
price-aware calculation reads. `entried_at` and `exited_at` are the exact entry
and exit moments — `entried_at` defaults to `traded_at` on insert, because for
a hand-logged trade they *are* the same moment, so the trade form needs no
extra field. `created_at` is when the row was written, which is what the
Trades tab sorts and labels by and what Goals bucket on.

They only diverge for [Bar Replay](bar-replay.md#replayed-dates-vs-when-you-logged-it)
and [Paper Trading](paper-trading.md), where a trade is taken in one period and
journaled in another. The trade detail view shows all three it can
(**Opened** / **Closed** / **Logged**) and refuses to print an entry date that
falls *after* the close — rows written before `entried_at` existed carry the
journaling wall clock in `traded_at`, and a date that contradicts the close is
worse than no date.

### `trade_context`: a point-in-time snapshot, captured once

`app/core/trade_context.py` computes one JSON blob at trade creation and stores it on
the row (`manual_trades.trade_context`). It is **never recomputed on read** —
same reasoning as `account_balance_at_trade` below: it's a point-in-time fact,
and bars get split-adjusted and revised behind you, so recomputing later would
silently rewrite the history you're trying to learn from. Everything is read
from the local DB (`db.bars_before` / `db.bars_between`, preferring
`price_history_max` and falling back to the rolling 1y `price_history`) — no
network, which is what keeps the bulk-import dialog's N parallel POSTs usable.

Two halves, knowable at different times:

- **Entry context**, from the ~100 daily bars *strictly before* entry: trend
  (20/50 EMA), volatility regime (ATR percentile, 20/80 split), how extended
  the entry was (signed ATRs from the 20-EMA — positive always means "entered
  in the direction the move had already gone", so it reads the same for a
  short), position in the 100-bar range (deliberately **not** clamped to
  [0, 1]: >1 is a breakout, and clamping would erase exactly the interesting
  distinction), volume vs its 20-day average, `with_trend`, and the volume-spike
  scan (below).
- **MAE / MFE** (Maximum Adverse / Favourable Excursion) over the holding
  window: the heat the trade took before it worked, and the best it ever
  offered before you closed it. Expressed both as a % of entry and in **R**
  against the stop distance, since percentages aren't comparable across symbols
  but R multiples are. Needs an exit date — without one these keys are simply
  **absent**, not zero (`mae_pct: 0` is a real and very different finding, so
  the UI branches on key presence throughout).

**Fill-once is per-half, not per-row.** Logging a trade open and closing it
later is the ordinary workflow, so on edit: no snapshot at all → compute the
whole thing; entry context stored but no excursion and an exit date has now
arrived → compute **only** the excursion and merge it onto the stored entry
context (re-reading the entry bars could pick up a split adjustment and rewrite
a fact you already have); everything present → touch nothing.

**Volume spike before entry.** `vol_spike` records the loudest bar in the last
N bars *before* entry as a multiple of that bar's **own** 20-bar average volume
— a rolling baseline, so one huge bar can't inflate the average it is measured
against. Stored as `{max_ratio, bars_ago, count, multiple, lookback}`: the peak
is kept whether or not it cleared the threshold (peaking at 1.1× is a finding,
and storing only spikes would make "no spike" indistinguishable from "not
computed"), `bars_ago: 1` is the bar immediately before entry, and `count` is
how many bars in the window cleared it.

The threshold and window are **per trade account** (`trade_accounts.vol_spike_multiple`
/ `vol_spike_lookback`, default 2× over 10 bars, editable in Settings → Trade
accounts) — what counts as unusual volume is a property of the strategy, not
the symbol. The values actually used are copied onto each snapshot, so retuning
an account changes what *future* trades capture and never re-interprets what
past ones recorded. A trade with no account falls back to the same defaults.

Under 30 prior bars, the snapshot stores `{bars_used, context_insufficient}`
rather than a partial payload — a dict carrying `trend` but no `vol_regime`
reads exactly like a real one at a glance. The detail view explains the gap
("Only 12 prior bars were available…") instead of showing blanks. Excursion is
still attached in that case, since MAE/MFE doesn't depend on the lookback.

```bash
.venv/bin/python trade_context.selfcheck.py
```

### Trade accounts: one strategy, one wallet, one frozen balance per trade

An account is a *system being run with a pot of money* — **one strategy each**,
by design. Comparing two strategies means comparing two accounts, so an account
never holds a mixed bag that can't be judged as a whole. Managed under
**Settings › Trade accounts**: name, strategy, strategy explanation, opening
balance, and its deposits/withdrawals.

- **Deposits and withdrawals** reuse the same `balance_adjustments` table the
  Overview tab's wallet dialog already wrote to, now tagged with `account_id`.
  Both surfaces write the same ledger — the settings tab is per-account, the
  Overview dialog tags whatever account is currently selected.
- **`account_balance_at_trade` is the one derived value this schema stores**,
  deliberately breaking the "never persist a computed number" rule the rest of
  the journal follows. It's a point-in-time *fact*, not a function of the row:
  re-deriving it later would silently rewrite every past trade's account-return%
  the moment a deposit is backdated or an older trade is edited. The server
  computes it once (`db.account_balance_at` — opening balance + adjustments +
  realized P&L of everything closed before that moment) and freezes it.
  Editing a trade leaves it alone; it's only recomputed if the trade actually
  **moves to a different account**, where the old account's balance is
  meaningless.
- That snapshot is what **account return %** divides by — "what did this trade
  do to the account", as opposed to the existing return %, which is against the
  position's own cost. Available as a Statistics metric, a Compare axis, and
  two entries in Overall statistics.
- **Trading costs are per account** (`frontend/src/lib/tradeCosts.js`):
  slippage (per share or in bps of turnover), flat + percentage brokerage, and
  other charges as a % of turnover, all configured in **Settings › Trade
  accounts**. They're charged **per side** — entry always, exit only once the
  trade is closed — so an open position shows a half-priced cost and says so
  rather than pretending the round trip is done.
  - Every surface shows **gross and net side by side**; the only place net
    wins outright is a wallet balance, which has no room for two answers —
    slippage and brokerage genuinely left the account.
  - An account with no costs configured is unaffected, and a trade with no
    account has no rate card at all: it reads `—`, "unknown", never "free".
  - Same rate card applies to paper accounts, so a paper P&L and a journal
    P&L are finally comparable numbers instead of one gross and one net.
- **The volume-spike scan is per account too** — "spike is N× the bar's own
  20-bar average" and "scan the last M bars before entry", defaulting to 2× over
  10 bars, in the same **Settings › Trade accounts** form. What counts as
  unusual volume belongs to the strategy, not the symbol: a breakout account
  wants the run-up to be loud, a mean-reversion one may not care. Read once when
  the trade is logged and copied onto its snapshot, so retuning an account
  changes what future trades capture and never rewrites a past reading.
- **Max position size** (₹ or % of balance) and **max open positions** are
  **advisory**: they raise a warning on the trade form and never reject a trade.
  The journal records what you actually did, not what the rules said you should
  have done — a blocked entry would just go unlogged, which is worse.
- **Deleting an account keeps its trades** (`ON DELETE SET NULL` — they become
  unassigned), but its deposits/withdrawals cascade away, since those only ever
  meant anything relative to that account's wallet.
- Trades are filtered **in the client**, not by a per-account fetch: the list is
  small, the full set is already cached for the trade form's cap checks, and
  "All accounts" then costs nothing.

### Statistics tab: one dimension/metric engine, not one function per chart

`frontend/src/lib/tradeStats.js` is a small reduction engine — a
`DIMENSIONS` lookup (symbol, setup, tag, emotion, direction, day of week,
session, hour, month, year, price range, quantity range, R-multiple bucket,
plus four **market-context** dimensions read off the stored `trade_context`
snapshot — trend alignment, volatility regime, entry extension, range
position) crossed with a `METRICS` lookup (net/avg P&L, win rate, count, volume,
turnover, avg R/expectancy, profit factor, avg return %, avg planned R:R, avg
account return %).
Every "metric by dimension" chart on the tab (`ManualStatistics.jsx`) is the
same `seriesFor(trades, dimension, metric)` call with different keys —
adding a row to either lookup makes every chart that reads it pick it up,
nothing per-chart to wire up.

- **Overall statistics** is a searchable, collapsible panel of every
  single-number stat at once (`overallStats()`), including risk-discipline
  numbers not shown elsewhere: Sortino ratio, SQN rating, recovery factor,
  max drawdown (plus the date it occurred), Omega ratio, adjusted win/loss
  ratio, total R, win/loss streaks, stop-violation count (exit lost more
  than the stop-loss implied), winner/loser return % (avg and total), and
  trade-size/frequency figures (avg/max/min volume per trade, avg/max
  trades per calendar month and year).
- **Distribution of gains and losses** bins P&L (or R-multiple/return %)
  with edges pinned to zero, so a small winner and a small loser never land
  in the same bar.
- **Cumulative performance per day** and **Trend analysis** are plain SVG
  line charts (not `lightweight-charts` — trade-closed timestamps repeat
  within a day, which that library's time-series API rejects as duplicate
  x-values). Trend analysis also plots a 10-trade moving average.
- **When you trade** is a weekday × hour heatmap, shaded by either trade
  count or net P&L.
- **Compare** is a free-choice scatter plot of any per-trade stat against
  any other (entry price, quantity, R, return %, P&L, ...), one dot per
  closed trade, colored by win/loss.
- **Calendar heatmap** is a week/month grid (Monday-start) shading each day
  by one `METRICS` value and printing a second `METRICS` value underneath —
  any two of the ten metrics, independently. ◀/▶ page by a week or a month
  at a time (`shiftCalendarAnchor`); paging forward is disabled once you
  reach the period containing today, so it can't page into the future.
  Distinct from the Overview tab's fixed net-P&L calendar (above) — this one
  is metric-agnostic and lives in `calendarHeatmap()` in `tradeStats.js`.
  Shade intensity is normalized against the darkest cell *in the current
  view*, so color isn't comparable across different months — hover a cell
  for its exact values.
- **The market-context dimensions** ("do I only lose when I chase?") bucket
  coarsely on purpose — slicing 100 trades across many fine buckets finds
  patterns that are pure noise. Trades logged before the feature shipped, or on
  a symbol with no local price history, land in an explicit **Not captured**
  bucket rather than being dropped: a dimension that quietly excludes most of
  the journal makes the surviving buckets look far better sampled than they are.
- Every panel here operates on `closedTrades(trades)` only — an open
  position has no P&L yet, so it's excluded from every chart rather than
  counted as a zero.

### Goals tab: targets and limits scored per period, nothing persisted but the goal itself

`frontend/src/lib/tradeGoals.js` defines a goal as
`{id, metric, operator: 'gt'|'lt', target, period: 'daily'|'weekly'|'monthly', mode: 'continuous'|'binary'}`,
stored via `getTradingGoals`/`setTradingGoals` (the whole goals array is
replaced on every save — there's no per-goal update endpoint). Nothing
about *achievement* is stored: every score is recomputed live from the
current trades, so editing a past trade or a goal's target can never leave
a stale percentage on screen.

- **Which period a trade counts toward is decided by `created_at`**, not
  `traded_at` (`goalDate` in `tradeGoals.js`). A goal measures the work you
  did that day or week, and a Bar Replay session practised on 2013 bars is
  work done today — bucketing it by market date would file today's practice
  under 2013 and leave the week reading as if nothing had been traded. Rows
  without a `created_at` fall back to `traded_at`.
- **Metrics a goal can track** are the Statistics tab's `METRICS` (so a
  goal can never disagree with the chart of the same name) plus
  goal-specific ones: winning/losing trade count, gross loss, max drawdown,
  largest risk taken (entry-to-stop ₹ — MAE is now captured per trade in
  `trade_context`, but goals still score against planned risk, not realized
  heat), and stop violations.
- **Operator** is "at least" (`gt`) for targets or "at most" (`lt`) for
  limits. **Mode** is either `continuous` (partial credit — e.g. ₹4,000 of
  a ₹5,000 target scores 80%) or `binary` (met or not, no partial credit).
  A non-positive target/limit has no meaningful ratio, so it's always
  scored pass/fail regardless of mode.
- **Current period strip** (`CurrentPeriod`, also condensed into a
  `GoalsSummary` on the Overview tab) shows where today/this week/this
  month stands right now, per goal and overall (the average of that
  period's goal percentages) — a gauge per goal, all computed against just
  the trades closed in the current period.
- **History table** scores every past period that has at least one closed
  trade, newest first, heat-mapped by achievement (not by target-vs-limit —
  green/red-by-outcome is what reads at a glance across a table that dense;
  the ≥/≤ badge on each column header is what tells you which kind of goal
  it is).

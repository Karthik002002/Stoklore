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
- **Bulk Trades** to import several trades at once from screenshots — each
  image is analyzed and its fields pre-filled for you to confirm.
- The **Trades** tab lists every trade with a filter bar (setup, NSE
  session, risk discipline, expected-R range), row checkboxes for **Bulk
  edit** (set a setup and/or add a tag across the selection in one go), and
  **Export CSV**.
- The **Overview** tab shows P&L stats, daily win/loss and cumulative P&L
  charts, a calendar heatmap (opens on the month of your most recent trade,
  not necessarily this month), and a goals-progress strip (see Goals below).
- The **Statistics** tab (see below) is a deeper, TradesViz-style drill-down
  across many angles, all driven by the same closed trades.
- The **Goals** tab (see below) scores your trades against targets/limits
  you define, per day/week/month.
- **Bar Replay** button opens the bar-by-bar replay tool ([docs](bar-replay.md))
  — trades you log there land in this same journal, tagged `replay`.

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

**The calendar heatmap defaults to today's month, then jumps once** to the
month containing your most recent trade the moment trade data actually
loads — this is what stops it from opening on an empty "current month"
when, say, all your logged trades are from a Bar Replay session set years
in the past. A "Today" button is still there to get back to the real
current month.

### Statistics tab: one dimension/metric engine, not one function per chart

`frontend/src/lib/tradeStats.js` is a small reduction engine — a
`DIMENSIONS` lookup (symbol, setup, tag, emotion, direction, day of week,
session, hour, month, year, price range, quantity range, R-multiple bucket)
crossed with a `METRICS` lookup (net/avg P&L, win rate, count, volume,
turnover, avg R/expectancy, profit factor, avg return %, avg planned R:R).
Every "metric by dimension" chart on the tab (`ManualStatistics.jsx`) is the
same `seriesFor(trades, dimension, metric)` call with different keys —
adding a row to either lookup makes every chart that reads it pick it up,
nothing per-chart to wire up.

- **Overall statistics** is a searchable, collapsible panel of every
  single-number stat at once (`overallStats()`), including risk-discipline
  numbers not shown elsewhere: Sortino ratio, SQN rating, recovery factor,
  max drawdown, win/loss streaks, and stop-violation count (exit lost more
  than the stop-loss implied).
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

- **Metrics a goal can track** are the Statistics tab's `METRICS` (so a
  goal can never disagree with the chart of the same name) plus
  goal-specific ones: winning/losing trade count, gross loss, max drawdown,
  largest risk taken (entry-to-stop ₹, since this journal doesn't store
  intra-trade prices for a true MAE-based risk goal the way TradesViz
  does), and stop violations.
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

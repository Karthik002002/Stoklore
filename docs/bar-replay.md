# Bar Replay

[← Back to index](README.md)

`/backtest/replay` — step through a stock's real history bar-by-bar and
paper-trade it.

## Using it

**Setup**
1. Pick a symbol and timeframe in the Setup panel — anything from **1 minute
   to 1 month**: `1m` / `5m` / `15m` / `1H` / `4H` / `1D` / `1W` / `1Mo`.
2. `1D`/`1W`/`1Mo` need **Collect max data** first (if you haven't already
   for that symbol). The intraday timeframes (`1m`–`4H`) fetch themselves —
   nothing to collect, just pick one (see [How it works](#how-it-works) for
   where that data comes from and how long the first fetch takes).
3. Optionally set a start date, then **Start replay**.

**Playback**
- Step back/forward, play/pause (0.5×–4× speed), or jump to a date.
- **Random bar** — the shuffle button next to the date picker (or the
  **Jump to date › Random bar** menu item) drops you somewhere else in the
  symbol's history and pauses there. The point is to practise without knowing
  which period you're in.
- **Every jump hands the candle pane's y-axis back to autoscale** — a date jump, `Shift+R`,
  starting a session, or a restart. Dragging or wheel-zooming the price axis
  pins it (that is the point of doing it), but the bars a jump lands on are
  usually nowhere near that range: 2013's candles around ₹120 on a scale pinned
  to 2024's ₹1,400 draw nothing at all, and an empty chart reads as a bug
  rather than a pinned axis. The saved range is cleared at the same time, so a
  reload doesn't pin it straight back. Ordinary bar stepping leaves your scale
  exactly where you put it.

  **Indicator panes are never touched.** An oscillator's scale is a property of
  the indicator, not of the period on screen — RSI is 0–100 in 2013 exactly as
  it is today — so a MACD or RSI pane you sized by hand survives every jump.
- Shortcuts: `B` buy, `S` sell, `Shift+↓` play/pause, `Shift+→` step forward,
  `Shift+R` random bar, `A` strategy.
- **`A` — the account's rules**, in a read-only modal over the chart: the
  strategy explanation you wrote, balance, position-size and open-position
  caps, the volume-spike threshold, the losing-run reminder, and what a round
  trip costs at the price on screen. Replay is where discipline is actually tested, so what you said you
  would trade belongs one key away rather than a tab away in Settings.
  Deliberately not editable — rewriting the rules mid-trade is the habit this
  interrupts, not one it should make easier. Works before a replay starts too;
  off while an order ticket or a close dialog is open.
- **Measure tool (`Shift`+click)** — TradingView's, on the replay candles.
  Shift+click one point, move the pointer, click again to lock the reading;
  Shift+drag and release does the same in one gesture. The band shows the exact
  price change, the percentage move, how many bars (candles) it spans, the time
  elapsed between the two ends, and the volume traded across them. Anchored to
  bar index + price like the drawing tools, so it stays on the price action
  through pan and zoom; `Esc` or one more click clears it, and switching symbol
  or timeframe drops it (the bars underneath it are no longer the same bars).
  Nothing is saved — a measurement is a question you ask once.
- The **OHLCV legend** sits top-left of the chart: date, open/high/low/close,
  the change against the previous bar, and volume, coloured by the candle's
  own direction. It follows the crosshair while you hover and falls back to
  the newest bar when the pointer leaves.

**Trading**
- **Buy**/**Sell** in the Trade panel opens an order ticket — Market or
  Limit, with optional take-profit and stop-loss. A level on the wrong
  side of entry is rejected with an inline error.
- **Position-size warnings, with a confirmation before the fill.** A share is
  indivisible, so a sizing preference can be arithmetically unreachable: 10% of
  a ₹10,000 account at ₹5,000 a share is 0.2 shares, which floors to 1 — and
  fills at **50% of the account**. That used to happen in silence, most easily
  through `Shift+B`/`Shift+S`, which skip the ticket entirely.

  Now both entry paths run the same check (`orderEngine.orderWarnings`) and stop
  for a confirmation when anything trips: the position costs more than the whole
  balance, it is more than 25% past the sizing preference's budget, or it breaks
  one of the account's own caps (max position size / max open positions — the
  same `capWarnings` the trade form uses, so journal and replay judge a position
  by identical rules). The order ticket shows the same warnings inline while you
  are still typing the size, so nothing appears at submit that wasn't already on
  screen.

  Confirming is always allowed — every cap here is advisory and the replay
  records what you actually did. The point is that an oversized entry becomes a
  decision instead of an accident. A position inside your rules is placed with no
  dialog at all, which is what keeps the dialog worth reading. Autoplay pauses
  while the question is on screen, and the trading shortcuts are inert until it
  is answered.
- **Losing-run reminder.** Set *"Remind me after N losses in a row"* on the
  account (Settings › Trade accounts; blank = off) and Bar Replay interrupts
  once that run is reached — **after** the close dialog, so the trade that got
  you there is already journaled and counted. It shows the run, what it cost,
  and the account's own strategy explanation, because re-reading the plan you
  wrote calmly is the cheapest intervention available.

  Per account on purpose: a 40%-win-rate breakout system throws four-loss runs
  routinely and a mean-reversion one almost never does, so one global number
  would be wrong for somebody. The run is counted from the **journal**, not from
  this replay session, so it survives a reload — and in the order the trades
  were *logged*, not their market dates, because a replay that jumps to random
  bars produces market dates in no meaningful sequence. It re-alerts on each
  further loss (4, 5, 6…) and resets on the first win. There is no "don't show
  again": that is the setting, and it lives on the account where it can be
  reasoned about between sessions rather than dismissed mid-tilt.
- Drag a stop-loss/target line directly on the chart to adjust it after
  placing the order.
- If price gaps clean past a stop-loss/target instead of touching it, the
  trade still closes — filled at that bar's open, not the skipped level.
- Closing a trade (manually or automatically) opens a feedback dialog
  (result/emotion/notes) and pauses playback while it's open. That dialog
  carries a **Jump to a random date after logging** checkbox — tick it once
  and every subsequent close ends with the same random jump the shuffle button
  makes, so you're not clicking it by hand between trades. The preference is
  saved with the rest of the session; a laddered exit that queues several
  dialogs only jumps after the last one. The trade is
  saved with a screenshot of the chart at that moment, and shows up in the
  [Manual trade journal](backtesting-manual.md) above — including its
  Statistics tab (grouped like any other trade) and Goals tab (counts
  toward whichever day/week/month it was closed in), since both read off
  the same `manual_trades` table with no special case for `replay`-tagged
  rows.

**Multiple stop-loss/target levels (laddered exits)**
- A position isn't limited to one stop-loss or one target — in the order
  ticket, click **Add level** under either Take profit or Stop loss to add
  a second (or third, etc.) level, each with its own price and its own
  share of the quantity. This is a laddered/scaled exit: e.g. take profit
  on half the position at a near target and let the rest run toward a
  farther one, or exit half at a tight stop and the rest at a wider one -
  instead of an all-or-nothing exit on either side.
- Each level's quantity is entered directly (not a %) — the total across a
  ladder's levels must not exceed the order's share count; whatever isn't
  covered by a level simply has no stop-loss/take-profit protection for
  that slice, exactly like leaving it off entirely.
- When a bar's range reaches a level, only *that level's* quantity closes
  — the position stays open with its remaining, untouched levels still
  active (on both sides), at the new smaller size. Each level that closes
  is journaled as its own trade (so a 2-level ladder that fully unwinds
  across two bars produces two rows in the Manual trade journal, not one).
  If a single bar (or a gap) blows through more than one level at once,
  all of them close together, each still logged as its own trade at that
  bar's fill price. If any stop-loss level is hit, target levels are not
  also checked that same bar — stop-loss wins for the whole order (same
  conservative rule as before, just extended to a partial hit).

**Adding a level to a live position — straight from the chart**
- Once a position is open, its Trade panel row shows an **Add stop
  loss**/**Add target** button per side (only while some quantity on that
  side is still unprotected). Clicking it doesn't open any form — it arms
  the chart (cursor turns into a crosshair, chart pan/zoom is paused, and
  the button itself shows "Click the chart…") and waits for your next
  click on the price you want. That click places the new level right
  there, covering whatever quantity wasn't already covered on that side.
  Click the button again (or click elsewhere once already armed) to place
  it; there's no separate "drag it into position afterward" step.
- Every level, once placed (from the ticket or from the chart), is its own
  draggable line (labeled `SL1`/`SL2`… or `T1`/`T2`… once there's more than
  one on that side) and its own row in the Trade panel, each independently
  removable. Removing a level just drops its protection — it does **not**
  close any part of the position, only an actual bar touching a level's
  price does that.

**Drawing on the chart**
- The **Draw** popover in the bottom bar arms a tool: **trendline**,
  **horizontal line**, or **rectangle**. Drag on the chart to place one; `Esc`
  disarms, clicking a shape selects it, and `Delete`/`Backspace` removes the
  selected one. **Clear all** drops every shape at once.
- Shapes are anchored to a *bar index + price*, not to screen pixels, so they
  stay on the price action through pan, zoom and autoscale. They're saved with
  the session and dropped on a symbol/timeframe change — bar 3200 is a
  different moment in every instrument.

**Indicators & settings**
- Indicators panel: add EMA, SMA, or RSI. RSI gets its own pane below the
  candles.
- The gear icon (top-left) opens **Settings**: candle colors, RSI reference
  levels (add/remove any number, not just 30/70), and **order sizing**.
- **Order sizing** is either a **fixed quantity** or a **percentage of
  capital** — with the percentage, every new order is sized off the selected
  account's live balance at the current bar's price, so position size grows
  and shrinks with the account instead of staying at a number you set weeks
  ago. It applies to the ticket's pre-filled quantity and to the one-key
  market orders (`Shift+B`/`Shift+S`) alike, so the two can never disagree.
  The ticket also has a **Size by risk** field that back-solves the share
  count from a % of the account you're willing to lose to the tightest stop.

**Persistence**
- Everything here (symbol, timeframe, bar position, open orders, drawings,
  indicators, settings) is saved to your browser's local storage as you
  go — closing the tab or reloading resumes exactly where you left off.
  This state is per-browser, not synced anywhere.
- That includes **how the chart is framed**: the zoom window, each pane's
  height, and each pane's price scale (including whether you left it on
  autoscale). A reload puts the candles back where you were looking, not at
  a default window.

## How it works

Everything here is client-side — `frontend/src/features/bar-replay/`.
There's no "replay" concept on the backend at all; it's just bars from one
of two sources (below) plus a chart that only reveals them up to a cursor.

### Two data sources, one per timeframe half

- **`1D`/`1W`/`1Mo`** — the app's regular `price_history_max` data (the same
  one-time "Collect max history" pull used elsewhere), rolled up client-side
  by `lib/replay.js`'s `aggregateBars`.
- **`1m`/`5m`/`15m`/`1H`/`4H`** — `GET /api/prices/{symbol}/intraday`, backed
  by **`app/core/minute_data.py`**, which reads a public HuggingFace dataset,
  [`xxparthparekhxx/indian-stock-market-minute-data`](https://huggingface.co/datasets/xxparthparekhxx/indian-stock-market-minute-data)
  (2,535 NSE symbols, 2022-01 → 2026-01, ~715M minute rows). Nothing is
  downloaded up front: DuckDB reads the dataset's remote parquet shards
  directly over HTTP with predicate pushdown (`WHERE symbol = ...`), so a
  symbol's first request pulls only its own rows (~11s for a full symbol,
  ~6MB) into a local cache (`local_data/minute/<SYMBOL>.parquet`, gitignored)
  and every later request — any timeframe, any date — resamples that local
  file in well under a second. A symbol the dataset doesn't cover falls back
  to `scraper.get_intraday_bars` (yfinance), which is far shallower
  (~60 days) but keeps replay working instead of showing nothing.
  - `4H`/`1H`/etc. buckets are anchored to NSE's 09:15 IST open, not
    midnight, so a session's candles land on 09:15/10:15/…/15:15 rather than
    an odd partial bucket at the open.
  - Each request is capped to the newest 30,000 bars (`MAX_BARS` in
    `app/core/minute_data.py`) — at `1m` that's roughly the most recent ~80 sessions,
    growing per timeframe (the same "finer timeframe, shorter window"
    tradeoff any charting platform makes rather than shipping the full
    47MB/375k-row history to the browser on every timeframe switch).

### Session state: one Zustand store, not the URL

Every other page in this app keeps its state in the URL (TanStack Router
search params) so it's shareable/bookmarkable. Bar Replay deliberately
doesn't — a replay session is "your one running simulation," not something
you'd link someone else into at a specific bar. Instead, `store.js` holds
symbol, timeframe, bar index, orders, indicators, playback speed, and chart
settings in one `zustand` store wrapped in the `persist` middleware, which
mirrors it to `localStorage` automatically on every change. Reloading the
page just re-hydrates from that same key — no server round-trip, no
special "resume" logic to write.

Left out of the persisted store on purpose: whether playback is currently
*playing* (resuming autoplay unattended after a reload would be
surprising), the order-ticket draft, and the pending "confirm this close"
queue (a stale confirmation dialog reappearing after a reload would be
worse than just losing track of it) — these live in ordinary component
state instead.

### Order matching: touches and gaps

`orderEngine.js` is the pure logic, no chart or React dependency. A bar
"touches" a price if that price falls within `[bar.low, bar.high]` — with
only daily/weekly/monthly bars and no intrabar tick data, that's the only
signal available for whether a limit order filled or a stop/target was
hit.

The one refinement worth knowing about: a bar can **gap clean past** a
level without ever touching it — the whole bar lands on the far side (e.g.
the entire bar is below your stop-loss on a long position, having gapped
down overnight). `levelHit()` detects this case specifically and fills at
that bar's **open** instead of the stale stop-loss/target price, since the
level itself was never actually available to trade at. If a bar somehow
hits both stop-loss and target at once (a very wide bar, or a gap past
both), stop-loss wins — which side happened first intrabar is
unknowable, so this is the conservative assumption.

### Laddered stop-loss/target: one order, several partial-exit legs, on both sides

A position's stop-loss and target each aren't a single price — they're
`stopLosses` and `targets`, both lists of `{ id, price, qty }` legs, each
covering part of the order's quantity. A plain single-stop or
single-target order is just the one-leg case (one leg, `qty` equal to the
whole position), so nothing about the simple path changed; the list is
what makes more than one level possible, independently, on either side.

`processBarForOrders` checks every open order's legs **independently**,
on both sides, ordered nearest-to-entry first (`orderLegsByProximity` -
sorted by plain distance from `order.entryPrice`, which happens to land
stop-loss and target legs in the right nearest-first order on both sides
of both directions without needing to special-case long vs. short), using
the exact same `levelHit()` touch-or-gap logic as before, just once per
leg instead of once per order:

- A leg only shows up in `triggeredCloses` if the bar's range actually
  reaches (or gaps past) *that leg's own price* — a bar that only reaches
  a nearer leg leaves a farther one on the same side completely untouched,
  so the position survives at a reduced size rather than fully closing.
- Each hit leg gets its **own** `triggeredCloses` entry (carrying that
  leg's `price`/`qty` and a `reason` of `'stop_loss'` or `'target'`),
  because a partial hit is a partial close — the caller (BarReplay.jsx)
  needs to know exactly which slice closed, not just "this order had *a*
  stop-loss/target hit somewhere."
- If a gap (or one very wide bar) reaches past more than one leg on the
  same side at once, every reached leg is hit in the same call, each with
  its own entry - same underlying `levelHit()` gap-fill rule per leg, so a
  leg gapped clean through fills at the bar's open just like the
  single-stop/single-target case always did.
- If **any** stop-loss leg is hit, target legs are not checked for that
  order in that same bar — the original "stop-loss wins" conservative
  rule, just extended to cover a partial hit instead of only a full one.

Nothing is mutated in `orders` for a hit leg until its close is actually
confirmed (same "closing only happens on confirm" rule the single-stop
version always followed) — see the next section for what confirming does.

### Partial closes: one order can produce several journaled trades

Closing used to always mean "this order is done, drop it from `orders`."
With laddered exits that's no longer true for a partial hit, so the
close-confirmation flow (`BarReplay.jsx`'s `closeQueue` +
`CloseTradeDialog`) now carries a `leg` alongside the `order` and `reason`
for every queued close - `null` for a full close (manual, or a legacy
single-leg order that covers the whole position), or the specific leg
object for a partial stop-loss/target hit.

- The **dedup key** for the close queue changed from "order id" to "order
  id + leg id" (`closeKey` in BarReplay.jsx) - a gap that hits two legs of
  the same order (on the same side) in one bar needs *two* queued
  confirmations, not one, and the old order-id-only key would have
  silently dropped the second.
- `CloseTradeDialog` journals `leg?.qty ?? order.quantity` as the trade's
  quantity. Its `stop_loss`/`target` fields are gated by `reason` - e.g.
  `reason === 'stop_loss' ? leg?.price : order.stopLosses?.[0]?.price` -
  so a target-leg hit doesn't get misreported as a stop-loss price (a leg
  is now attached for *both* kinds of hit) and vice versa; a manual close
  falls back to whichever level is first-remaining on each side, purely
  informational, same as before laddering existed. Its title shows
  `(partial: N/M shares)` when it isn't the whole position.
- Confirming a partial close (`onClosed` in BarReplay.jsx) removes just
  that one leg from the relevant field (`stopLosses` or `targets`,
  whichever `reason` points at) and reduces `order.quantity` by the leg's
  `qty`. If that was the last leg (nothing left covering the remaining
  quantity, i.e. `remainingQty <= 0`), it's really a full close and the
  order is dropped entirely - same end state as the old single-level
  path, just reached by however many partial confirmations it took to
  unwind the ladder. Dismissing the dialog without saving, as always,
  leaves the order completely unchanged - a stale confirmation can never
  silently shrink a position.

### Adding a level to a live position from the chart, not a form

TradingPanel's "Add stop loss"/"Add target" buttons don't call anything
that mutates an order directly. Clicking one arms `addLevelMode` in
BarReplay.jsx (`{ orderId, kind }`, toggled off by clicking again) and
waits for the next chart click:

- `ReplayChart.jsx` gets `addLevelMode`/`onPlaceLevel` as props. A reactive
  effect (same pattern the disabled "Draw long/short" tool already used
  for this exact reason) disables the chart's own pan/zoom and switches
  the cursor to a crosshair *at arm time*, not inside the click handler -
  the chart's own pan handler lives on a descendant canvas and would
  otherwise see the same pointerdown first and already start panning
  before a reactive toggle could stop it.
- The pointerdown handler checks for an existing line-drag first (so
  dragging a level still works exactly as before); only if nothing was
  grabbed **and** `addLevelMode` is armed does the click count as a
  placement - it reads the price at that y-coordinate and calls
  `onPlaceLevel(price)`.
- `placeLevel` in BarReplay.jsx (the `onPlaceLevel` handler) resolves
  `addLevelMode` back to an order + field (`stopLosses` or `targets`),
  computes the still-uncovered quantity on that side, and appends one new
  leg there - the exact same "cover whatever's left" rule the old
  one-shot "Set stop loss"/"Set target" buttons used, just placed by a
  click instead of a computed default offset that then needed dragging.

### Chart & Trade panel: one line, one row, per leg (both sides)

`ReplayChart.jsx`'s draggable-price-line effect and price-line-drawing
effect both iterate `order.stopLosses` **and** `order.targets` instead of
reading two flat fields - each leg on either side gets its own line
(`SL1`/`SL2`… or `T1`/`T2`… once there's more than one on that side),
keyed `${orderId}:stopLoss:${legId}`/`${orderId}:target:${legId}` so
dragging one leg's line only touches that leg. `TradingPanel.jsx`'s
`OrderRow` mirrors this with one row per leg on each side (each with its
own remove button) instead of a single optional field - "Add stop
loss"/"Add target" only appears while some quantity on that side is still
unprotected (`covered qty < order.quantity`), matching how the old
one-shot "Set stop loss"/"Set target" buttons only appeared when there
was nothing set yet.

### Persisted sessions: a one-time store migration

Existing sessions saved before this feature have orders with bare
`stopLoss: number | null` and `target: number | null` fields, not
`stopLosses`/`targets` lists. `store.js`'s zustand `persist` config bumps
to `version: 1` with a `migrate` function that rewrites any
`version < 1` order's `stopLoss`/`target` into single-leg
`stopLosses`/`targets` arrays (`[{ id, price, qty: order.quantity }]`, or
`[]` if it was `null`) the first time the store rehydrates - so a session
saved before this change resumes exactly as it looked before, just
represented as the new one-leg-covers-everything shape under the hood.

### The chart: lightweight-charts, one instance, multiple panes

`ReplayChart.jsx` owns a single `lightweight-charts` instance for the whole
component's lifetime (torn down and recreated only when the symbol or
timeframe changes — every other update just calls `.setData()` on existing
series, which is what lets your zoom/pan survive stepping or playing
forward instead of resetting every bar).

- **RSI gets its own pane** below the candles using lightweight-charts'
  native multi-pane support (`chart.addSeries(type, opts, paneIndex)`) —
  not a second chart instance. It's pinned to a fixed 0–100 scale
  (autoscale off) so it never rescales to price, with dashed reference
  lines at whatever levels you've configured in Settings.
- **Dragging a stop-loss/target line** is done with raw pointer event
  listeners on the chart's container, not a lightweight-charts feature —
  the library has no built-in draggable price line. Pointer-down within a
  few pixels of a line's y-coordinate grabs it; pointer-up commits the new
  price. While dragging, the chart's own pan/zoom is deliberately disabled
  the moment a drag *starts* (not reactively after) — a subtlety that
  mattered: the chart's own pan handler lives on its canvas, which sees a
  mousedown before this component's own container-level listener does, so
  disabling pan reactively was too late to stop it from also panning
  during the same drag.
- **Chart settings** (candle colors, RSI levels) apply via
  `series.applyOptions()` on the existing series when you save them in
  Settings — never a full chart rebuild, so changing a color doesn't reset
  your zoom either.

### Axis drags: the price scale is the app's, not the library's

Dragging a price axis (or double-clicking it to re-autoscale) is handled by
this component, not left to lightweight-charts. The chart's own axis handler
fights the drawing layer and the order-line drags for the same pointer, and it
has no idea which pane's scale the pointer is actually over once an oscillator
pane exists. `ReplayChart`'s pointer listeners resolve the pane under the
cursor (`chart.panes()` → the pane's own first series, or the candle series for
pane 0), then move *that* scale's visible range directly, so a drag on the RSI
pane's axis stretches RSI and never price. Double-click on any axis puts that
one scale back on autoscale.

### Framing is persisted, but the store is read exactly once

The zoom window, pane heights and per-pane price ranges are written back into
the session store, so a reload lands where you left off. Two rules keep that
from costing anything:

- **Read once, at mount.** `BarReplay` pulls `view` out of the store with
  `getState()` rather than subscribing to it. Subscribing meant every frame of
  a pan re-rendered the page, which re-sliced the `bars` array, which made the
  chart `setData()` every candle and recompute every indicator mid-drag. After
  mount the chart owns its framing and only reports it back.
- **Writes are coalesced** (400ms trailing, flushed on unmount) and only fire
  when something actually moved — a drag emits dozens of range-change events,
  each one otherwise a synchronous `localStorage` write of the whole session.

A saved price range of `null` means "that pane was left on autoscale", stored
explicitly: restoring a range onto a scale you never pinned would freeze it at
yesterday's prices. Each pane's scale is restored **once** — after that it
belongs to you, and re-applying it on a later render would snap your drag back.

### Replayed dates vs. when you logged it

A replay trade carries **four** timestamps, and they mean four different
things:

| Column | What it is |
|---|---|
| `entried_at` | the replayed bar the position **opened** on |
| `exited_at` | the replayed bar it **closed** on |
| `traded_at` | the journal's date for the trade — kept equal to the entry bar |
| `created_at` | when the row was **written** (wall clock, DB default) |

`traded_at` is the market date because everything that reasons about price
reasons about it: the entry-context snapshot reads the bars around it, the
equity curve and the calendar place the trade in the market it was taken in.
It used to hold the wall clock instead, which dated a 2013 replay session to
today and scored it against today's chart.

The entry date is stamped **on the order at fill** (`entryDate`, set beside
`entryBarIndex` in `orderEngine.processBarForOrders`), not looked up from a
bar index when the trade closes. An index is only valid against the exact
`allBars` array it filled on, and that array grows at the front when more
history is collected — so the lookup could come back `null`, or worse, point
at a different bar.

Anything measuring *your* activity rather than the market uses `created_at`:
the journal's Trades tab sorts newest-logged first and shows it as the
**Logged** column, and the [Goals](backtesting-manual.md#goals-tab-targets-and-limits-scored-per-period-nothing-persisted-but-the-goal-itself)
tab buckets by it — a session practised on 2013 bars is work you did today.

### Screenshot on close

`ReplayChart` exposes a `captureScreenshot()` method via `useImperativeHandle`,
built on lightweight-charts' own `chart.takeScreenshot()` (no separate
screenshot library). The moment a trade closes — automatically (stop-loss/
target hit) or manually — that screenshot is captured immediately and
carried along through the close-confirmation flow. When the confirmation
dialog's mutation actually creates the trade, it uploads that captured
image right after, through the same upload endpoint the manual trade form
uses for user-picked files — Bar Replay just supplies a captured `Blob`
instead of something you selected from disk.

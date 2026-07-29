# Bar Replay

[← Back to index](README.md)

`/backtest/replay` — step through a stock's real history bar-by-bar and
paper-trade it.

## Using it

**Setup**
1. Pick a symbol and timeframe (1D/1W/1M) in the Setup panel.
2. Click **Collect max data** if you haven't already for that symbol.
3. Optionally set a start date, then **Start replay**.

**Playback**
- Step back/forward, play/pause (0.5×–4× speed), or jump to a date.
- Shortcuts: `B` buy, `S` sell, `Shift+↓` play/pause, `Shift+→` step forward.

**Trading**
- **Buy**/**Sell** in the Trade panel opens an order ticket — Market or
  Limit, with optional stop-loss/target. A target/SL on the wrong side of
  entry is rejected with an inline error.
- Drag a stop-loss/target line directly on the chart to adjust it after
  placing the order. If an order was placed without one, use **Set stop
  loss**/**Set target** on that position to add one (seeded near entry,
  then drag it into place).
- If price gaps clean past a stop-loss/target instead of touching it, the
  trade still closes — filled at that bar's open, not the skipped level.
- Closing a trade (manually or automatically) opens a feedback dialog
  (result/emotion/notes) and pauses playback while it's open. The trade is
  saved with a screenshot of the chart at that moment, and shows up in the
  [Manual trade journal](backtesting-manual.md) above.

**Indicators & settings**
- Indicators panel: add EMA, SMA, or RSI. RSI gets its own pane below the
  candles.
- The gear icon (top-left) opens **Settings**: candle colors, default
  order quantity, and RSI reference levels (add/remove any number of
  levels, not just 30/70).

**Persistence**
- Everything here (symbol, timeframe, bar position, open orders,
  indicators, settings) is saved to your browser's local storage as you
  go — closing the tab or reloading resumes exactly where you left off.
  This state is per-browser, not synced anywhere.

## How it works

Everything here is client-side — `frontend/src/features/bar-replay/`.
There's no "replay" concept on the backend at all; it's just the app's
regular `price_history_max` data (the same one-time "Collect max history"
pull used elsewhere) plus a chart that only reveals bars up to a cursor.

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

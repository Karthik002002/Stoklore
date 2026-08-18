import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DEFAULT_CHART_SETTINGS = {
  bodyUpColor: '#22c55e',
  bodyDownColor: '#ef4444',
  wickUpColor: '#22c55e',
  wickDownColor: '#ef4444',
  borderVisible: false,
  borderUpColor: '#22c55e',
  borderDownColor: '#ef4444',
  defaultQty: 1,
  rsiLevels: [30, 70],
}

const DEFAULT_INDICATORS = [{ key: 'default-ema20', type: 'ema', period: 20 }]

// How the chart is framed, as opposed to what it shows.
//
// `logicalRange` is the zoom/pan window (lightweight-charts' bar-index range, not a price range).
// `logicalRange: null` means "no saved framing" - the chart falls back to its
// INITIAL_VISIBLE_BARS window (see ReplayChart). It is cleared on a symbol/timeframe change
// because it counts bars: bar 3200-3400 of one instrument is nowhere near the same place in
// another.
//
// `paneHeights` is the dragged height of each pane, in lightweight-charts' relative stretch
// units, keyed by WHAT THE PANE SHOWS - 'price' for the candles, otherwise the oscillator's
// indicator type ('rsi', 'macd', ...). Keyed rather than a positional [3, 1, 1] array because
// pane INDEX is just "which oscillator type came first in the indicator list": drop RSI from a
// chart that also has MACD and MACD slides from pane 2 to pane 1, inheriting RSI's height under a
// positional scheme. Keying by type means a height follows the indicator it belongs to, and an
// indicator you re-add later comes back the size you left it.
//
// Deliberately survives a symbol/timeframe change - how tall you like the RSI pane is a layout
// preference, not something about the instrument.
//
// `priceRanges` is the vertical half of the same idea: what each pane's price scale is showing,
// keyed the same way as paneHeights. A value of `null` means "that pane was left on autoscale" -
// stored explicitly, because restoring a range onto a scale the user never pinned would freeze it
// at yesterday's prices, and the two states have to be told apart. Cleared with logicalRange on a
// symbol/timeframe change: a price window in rupees means nothing on another instrument.
const DEFAULT_VIEW = { logicalRange: null, paneHeights: {}, priceRanges: {} }

// Everything about a Bar Replay session lives in this one store - symbol/timeframe/bar position,
// open/pending orders, indicators, playback speed, and chart/trading settings - persisted to
// localStorage (zustand's `persist` middleware) so leaving the page, even a hard reload, and
// coming back to /backtest/replay resumes exactly where it left off instead of starting blank.
// Deliberately NOT in the URL like a lot of TanStack Router state elsewhere in this app - this
// page's state is "your one running replay session", not something you'd bookmark or share a
// link to at a specific bar.
export const useBarReplayStore = create(
  persist(
    (set) => ({
      symbol: null,
      timeframe: '1D',
      barIndex: null,
      orders: [],
      // Trendlines/horizontal lines/rectangles drawn on the chart. Anchored to a fractional bar
      // index + a price (see ReplayChart's drawing layer), which is why they're dropped on a
      // symbol/timeframe change alongside the orders - bar 3200 is a different moment in every
      // instrument. Kept across a restart: the levels you marked are analysis of THIS chart, and
      // redrawing them to replay the same stretch again would be busywork.
      drawings: [],
      indicators: DEFAULT_INDICATORS,
      speedMs: 1000,
      settings: DEFAULT_CHART_SETTINGS,
      view: DEFAULT_VIEW,
      // Which trade_accounts row trades logged from this session's closes are journaled under -
      // sticky across the session (not reset by setSymbol/setTimeframe below) since a replay
      // session is "practicing one strategy", the same strategy regardless of which symbol is on
      // screen at the moment. null = unassigned, same as the manual trade form's "No account".
      accountId: null,

      // A fresh symbol/timeframe carries no orders or bar position over - a limit/SL/target (or
      // "bar 400") from a different instrument/timeframe makes no sense. Same for the saved zoom
      // window; the pane heights stay (see DEFAULT_VIEW).
      setSymbol: (symbol) =>
        set((s) => ({
          symbol,
          barIndex: null,
          orders: [],
          drawings: [],
          view: { ...s.view, logicalRange: null, priceRanges: {} },
        })),
      setTimeframe: (timeframe) =>
        set((s) => ({
          timeframe,
          barIndex: null,
          orders: [],
          drawings: [],
          view: { ...s.view, logicalRange: null, priceRanges: {} },
        })),
      setBarIndex: (barIndex) => set({ barIndex }),
      setOrders: (orders) => set({ orders }),
      setDrawings: (drawings) => set({ drawings }),
      setIndicators: (indicators) => set({ indicators }),
      setSpeedMs: (speedMs) => set({ speedMs }),
      setSettings: (settings) => set({ settings }),
      setAccountId: (accountId) => set({ accountId }),
      setView: (view) => set((s) => ({ view: { ...s.view, ...view } })),
      restart: () =>
        set((s) => ({
          barIndex: null,
          orders: [],
          view: { ...s.view, logicalRange: null, priceRanges: {} },
        })),
    }),
    {
      name: 'barReplay.store',
      version: 7,
      // v0 -> v1: a position's stop-loss and target were single `stopLoss`/`target` numbers;
      // they're now `stopLosses`/`targets`, lists of {id, price, qty} legs (see orderEngine.js)
      // so one trade can carry a laddered exit on either side - a plain single-SL/single-target
      // order just becomes a one-leg list covering the full quantity, so nothing about existing
      // sessions' behavior changes.
      migrate: (persisted, version) => {
        // v6 -> v7: `view.priceRanges` is new. persist's merge is shallow and `view` already
        // exists, so without this an upgraded session reads it as undefined - harmless, but the
        // first sample would then write a key the restore path never looked for.
        if (version < 7 && persisted?.view && !persisted.view.priceRanges) {
          persisted.view.priceRanges = {}
        }
        // v5 -> v6: `drawings` is new. persist's merge is shallow, so a session saved before this
        // existed has no key at all and would read as undefined rather than an empty list.
        if (version < 6 && persisted && !persisted.drawings) {
          persisted.drawings = []
        }
        // v4 -> v5: pane heights moved from a positional `paneStretch` array to `paneHeights`
        // keyed by what the pane shows. The old array can't be converted - which slot held which
        // oscillator wasn't recorded - so it's dropped and the panes go back to their defaults.
        // A layout preference is cheap to redo; silently reapplying it to the wrong indicator is
        // not.
        if (version < 5 && persisted) {
          delete persisted.view?.paneStretch
          if (persisted.view) persisted.view.paneHeights = {}
        }
        // v3 -> v4: `view` (zoom window + pane heights) is new. persist's merge is shallow, so a
        // session saved before this existed has no `view` key at all and would read as undefined
        // rather than falling back to DEFAULT_VIEW.
        if (version < 4 && persisted && !persisted.view) {
          persisted.view = DEFAULT_VIEW
        }
        // v2 -> v3: the monthly timeframe was renamed '1M' -> '1Mo' when '1m' (one minute) became
        // a real timeframe - see lib/replay.js. Without this a persisted '1M' session would show
        // a blank entry in the picker until the user reselected one.
        if (version < 3 && persisted?.timeframe === '1M') {
          persisted.timeframe = '1Mo'
        }
        // v1 -> v2: accountId is new - defaults to null (unassigned), same as every trade logged
        // before accounts existed.
        if (version < 2 && persisted && persisted.accountId === undefined) {
          persisted.accountId = null
        }
        if (version < 1 && persisted?.orders) {
          persisted.orders = persisted.orders.map(({ stopLoss, target, ...order }) => ({
            ...order,
            stopLosses:
              order.stopLosses ??
              (stopLoss != null ? [{ id: crypto.randomUUID(), price: stopLoss, qty: order.quantity }] : []),
            targets:
              order.targets ??
              (target != null ? [{ id: crypto.randomUUID(), price: target, qty: order.quantity }] : []),
          }))
        }
        return persisted
      },
    },
  ),
)

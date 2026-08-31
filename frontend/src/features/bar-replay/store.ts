import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Bar } from '@/lib/types'

// The vocabulary for the whole feature. Every other file in bar-replay/ speaks in these shapes -
// the order engine matches them against bars, the chart draws them, the dialogs edit them.

/** A bar as this feature handles it: always dated, because the daily path stores a date and the
 *  intraday path stamps one (see lib/replay.ts) - and everything here, from the date jumper to the
 *  journal entry a close writes, needs it. */
export type ReplayBar = Bar & { date: string }

/** One rung of a laddered exit: a price, and how much of the position it covers. */
export type ReplayLeg = { id: string; price: number; qty: number }

/** A replay order. 'pending' is a resting limit; 'open' is a filled position. Both exit sides are
 *  ladders - a plain single stop is a one-leg list covering the whole quantity. */
export type ReplayOrder = {
  id: string
  /** How it was placed. A limit rests until the price crosses it; a market order is open at once. */
  type?: 'market' | 'limit'
  direction: 'long' | 'short'
  status: 'pending' | 'open'
  quantity: number
  entryPrice: number
  /** Only valid against the exact bars array it filled on; `entryDate` is what gets journaled. */
  entryBarIndex?: number | null
  entryDate?: string | null
  stopLosses: ReplayLeg[]
  targets: ReplayLeg[]
  notes?: string | null
  /** Chandelier-style trailing stop, when one was armed (see orderEngine's trailStops). */
  trailing?: { atrPeriod?: number; atrMult: number } | null
}

/** A shape drawn over the chart, anchored to fractional bar index + price so it survives pan,
 *  zoom and new bars (see ReplayChart's drawing layer). */
export type Drawing = {
  id: string
  type: 'trendline' | 'hline' | 'rect'
  /** One anchor for a horizontal line, two for a trend line or rectangle. */
  points: { index: number; price: number }[]
}

/** An indicator on the chart: which kind, and its period where it has one. `period: null` is the
 *  periodless kind (VWAP, previous-day levels) - stored explicitly rather than left absent. */
export type IndicatorConfig = { key: string; type: string; period?: number | null }

export type ChartSettings = typeof DEFAULT_CHART_SETTINGS

/** How the chart is framed, as opposed to what it shows - see the note on DEFAULT_VIEW. */
export type ReplayView = {
  logicalRange: { from: number; to: number } | null
  paneHeights: Record<string, number>
  priceRanges: Record<string, { minValue: number; maxValue: number } | null>
}

type ReplayState = {
  symbol: string | null
  timeframe: string
  barIndex: number | null
  orders: ReplayOrder[]
  drawings: Drawing[]
  indicators: IndicatorConfig[]
  speedMs: number
  settings: ChartSettings
  view: ReplayView
  autoRandomJump: boolean
  accountId: number | null
  setSymbol: (symbol: string | null) => void
  setTimeframe: (timeframe: string) => void
  setBarIndex: (barIndex: number | null) => void
  setOrders: (orders: ReplayOrder[]) => void
  setDrawings: (drawings: Drawing[]) => void
  setIndicators: (indicators: IndicatorConfig[]) => void
  setSpeedMs: (speedMs: number) => void
  setSettings: (settings: ChartSettings) => void
  setAccountId: (accountId: number | null) => void
  setAutoRandomJump: (autoRandomJump: boolean) => void
  setView: (view: Partial<ReplayView>) => void
  restart: () => void
}

export const DEFAULT_CHART_SETTINGS = {
  bodyUpColor: '#22c55e',
  bodyDownColor: '#ef4444',
  wickUpColor: '#22c55e',
  wickDownColor: '#ef4444',
  borderVisible: false,
  borderUpColor: '#22c55e',
  borderDownColor: '#ef4444',
  defaultQty: 1,
  // How a new position is sized. 'qty' takes defaultQty as-is; 'pctCapital' spends capitalPct% of
  // the selected account's live balance at the current price (see orderEngine's preferredQuantity).
  // One preference, read by every path that opens a position - the order ticket and the one-key
  // market shortcuts alike - so it never has to be set twice.
  sizeMode: 'qty',
  capitalPct: 10,
  rsiLevels: [30, 70],
}

const DEFAULT_INDICATORS: IndicatorConfig[] = [{ key: 'default-ema20', type: 'ema', period: 20 }]

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
const DEFAULT_VIEW: ReplayView = { logicalRange: null, paneHeights: {}, priceRanges: {} }

// Everything about a Bar Replay session lives in this one store - symbol/timeframe/bar position,
// open/pending orders, indicators, playback speed, and chart/trading settings - persisted to
// localStorage (zustand's `persist` middleware) so leaving the page, even a hard reload, and
// coming back to /backtest/replay resumes exactly where it left off instead of starting blank.
// Deliberately NOT in the URL like a lot of TanStack Router state elsewhere in this app - this
// page's state is "your one running replay session", not something you'd bookmark or share a
// link to at a specific bar.
export const useBarReplayStore = create<ReplayState>()(
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
      // After logging a closed trade, jump the replay to a random bar instead of leaving it
      // parked where the trade ended. Off by default; the toggle lives in the close-trade dialog,
      // where the decision is actually made. Persisted with everything else here, so the choice
      // survives a reload - a missing key in an older persisted session reads as `false` through
      // persist's shallow merge, so this needs no migration.
      autoRandomJump: false,
      // Which trade_accounts row trades logged from this session's closes are journaled under -
      // sticky across the session (not reset by setSymbol/setTimeframe below) since a replay
      // session is "practicing one strategy", the same strategy regardless of which symbol is on
      // screen at the moment. null = unassigned, same as the manual trade form's "No account".
      accountId: null,

      // A fresh symbol/timeframe carries no orders or bar position over - a limit/SL/target (or
      // "bar 400") from a different instrument/timeframe makes no sense. Same for the saved zoom
      // window; the pane heights stay (see DEFAULT_VIEW).
      setSymbol: (symbol: string | null) =>
        set((s) => ({
          symbol,
          barIndex: null,
          orders: [],
          drawings: [],
          view: { ...s.view, logicalRange: null, priceRanges: {} },
        })),
      setTimeframe: (timeframe: string) =>
        set((s) => ({
          timeframe,
          barIndex: null,
          orders: [],
          drawings: [],
          view: { ...s.view, logicalRange: null, priceRanges: {} },
        })),
      setBarIndex: (barIndex: number | null) => set({ barIndex }),
      setOrders: (orders: ReplayOrder[]) => set({ orders }),
      setDrawings: (drawings: Drawing[]) => set({ drawings }),
      setIndicators: (indicators: IndicatorConfig[]) => set({ indicators }),
      setSpeedMs: (speedMs: number) => set({ speedMs }),
      setSettings: (settings: ChartSettings) => set({ settings }),
      setAccountId: (accountId: number | null) => set({ accountId }),
      setAutoRandomJump: (autoRandomJump: boolean) => set({ autoRandomJump }),
      setView: (view: Partial<ReplayView>) => set((s) => ({ view: { ...s.view, ...view } })),
      restart: () =>
        set((s) => ({
          barIndex: null,
          orders: [],
          view: { ...s.view, logicalRange: null, priceRanges: {} },
        })),
    }),
    {
      name: 'barReplay.store',
      version: 8,
      // v0 -> v1: a position's stop-loss and target were single `stopLoss`/`target` numbers;
      // they're now `stopLosses`/`targets`, lists of {id, price, qty} legs (see orderEngine.js)
      // so one trade can carry a laddered exit on either side - a plain single-SL/single-target
      // order just becomes a one-leg list covering the full quantity, so nothing about existing
      // sessions' behavior changes.
      // ts: `any` on the persisted blob, deliberately. Migrations exist precisely because old
      // sessions do NOT match the current state type - typing this as ReplayState would assert
      // the very thing each branch below is there to fix.
      migrate: (persisted: any, version: number) => {
        // v7 -> v8: `settings.sizeMode`/`capitalPct` are new. persist's merge is shallow and
        // `settings` already exists, so an upgraded session would read them as undefined and size
        // every order off an undefined preference.
        if (version < 8 && persisted?.settings) {
          persisted.settings = { ...DEFAULT_CHART_SETTINGS, ...persisted.settings }
        }
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
          persisted.orders = persisted.orders.map(({ stopLoss, target, ...order }: any) => ({
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

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
      indicators: DEFAULT_INDICATORS,
      speedMs: 1000,
      settings: DEFAULT_CHART_SETTINGS,
      // Which trade_accounts row trades logged from this session's closes are journaled under -
      // sticky across the session (not reset by setSymbol/setTimeframe below) since a replay
      // session is "practicing one strategy", the same strategy regardless of which symbol is on
      // screen at the moment. null = unassigned, same as the manual trade form's "No account".
      accountId: null,

      // A fresh symbol/timeframe carries no orders or bar position over - a limit/SL/target (or
      // "bar 400") from a different instrument/timeframe makes no sense.
      setSymbol: (symbol) => set({ symbol, barIndex: null, orders: [] }),
      setTimeframe: (timeframe) => set({ timeframe, barIndex: null, orders: [] }),
      setBarIndex: (barIndex) => set({ barIndex }),
      setOrders: (orders) => set({ orders }),
      setIndicators: (indicators) => set({ indicators }),
      setSpeedMs: (speedMs) => set({ speedMs }),
      setSettings: (settings) => set({ settings }),
      setAccountId: (accountId) => set({ accountId }),
      restart: () => set({ barIndex: null, orders: [] }),
    }),
    {
      name: 'barReplay.store',
      version: 2,
      // v0 -> v1: a position's stop-loss and target were single `stopLoss`/`target` numbers;
      // they're now `stopLosses`/`targets`, lists of {id, price, qty} legs (see orderEngine.js)
      // so one trade can carry a laddered exit on either side - a plain single-SL/single-target
      // order just becomes a one-leg list covering the full quantity, so nothing about existing
      // sessions' behavior changes.
      migrate: (persisted, version) => {
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

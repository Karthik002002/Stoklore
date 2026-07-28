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

      // A fresh symbol/timeframe carries no orders or bar position over - a limit/SL/target (or
      // "bar 400") from a different instrument/timeframe makes no sense.
      setSymbol: (symbol) => set({ symbol, barIndex: null, orders: [] }),
      setTimeframe: (timeframe) => set({ timeframe, barIndex: null, orders: [] }),
      setBarIndex: (barIndex) => set({ barIndex }),
      setOrders: (orders) => set({ orders }),
      setIndicators: (indicators) => set({ indicators }),
      setSpeedMs: (speedMs) => set({ speedMs }),
      setSettings: (settings) => set({ settings }),
      restart: () => set({ barIndex: null, orders: [] }),
    }),
    { name: 'barReplay.store' },
  ),
)

import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import App from './App'
import AutoBacktestDetail from './AutoBacktestDetail'
import Backtesting from './Backtesting'
import BarReplay from './features/bar-replay'
import EventsFeed from './EventsFeed'
import Holdings from './Holdings'
import StockDetail from './StockDetail'
import StocksList from './StocksList'
import TopNews from './TopNews'

const SETTINGS_TABS = [
  'model',
  'litellm',
  'cogencis',
  'broker',
  'rules',
  'data',
  'stocks',
  'activity',
  'backtesting',
]

// Lives on the root route (not a leaf) since the Settings dialog is mounted in App.jsx's layout,
// on top of every page - any page can open it to a specific tab via the same `settings` param,
// and `broker` here is the one shared by Holdings' own broker picker (see holdingsRoute below),
// so Settings' Broker sub-tabs and Holdings' broker selection are always in sync.
const rootRoute = createRootRoute({
  component: App,
  validateSearch: (search) => ({
    settings: SETTINGS_TABS.includes(search.settings) ? search.settings : undefined,
    broker: search.broker === 'kite' ? 'kite' : 'dhan',
  }),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: StocksList,
})

const stockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stock/$symbol',
  component: StockDetail,
})

const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events',
  component: EventsFeed,
})

const topNewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/top-news',
  component: TopNews,
})

const holdingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/holdings',
  validateSearch: (search) => ({
    kiteLogin:
      search.kite_login === 'success' || search.kite_login === 'failed' ? search.kite_login : undefined,
  }),
  component: Holdings,
})

const backtestingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backtesting',
  validateSearch: (search) => ({ tab: search.tab === 'manual' ? 'manual' : 'auto' }),
  component: Backtesting,
})

const autoBacktestDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backtest/auto/$scriptId',
  component: AutoBacktestDetail,
})

// Replay progress (symbol/timeframe/bar pointer, orders, indicators, chart settings) lives in
// the persisted Zustand store (features/bar-replay/store.js), not the URL - so this route has no
// search params of its own, and a reload of /backtest/replay just reads that store back.
const barReplayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backtest/replay',
  component: BarReplay,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  stockRoute,
  eventsRoute,
  topNewsRoute,
  holdingsRoute,
  backtestingRoute,
  autoBacktestDetailRoute,
  barReplayRoute,
])

export const router = createRouter({ routeTree })

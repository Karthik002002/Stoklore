import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import type { SearchSchemaInput } from '@tanstack/react-router'
import App from './App'
import AutoBacktestDetail from './AutoBacktestDetail'
import Backtesting from './Backtesting'
import BarReplay from './features/bar-replay'
import EventsFeed from './EventsFeed'
import Holdings from './Holdings'
import PaperTrading from './paper/PaperTrading'
import PaperPositionChart from './paper/PaperPositionChart'
import LiveTrading from './live/LiveTrading'
import LivePositionChart from './live/LivePositionChart'
import StockDetail from './StockDetail'
import StocksList from './StocksList'
import Shareholding from './Shareholding'
import TopNews from './TopNews'
import TradeSimulation from './TradeSimulation'

// Search params arrive as `unknown` - they came off a URL somebody could have hand-edited. Every
// validateSearch below is the same shape it has always been; the only thing TypeScript adds is
// that the value each one hands back now has a type the pages can rely on.

/** True when `value` is one of `allowed`, and narrows it to that literal union. Replaces the bare
 *  `.includes()` calls this file used to make: identical at runtime (a non-string is never in a
 *  list of strings), but it tells the caller WHICH string it got. */
const oneOf = <T extends string>(allowed: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)

/** A number from the URL, or undefined - the same guard every account param already used. */
const numeric = (value: unknown) => (Number.isFinite(Number(value)) && value ? Number(value) : undefined)

const SETTINGS_TABS = [
  'model',
  'litellm',
  'cogencis',
  'broker',
  'rules',
  'data',
  'stocks',
  'activity',
  'shortcuts',
  'backtesting',
  'accounts',
  'paper-accounts',
] as const

// Lives on the root route (not a leaf) since the Settings dialog is mounted in App.jsx's layout,
// on top of every page - any page can open it to a specific tab via the same `settings` param,
// and `broker` here is the one shared by Holdings' own broker picker (see holdingsRoute below),
// so Settings' Broker sub-tabs and Holdings' broker selection are always in sync.
type SettingsTab = (typeof SETTINGS_TABS)[number]
type Broker = 'dhan' | 'kite'

const rootRoute = createRootRoute({
  component: App,
  // `broker` always comes OUT of here (it defaults to dhan), but a link never has to put it in -
  // which is what SearchSchemaInput expresses: the parameter type is what callers may pass, the
  // return type is what pages read back. Without it, every typed <Link> in the app would be made
  // to spell out `search={{ broker }}` to satisfy a param this function fills in itself.
  validateSearch: (
    search: { settings?: SettingsTab; broker?: Broker } & SearchSchemaInput,
  ): { settings?: SettingsTab; broker: Broker } => ({
    settings: oneOf(SETTINGS_TABS, search.settings) ? search.settings : undefined,
    broker: search.broker === 'kite' ? 'kite' : 'dhan',
  }),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (search): { list?: string } => ({
    list: typeof search.list === 'string' && search.list ? search.list : undefined,
  }),
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
  validateSearch: (search): { kiteLogin?: 'success' | 'failed' } => ({
    kiteLogin:
      search.kite_login === 'success' || search.kite_login === 'failed' ? search.kite_login : undefined,
  }),
  component: Holdings,
})

// Deliberately NOT /holdings - that one is the broker portfolio (what YOU own). This is the
// companies' own shareholding pattern (who owns THEM), and the two would be a coin-flip to guess
// apart from the URL alone.
const shareholdingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shareholding',
  component: Shareholding,
})

const BACKTESTING_VIEWS = ['overview', 'trades', 'statistics', 'goals'] as const
type BacktestingView = (typeof BACKTESTING_VIEWS)[number]

const backtestingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backtesting',
  // `account` is the selected trade account, shared by all four sub-tabs - in the URL so a
  // per-account view is shareable and survives a reload. Undefined = every account at once.
  //
  // `f` is the include/exclude trade filter, kept as one opaque string rather than a param per
  // facet (eight facets × value list + mode would be sixteen). Its grammar and validation live in
  // lib/tradeFilters.js - parseFilters drops anything it doesn't recognise, so a hand-mangled URL
  // degrades to fewer filters instead of a crash.
  validateSearch: (
    search: { view?: BacktestingView; account?: number; f?: string } & SearchSchemaInput,
  ): { view: BacktestingView; account?: number; f?: string } => ({
    view: oneOf(BACKTESTING_VIEWS, search.view) ? search.view : 'overview',
    account: numeric(search.account),
    f: typeof search.f === 'string' && search.f ? search.f : undefined,
  }),
  component: Backtesting,
})

// Live-price paper trading. Its own top-level route rather than a Backtesting tab: this is
// simulated money moving right now, and having it one click from the historical journal makes the
// two easy to confuse. `account` is in the URL for the same reason it is on /backtesting - a
// per-account view should survive a reload.
const PAPER_VIEWS = ['overview', 'holdings', 'trades'] as const
type PaperView = (typeof PAPER_VIEWS)[number]

const paperRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/paper',
  validateSearch: (
    search: { view?: PaperView; account?: number } & SearchSchemaInput,
  ): { view: PaperView; account?: number } => ({
    view: oneOf(PAPER_VIEWS, search.view) ? search.view : 'overview',
    account: numeric(search.account),
  }),
  component: PaperTrading,
})

// Monte Carlo over a trade log. Its own top-level route rather than a fifth Backtesting tab: the
// /backtesting tabs all describe trades that happened, this one projects trades that haven't - and
// it runs over paper accounts too, which that page's account picker deliberately excludes.
//
// Two independent selections, not one: `account` is the Single tab's one account (no "all accounts"
// option - pooling two strategies describes a trader who doesn't exist), and `accounts` is the
// Multiple tab's comma-separated list, each still simulated on its own. Keeping them separate means
// switching tabs doesn't destroy the other tab's selection. `view` is the inner tab under Multiple:
// 'comparison' or a stringified account id.
// One position, on the Bar Replay chart. A child route of /paper rather than a tab: the chart wants
// the whole viewport, and a position is a thing you drill into and come back from.
const paperPositionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/paper/$symbol',
  validateSearch: (search): { account?: number } => ({ account: numeric(search.account) }),
  component: PaperPositionChart,
})

// Real orders, mirrored from Dhan. A sibling of /paper rather than a tab inside it: the two pages
// look alike on purpose, and the one thing that must never happen is clicking the wrong tab.
const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/live',
  component: LiveTrading,
})

// One live position on the Bar Replay chart, where the stop and target lines are legs of a Super
// Order at the broker - dragging one sends a modify.
const livePositionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/live/$symbol',
  component: LivePositionChart,
})

const simulationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/simulation',
  validateSearch: (
    search: {
      mode?: 'single' | 'multiple'
      account?: number
      accounts?: string
      view?: string
    } & SearchSchemaInput,
  ): { mode: 'single' | 'multiple'; account?: number; accounts?: string; view?: string } => ({
    mode: search.mode === 'multiple' ? 'multiple' : 'single',
    account: numeric(search.account),
    accounts: typeof search.accounts === 'string' && search.accounts ? search.accounts : undefined,
    view: typeof search.view === 'string' && search.view ? search.view : undefined,
  }),
  component: TradeSimulation,
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
  shareholdingRoute,
  backtestingRoute,
  paperRoute,
  paperPositionRoute,
  liveRoute,
  livePositionRoute,
  simulationRoute,
  autoBacktestDetailRoute,
  barReplayRoute,
])

export const router = createRouter({ routeTree })

// Registers this router's shape with the library's own types, which is what makes `<Link to>`,
// `useSearch({ from })` and `navigate({ search })` check against the real route tree instead of
// accepting any string. It only reaches files that have been converted - a .jsx page is not
// type-checked, so nothing breaks while the rest of the app is still JavaScript.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

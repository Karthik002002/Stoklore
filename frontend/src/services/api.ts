// The single door to the backend. Every fetch in this app goes through one of these wrappers, so
// a URL, a query-param name or a request body is spelled once and checked here.
//
// **Request bodies and query params are the backend's own types**, generated from its OpenAPI
// schema into ./api.types.ts by `npm run types:api` (the backend must be running). Regenerate it
// whenever a Pydantic model changes; never edit it - it is build output. Run through npx rather
// than as a devDependency: openapi-typescript 7 peer-depends on TypeScript 5, and this repo is on
// 7, so installing it would need --legacy-peer-deps for a tool that runs three times a year.
//
// **Responses are typed here by hand, or not at all.** FastAPI publishes a schema for what it
// ACCEPTS but not for what it returns: none of the 132 endpoints declares a response model, so
// the generated file says `unknown` for every response body. So the shapes the typed code
// actually relies on are written out below, and everything else is honestly `unknown` - which
// turns a silently-wrong field access into a compile error the day someone converts that page,
// rather than an `undefined` at runtime. Adding return annotations to the routers in app/ would
// let these be generated too; until then, this file is the record.
import type { components } from './api.types.ts'
import type { Goal } from '@/lib/tradeGoals'
import type { DailyBar, StockMasterRow, Trade, TradeAccount } from '@/lib/types'

/** The request bodies FastAPI validates, from its own schema. */
type Schemas = components['schemas']
export type ManualTradeRequest = Schemas['ManualTradeRequest']
export type TradeAccountRequest = Schemas['TradeAccountRequest']
export type PaperOrderRequest = Schemas['PaperOrderRequest']
export type PaperModifyRequest = Schemas['PaperModifyRequest']
export type LiveOrderRequest = Schemas['LiveOrderRequest']
export type LiveModifyRequest = Schemas['LiveModifyRequest']
export type LiveSettingsRequest = Schemas['LiveSettingsRequest']
export type AlertRequest = Schemas['AlertRequest']
export type WatchRuleRequest = Schemas['WatchRuleRequest']
export type AutoBacktestScriptRequest = Schemas['AutoBacktestScriptRequest']
export type BacktestRunRequest = Schemas['BacktestRunRequest']
export type BacktestSaveRequest = Schemas['BacktestSaveRequest']
export type BalanceAdjustmentRequest = Schemas['BalanceAdjustmentRequest']
export type TradingGoalRequest = Schemas['TradingGoalRequest']
export type ManualBacktestSettingsRequest = Schemas['ManualBacktestSettingsRequest']
export type ActivitySettingsRequest = Schemas['ActivitySettingsRequest']
export type ActivityDay = Schemas['ActivityDay']
export type BulkMaxCollectRequest = Schemas['BulkMaxCollectRequest']

// --- Response shapes this app actually reads ---------------------------------------------------
// Only the ones typed code depends on. Everything else stays `unknown` on purpose (see above).

/** A candle series as the chart endpoints return it. */
/** A bar from the chart endpoints. Unlike a stored daily bar it always carries a unix `time`
 *  (pre-shifted to IST by scraper.py so the UTC-only axis reads as market-local) and no `date`. */
export type ChartBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** `bars` includes warmup bars before `visibleFrom` so indicators can be computed across the
 *  whole visible range - the price series itself is the bars at or after it. */
export type ChartResponse = {
  bars: ChartBar[]
  interval: string
  visibleFrom: number | null
  source?: string
}

/** One open paper position, marked to the last known price by the endpoint. */
export type PaperPosition = {
  id: number
  account_id: number
  symbol: string
  direction: 'long' | 'short'
  order_type: 'market' | 'limit'
  status: 'pending' | 'open'
  quantity: number
  entry_price: number
  stop_losses: { id: string; price: number; qty: number }[]
  targets: { id: string; price: number; qty: number }[]
  notes: string | null
  /** Filled in by the positions endpoint from the quote cache, so it can be absent. */
  sector?: string | null
  current_price: number | null
  price_as_of: string | null
  price_stale: boolean
  pnl: number | null
  pnl_pct: number | null
  value: number | null
}

/** Dhan's order book, mirrored (app/core/live.py). Statuses are Dhan's own vocabulary. */
export type LiveOrder = {
  order_id: string
  parent_order_id: string | null
  correlation_id: string | null
  status: 'TRANSIT' | 'PENDING' | 'PART_TRADED' | 'TRADED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED'
  symbol: string | null
  security_id: string
  side: 'BUY' | 'SELL' | null
  product: string | null
  order_type: string | null
  leg: 'ENTRY_LEG' | 'TARGET_LEG' | 'STOP_LOSS_LEG' | null
  quantity: number | null
  filled_qty: number | null
  avg_price: number | null
  price: number | null
  trigger_price: number | null
  error: string | null
}

/** Dhan's position book, mirrored, plus the app's own delayed mark. */
export type LivePosition = {
  security_id: string
  symbol: string | null
  product: string | null
  position_type: string | null
  net_qty: number
  buy_qty: number
  sell_qty: number
  buy_avg: number | null
  sell_avg: number | null
  realised: number | null
  unrealised: number | null
  current_price?: number | null
  mark_pnl?: number
}

export type LiveStatus = {
  configured: boolean
  sandbox: boolean
  base_url: string
  /** Deployable cash from Dhan's fund limit; null when unconfigured or never fetched. */
  balance: number | null
  settings: {
    enabled: boolean
    max_order_value: number
    max_orders_per_day: number
    daily_loss_limit: number
    /** Share of the wallet one position may take before the ticket warns. Advisory. */
    max_position_pct: number
    product: string
    account_id: number | null
  }
  runtime: {
    halted: boolean
    halt_reason: string | null
    orders_today: number
    realised_today: number
  }
  poller: { running: boolean; last_poll: string | null; last_error: string | null }
  unconfirmed: { correlation_id: string; symbol: string | null; error: string | null }[]
}

/** A background collector's state, as the max-history and bulk-collect endpoints report it. */
export type CollectStatus = {
  running: boolean
  error: string | null
  done?: number
  total?: number
  symbol?: string | null
}

/** What a create endpoint answers with - the row's new id, and nothing else. */
export type Created = { id: number }

/** The master search: matching rows, plus the per-board totals so a caller can show the split. */
/** How many rows the master holds, split two ways. The exchange split has three buckets on
 *  purpose: a dual-listed company is ONE row, so nse_only + both + bse_only == total. */
export type StockMasterCounts = {
  total: number
  main: number
  sme: number
  nse: number
  nse_only: number
  bse: number
  bse_only: number
  both: number
}

export type StockMasterSearch = StockMasterCounts & { stocks: StockMasterRow[] }

/** Which price_sources plugin can fetch history, and which one is picked by default. */
export type PriceSources = { sources: string[]; default: string }

/** A price level the user armed, or something the broker did - one feed, two kinds. */
export type Alert = {
  id: number
  kind: 'price' | 'order'
  symbol: string | null
  condition: 'above' | 'below' | null
  price: number | null
  note: string | null
  recurring: boolean
  active: boolean
  triggered_at: string | null
  triggered_price: number | null
  message: string | null
  acknowledged_at: string | null
  created_at: string
}

/** Query params, minus the ones that weren't set. URLSearchParams wants strings, and an
 *  undefined left in becomes the literal "undefined" in the URL - which the backend then tries to
 *  parse. */
const queryEntries = (params: Record<string, unknown>): [string, string][] =>
  Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => [k, String(v)])

async function json<T = unknown>(res: Response): Promise<T> {
  if (!res.ok) {
    const { detail } = await res.json().catch(() => ({}))
    throw new Error(detail || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

// Quote + news + reports for one symbol. The order ticket only wants `quote.currentPrice`, but this
// is the endpoint the app already caches per symbol, so asking for it here is a cache hit.
/** yfinance's quote bag. The named fields are the ones the app reads; the rest are passed
 *  through as-is and looked up by key (StockDetail's fundamentals grid). */
export type StockQuote = {
  currentPrice?: number | null
  shortName?: string | null
  sector?: string | null
  regularMarketChangePercent?: number | null
  [key: string]: unknown
}

/** One news item stored for a symbol (stock_news). */
export type StockNews = {
  title: string
  summary: string | null
  url: string
  published_at: string | null
  source: string | null
  origin: string | null
  sentiment_label: string | null
}

/** A scraped page kept for a symbol. */
export type StockReport = { id: number; symbol: string; content_markdown: string; scraped_at: string }

/** What /api/stocks/{symbol} answers with. `quote` is {} when the upstream fetch failed. */
export type StockDetail = { quote: StockQuote; news: StockNews[]; reports: StockReport[] }

export const getStockDetail = (symbol: string) => fetch(`/api/stocks/${symbol}`).then(json<StockDetail>)

export const getStockChart = (symbol: string, range: string) =>
  fetch(`/api/stocks/${symbol}/chart?range=${range}`).then(json<ChartResponse>)

/** One benchmark index's live quote. Both fields are null when the upstream quote failed. */
export type IndexQuote = { name: string; price: number | null; changePercent: number | null }

export const getIndices = () => fetch('/api/indices').then(json<IndexQuote[]>)

/** One index row from NSE's Index Performances table. Every number can be missing - NSE omits
 *  PE/PB/DY for several index families. */
export type MacroIndex = {
  name: string
  symbol: string
  last: number | null
  change: number | null
  percentChange: number | null
  open: number | null
  high: number | null
  low: number | null
  previousClose: number | null
  yearHigh: number | null
  yearLow: number | null
  pe: number | string | null
  pb: number | string | null
  dy: number | string | null
  advances: number | string | null
  declines: number | string | null
  unchanged: number | string | null
  perChange30d: number | null
  perChange365d: number | null
}

/** All NSE-published indices, grouped the way NSE groups them (Broad Market, Sectoral, …). */
export type MacroIndices = {
  timestamp: string | null
  advances: number | string | null
  declines: number | string | null
  unchanged: number | string | null
  groups: { key: string; indices: MacroIndex[] }[]
}

export const getMacroIndices = () => fetch('/api/macro-indices').then(json<MacroIndices>)

// --- Dashboard (StocksList's terminal view) -------------------------------------------------
// These wrap endpoints StocksList used to hit with bare fetch()es - moved here so the dashboard
// can poll them through react-query (refetchInterval) like every other live view in the app.
/** A tracked symbol on the terminal list: its report counts plus a cached quote. Price and
 *  change are null when the upstream fetch failed for that symbol. */
export type TrackedStock = {
  symbol: string
  report_count: number
  last_scraped: string | null
  price: number | null
  changePercent: number | null
}

export const getStocks = () => fetch('/api/stocks').then(json<TrackedStock[]>)

/** One membership row: a symbol can sit in more than one list. */
export type WatchlistEntry = { symbol: string; list_name: string }

export const getWatchlist = () => fetch('/api/watchlist').then(json<WatchlistEntry[]>)

export const getWatchlistNames = () => fetch('/api/watchlists').then(json<string[]>)

/** One row of the events feed (stock_events, joined to whichever watchlist the symbol is in). */
export type FeedEvent = {
  id: number
  symbol: string
  list_name: string | null
  event_type: string
  headline: string
  detail: string | null
  url: string | null
  event_time: string | null
  sentiment_label: 'positive' | 'negative' | 'neutral' | null
  sentiment_score: number | null
}

/** How much a symbol is being covered right now versus its own baseline. */
export type AttentionScore = {
  symbol: string
  list_name: string | null
  recent_count: number
  baseline_count: number
  baseline_avg: number
  /** recent vs baseline; null when there is no baseline to divide by. */
  ratio: number | null
  is_new_attention: boolean
}

export const getEvents = (listName?: string) =>
  fetch(`/api/events${listName ? `?list_name=${encodeURIComponent(listName)}` : ''}`).then(json<FeedEvent[]>)

export const getEventsAttention = (listName?: string) =>
  fetch(`/api/events/attention${listName ? `?list_name=${encodeURIComponent(listName)}` : ''}`).then(
    json<AttentionScore[]>,
  )

export const getTopNews = () => fetch('/api/top-news').then(json)

export const getIndexChart = (name: string, range: string) =>
  fetch(`/api/indices/${name}/chart?range=${range}`).then(json<ChartResponse>)

/** Quarterly financials, pivoted: one column per period (the last is 'TTM'), one row per line
 *  item with a value per period. A null is a quarter the source didn't report. */
export type Financials = {
  periods: string[]
  rows: { label: string; values: (number | null)[] }[]
}

export const getStockFinancials = (symbol: string) =>
  fetch(`/api/stocks/${symbol}/financials`).then(json<Financials>)

// Screener.in company page - fundamentals, pros/cons, 12y statements, shareholding, filings.
/** One statement table off a screener.in page: pivoted, values kept as the display strings the
 *  source printed (one table mixes ₹ Cr, % and per-share, so the formatting carries the unit). */
export type ScreenerTable = {
  title: string
  periods: string[]
  rows: { label: string; values: string[] }[]
}

/** A filing screener lists, with its own one-line summary where it has one. */
export type ScreenerDocument = { title: string; detail: string | null; url: string }

/** Everything parseable off a company's screener.in page (app/core/scraper.py). */
export type ScreenerData = {
  url: string
  name: string
  about: string | null
  keyPoints: string | null
  industry: string[]
  ratios: { label: string; value: string }[]
  pros: string[]
  cons: string[]
  /** Keyed by screener's own section id (profit-loss, balance-sheet, …). */
  tables: Record<string, ScreenerTable>
  /** Keyed by the group heading screener prints (Announcements, Annual reports, …). */
  documents: Record<string, ScreenerDocument[]>
}

export const getScreenerData = (symbol: string) =>
  fetch(`/api/stocks/${symbol}/screener`).then(json<ScreenerData>)

/** Where the two EMAs stand, and when they last crossed. `crossover` is set only when the cross
 *  happened on the latest bar - 'bullish' is a golden cross, 'bearish' a death cross. */
export type EmaCrossover = {
  crossover: 'bullish' | 'bearish' | null
  shortEma: number
  longEma: number
  lastCrossoverDate: string | null
}

export const getEmaCrossover = (symbol: string, short: number, long: number) =>
  fetch(`/api/prices/${symbol}/ema-crossover?short=${short}&long=${long}`).then(json<EmaCrossover>)

export const getMaxHistory = (symbol: string) => fetch(`/api/prices/${symbol}/max`).then(json<DailyBar[]>)

export const getMaxHistoryStatus = (symbol: string) =>
  fetch(`/api/prices/${symbol}/max/status`).then(json<CollectStatus>)

// Bar Replay's intraday timeframes (15m/1H/4H) - returns {bars, source}. The first call for a
// symbol is slow (the backend extracts it from the remote minute dataset into a local cache),
// every later one is fast. See minute_data.py.
export const getIntradayBars = (symbol: string, interval: string) =>
  fetch(`/api/prices/${symbol}/intraday?interval=${encodeURIComponent(interval)}`).then(json<ChartResponse>)

// `source` picks which price_sources plugin (backend) actually fetches the data - see
// GET /api/prices/sources for the live list instead of hardcoding names here.
export const getPriceSources = () => fetch('/api/prices/sources').then(json<PriceSources>)

// `source` is optional and OMITTED when absent rather than sent empty: the endpoint defaults to
// price_sources.DEFAULT_SOURCE, and a `?source=undefined` (which is what a missing one used to
// stringify to, before the sources list had loaded) is a 422 for an unknown source.
export const collectMaxHistory = (symbol: string, source?: string | null) =>
  fetch(`/api/prices/${symbol}/max/collect${source ? `?source=${encodeURIComponent(source)}` : ''}`, {
    method: 'POST',
  }).then(json)

export const collectMaxHistoryBulk = (symbols: string[], source: string) =>
  fetch('/api/prices/max/collect-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols, source }),
  }).then(json)

/** The bulk collector's progress: which symbol it is on, and how each finished one went. One
 *  failure never stops the batch, so `results` mixes successes and errors. */
export type BulkCollectStatus = {
  running: boolean
  done: number
  total: number
  current_symbol: string | null
  results: { symbol: string; ok: boolean; error: string | null }[]
}

export const getBulkCollectStatus = () =>
  fetch('/api/prices/max/collect-bulk/status').then(json<BulkCollectStatus>)

/** A model the chat can run on: the id the API takes, and what to show in the picker. */
export type ModelOption = { id: string; label: string }

export const getModels = () => fetch('/api/models').then(json<ModelOption[]>)

export const getActiveModel = () => fetch('/api/settings/active-model').then(json<{ model: string | null }>)

export const setActiveModel = (model: string) =>
  fetch('/api/settings/active-model', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  }).then(json)

/** The proxy's address, and whether a key is stored - the key itself is never sent back. */
export type LiteLLMConfig = { base_url: string | null; has_api_key: boolean }

export const getLiteLLMConfig = () => fetch('/api/settings/litellm').then(json<LiteLLMConfig>)

export const setLiteLLMConfig = (baseUrl: string, apiKey: string | null) =>
  fetch('/api/settings/litellm', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_url: baseUrl, api_key: apiKey || null }),
  }).then(json)

export const getCogencisConfig = () => fetch('/api/settings/cogencis').then(json<{ has_token: boolean }>)

export const setCogencisToken = (token: string) =>
  fetch('/api/settings/cogencis', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).then(json)

export const getWatchRules = () => fetch('/api/watch-rules').then(json<WatchRule[]>)

/** What the LLM recognised in a rule written in plain English. Every field is optional - a rule
 *  can name any one of them. */
export type WatchCriteria = {
  max_pe?: number | null
  ema_short?: number | null
  ema_long?: number | null
  no_negative_events_days?: number | null
}

/** A saved rule, as the list endpoint returns it. */
export type WatchRule = {
  id: number
  name: string
  rule_text: string
  max_pe: number | null
  ema_short: number | null
  ema_long: number | null
  no_negative_events_days: number | null
  created_at: string
}

/** One rule checked against one symbol: every condition, and whether all of them held. */
export type RuleCheck = {
  symbol?: string
  passed: boolean
  checks: { label: string; passed: boolean; detail: string }[]
}

export const createWatchRule = (rule: WatchRuleRequest) =>
  fetch('/api/watch-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  }).then(json<{ ok: boolean; criteria: WatchCriteria }>)

export const deleteWatchRule = (id: number) =>
  fetch(`/api/watch-rules/${id}`, { method: 'DELETE' }).then(json)

export const checkWatchRule = (id: number, symbol?: string) =>
  fetch(`/api/watch-rules/${id}/check${symbol ? `?symbol=${symbol}` : ''}`).then(
    json<RuleCheck | RuleCheck[]>,
  )

/** Which broker is active and what each one has configured. Kite's session dies daily, so
 *  `logged_in_today` is the one that decides whether holdings can be fetched at all. */
export type BrokerConfig = {
  active_broker: string | null
  dhan: { has_credentials: boolean }
  kite: { has_credentials: boolean; logged_in_today: boolean }
}

export const getBrokerConfig = () => fetch('/api/settings/broker').then(json<BrokerConfig>)

export const setActiveBroker = (broker: string) =>
  fetch('/api/settings/broker', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ broker }),
  }).then(json)

export const setDhanConfig = (clientId: string, accessToken: string) =>
  fetch('/api/settings/dhan', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, access_token: accessToken }),
  }).then(json)

export const setKiteConfig = (apiKey: string, apiSecret: string) =>
  fetch('/api/settings/kite', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret }),
  }).then(json)

export const getKiteLoginUrl = () => fetch('/api/kite/login-url').then(json<{ url: string }>)

/** One holding at the broker. `ltp` is filled in from this app's own quote cache when the broker
 *  doesn't send a price (Dhan doesn't; Kite does) - see app/services/holdings.py. */
export type Holding = {
  symbol: string
  isin: string | null
  qty: number
  avg_price: number | null
  ltp: number | null
}

/** The portfolio snapshot: deployable cash and the holdings themselves. */
export type Portfolio = { available_balance: number | null; holdings: Holding[] }

export const getHoldings = (broker?: string, force = false) => {
  const params = new URLSearchParams()
  if (broker) params.set('broker_id', broker)
  if (force) params.set('force', 'true')
  const qs = params.toString()
  return fetch(`/api/holdings${qs ? `?${qs}` : ''}`).then(json<Portfolio>)
}

/** A saved EMA-crossover backtest run (the `backtests` table), newest first. */
export type StoredBacktest = {
  id: number
  symbol: string
  short_period: number
  long_period: number
  from_date: string | null
  to_date: string | null
  total_return_pct: number | null
  win_rate: number | null
  num_trades: number | null
  trades: unknown
  lessons: string | null
  created_at: string
}

export const getBacktests = (symbol?: string) =>
  fetch(`/api/backtests${symbol ? `?symbol=${symbol}` : ''}`).then(json<StoredBacktest[]>)

export const runBacktest = (params: BacktestRunRequest) =>
  fetch('/api/backtest/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).then(json)

export const saveBacktest = (params: BacktestSaveRequest) =>
  fetch('/api/backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).then(json)

export const updateBacktestLessons = (id: number, lessons: string) =>
  fetch(`/api/backtest/${id}/lessons`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lessons }),
  }).then(json)

export const deleteBacktest = (id: number) => fetch(`/api/backtest/${id}`, { method: 'DELETE' }).then(json)

export const getPriceHistory = (symbol: string, days = 365) =>
  fetch(`/api/prices/${symbol}?days=${days}`).then(json<DailyBar[]>)

/** A saved Pine script: what the Auto tab lists and the detail page edits. */
export type AutoBacktestScript = {
  id: number
  name: string
  script: string
  created_at: string
  updated_at: string
}

export const getAutoBacktestScripts = () =>
  fetch('/api/backtest/auto/scripts').then(json<AutoBacktestScript[]>)

export const getAutoBacktestScript = (id: number) =>
  fetch(`/api/backtest/auto/scripts/${id}`).then(json<AutoBacktestScript>)

export const createAutoBacktestScript = (script: AutoBacktestScriptRequest) =>
  fetch('/api/backtest/auto/scripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(script),
  }).then(json)

export const updateAutoBacktestScript = (id: number, script: AutoBacktestScriptRequest) =>
  fetch(`/api/backtest/auto/scripts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(script),
  }).then(json)

export const deleteAutoBacktestScript = (id: number) =>
  fetch(`/api/backtest/auto/scripts/${id}`, { method: 'DELETE' }).then(json)

export const getManualTrades = () => fetch('/api/manual-trades').then(json<Trade[]>)

export const createManualTrade = (trade: ManualTradeRequest) =>
  fetch('/api/manual-trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trade),
  }).then(json<Created>)

export const updateManualTrade = (id: number, trade: ManualTradeRequest) =>
  fetch(`/api/manual-trades/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trade),
  }).then(json)

export const deleteManualTrade = (id: number) =>
  fetch(`/api/manual-trades/${id}`, { method: 'DELETE' }).then(json)

export const uploadManualTradeImage = (id: number, file: File | Blob) => {
  const form = new FormData()
  form.append('file', file)
  return fetch(`/api/manual-trades/${id}/image`, { method: 'POST', body: form }).then(json)
}

export const analyzeBulkTradeImage = (file: File, model?: string) => {
  const form = new FormData()
  form.append('file', file)
  const qs = model ? `?model=${encodeURIComponent(model)}` : ''
  return fetch(`/api/manual-trades/bulk/analyze${qs}`, { method: 'POST', body: form }).then(json)
}

// `kind` is 'journal' (hand-logged trades) or 'paper' (live simulation). Defaults to journal, so
// every existing caller keeps behaving exactly as before.
export const getTradeAccounts = (kind: 'journal' | 'paper' = 'journal') =>
  fetch(`/api/trade-accounts?kind=${kind}`).then(json<TradeAccount[]>)

export const createTradeAccount = (account: TradeAccountRequest, kind: 'journal' | 'paper' = 'journal') =>
  fetch(`/api/trade-accounts?kind=${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  }).then(json)

export const updateTradeAccount = (id: number, account: TradeAccountRequest) =>
  fetch(`/api/trade-accounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  }).then(json)

export const deleteTradeAccount = (id: number) =>
  fetch(`/api/trade-accounts/${id}`, { method: 'DELETE' }).then(json)

export const getManualBacktestSettings = () =>
  fetch('/api/settings/manual-backtest').then(json<ManualBacktestSettingsRequest>)

export const setManualBacktestSettings = (settings: ManualBacktestSettingsRequest) =>
  fetch('/api/settings/manual-backtest', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }).then(json)

export const getTradingGoals = () => fetch('/api/trading-goals').then(json<Goal[]>)

export const setTradingGoals = (goals: TradingGoalRequest[]) =>
  fetch('/api/trading-goals', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(goals),
  }).then(json)

/** Cash moved in or out of an account's wallet, outside of trading. */
export type BalanceAdjustment = {
  id: number
  account_id: number | null
  amount: number
  /** 'add' is a deposit, 'subtract' a withdrawal (same pair lib/tradeAccounts works in). */
  type: 'add' | 'subtract'
  reason: string | null
  notes: string | null
  adjusted_at: string
}

export const getBalanceAdjustments = () =>
  fetch('/api/manual-trades/balance-adjustments').then(json<BalanceAdjustment[]>)

export const createBalanceAdjustment = (adjustment: BalanceAdjustmentRequest) =>
  fetch('/api/manual-trades/balance-adjustments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adjustment),
  }).then(json)

export const deleteBalanceAdjustment = (id: number) =>
  fetch(`/api/manual-trades/balance-adjustments/${id}`, { method: 'DELETE' }).then(json)

export const pingActivity = (kind: string) =>
  fetch('/api/activity/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  }).then(json)

// Per-day backlog, not a heartbeat: [{ date: 'YYYY-MM-DD', seconds }]. The browser owns the tally
// (see lib/activityTime.js); this is the occasional catch-up that keeps the year graph fed.
export const postActivityTime = (days: ActivityDay[]) =>
  fetch('/api/activity/time', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  }).then(json)

/** One day in the consistency window: was the app used in a way that counts. */
export type ActivityDaySummary = { date: string; seconds_active: number; qualifies: boolean }

/** The streak/consistency picture (app/routers/activity.py), read by the tracker and the banner. */
export type ActivitySummary = {
  days: ActivityDaySummary[]
  today_qualifies: boolean
  today_breakdown: { traded: boolean; analyzed: boolean; reviewed: boolean }
  current_streak: number
  best_streak: number
  days_missed_in_a_row: number
  avg_seconds_today: number
  avg_seconds_7d: number
  daily_goal_minutes: number
  qualifiers: Record<string, boolean>
}

export const getActivitySummary = () => fetch('/api/activity/summary').then(json<ActivitySummary>)

export const getActivitySettings = () => fetch('/api/settings/activity').then(json<ActivitySettingsRequest>)

export const setActivitySettings = (settings: ActivitySettingsRequest) =>
  fetch('/api/settings/activity', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }).then(json)

/** A previously-scraped symbol, as the @-tag search returns it - NOT the listed-equity master
 *  (that is searchStocksMaster below, which answers with a different shape entirely). */
export type SymbolMatch = { symbol: string; last_scraped: string | null }

export const searchStocks = (q = '') =>
  fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`).then(json<SymbolMatch[]>)

/** A freshly scraped symbol: the resolved symbol, and the page as markdown. */
export type AddedStock = { symbol: string; content_markdown: string }

export const addStock = (symbol: string) =>
  fetch('/api/stocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol }),
  }).then(json<AddedStock>)

// `board` is 'MAIN' | 'SME' | undefined (both boards). Rows carry name, series, board, market_lot,
// face_value, listing_date and ISIN, so every caller can show what a symbol actually is.
// NSE's top gainers/losers, one blob covering every index bucket. Fetched from NSE at most once a
// day (it only moves after the close) - `refresh` forces it.
/** One row of NSE's movers table. `change` is derived from ltp - prev_price, not from NSE's own
 *  net_price, which sometimes carries a different basis (see scraper._mover_row). */
export type MoverRow = {
  symbol: string
  series: string | null
  ltp: number | null
  prev_price: number | null
  perChange: number | null
  trade_quantity: number | null
  /** ₹ lakh, as NSE sends it. */
  turnover: number | null
  change: number | null
  /** A real corporate action, or null - NSE's own '-' placeholder is dropped. */
  ca_purpose: string | null
  ca_ex_date: string | null
}

/** NSE's post-close gainers/losers, one entry per index bucket. `trade_date` is the session the
 *  snapshot belongs to, not when it was fetched. */
export type MoverGroup = { key: string; label: string; gainers: MoverRow[]; losers: MoverRow[] }

export type MarketMovers = {
  timestamp: string | null
  trade_date: string | null
  groups: MoverGroup[]
  /** When this app last fetched it, and whether that fetch failed and this is the stored copy. */
  fetched_at: string | null
  stale: boolean
}

export const getMarketMovers = (refresh = false) =>
  fetch(`/api/market-movers${refresh ? '?refresh=1' : ''}`).then(json<MarketMovers>)

export const searchStocksMaster = (q = '', board?: string) =>
  fetch(`/api/stocks-master?q=${encodeURIComponent(q)}${board ? `&board=${board}` : ''}`).then(
    json<StockMasterSearch>,
  )

// `board` forces every row onto that board; omitted, each row's board comes from its SERIES code
// (SM/ST = NSE EMERGE), which is what makes one importer handle both CSVs.
// No file to upload: BSE serves its whole active-equity list as one JSON call, so this is a button
// rather than a file picker. Merges onto existing NSE rows by ISIN - see db.upsert_bse_master.
/** A BSE merge: `merged` gained a scrip code on an existing NSE row, `added` are BSE-only rows. */
export type BseImportResult = StockMasterCounts & { merged: number; added: number }

export const importBseMaster = () =>
  fetch('/api/stocks-master/import-bse', { method: 'POST' }).then(json<BseImportResult>)

export const importStocksMaster = (file: File, board?: string) => {
  const form = new FormData()
  form.append('file', file)
  return fetch(`/api/stocks-master/import${board ? `?board=${board}` : ''}`, {
    method: 'POST',
    body: form,
  }).then(json<StockMasterCounts & { imported: number; imported_sme: number; imported_main: number }>)
}

export const deleteStockMaster = (symbol: string) =>
  fetch(`/api/stocks-master/${symbol}`, { method: 'DELETE' }).then(json)

// --- Paper trading ---------------------------------------------------------------------------
// Open positions come from paper_positions; closed ones are ordinary manual_trades tagged
// 'paper', so history/statistics reuse getManualTrades rather than a paper-specific endpoint.

export const getPaperAccounts = () => fetch('/api/paper/accounts').then(json<TradeAccount[]>)

export const createPaperAccount = (payload: TradeAccountRequest) =>
  fetch('/api/paper/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const getPaperPositions = (accountId?: number | null) =>
  fetch(`/api/paper/positions${accountId != null ? `?account_id=${accountId}` : ''}`).then(
    json<PaperPosition[]>,
  )

/** A placed paper order: filled at `entry_price`, or resting there when status is 'pending'. */
export type PaperPlaced = { id: number; entry_price: number; status: 'pending' | 'open' }

export const createPaperOrder = (payload: PaperOrderRequest) =>
  fetch('/api/paper/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json<PaperPlaced>)

export const modifyPaperPosition = (id: number, payload: PaperModifyRequest) =>
  fetch(`/api/paper/positions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

/** What a close answers with: the price it went out at, and the journal rows it wrote. */
export type PaperClosed = { closed_at: number; trade_ids: number[] }

export const closePaperPosition = (id: number, quantity?: number | null) =>
  fetch(`/api/paper/positions/${id}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: quantity ?? null }),
  }).then(json<PaperClosed>)

// Engine heartbeat - drives the live/stale pulse on the Holdings tab.
/** The paper engine's heartbeat (app/core/paper.py's `state`), plus what the UI needs to judge a
 *  stale timestamp: whether the market is open at all, and the interval to measure staleness in. */
export type PaperStatus = {
  running: boolean
  last_poll: string | null
  last_error: string | null
  checked: number
  market_open: boolean
  poll_seconds: number
}

export const getPaperStatus = () => fetch('/api/paper/status').then(json<PaperStatus>)

// Force one sweep. The backend loop only runs during market hours, so this is what refreshes
// prices on demand outside them.
/** One forced sweep: the exits it fired now, and the ones it back-filled from history first. */
export type PaperPollResult = { triggered: unknown[]; caught_up: unknown[]; last_poll: string | null }

export const pollPaperEngine = () => fetch('/api/paper/poll', { method: 'POST' }).then(json<PaperPollResult>)

// --- Shareholding pattern -------------------------------------------------------------------
// The screener returns one row per symbol with the change already classified server-side (see
/** What changed between two filings. Deliberately not a diagnosis of the corporate action -
 *  `verdict` says which filings are worth reading, not what happened in them. */
export type ShareholdingChange = {
  promoter_pp: number | null
  promoter_shares_delta: number | null
  public_shares_delta: number | null
  total_shares_delta: number | null
  public_holders_delta: number | null
  /** True when the shares demonstrably came from the public; null when the detail is missing. */
  organic: boolean | null
  verdict: string
}

/** The cumulative move over the last `span` filings, and whether it arrived gradually. */
export type ShareholdingWindow = {
  total_pp: number | null
  steps: number
  largest_step: number | null
  gradual: boolean | null
}

/** One company on the screener. */
export type ShareholdingRow = {
  symbol: string
  company: string | null
  period_date: string
  off_cycle: boolean
  promoter_pct: number | null
  public_pct: number | null
  filings: number
  has_detail: boolean
  last_change: ShareholdingChange | null
  window: ShareholdingWindow
  /** 'quiet' nothing moved, 'organic' the public was the counterparty, 'verify' read the filing. */
  flag: 'quiet' | 'organic' | 'verify'
  /** Just enough points to draw the shape of the holding. */
  spark: { period_date: string; promoter_pct: number | null }[]
}

export type ShareholdingScreener = {
  rows: ShareholdingRow[]
  sort: { key: string; order: string }
  coverage: { filings: number; symbols: number; latest_period: string | null; without_detail: number }
  /** verdict key -> the sentence shown for it. */
  verdicts: Record<string, string>
}

// app/core/shareholding.py) - nothing here recomputes it, so the page and the stock detail block
// can never disagree about what a move was.
export const getShareholding = (params: Record<string, string | number | undefined> = {}) => {
  const query = new URLSearchParams(queryEntries(params)).toString()
  return fetch(`/api/shareholding${query ? `?${query}` : ''}`).then(json<ShareholdingScreener>)
}

export const getShareholdingSymbol = (symbol: string) => fetch(`/api/shareholding/${symbol}`).then(json)

/** The collector's progress. `phase` names which pass is running (filings, then XBRL detail). */
export type ShareholdingStatus = {
  running: boolean
  phase: string | null
  done: number
  total: number
  new: number
  details: number
  error: string | null
}

export const getShareholdingStatus = () => fetch('/api/shareholding/status').then(json<ShareholdingStatus>)

// Either a "last N years" shorthand or an explicit { from, to } span from the range picker - the
// backend prefers the span when both arrive.
export const syncShareholding = ({
  years = 1,
  from,
  to,
}: {
  years?: number
  from?: string
  to?: string
} = {}) => {
  const query = new URLSearchParams(from && to ? { from_date: from, to_date: to } : { years: String(years) })
  return fetch(`/api/shareholding/sync?${query}`, { method: 'POST' }).then(json)
}

// --- Live trading (Dhan) ----------------------------------------------------------------------
// Real money. Every mutating call here can be refused by the backend's guardrails, which answer
// with a LIST of reasons rather than one message (see app/core/dhan_orders.py) - `json()` above
// only unpacks a string detail, so these unpack the list themselves and join it.
async function liveJson<T = unknown>(res: Response): Promise<T> {
  if (!res.ok) {
    const { detail } = await res.json().catch(() => ({}))
    const errors = detail?.errors
    throw new Error(Array.isArray(errors) ? errors.join(' ') : detail || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

const post = (url: string, payload?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }).then(liveJson)

export const getLiveStatus = () => fetch('/api/live/status').then(json<LiveStatus>)

export const updateLiveSettings = (payload: LiveSettingsRequest) =>
  fetch('/api/live/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(liveJson)

export const getLiveOrders = (openOnly = false) =>
  fetch(`/api/live/orders${openOnly ? '?open_only=true' : ''}`).then(json<LiveOrder[]>)

export const getLivePositions = () => fetch('/api/live/positions').then(json<LivePosition[]>)

export const syncLive = () => post('/api/live/sync')

export const placeLiveOrder = (payload: LiveOrderRequest) => post('/api/live/orders', payload)

export const modifyLiveOrder = (orderId: string, payload: LiveModifyRequest) =>
  fetch(`/api/live/orders/${orderId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(liveJson)

export const cancelLiveOrder = (orderId: string, leg?: string | null) =>
  fetch(`/api/live/orders/${orderId}${leg ? `?leg=${leg}` : ''}`, { method: 'DELETE' }).then(liveJson)

export const closeLivePosition = (securityId: string) => post(`/api/live/positions/${securityId}/close`)

// Halts for the day and cancels everything still working. Does NOT close open positions - see the
// endpoint's own note on why a panic button must not trade.
export const livePanic = () => post('/api/live/panic')

export const resumeLive = () => post('/api/live/resume')

// The supported answer to a send that timed out: ask the broker what became of it. Never re-send.
export const recoverLiveOrder = (correlationId: string) =>
  post(`/api/live/recover?correlation_id=${encodeURIComponent(correlationId)}`)

// --- Alerts -----------------------------------------------------------------------------------
// One feed for two kinds: price levels you armed, and what the broker did (fills, rejections,
// positions going flat) written by the live mirror.
export const getAlerts = (params: { active?: boolean; limit?: number } = {}) => {
  const query = new URLSearchParams(queryEntries(params)).toString()
  return fetch(`/api/alerts${query ? `?${query}` : ''}`).then(json<Alert[]>)
}

/** What POST /api/alerts answers with - the new id, plus whether the level is already true so
 *  the UI can say the alert will fire on the next sweep rather than "some time". */
export type AlertCreated = { id: number; current_price: number | null; already_true: boolean }

export const createAlert = (payload: AlertRequest) => post('/api/alerts', payload) as Promise<AlertCreated>

export const acknowledgeAlerts = (ids?: number[]) => post('/api/alerts/acknowledge', ids ?? null)

export const deleteAlert = (id: number) => fetch(`/api/alerts/${id}`, { method: 'DELETE' }).then(liveJson)

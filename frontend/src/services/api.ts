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
import type { Bar, DailyBar, StockMasterRow, Trade, TradeAccount } from '@/lib/types'

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
export type ChartResponse = { bars: Bar[]; source?: string }

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
  settings: {
    enabled: boolean
    max_order_value: number
    max_orders_per_day: number
    daily_loss_limit: number
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

/** The master search: matching rows, plus the per-board totals so a caller can show the split. */
export type StockMasterSearch = { stocks: StockMasterRow[]; main: number; sme: number; total: number }

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
export const getStockDetail = (symbol: string) => fetch(`/api/stocks/${symbol}`).then(json)

export const getStockChart = (symbol: string, range: string) => fetch(`/api/stocks/${symbol}/chart?range=${range}`).then(json<ChartResponse>)

export const getIndices = () => fetch('/api/indices').then(json)

export const getMacroIndices = () => fetch('/api/macro-indices').then(json)

// --- Dashboard (StocksList's terminal view) -------------------------------------------------
// These wrap endpoints StocksList used to hit with bare fetch()es - moved here so the dashboard
// can poll them through react-query (refetchInterval) like every other live view in the app.
export const getStocks = () => fetch('/api/stocks').then(json)

export const getWatchlist = () => fetch('/api/watchlist').then(json)

export const getWatchlistNames = () => fetch('/api/watchlists').then(json)

export const getEvents = (listName?: string) =>
  fetch(`/api/events${listName ? `?list_name=${encodeURIComponent(listName)}` : ''}`).then(json)

export const getEventsAttention = (listName?: string) =>
  fetch(`/api/events/attention${listName ? `?list_name=${encodeURIComponent(listName)}` : ''}`).then(json)

export const getTopNews = () => fetch('/api/top-news').then(json)

export const getIndexChart = (name: string, range: string) => fetch(`/api/indices/${name}/chart?range=${range}`).then(json<ChartResponse>)

export const getStockFinancials = (symbol: string) => fetch(`/api/stocks/${symbol}/financials`).then(json)

// Screener.in company page - fundamentals, pros/cons, 12y statements, shareholding, filings.
export const getScreenerData = (symbol: string) => fetch(`/api/stocks/${symbol}/screener`).then(json)

export const getEmaCrossover = (symbol: string, short: number, long: number) =>
  fetch(`/api/prices/${symbol}/ema-crossover?short=${short}&long=${long}`).then(json)

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
  fetch(
    `/api/prices/${symbol}/max/collect${source ? `?source=${encodeURIComponent(source)}` : ''}`,
    { method: 'POST' },
  ).then(json)

export const collectMaxHistoryBulk = (symbols: string[], source: string) =>
  fetch('/api/prices/max/collect-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols, source }),
  }).then(json)

export const getBulkCollectStatus = () => fetch('/api/prices/max/collect-bulk/status').then(json<CollectStatus>)

export const getModels = () => fetch('/api/models').then(json)

export const getActiveModel = () => fetch('/api/settings/active-model').then(json)

export const setActiveModel = (model: string) =>
  fetch('/api/settings/active-model', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  }).then(json)

export const getLiteLLMConfig = () => fetch('/api/settings/litellm').then(json)

export const setLiteLLMConfig = (baseUrl: string, apiKey: string | null) =>
  fetch('/api/settings/litellm', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_url: baseUrl, api_key: apiKey || null }),
  }).then(json)

export const getCogencisConfig = () => fetch('/api/settings/cogencis').then(json)

export const setCogencisToken = (token: string) =>
  fetch('/api/settings/cogencis', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).then(json)

export const getWatchRules = () => fetch('/api/watch-rules').then(json)

export const createWatchRule = (rule: WatchRuleRequest) =>
  fetch('/api/watch-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  }).then(json)

export const deleteWatchRule = (id: number) => fetch(`/api/watch-rules/${id}`, { method: 'DELETE' }).then(json)

export const checkWatchRule = (id: number, symbol?: string) =>
  fetch(`/api/watch-rules/${id}/check${symbol ? `?symbol=${symbol}` : ''}`).then(json)

export const getBrokerConfig = () => fetch('/api/settings/broker').then(json)

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

export const getKiteLoginUrl = () => fetch('/api/kite/login-url').then(json)

export const getHoldings = (broker?: string, force = false) => {
  const params = new URLSearchParams()
  if (broker) params.set('broker_id', broker)
  if (force) params.set('force', 'true')
  const qs = params.toString()
  return fetch(`/api/holdings${qs ? `?${qs}` : ''}`).then(json)
}

export const getBacktests = (symbol?: string) => fetch(`/api/backtests${symbol ? `?symbol=${symbol}` : ''}`).then(json)

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

export const getPriceHistory = (symbol: string, days = 365) => fetch(`/api/prices/${symbol}?days=${days}`).then(json<DailyBar[]>)

export const getAutoBacktestScripts = () => fetch('/api/backtest/auto/scripts').then(json)

export const getAutoBacktestScript = (id: number) => fetch(`/api/backtest/auto/scripts/${id}`).then(json)

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
  }).then(json)

export const updateManualTrade = (id: number, trade: ManualTradeRequest) =>
  fetch(`/api/manual-trades/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trade),
  }).then(json)

export const deleteManualTrade = (id: number) => fetch(`/api/manual-trades/${id}`, { method: 'DELETE' }).then(json)

export const uploadManualTradeImage = (id: number, file: File) => {
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
export const getTradeAccounts = (kind: 'journal' | 'paper' = 'journal') => fetch(`/api/trade-accounts?kind=${kind}`).then(json<TradeAccount[]>)

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

export const deleteTradeAccount = (id: number) => fetch(`/api/trade-accounts/${id}`, { method: 'DELETE' }).then(json)

export const getManualBacktestSettings = () => fetch('/api/settings/manual-backtest').then(json)

export const setManualBacktestSettings = (settings: ManualBacktestSettingsRequest) =>
  fetch('/api/settings/manual-backtest', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }).then(json)

export const getTradingGoals = () => fetch('/api/trading-goals').then(json)

export const setTradingGoals = (goals: TradingGoalRequest[]) =>
  fetch('/api/trading-goals', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(goals),
  }).then(json)

export const getBalanceAdjustments = () => fetch('/api/manual-trades/balance-adjustments').then(json)

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

export const getActivitySummary = () => fetch('/api/activity/summary').then(json)

export const getActivitySettings = () => fetch('/api/settings/activity').then(json)

export const setActivitySettings = (settings: ActivitySettingsRequest) =>
  fetch('/api/settings/activity', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }).then(json)

export const searchStocks = (q = '') =>
  fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`).then(json<StockMasterSearch>)

export const addStock = (symbol: string) =>
  fetch('/api/stocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol }),
  }).then(json)

// `board` is 'MAIN' | 'SME' | undefined (both boards). Rows carry name, series, board, market_lot,
// face_value, listing_date and ISIN, so every caller can show what a symbol actually is.
// NSE's top gainers/losers, one blob covering every index bucket. Fetched from NSE at most once a
// day (it only moves after the close) - `refresh` forces it.
export const getMarketMovers = (refresh = false) =>
  fetch(`/api/market-movers${refresh ? '?refresh=1' : ''}`).then(json)

export const searchStocksMaster = (q = '', board?: string) =>
  fetch(`/api/stocks-master?q=${encodeURIComponent(q)}${board ? `&board=${board}` : ''}`).then(
    json<StockMasterSearch>,
  )

// `board` forces every row onto that board; omitted, each row's board comes from its SERIES code
// (SM/ST = NSE EMERGE), which is what makes one importer handle both CSVs.
// No file to upload: BSE serves its whole active-equity list as one JSON call, so this is a button
// rather than a file picker. Merges onto existing NSE rows by ISIN - see db.upsert_bse_master.
export const importBseMaster = () => fetch('/api/stocks-master/import-bse', { method: 'POST' }).then(json)

export const importStocksMaster = (file: File, board?: string) => {
  const form = new FormData()
  form.append('file', file)
  return fetch(`/api/stocks-master/import${board ? `?board=${board}` : ''}`, {
    method: 'POST',
    body: form,
  }).then(json)
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
  fetch(`/api/paper/positions${accountId != null ? `?account_id=${accountId}` : ''}`).then(json<PaperPosition[]>)

export const createPaperOrder = (payload: PaperOrderRequest) =>
  fetch('/api/paper/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const modifyPaperPosition = (id: number, payload: PaperModifyRequest) =>
  fetch(`/api/paper/positions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const closePaperPosition = (id: number, quantity?: number | null) =>
  fetch(`/api/paper/positions/${id}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: quantity ?? null }),
  }).then(json)

// Engine heartbeat - drives the live/stale pulse on the Holdings tab.
export const getPaperStatus = () => fetch('/api/paper/status').then(json)

// Force one sweep. The backend loop only runs during market hours, so this is what refreshes
// prices on demand outside them.
export const pollPaperEngine = () => fetch('/api/paper/poll', { method: 'POST' }).then(json)

// --- Shareholding pattern -------------------------------------------------------------------
// The screener returns one row per symbol with the change already classified server-side (see
// app/core/shareholding.py) - nothing here recomputes it, so the page and the stock detail block
// can never disagree about what a move was.
export const getShareholding = (params: Record<string, string | number | undefined> = {}) => {
  const query = new URLSearchParams(queryEntries(params)).toString()
  return fetch(`/api/shareholding${query ? `?${query}` : ''}`).then(json)
}

export const getShareholdingSymbol = (symbol: string) => fetch(`/api/shareholding/${symbol}`).then(json)

export const getShareholdingStatus = () => fetch('/api/shareholding/status').then(json)

// Either a "last N years" shorthand or an explicit { from, to } span from the range picker - the
// backend prefers the span when both arrive.
export const syncShareholding = ({ years = 1, from, to }: { years?: number; from?: string; to?: string } = {}) => {
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

export const createAlert = (payload: AlertRequest) => post('/api/alerts', payload)

export const acknowledgeAlerts = (ids?: number[]) => post('/api/alerts/acknowledge', ids ?? null)

export const deleteAlert = (id: number) => fetch(`/api/alerts/${id}`, { method: 'DELETE' }).then(liveJson)

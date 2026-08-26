async function json(res) {
  if (!res.ok) {
    const { detail } = await res.json().catch(() => ({}))
    throw new Error(detail || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

// Quote + news + reports for one symbol. The order ticket only wants `quote.currentPrice`, but this
// is the endpoint the app already caches per symbol, so asking for it here is a cache hit.
export const getStockDetail = (symbol) => fetch(`/api/stocks/${symbol}`).then(json)

export const getStockChart = (symbol, range) => fetch(`/api/stocks/${symbol}/chart?range=${range}`).then(json)

export const getIndices = () => fetch('/api/indices').then(json)

export const getMacroIndices = () => fetch('/api/macro-indices').then(json)

// --- Dashboard (StocksList's terminal view) -------------------------------------------------
// These wrap endpoints StocksList used to hit with bare fetch()es - moved here so the dashboard
// can poll them through react-query (refetchInterval) like every other live view in the app.
export const getStocks = () => fetch('/api/stocks').then(json)

export const getWatchlist = () => fetch('/api/watchlist').then(json)

export const getWatchlistNames = () => fetch('/api/watchlists').then(json)

export const getEvents = (listName) =>
  fetch(`/api/events${listName ? `?list_name=${encodeURIComponent(listName)}` : ''}`).then(json)

export const getEventsAttention = (listName) =>
  fetch(`/api/events/attention${listName ? `?list_name=${encodeURIComponent(listName)}` : ''}`).then(json)

export const getTopNews = () => fetch('/api/top-news').then(json)

export const getIndexChart = (name, range) => fetch(`/api/indices/${name}/chart?range=${range}`).then(json)

export const getStockFinancials = (symbol) => fetch(`/api/stocks/${symbol}/financials`).then(json)

// Screener.in company page - fundamentals, pros/cons, 12y statements, shareholding, filings.
export const getScreenerData = (symbol) => fetch(`/api/stocks/${symbol}/screener`).then(json)

export const getEmaCrossover = (symbol, short, long) =>
  fetch(`/api/prices/${symbol}/ema-crossover?short=${short}&long=${long}`).then(json)

export const getMaxHistory = (symbol) => fetch(`/api/prices/${symbol}/max`).then(json)

export const getMaxHistoryStatus = (symbol) => fetch(`/api/prices/${symbol}/max/status`).then(json)

// Bar Replay's intraday timeframes (15m/1H/4H) - returns {bars, source}. The first call for a
// symbol is slow (the backend extracts it from the remote minute dataset into a local cache),
// every later one is fast. See minute_data.py.
export const getIntradayBars = (symbol, interval) =>
  fetch(`/api/prices/${symbol}/intraday?interval=${encodeURIComponent(interval)}`).then(json)

// `source` picks which price_sources plugin (backend) actually fetches the data - see
// GET /api/prices/sources for the live list instead of hardcoding names here.
export const getPriceSources = () => fetch('/api/prices/sources').then(json)

export const collectMaxHistory = (symbol, source) =>
  fetch(`/api/prices/${symbol}/max/collect?source=${encodeURIComponent(source)}`, { method: 'POST' }).then(
    json,
  )

export const collectMaxHistoryBulk = (symbols, source) =>
  fetch('/api/prices/max/collect-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols, source }),
  }).then(json)

export const getBulkCollectStatus = () => fetch('/api/prices/max/collect-bulk/status').then(json)

export const getModels = () => fetch('/api/models').then(json)

export const getActiveModel = () => fetch('/api/settings/active-model').then(json)

export const setActiveModel = (model) =>
  fetch('/api/settings/active-model', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  }).then(json)

export const getLiteLLMConfig = () => fetch('/api/settings/litellm').then(json)

export const setLiteLLMConfig = (baseUrl, apiKey) =>
  fetch('/api/settings/litellm', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_url: baseUrl, api_key: apiKey || null }),
  }).then(json)

export const getCogencisConfig = () => fetch('/api/settings/cogencis').then(json)

export const setCogencisToken = (token) =>
  fetch('/api/settings/cogencis', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).then(json)

export const getWatchRules = () => fetch('/api/watch-rules').then(json)

export const createWatchRule = (rule) =>
  fetch('/api/watch-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  }).then(json)

export const deleteWatchRule = (id) => fetch(`/api/watch-rules/${id}`, { method: 'DELETE' }).then(json)

export const checkWatchRule = (id, symbol) =>
  fetch(`/api/watch-rules/${id}/check${symbol ? `?symbol=${symbol}` : ''}`).then(json)

export const getBrokerConfig = () => fetch('/api/settings/broker').then(json)

export const setActiveBroker = (broker) =>
  fetch('/api/settings/broker', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ broker }),
  }).then(json)

export const setDhanConfig = (clientId, accessToken) =>
  fetch('/api/settings/dhan', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, access_token: accessToken }),
  }).then(json)

export const setKiteConfig = (apiKey, apiSecret) =>
  fetch('/api/settings/kite', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret }),
  }).then(json)

export const getKiteLoginUrl = () => fetch('/api/kite/login-url').then(json)

export const getHoldings = (broker, force = false) => {
  const params = new URLSearchParams()
  if (broker) params.set('broker_id', broker)
  if (force) params.set('force', 'true')
  const qs = params.toString()
  return fetch(`/api/holdings${qs ? `?${qs}` : ''}`).then(json)
}

export const getBacktests = (symbol) => fetch(`/api/backtests${symbol ? `?symbol=${symbol}` : ''}`).then(json)

export const runBacktest = (params) =>
  fetch('/api/backtest/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).then(json)

export const saveBacktest = (params) =>
  fetch('/api/backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).then(json)

export const updateBacktestLessons = (id, lessons) =>
  fetch(`/api/backtest/${id}/lessons`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lessons }),
  }).then(json)

export const deleteBacktest = (id) => fetch(`/api/backtest/${id}`, { method: 'DELETE' }).then(json)

export const getPriceHistory = (symbol, days = 365) => fetch(`/api/prices/${symbol}?days=${days}`).then(json)

export const getAutoBacktestScripts = () => fetch('/api/backtest/auto/scripts').then(json)

export const getAutoBacktestScript = (id) => fetch(`/api/backtest/auto/scripts/${id}`).then(json)

export const createAutoBacktestScript = (script) =>
  fetch('/api/backtest/auto/scripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(script),
  }).then(json)

export const updateAutoBacktestScript = (id, script) =>
  fetch(`/api/backtest/auto/scripts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(script),
  }).then(json)

export const deleteAutoBacktestScript = (id) =>
  fetch(`/api/backtest/auto/scripts/${id}`, { method: 'DELETE' }).then(json)

export const getManualTrades = () => fetch('/api/manual-trades').then(json)

export const createManualTrade = (trade) =>
  fetch('/api/manual-trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trade),
  }).then(json)

export const updateManualTrade = (id, trade) =>
  fetch(`/api/manual-trades/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trade),
  }).then(json)

export const deleteManualTrade = (id) => fetch(`/api/manual-trades/${id}`, { method: 'DELETE' }).then(json)

export const uploadManualTradeImage = (id, file) => {
  const form = new FormData()
  form.append('file', file)
  return fetch(`/api/manual-trades/${id}/image`, { method: 'POST', body: form }).then(json)
}

export const analyzeBulkTradeImage = (file, model) => {
  const form = new FormData()
  form.append('file', file)
  const qs = model ? `?model=${encodeURIComponent(model)}` : ''
  return fetch(`/api/manual-trades/bulk/analyze${qs}`, { method: 'POST', body: form }).then(json)
}

// `kind` is 'journal' (hand-logged trades) or 'paper' (live simulation). Defaults to journal, so
// every existing caller keeps behaving exactly as before.
export const getTradeAccounts = (kind = 'journal') => fetch(`/api/trade-accounts?kind=${kind}`).then(json)

export const createTradeAccount = (account, kind = 'journal') =>
  fetch(`/api/trade-accounts?kind=${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  }).then(json)

export const updateTradeAccount = (id, account) =>
  fetch(`/api/trade-accounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  }).then(json)

export const deleteTradeAccount = (id) => fetch(`/api/trade-accounts/${id}`, { method: 'DELETE' }).then(json)

export const getManualBacktestSettings = () => fetch('/api/settings/manual-backtest').then(json)

export const setManualBacktestSettings = (settings) =>
  fetch('/api/settings/manual-backtest', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }).then(json)

export const getTradingGoals = () => fetch('/api/trading-goals').then(json)

export const setTradingGoals = (goals) =>
  fetch('/api/trading-goals', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(goals),
  }).then(json)

export const getBalanceAdjustments = () => fetch('/api/manual-trades/balance-adjustments').then(json)

export const createBalanceAdjustment = (adjustment) =>
  fetch('/api/manual-trades/balance-adjustments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adjustment),
  }).then(json)

export const deleteBalanceAdjustment = (id) =>
  fetch(`/api/manual-trades/balance-adjustments/${id}`, { method: 'DELETE' }).then(json)

export const pingActivity = (kind) =>
  fetch('/api/activity/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  }).then(json)

// Per-day backlog, not a heartbeat: [{ date: 'YYYY-MM-DD', seconds }]. The browser owns the tally
// (see lib/activityTime.js); this is the occasional catch-up that keeps the year graph fed.
export const postActivityTime = (days) =>
  fetch('/api/activity/time', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  }).then(json)

export const getActivitySummary = () => fetch('/api/activity/summary').then(json)

export const getActivitySettings = () => fetch('/api/settings/activity').then(json)

export const setActivitySettings = (settings) =>
  fetch('/api/settings/activity', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }).then(json)

export const searchStocks = (q = '') => fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`).then(json)

export const addStock = (symbol) =>
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

export const searchStocksMaster = (q = '', board) =>
  fetch(`/api/stocks-master?q=${encodeURIComponent(q)}${board ? `&board=${board}` : ''}`).then(json)

// `board` forces every row onto that board; omitted, each row's board comes from its SERIES code
// (SM/ST = NSE EMERGE), which is what makes one importer handle both CSVs.
export const importStocksMaster = (file, board) => {
  const form = new FormData()
  form.append('file', file)
  return fetch(`/api/stocks-master/import${board ? `?board=${board}` : ''}`, {
    method: 'POST',
    body: form,
  }).then(json)
}

export const deleteStockMaster = (symbol) =>
  fetch(`/api/stocks-master/${symbol}`, { method: 'DELETE' }).then(json)

// --- Paper trading ---------------------------------------------------------------------------
// Open positions come from paper_positions; closed ones are ordinary manual_trades tagged
// 'paper', so history/statistics reuse getManualTrades rather than a paper-specific endpoint.

export const getPaperAccounts = () => fetch('/api/paper/accounts').then(json)

export const createPaperAccount = (payload) =>
  fetch('/api/paper/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const getPaperPositions = (accountId) =>
  fetch(`/api/paper/positions${accountId != null ? `?account_id=${accountId}` : ''}`).then(json)

export const createPaperOrder = (payload) =>
  fetch('/api/paper/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const modifyPaperPosition = (id, payload) =>
  fetch(`/api/paper/positions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const closePaperPosition = (id, quantity) =>
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
export const getShareholding = (params = {}) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== ''),
  ).toString()
  return fetch(`/api/shareholding${query ? `?${query}` : ''}`).then(json)
}

export const getShareholdingSymbol = (symbol) => fetch(`/api/shareholding/${symbol}`).then(json)

export const getShareholdingStatus = () => fetch('/api/shareholding/status').then(json)

// Either a "last N years" shorthand or an explicit { from, to } span from the range picker - the
// backend prefers the span when both arrive.
export const syncShareholding = ({ years = 1, from, to } = {}) => {
  const query = new URLSearchParams(from && to ? { from_date: from, to_date: to } : { years: String(years) })
  return fetch(`/api/shareholding/sync?${query}`, { method: 'POST' }).then(json)
}

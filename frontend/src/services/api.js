async function json(res) {
  if (!res.ok) {
    const { detail } = await res.json().catch(() => ({}))
    throw new Error(detail || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

export const getStockChart = (symbol, range) => fetch(`/api/stocks/${symbol}/chart?range=${range}`).then(json)

export const getIndices = () => fetch('/api/indices').then(json)

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

export const getManualBacktestSettings = () => fetch('/api/settings/manual-backtest').then(json)

export const setManualBacktestSettings = (settings) =>
  fetch('/api/settings/manual-backtest', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
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

export const searchStocksMaster = (q = '') =>
  fetch(`/api/stocks-master?q=${encodeURIComponent(q)}`).then(json)

export const importStocksMaster = (file) => {
  const form = new FormData()
  form.append('file', file)
  return fetch('/api/stocks-master/import', { method: 'POST', body: form }).then(json)
}

export const deleteStockMaster = (symbol) =>
  fetch(`/api/stocks-master/${symbol}`, { method: 'DELETE' }).then(json)

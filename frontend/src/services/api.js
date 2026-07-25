async function json(res) {
  if (!res.ok) {
    const { detail } = await res.json().catch(() => ({}))
    throw new Error(detail || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

export const getStockChart = (symbol, range) => fetch(`/api/stocks/${symbol}/chart?range=${range}`).then(json)

export const getIndices = () => fetch('/api/indices').then(json)

export const getIndexChart = (name, range) => fetch(`/api/indices/${name}/chart?range=${range}`).then(json)

export const getStockFinancials = (symbol) => fetch(`/api/stocks/${symbol}/financials`).then(json)

export const getEmaCrossover = (symbol, short, long) =>
  fetch(`/api/prices/${symbol}/ema-crossover?short=${short}&long=${long}`).then(json)

export const getMaxHistory = (symbol) => fetch(`/api/prices/${symbol}/max`).then(json)

export const getMaxHistoryStatus = (symbol) => fetch(`/api/prices/${symbol}/max/status`).then(json)

export const collectMaxHistory = (symbol) =>
  fetch(`/api/prices/${symbol}/max/collect`, { method: 'POST' }).then(json)

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

export const searchStocks = (q = '') => fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`).then(json)

export const addStock = (symbol) =>
  fetch('/api/stocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol }),
  }).then(json)

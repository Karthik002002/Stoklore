async function json(res) {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const getStockChart = (symbol, range) => fetch(`/api/stocks/${symbol}/chart?range=${range}`).then(json)

export const getIndices = () => fetch('/api/indices').then(json)

export const getIndexChart = (name, range) => fetch(`/api/indices/${name}/chart?range=${range}`).then(json)

export const getStockFinancials = (symbol) => fetch(`/api/stocks/${symbol}/financials`).then(json)

export const getEmaCrossover = (symbol, short, long) =>
  fetch(`/api/prices/${symbol}/ema-crossover?short=${short}&long=${long}`).then(json)

export const getModels = () => fetch('/api/models').then(json)

export const getActiveModel = () => fetch('/api/settings/active-model').then(json)

export const setActiveModel = (model) =>
  fetch('/api/settings/active-model', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  }).then(json)

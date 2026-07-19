async function json(res) {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const getStockChart = (symbol, range) => fetch(`/api/stocks/${symbol}/chart?range=${range}`).then(json)

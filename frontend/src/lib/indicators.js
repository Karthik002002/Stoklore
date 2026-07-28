// Pure indicator math, no chart/React dependency - shared by PriceChart.jsx (live stock charts)
// and BarReplay.jsx (bar-by-bar replay). `bars` is any array of {time, close}.

export function computeEma(bars, period) {
  if (bars.length < period) return []
  const k = 2 / (period + 1)
  const sma = bars.slice(0, period).reduce((sum, b) => sum + b.close, 0) / period
  const out = [{ time: bars[period - 1].time, value: sma }]
  let prev = sma
  for (let i = period; i < bars.length; i++) {
    prev = bars[i].close * k + prev * (1 - k)
    out.push({ time: bars[i].time, value: prev })
  }
  return out
}

export function computeSma(bars, period) {
  if (bars.length < period) return []
  const out = []
  let windowSum = bars.slice(0, period).reduce((sum, b) => sum + b.close, 0)
  out.push({ time: bars[period - 1].time, value: windowSum / period })
  for (let i = period; i < bars.length; i++) {
    windowSum += bars[i].close - bars[i - period].close
    out.push({ time: bars[i].time, value: windowSum / period })
  }
  return out
}

// A small registry rather than a real dynamic-plugin loader (YAGNI for a personal app) - adding
// a new indicator type is just one more entry here, both callers (PriceChart, BarReplay) already
// iterate this generically.
export const INDICATOR_TYPES = {
  ema: { label: 'EMA', compute: computeEma },
  sma: { label: 'SMA', compute: computeSma },
}

export const INDICATOR_COLORS = ['#f59e0b', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6']

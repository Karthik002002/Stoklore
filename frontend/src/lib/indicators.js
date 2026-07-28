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

// Wilder's smoothing (the standard RSI, matching TradingView's default) - a plain N-bar average
// of gains/losses to seed, then an exponential-style rolling average from there.
export function computeRsi(bars, period) {
  if (bars.length <= period) return []
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = bars[i].close - bars[i - 1].close
    if (diff > 0) gainSum += diff
    else lossSum -= diff
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  const rsiFrom = (gain, loss) => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss))
  const out = [{ time: bars[period].time, value: rsiFrom(avgGain, avgLoss) }]
  for (let i = period + 1; i < bars.length; i++) {
    const diff = bars[i].close - bars[i - 1].close
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
    out.push({ time: bars[i].time, value: rsiFrom(avgGain, avgLoss) })
  }
  return out
}

// A small registry rather than a real dynamic-plugin loader (YAGNI for a personal app) - adding
// a new indicator type is just one more entry here, both callers (PriceChart, BarReplay) already
// iterate this generically. `pane: 'separate'` marks oscillators (0-100 range, unrelated to
// price) that need their own pane below the candles rather than overlaying the price series -
// only BarReplay's ReplayChart (multi-pane aware) reads that flag; PriceChart doesn't use this
// registry at all.
export const INDICATOR_TYPES = {
  ema: { label: 'EMA', compute: computeEma },
  sma: { label: 'SMA', compute: computeSma },
  rsi: { label: 'RSI', compute: computeRsi, pane: 'separate' },
}

export const INDICATOR_COLORS = ['#f59e0b', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6']

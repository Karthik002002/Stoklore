// Timeframe list for Bar Replay's picker. 1D/1W/1M are all derivable from the daily bars this
// app actually syncs (price_history_max) - no new data source needed for those. Intraday entries
// are listed (not hidden) so the picker's architecture visibly supports them, but marked
// unavailable since this app only ever syncs daily OHLCV - they light up automatically the day
// intraday syncing exists, no UI rework needed.
export const REPLAY_TIMEFRAMES = [
  { value: '1D', label: '1 Day', available: true },
  { value: '1W', label: '1 Week', available: true },
  { value: '1M', label: '1 Month', available: true },
  { value: '15m', label: '15 min', available: false },
  { value: '1H', label: '1 Hour', available: false },
  { value: '4H', label: '4 Hour', available: false },
]

export const REPLAY_SPEEDS = [
  { value: 2000, label: '0.5x' },
  { value: 1000, label: '1x' },
  { value: 500, label: '2x' },
  { value: 250, label: '4x' },
]

// Monday of the ISO week containing dateStr, as "YYYY-MM-DD" - used as the aggregated weekly
// candle's representative time.
function weekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const diffToMonday = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - diffToMonday)
  return d.toISOString().slice(0, 10)
}

function monthKey(dateStr) {
  return `${dateStr.slice(0, 7)}-01`
}

// Rolls up ascending daily {date, open, high, low, close, volume} bars into weekly/monthly
// candles. '1D' (or an already-empty list) passes through unchanged.
export function aggregateBars(dailyBars, timeframe) {
  if (timeframe === '1D' || dailyBars.length === 0) return dailyBars
  const keyFn = timeframe === '1W' ? weekKey : monthKey
  const order = []
  const buckets = new Map()
  for (const bar of dailyBars) {
    const key = keyFn(bar.date)
    const bucket = buckets.get(key)
    if (!bucket) {
      buckets.set(key, {
        date: key,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      })
      order.push(key)
    } else {
      bucket.high = Math.max(bucket.high, bar.high)
      bucket.low = Math.min(bucket.low, bar.low)
      bucket.close = bar.close
      bucket.volume += bar.volume
    }
  }
  return order.map((k) => buckets.get(k))
}

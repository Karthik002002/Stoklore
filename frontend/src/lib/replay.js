// Timeframe list for Bar Replay's picker, fine -> coarse. The two halves come from completely
// different sources: 1D/1W/1Mo are rolled up from the daily bars this app syncs itself
// (price_history_max, via aggregateBars below), while everything marked `intraday` is fetched
// from GET /api/prices/{symbol}/intraday, backed by the HuggingFace minute dataset with a
// yfinance fallback (see minute_data.py). isIntraday is what BarReplay switches on.
//
// The monthly value is '1Mo', not '1M' - '1m' (one minute) is a real timeframe here now, and two
// values differing only by case is a footgun waiting for the first careless lowercasing.
export const REPLAY_TIMEFRAMES = [
  { value: '1m', label: '1 min', available: true, intraday: true },
  { value: '5m', label: '5 min', available: true, intraday: true },
  { value: '15m', label: '15 min', available: true, intraday: true },
  { value: '1H', label: '1 Hour', available: true, intraday: true },
  { value: '4H', label: '4 Hour', available: true, intraday: true },
  { value: '1D', label: '1 Day', available: true },
  { value: '1W', label: '1 Week', available: true },
  { value: '1Mo', label: '1 Month', available: true },
]

export const isIntraday = (timeframe) => REPLAY_TIMEFRAMES.some((t) => t.value === timeframe && t.intraday)

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

import type { DailyBar } from './types.ts'

/** What the measure tool needs off a bar. Deliberately looser than Bar or DailyBar: the replay
 *  chart feeds it whichever of the two the current timeframe produced, and the only fields it
 *  reads are the stamp and the volume. */
type MeasureBar = { time?: number | string; date?: string; volume?: number | null }

/** A point the user dragged to on the chart - a fractional bar index and an arbitrary price. */
type MeasureAnchor = { index: number; price: number }

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

export const isIntraday = (timeframe: string) => REPLAY_TIMEFRAMES.some((t) => t.value === timeframe && t.intraday)

export const REPLAY_SPEEDS = [
  { value: 2000, label: '0.5x' },
  { value: 1000, label: '1x' },
  { value: 500, label: '2x' },
  { value: 250, label: '4x' },
]

// Monday of the ISO week containing dateStr, as "YYYY-MM-DD" - used as the aggregated weekly
// candle's representative time.
function weekKey(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const diffToMonday = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - diffToMonday)
  return d.toISOString().slice(0, 10)
}

function monthKey(dateStr: string) {
  return `${dateStr.slice(0, 7)}-01`
}

// Rolls up ascending daily {date, open, high, low, close, volume} bars into weekly/monthly
// candles. '1D' (or an already-empty list) passes through unchanged.
export function aggregateBars(dailyBars: DailyBar[], timeframe: string): DailyBar[] {
  if (timeframe === '1D' || dailyBars.length === 0) return dailyBars
  const keyFn = timeframe === '1W' ? weekKey : monthKey
  const order: string[] = []
  const buckets = new Map<string, DailyBar>()
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
      bucket.volume = (bucket.volume ?? 0) + (bar.volume ?? 0)
    }
  }
  return order.map((k) => buckets.get(k)!)
}

// --- Measure tool -------------------------------------------------------------------------------
// The reading behind Shift+click on the replay chart (TradingView's measure): what the two anchors
// say about price, time and participation. Pure - the chart hands it two {index, price} anchors and
// the bar array they index into, and gets back the numbers to print.

/** Milliseconds a bar's `time` stands for. Intraday bars key on a unix timestamp, daily ones on a
 *  "YYYY-MM-DD" business day (see ReplayChart's stamp) - so this is the one place that has to know
 *  both, and everything downstream just subtracts. */
function barMs(bar: MeasureBar | undefined) {
  if (!bar) return null
  if (typeof bar.time === 'number') return bar.time * 1000
  return Date.parse(`${bar.date ?? bar.time}T00:00:00Z`)
}

/** Elapsed time as the shortest thing worth reading: days once there is at least one, otherwise
 *  hours and minutes. Null when either end has no bar under it. */
export function elapsedLabel(ms: number | null) {
  if (ms == null) return null
  const abs = Math.abs(ms)
  const days = Math.round(abs / 86400000)
  if (days >= 1) return `${days}d`
  const minutes = Math.round(abs / 60000)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

/** The measure reading between two chart anchors.
 *
 *  `price` comes from the anchors themselves, not from the bars underneath: the whole point of
 *  dragging to an arbitrary spot is measuring to THAT level, which is rarely a close. Bars, elapsed
 *  time and volume do come from the bars, since those only exist per candle.
 *
 *  Indices are fractional (the chart's logical scale) and can sit outside the data - past the last
 *  bar is normal, since the replay chart keeps empty space on the right. They're rounded and
 *  clamped, so a measurement dragged into that space still counts the bars it actually covered
 *  rather than reporting nothing.
 */
export function measureRange(bars: MeasureBar[], a: MeasureAnchor, b: MeasureAnchor) {
  const change = b.price - a.price
  const pct = a.price ? (change / a.price) * 100 : null

  const last = bars.length - 1
  const clamp = (i: number) => Math.max(0, Math.min(last, Math.round(i)))
  const from = clamp(Math.min(a.index, b.index))
  const to = clamp(Math.max(a.index, b.index))

  let volume = 0
  for (let i = from; i <= to && bars.length; i++) volume += bars[i]?.volume ?? 0

  const startMs = barMs(bars[from])
  const endMs = barMs(bars[to])
  return {
    change,
    pct,
    // Inclusive: dragging across one candle is "1 bar", not zero.
    bars: bars.length ? to - from + 1 : 0,
    elapsed: startMs == null || endMs == null ? null : elapsedLabel(endMs - startMs),
    volume: bars.length ? volume : null,
    up: change >= 0,
  }
}

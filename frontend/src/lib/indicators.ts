// Pure indicator math, no chart/React dependency - shared by PriceChart.jsx (live stock charts)
// and BarReplay.jsx (bar-by-bar replay).
//
// The moving averages take any array of {time, close}. Everything below them needs the full
// candle ({time, date, open, high, low, close}) - see INDICATOR_TYPES' note at the bottom.
//
// Self-check: node frontend/src/lib/indicators.selfcheck.mjs
import type { Bar } from './types.ts'

/** What every indicator returns: a value per bar time, ready for lightweight-charts. */
export type Point = { time: number; value: number }

/** An indicator series aligned index-for-index with the bars it was computed from. The leading
 *  entries are null: a 20-period average has no value until the 20th bar. */
export type Series = (number | null)[]

/** One session's OHLC, accumulated bar by bar for the previous-day levels. */
type DayOhlc = { open: number; high: number; low: number; close: number }

export function computeEma(bars: Bar[], period: number) {
  if (bars.length < period) return []
  const k = 2 / (period + 1)
  const sma = bars.slice(0, period).reduce((sum: number, b: Bar) => sum + b.close, 0) / period
  const out = [{ time: bars[period - 1].time, value: sma }]
  let prev = sma
  for (let i = period; i < bars.length; i++) {
    prev = bars[i].close * k + prev * (1 - k)
    out.push({ time: bars[i].time, value: prev })
  }
  return out
}

export function computeSma(bars: Bar[], period: number) {
  if (bars.length < period) return []
  const out = []
  let windowSum = bars.slice(0, period).reduce((sum: number, b: Bar) => sum + b.close, 0)
  out.push({ time: bars[period - 1].time, value: windowSum / period })
  for (let i = period; i < bars.length; i++) {
    windowSum += bars[i].close - bars[i - period].close
    out.push({ time: bars[i].time, value: windowSum / period })
  }
  return out
}

// Wilder's smoothing (the standard RSI, matching TradingView's default) - a plain N-bar average
// of gains/losses to seed, then an exponential-style rolling average from there.
export function computeRsi(bars: Bar[], period: number) {
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
  const rsiFrom = (gain: number, loss: number) => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss))
  const out = [{ time: bars[period].time, value: rsiFrom(avgGain, avgLoss) }]
  for (let i = period + 1; i < bars.length; i++) {
    const diff = bars[i].close - bars[i - 1].close
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
    out.push({ time: bars[i].time, value: rsiFrom(avgGain, avgLoss) })
  }
  return out
}

// --- shared array helpers -------------------------------------------------------------------------
// Everything below works on plain number arrays the same LENGTH as `bars`, using null for the
// warm-up window, so index i always means bar i no matter how many indicators are stacked on top
// of each other (MACD's signal line is an EMA of an EMA difference, ADX is a Wilder average of a
// ratio of Wilder averages). Nulls are dropped once, at the very end, by `points`.
//
// Nulls only ever appear as a leading run - no indicator here punches holes in the middle - so
// each helper just finds the first real value and windows from there.

function smaArr(values: Series, period: number): Series {
  const out = new Array(values.length).fill(null)
  const start = values.findIndex((v) => v != null)
  if (start < 0) return out
  // Past `start` there are no more nulls (see the note above), which is what lets the arithmetic
  // below read the array as plain numbers.
  const nums = values as number[]
  let sum = 0
  for (let i = start; i < values.length; i++) {
    sum += nums[i]
    if (i - start >= period) sum -= nums[i - period]
    if (i - start >= period - 1) out[i] = sum / period
  }
  return out
}

function emaArr(values: Series, period: number): Series {
  const out = new Array(values.length).fill(null)
  const start = values.findIndex((v) => v != null)
  if (start < 0 || values.length - start < period) return out
  const nums = values as number[]
  const k = 2 / (period + 1)
  let prev = 0
  for (let i = start; i < start + period; i++) prev += nums[i]
  prev /= period // seeded with an SMA, same convention as computeEma above
  out[start + period - 1] = prev
  for (let i = start + period; i < values.length; i++) {
    prev = nums[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

// Wilder's smoothing - what ATR, ADX and RSI use. NOT an EMA of the same period: its smoothing
// constant is 1/n rather than 2/(n+1), so a 14-period Wilder average reacts like a 27-period EMA.
// Mixing the two up is the usual reason a hand-rolled ADX doesn't match TradingView.
function wilderArr(values: Series, period: number): Series {
  const out = new Array(values.length).fill(null)
  const start = values.findIndex((v) => v != null)
  if (start < 0 || values.length - start < period) return out
  const nums = values as number[]
  let prev = 0
  for (let i = start; i < start + period; i++) prev += nums[i]
  prev /= period
  out[start + period - 1] = prev
  for (let i = start + period; i < values.length; i++) {
    prev = (prev * (period - 1) + nums[i]) / period
    out[i] = prev
  }
  return out
}

// True range: the bar's own range, or its gap from the previous close if that's wider. Bar 0 has
// no previous close, so it falls back to the plain range.
function trueRangeArr(bars: Bar[]) {
  return bars.map((b: Bar, i: number) => {
    if (i === 0) return b.high - b.low
    const prevClose = bars[i - 1].close
    return Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose))
  })
}

// Highest high / lowest low of the `period` bars ending at i, or null before the window fills.
function extremes(bars: Bar[], i: number, period: number) {
  if (i < period - 1) return null
  let hh = -Infinity
  let ll = Infinity
  for (let j = i - period + 1; j <= i; j++) {
    if (bars[j].high > hh) hh = bars[j].high
    if (bars[j].low < ll) ll = bars[j].low
  }
  return { hh, ll }
}

// Pairs values with their bar's time, dropping the warm-up nulls (and any non-finite value, which
// would otherwise poison a pane's autoscale).
function points(bars: Bar[], values: Series): Point[] {
  const out: Point[] = []
  for (let i = 0; i < bars.length; i++) {
    const v = values[i]
    if (v != null && Number.isFinite(v)) out.push({ time: bars[i].time, value: v })
  }
  return out
}

// --- trend ------------------------------------------------------------------------------------------

// Two EMAs' distance apart (the MACD line), an EMA of that (signal), and the gap between them
// (histogram - the part that crosses zero when momentum turns). Fixed 12/26/9: the classic
// settings, and one period box can't express three.
export function computeMacd(bars: Bar[]) {
  const closes = bars.map((b: Bar) => b.close)
  const fast = emaArr(closes, 12)
  const slow = emaArr(closes, 26)
  const macd = closes.map((_, i: number) => {
    const [f, sl] = [fast[i], slow[i]]
    return f != null && sl != null ? f - sl : null
  })
  const signal = emaArr(macd, 9)
  const histogram = macd.map((m, i: number) => {
    const sig = signal[i]
    return m != null && sig != null ? m - sig : null
  })
  return { macd: points(bars, macd), signal: points(bars, signal), histogram: points(bars, histogram) }
}

// Trend STRENGTH, direction-blind: ADX rising means the move is committed, whichever way it's
// going. +DI/-DI carry the direction, and are plotted alongside because ADX alone can't tell you
// which side is winning. Above ~25 is conventionally "trending", below ~20 chop.
export function computeAdx(bars: Bar[], period = 14) {
  const plusDM = []
  const minusDM = []
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      plusDM.push(0)
      minusDM.push(0)
      continue
    }
    // Only the larger of the two directional moves counts, and only if it's positive - an inside
    // bar contributes nothing to either side.
    const up = bars[i].high - bars[i - 1].high
    const down = bars[i - 1].low - bars[i].low
    plusDM.push(up > down && up > 0 ? up : 0)
    minusDM.push(down > up && down > 0 ? down : 0)
  }
  const tr = wilderArr(trueRangeArr(bars), period)
  const plus = wilderArr(plusDM, period)
  const minus = wilderArr(minusDM, period)
  const plusDI = tr.map((t, i) => (t && plus[i] != null ? (100 * plus[i]) / t : null))
  const minusDI = tr.map((t, i) => (t && minus[i] != null ? (100 * minus[i]) / t : null))
  const dx = plusDI.map((p, i) => {
    const m = minusDI[i]
    if (p == null || m == null) return null
    const sum = p + m
    return sum === 0 ? 0 : (100 * Math.abs(p - m)) / sum
  })
  return {
    adx: points(bars, wilderArr(dx, period)),
    plusDI: points(bars, plusDI),
    minusDI: points(bars, minusDI),
  }
}

// --- momentum ---------------------------------------------------------------------------------------

// Where the close sits in the period's high-low range, smoothed (%K), plus a moving average of
// that (%D). Unlike CLV above, the range is the whole lookback window, not one candle.
export function computeStochastic(bars: Bar[], period = 14) {
  const raw = bars.map((b: Bar, i: number) => {
    const e = extremes(bars, i, period)
    if (!e) return null
    return e.hh === e.ll ? 50 : (100 * (b.close - e.ll)) / (e.hh - e.ll)
  })
  const k = smaArr(raw, 3)
  return { k: points(bars, k), d: points(bars, smaArr(k, 3)) }
}

// The same reading as stochastic %K, inverted and shifted: 0 means closing at the top of the
// range, -100 at the bottom. Kept as its own indicator because the -80/-20 bands are what people
// actually read it against.
export function computeWilliamsR(bars: Bar[], period = 14) {
  return points(
    bars,
    bars.map((b: Bar, i: number) => {
      const e = extremes(bars, i, period)
      if (!e) return null
      return e.hh === e.ll ? -50 : (-100 * (e.hh - b.close)) / (e.hh - e.ll)
    }),
  )
}

// --- volatility -------------------------------------------------------------------------------------

// An SMA with bands at ±mult standard deviations. The bands widen with volatility, so price
// touching one says "far from average *for current conditions*", not a fixed distance.
export function computeBollinger(bars: Bar[], period = 20, mult = 2) {
  const closes = bars.map((b: Bar) => b.close)
  const middle = smaArr(closes, period)
  const upper = []
  const lower = []
  for (let i = 0; i < bars.length; i++) {
    if (middle[i] == null) {
      upper.push(null)
      lower.push(null)
      continue
    }
    const mid = middle[i] as number
    let sq = 0
    for (let j = i - period + 1; j <= i; j++) sq += (closes[j] - mid) ** 2
    const sd = Math.sqrt(sq / period)
    upper.push(mid + mult * sd)
    lower.push(mid - mult * sd)
  }
  return { upper: points(bars, upper), middle: points(bars, middle), lower: points(bars, lower) }
}

// Average true range - volatility in price units, so it's what a stop distance should be sized
// against. Its own pane, and deliberately NOT range-bounded: ₹2 of ATR on a ₹40 stock and ₹200 on
// a ₹5000 one are both normal.
export function computeAtr(bars: Bar[], period = 14) {
  return points(bars, wilderArr(trueRangeArr(bars), period))
}

// Keltner: an EMA with ATR-scaled bands. Same idea as Bollinger but driven by true range rather
// than standard deviation, so gaps widen it where Bollinger (close-only) doesn't notice them.
export function computeKeltner(bars: Bar[], period = 20, mult = 2) {
  const middle = emaArr(
    bars.map((b: Bar) => b.close),
    period,
  )
  const atr = wilderArr(trueRangeArr(bars), period)
  const band = (sign: number) =>
    middle.map((m, i) => {
      const a = atr[i]
      return m != null && a != null ? m + sign * mult * a : null
    })
  return { upper: points(bars, band(1)), middle: points(bars, middle), lower: points(bars, band(-1)) }
}

// Donchian: the literal highest high and lowest low of the last N bars. No averaging at all - the
// upper band IS the breakout level, which is what makes it the honest one to trade against.
export function computeDonchian(bars: Bar[], period = 20) {
  const upper = []
  const middle = []
  const lower = []
  for (let i = 0; i < bars.length; i++) {
    const e = extremes(bars, i, period)
    upper.push(e ? e.hh : null)
    lower.push(e ? e.ll : null)
    middle.push(e ? (e.hh + e.ll) / 2 : null)
  }
  return { upper: points(bars, upper), middle: points(bars, middle), lower: points(bars, lower) }
}

// --- volume -------------------------------------------------------------------------------------------

// Volume-weighted average price, re-anchored at each session open (grouped by `bar.date`, same
// boundary the previous-day levels use). A rolling VWAP would be meaningless - the whole point is
// "the average price paid TODAY", which is why institutional fills get measured against it.
//
// On a daily timeframe every bar is its own session, so this degenerates to the bar's typical
// price. That's correct rather than useful: VWAP is an intraday tool.
export function computeVwap(bars: Bar[]) {
  const out = []
  let day = null
  let cumPv = 0
  let cumVol = 0
  for (const b of bars) {
    if (b.date !== day) {
      day = b.date
      cumPv = 0
      cumVol = 0
    }
    const volume = b.volume ?? 0
    cumPv += ((b.high + b.low + b.close) / 3) * volume
    cumVol += volume
    if (cumVol > 0) out.push({ time: b.time, value: cumPv / cumVol })
  }
  return out
}

// Money Flow Index - RSI weighted by volume, so a push higher on thin volume scores lower than
// the same push on heavy volume. Same 0-100 scale and 20/80 convention as RSI.
export function computeMfi(bars: Bar[], period = 14) {
  const typical = bars.map((b: Bar) => (b.high + b.low + b.close) / 3)
  const values = new Array(bars.length).fill(null)
  for (let i = period; i < bars.length; i++) {
    let positive = 0
    let negative = 0
    for (let j = i - period + 1; j <= i; j++) {
      const flow = typical[j] * (bars[j].volume ?? 0)
      if (typical[j] > typical[j - 1]) positive += flow
      else if (typical[j] < typical[j - 1]) negative += flow
    }
    values[i] = negative === 0 ? 100 : 100 - 100 / (1 + positive / negative)
  }
  return points(bars, values)
}

// Volume as a multiple of its own recent average - 1 is a normal bar, 3 is a bar that traded
// three times its usual size. Raw volume can't be compared across symbols or across months of the
// same symbol; this can, which is what makes a "spike" a spike.
export function computeRelativeVolume(bars: Bar[], period = 20) {
  const volumes = bars.map((b: Bar) => b.volume ?? 0)
  const average = smaArr(volumes, period)
  return points(
    bars,
    average.map((a, i) => (a ? volumes[i] / a : null)),
  )
}

// --- more shared helpers ----------------------------------------------------------------------------

// Linearly weighted MA - the newest bar carries `period` units of weight, the oldest 1. HMA is
// built entirely out of these.
function wmaArr(values: Series, period: number): Series {
  const out = new Array(values.length).fill(null)
  const start = values.findIndex((v) => v != null)
  if (start < 0) return out
  const nums = values as number[]
  const denom = (period * (period + 1)) / 2
  for (let i = start + period - 1; i < values.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) sum += nums[i - j] * (period - j)
    out[i] = sum / denom
  }
  return out
}

// Rolling mean and POPULATION standard deviation (divide by n, not n-1). Population is the right
// choice here: the window is the entire thing being described, not a sample drawn from something
// larger, and it matches what charting packages plot.
function rollingStats(values: Series, period: number) {
  const mean = new Array(values.length).fill(null)
  const sd = new Array(values.length).fill(null)
  const start = values.findIndex((v) => v != null)
  if (start < 0) return { mean, sd }
  const nums = values as number[]
  for (let i = start + period - 1; i < values.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += nums[j]
    const m = sum / period
    let sq = 0
    for (let j = i - period + 1; j <= i; j++) sq += (nums[j] - m) ** 2
    mean[i] = m
    sd[i] = Math.sqrt(sq / period)
  }
  return { mean, sd }
}

// Pearson correlation of two equal-length windows. Returns 0 rather than NaN when either side is
// constant (zero variance) - "no relationship" is the honest reading, and a NaN would poison the
// pane's autoscale.
function pearson(xs: number[], ys: number[]) {
  const n = xs.length
  if (n === 0) return 0
  const mx = xs.reduce((s: number, v: number) => s + v, 0) / n
  const my = ys.reduce((s: number, v: number) => s + v, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx
    const b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  const denom = Math.sqrt(dx * dy)
  return denom === 0 ? 0 : num / denom
}

// Bar-to-bar fractional returns. Index 0 has no predecessor, so it's null.
function returnsArr(bars: Bar[]) {
  return bars.map((b: Bar, i: number) => {
    if (i === 0) return null
    const prev = bars[i - 1].close
    return prev === 0 ? null : (b.close - prev) / prev
  })
}

// --- market microstructure (approximations) ------------------------------------------------------
// Real order flow needs tick data with the aggressor side on every print. None of that survives
// into an OHLCV bar, so everything here INFERS pressure from the candle's shape. Treat it as a
// proxy: a bar that closed up on heavy volume probably saw more buying, but "probably" is doing
// real work in that sentence.

// Signed volume: the bar's whole volume counted as buying if it closed above its open, selling if
// below, nothing if unchanged. The crudest possible split - a real delta would allocate each
// trade to the bid or the ask - but it does separate heavy up-bars from heavy down-bars, which
// raw volume cannot.
export function computeVolumeDelta(bars: Bar[]) {
  return bars.map((b: Bar) => ({
    time: b.time,
    value: Math.sign(b.close - b.open) * (b.volume ?? 0),
  }))
}

// Velocity is price change over `period` bars; acceleration is the change in that velocity. A
// move that is still accelerating is being pushed by someone who wants filled now - the "speed
// strike" signature. Both are in price units, so they autoscale.
export function computeVelocity(bars: Bar[], period = 5) {
  const closes = bars.map((b: Bar) => b.close)
  const velocity = closes.map((c, i: number) => (i < period ? null : c - closes[i - period]))
  const acceleration = velocity.map((v, i: number) => {
    const prev = velocity[i - period]
    return v == null || prev == null ? null : v - prev
  })
  return { velocity: points(bars, velocity), acceleration: points(bars, acceleration) }
}

// Range per unit of volume: how far price had to travel to absorb each share. Spikes mark thin,
// slippery conditions (a big range on little volume); troughs mark heavy two-way trade going
// nowhere. Scale is symbol-specific, so read it against its own history, not an absolute number.
export function computeVolumeWeightedSpread(bars: Bar[]) {
  return points(
    bars,
    bars.map((b: Bar) => {
      const volume = b.volume ?? 0
      return volume === 0 ? null : (b.high - b.low) / volume
    }),
  )
}

// How many standard deviations this bar's volume sits above its own rolling average. 2+ is a
// genuine climax; sustained 3+ usually marks exhaustion rather than the start of something. Uses
// a z-score rather than a fixed multiple so it adapts to how noisy the symbol's volume normally is.
export function computeVolumeClimax(bars: Bar[], period = 20) {
  const volumes = bars.map((b: Bar) => b.volume ?? 0)
  const { mean, sd } = rollingStats(volumes, period)
  return points(
    bars,
    volumes.map((v: number, i: number) => (mean[i] == null || !sd[i] ? null : (v - mean[i]) / sd[i])),
  )
}

// --- statistical ------------------------------------------------------------------------------------

// Rolling correlation between price and its own volume. Positive means moves come with
// participation (a trend being funded); near zero or negative means price is drifting on nothing,
// which is where reversals live.
export function computeRollingCorrelation(bars: Bar[], period = 20) {
  const values = new Array(bars.length).fill(null)
  for (let i = period - 1; i < bars.length; i++) {
    const window = bars.slice(i - period + 1, i + 1)
    values[i] = pearson(
      window.map((b: Bar) => b.close),
      window.map((b: Bar) => b.volume ?? 0),
    )
  }
  return points(bars, values)
}

// How many standard deviations the close sits from its own rolling mean. The mean-reversion
// workhorse: ±2 is the classic stretched reading (and is exactly where a Bollinger band sits,
// since both are built from the same rolling sigma).
export function computeZScore(bars: Bar[], period = 20) {
  const closes = bars.map((b: Bar) => b.close)
  const { mean, sd } = rollingStats(closes, period)
  return points(
    bars,
    closes.map((c, i: number) => {
      const [m, s] = [mean[i], sd[i]]
      return m == null || !s ? null : (c - m) / s
    }),
  )
}

// Lag-1 autocorrelation of returns: does an up bar tend to be followed by another up bar?
// Positive = momentum regime (trend-following should work), negative = mean-reverting regime
// (fade the move), near zero = a random walk where neither edge exists. This is a regime filter,
// not a signal.
export function computeAutocorrelation(bars: Bar[], period = 20) {
  const returns = returnsArr(bars)
  const values = new Array(bars.length).fill(null)
  for (let i = 0; i < bars.length; i++) {
    // Needs `period` return PAIRS, and returns themselves start at index 1.
    if (i < period + 1) continue
    const current = returns.slice(i - period + 1, i + 1)
    const lagged = returns.slice(i - period, i)
    values[i] = pearson(current as number[], lagged as number[])
  }
  return points(bars, values)
}

// Standard deviation of bar-to-bar returns, as a percentage. Variance is simply this squared -
// plotted as sigma rather than sigma-squared because sigma is in the same units as the returns
// themselves, which makes it directly comparable to a stop distance.
export function computeRollingVolatility(bars: Bar[], period = 20) {
  const returns = returnsArr(bars)
  const { sd } = rollingStats(returns, period)
  return points(
    bars,
    sd.map((s) => (s == null ? null : s * 100)),
  )
}

// --- price action / structure -------------------------------------------------------------------------

// Market structure as a state, not an event: +1 once price closes above the highest high of the
// prior `period` bars (a break up), -1 once it closes below the lowest low, and it HOLDS that
// reading until the opposite break happens. That hold is the point - structure is "where we are",
// and a bar that breaks nothing leaves the regime unchanged rather than resetting it to neutral.
//
// A swing-pivot implementation (literal HH/HL/LH/LL labelling) would need to look forward to
// confirm each pivot, which repaints - unusable in a replay where the whole discipline is only
// seeing what you'd have seen at the time.
export function computeMarketStructure(bars: Bar[], period = 20) {
  const values = new Array(bars.length).fill(null)
  let state = 0
  for (let i = 0; i < bars.length; i++) {
    // Window ends at i-1, so the break is measured against bars that had already closed - never
    // against this bar's own high/low, which would make every new extreme trivially "a break".
    const e = extremes(bars, i - 1, period)
    if (!e) continue
    if (bars[i].close > e.hh) state = 1
    else if (bars[i].close < e.ll) state = -1
    values[i] = state
  }
  return points(bars, values)
}

// Volume accumulated so far within the current session, reset at each new date. Read across days
// it shows whether today is running hot or thin versus the same point yesterday.
//
// NOT the Asia/London/New York split that this idea usually comes with: NSE trades one 9:15-15:30
// session, so those three windows would be one bucket and two empty ones. Grouping by trading day
// is the version of "which session controls the volume" that means anything on this instrument.
export function computeSessionVolume(bars: Bar[]) {
  const out = []
  let day = null
  let cumulative = 0
  for (const b of bars) {
    if (b.date !== day) {
      day = b.date
      cumulative = 0
    }
    cumulative += b.volume ?? 0
    out.push({ time: b.time, value: cumulative })
  }
  return out
}

// Overnight gap: the session's open against the previous session's close, in percent. Held flat
// across the day, so on an intraday chart every bar shows the gap the day started with.
export function computeGapPercent(bars: Bar[]) {
  const values = new Array(bars.length).fill(null)
  let prevClose = null
  let dayOpen = null
  let day = null
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].date !== day) {
      if (day != null) prevClose = bars[i - 1].close // last bar of the session just finished
      day = bars[i].date
      dayOpen = bars[i].open
    }
    if (prevClose && dayOpen != null) values[i] = ((dayOpen - prevClose) / prevClose) * 100
  }
  return points(bars, values)
}

// +1 outside bar (this bar's range engulfs the previous one - expansion, both sides taken out),
// -1 inside bar (engulfed by the previous - compression, often coiling before a move), 0 neither.
export function computeInsideOutside(bars: Bar[]) {
  return points(
    bars,
    bars.map((b: Bar, i: number) => {
      if (i === 0) return null
      const prev = bars[i - 1]
      if (b.high > prev.high && b.low < prev.low) return 1
      if (b.high <= prev.high && b.low >= prev.low) return -1
      return 0
    }),
  )
}

// --- adaptive moving averages -----------------------------------------------------------------------

// Hull MA: WMA(2*WMA(n/2) - WMA(n), sqrt(n)). The doubled half-length WMA overshoots forward far
// enough to cancel most of the lag, and the sqrt(n) smoothing pass cleans up the noise that
// overshoot introduces. Much faster to turn than an EMA of the same period.
export function computeHma(bars: Bar[], period = 20) {
  const closes = bars.map((b: Bar) => b.close)
  const half = wmaArr(closes, Math.max(1, Math.round(period / 2)))
  const full = wmaArr(closes, period)
  const raw = closes.map((_, i: number) => {
    const [h, f] = [half[i], full[i]]
    return h != null && f != null ? 2 * h - f : null
  })
  return points(bars, wmaArr(raw, Math.max(1, Math.round(Math.sqrt(period)))))
}

// Kaufman's Adaptive MA. The efficiency ratio - net move over the window divided by the total
// distance travelled to get there - is ~1 for a clean directional run and ~0 for chop. That ratio
// scales the smoothing constant between a fast EMA (2) and a slow one (30), so KAMA tracks price
// closely in a trend and goes nearly flat in a range, which is exactly when a normal MA whipsaws.
export function computeKama(bars: Bar[], period = 10) {
  const closes = bars.map((b: Bar) => b.close)
  const fastest = 2 / (2 + 1)
  const slowest = 2 / (30 + 1)
  const values = new Array(bars.length).fill(null)
  if (closes.length <= period) return []
  let kama = closes[period - 1]
  values[period - 1] = kama
  for (let i = period; i < closes.length; i++) {
    const change = Math.abs(closes[i] - closes[i - period])
    let volatility = 0
    for (let j = i - period + 1; j <= i; j++) volatility += Math.abs(closes[j] - closes[j - 1])
    const efficiency = volatility === 0 ? 0 : change / volatility
    const sc = (efficiency * (fastest - slowest) + slowest) ** 2
    kama += sc * (closes[i] - kama)
    values[i] = kama
  }
  return points(bars, values)
}

// Chande Momentum Oscillator: the same up/down sums RSI uses, but differenced over their total
// instead of ratioed, and with NO Wilder smoothing. That makes it react a bar or two sooner than
// RSI at the cost of a noisier line. Scale is -100..+100, so its neutral point is 0, not 50.
export function computeCmo(bars: Bar[], period = 14) {
  const closes = bars.map((b: Bar) => b.close)
  const values = new Array(bars.length).fill(null)
  for (let i = period; i < closes.length; i++) {
    let up = 0
    let down = 0
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1]
      if (diff > 0) up += diff
      else down -= diff
    }
    values[i] = up + down === 0 ? 0 : (100 * (up - down)) / (up + down)
  }
  return points(bars, values)
}

// --- single-candle shape ------------------------------------------------------------------------
// These three read one bar at a time - no lookback, no period. They describe the *shape* of a
// candle rather than a trend through several, so each is normalised by that bar's own range and
// lands in a fixed band. A doji (high === low) has no range to divide by; it reads 0 rather than
// NaN, which would break the chart's autoscale.

// Where the close sits inside the bar's range: +1 closed on the high (buyers held it there), -1
// closed on the low, 0 dead centre.
export function computeClv(bars: Bar[]) {
  return bars.map((b: Bar) => {
    const range = b.high - b.low
    return { time: b.time, value: range === 0 ? 0 : (b.close - b.low - (b.high - b.close)) / range }
  })
}

// How much of the bar's range is real body. Near 1 = a decisive candle that opened one end and
// closed the other; near 0 = a long-wicked candle that went somewhere and got rejected.
export function computeBodyRatio(bars: Bar[]) {
  return bars.map((b: Bar) => {
    const range = b.high - b.low
    return { time: b.time, value: range === 0 ? 0 : Math.abs(b.close - b.open) / range }
  })
}

// Upper wick minus lower wick, as a fraction of the range: +1 all upper wick (supply rejecting
// price from above), -1 all lower wick (demand absorbing it from below). Body + both wicks always
// sum to the range, so this can never leave [-1, 1].
export function computeWickAsymmetry(bars: Bar[]) {
  return bars.map((b: Bar) => {
    const range = b.high - b.low
    if (range === 0) return { time: b.time, value: 0 }
    const upper = b.high - Math.max(b.open, b.close)
    const lower = Math.min(b.open, b.close) - b.low
    return { time: b.time, value: (upper - lower) / range }
  })
}

// --- previous-session levels --------------------------------------------------------------------
// Previous day's high/low/open/close, carried forward across every bar of the current day as a
// flat reference line - the levels price reacts to, and what a breakout has to clear to count.
//
// Grouped by `bar.date` (the IST calendar day, present on both the daily and intraday paths - see
// lib/replay.js), NOT by "the bar before this one": on a 15m chart the previous day is ~25 bars
// back, and on a daily chart it is exactly one, and this handles both without a special case.
// The first day has nothing before it, so it gets no points rather than a fabricated flat line.
export function computePrevDayLevel(bars: Bar[], field: keyof DayOhlc) {
  const out: Point[] = []
  let prev: DayOhlc | null = null // the completed previous day's OHLC
  let current: DayOhlc | null = null
  let currentDate: string | undefined
  for (const b of bars) {
    if (b.date !== currentDate) {
      if (current) prev = current
      currentDate = b.date
      current = { open: b.open, high: b.high, low: b.low, close: b.close }
    } else if (current) {
      current.high = Math.max(current.high, b.high)
      current.low = Math.min(current.low, b.low)
      current.close = b.close
    }
    if (prev) out.push({ time: b.time, value: prev[field] })
  }
  return out
}

// A small registry rather than a real dynamic-plugin loader (YAGNI for a personal app) - adding
// a new indicator type is just one more entry here, and both callers iterate it generically.
// Only BarReplay's ReplayChart (multi-pane aware) reads the layout fields; PriceChart doesn't use
// this registry at all.
//
//   pane: 'separate'  oscillator - gets its own pane under the candles instead of overlaying price
//   range: [min, max] fixed scale for that pane, so a -1..1 reading isn't crushed by a 0..100 one
//                     (every distinct oscillator type gets its own pane for exactly this reason).
//                     OMIT it for anything in price units or otherwise unbounded - MACD, ATR and
//                     relative volume autoscale instead, since no fixed band could fit every
//                     symbol.
//   levels: [...]     reference lines drawn across the pane
//   periodless: true  no configurable lookback, so no period input
//   lineStyle         lightweight-charts line style; 2 = dashed
//   lines: [...]      multi-line indicators (bands, MACD, stochastic). Each entry is
//                     {key, label, color?, lineStyle?} and `compute` returns an OBJECT keyed by
//                     those `key`s rather than a bare point array. Single-line types omit this.
//
// `compute(bars, period)` takes the FULL bar objects ({time, date, open, high, low, close,
// volume}) - the moving averages only touch `close`, but everything below needs the whole candle.
const BAND_COLOR = '#64748b'

export const INDICATOR_TYPES = {
  ema: { label: 'EMA', compute: computeEma },
  sma: { label: 'SMA', compute: computeSma },
  rsi: { label: 'RSI', compute: computeRsi, pane: 'separate', range: [0, 100], levels: [30, 70] },
  macd: {
    label: 'MACD',
    compute: computeMacd,
    pane: 'separate',
    levels: [0],
    periodless: true,
    lines: [
      { key: 'macd', label: 'MACD', color: '#3b82f6' },
      { key: 'signal', label: 'Signal', color: '#f59e0b' },
      { key: 'histogram', label: 'Hist', color: BAND_COLOR, lineStyle: 2 },
    ],
  },
  adx: {
    label: 'ADX',
    compute: computeAdx,
    pane: 'separate',
    range: [0, 100],
    levels: [20, 25],
    lines: [
      { key: 'adx', label: 'ADX', color: '#a855f7' },
      { key: 'plusDI', label: '+DI', color: '#22c55e', lineStyle: 2 },
      { key: 'minusDI', label: '-DI', color: '#ef4444', lineStyle: 2 },
    ],
  },
  stochastic: {
    label: 'Stochastic',
    compute: computeStochastic,
    pane: 'separate',
    range: [0, 100],
    levels: [20, 80],
    lines: [
      { key: 'k', label: '%K', color: '#3b82f6' },
      { key: 'd', label: '%D', color: '#f59e0b' },
    ],
  },
  williamsR: {
    label: 'Williams %R',
    compute: computeWilliamsR,
    pane: 'separate',
    range: [-100, 0],
    levels: [-80, -20],
  },
  bollinger: {
    label: 'Bollinger',
    compute: computeBollinger,
    lines: [
      { key: 'upper', label: 'Upper', color: BAND_COLOR },
      { key: 'middle', label: 'Basis', color: '#f59e0b', lineStyle: 2 },
      { key: 'lower', label: 'Lower', color: BAND_COLOR },
    ],
  },
  keltner: {
    label: 'Keltner',
    compute: computeKeltner,
    lines: [
      { key: 'upper', label: 'Upper', color: '#14b8a6' },
      { key: 'middle', label: 'Basis', color: '#14b8a6', lineStyle: 2 },
      { key: 'lower', label: 'Lower', color: '#14b8a6' },
    ],
  },
  donchian: {
    label: 'Donchian',
    compute: computeDonchian,
    lines: [
      { key: 'upper', label: 'Upper', color: '#a855f7' },
      { key: 'middle', label: 'Mid', color: '#a855f7', lineStyle: 2 },
      { key: 'lower', label: 'Lower', color: '#a855f7' },
    ],
  },
  atr: { label: 'ATR', compute: computeAtr, pane: 'separate' },
  vwap: { label: 'VWAP', compute: computeVwap, periodless: true, lineStyle: 2 },
  mfi: { label: 'MFI', compute: computeMfi, pane: 'separate', range: [0, 100], levels: [20, 80] },
  relVolume: { label: 'Rel volume', compute: computeRelativeVolume, pane: 'separate', levels: [1] },

  // Adaptive moving averages - price-pane overlays, same as EMA/SMA.
  hma: { label: 'HMA', compute: computeHma },
  kama: { label: 'KAMA', compute: computeKama },
  cmo: {
    label: 'CMO',
    compute: computeCmo,
    pane: 'separate',
    range: [-100, 100],
    levels: [-50, 0, 50],
  },

  // Microstructure approximations - inferred from candle shape, not real order flow.
  volumeDelta: {
    label: 'Volume delta',
    compute: computeVolumeDelta,
    pane: 'separate',
    levels: [0],
    periodless: true,
  },
  velocity: {
    label: 'Velocity/accel',
    compute: computeVelocity,
    pane: 'separate',
    levels: [0],
    lines: [
      { key: 'velocity', label: 'Velocity', color: '#3b82f6' },
      { key: 'acceleration', label: 'Accel', color: '#ec4899', lineStyle: 2 },
    ],
  },
  vwSpread: {
    label: 'VW spread',
    compute: computeVolumeWeightedSpread,
    pane: 'separate',
    periodless: true,
  },
  volumeClimax: { label: 'Volume climax', compute: computeVolumeClimax, pane: 'separate', levels: [2, 3] },

  // Statistical regime measures.
  correlation: {
    label: 'Corr (price/vol)',
    compute: computeRollingCorrelation,
    pane: 'separate',
    range: [-1, 1],
    levels: [0],
  },
  zScore: { label: 'Z-score', compute: computeZScore, pane: 'separate', levels: [-2, 0, 2] },
  autocorrelation: {
    label: 'Autocorrelation',
    compute: computeAutocorrelation,
    pane: 'separate',
    range: [-1, 1],
    levels: [0],
  },
  volatility: { label: 'Rolling vol %', compute: computeRollingVolatility, pane: 'separate' },

  // Structure and session mapping.
  marketStructure: {
    label: 'Market structure',
    compute: computeMarketStructure,
    pane: 'separate',
    range: [-1, 1],
    levels: [0],
  },
  sessionVolume: {
    label: 'Session volume',
    compute: computeSessionVolume,
    pane: 'separate',
    periodless: true,
  },
  gapPercent: {
    label: 'Gap %',
    compute: computeGapPercent,
    pane: 'separate',
    levels: [0],
    periodless: true,
  },
  insideOutside: {
    label: 'Inside/outside',
    compute: computeInsideOutside,
    pane: 'separate',
    range: [-1, 1],
    levels: [0],
    periodless: true,
  },
  clv: {
    label: 'CLV',
    compute: computeClv,
    pane: 'separate',
    range: [-1, 1],
    levels: [0],
    periodless: true,
  },
  bodyRatio: {
    label: 'Body/Range',
    compute: computeBodyRatio,
    pane: 'separate',
    range: [0, 1],
    levels: [0.5],
    periodless: true,
  },
  wickAsym: {
    label: 'Wick asym',
    compute: computeWickAsymmetry,
    pane: 'separate',
    range: [-1, 1],
    levels: [0],
    periodless: true,
  },
  pdh: {
    label: 'Prev day high',
    compute: (bars: Bar[]) => computePrevDayLevel(bars, 'high'),
    periodless: true,
    lineStyle: 2,
  },
  pdl: {
    label: 'Prev day low',
    compute: (bars: Bar[]) => computePrevDayLevel(bars, 'low'),
    periodless: true,
    lineStyle: 2,
  },
  pdo: {
    label: 'Prev day open',
    compute: (bars: Bar[]) => computePrevDayLevel(bars, 'open'),
    periodless: true,
    lineStyle: 2,
  },
  pdc: {
    label: 'Prev day close',
    compute: (bars: Bar[]) => computePrevDayLevel(bars, 'close'),
    periodless: true,
    lineStyle: 2,
  },
}

export const INDICATOR_COLORS = ['#f59e0b', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6']

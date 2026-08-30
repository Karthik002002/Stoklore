// Self-check for the candle-shape indicators and the previous-day level walk. Plain asserts, no
// framework - matches the other *.selfcheck.mjs files here:
//
//     node frontend/src/lib/indicators.selfcheck.mjs
//
// The moving averages (EMA/SMA/RSI) are not covered: they predate this and are exercised on every
// chart. What's checked here is the arithmetic that is easy to get subtly wrong - the degenerate
// zero-range bar, the sign conventions, and the day-boundary walk.
import {
  computeAdx,
  computeAtr,
  computeAutocorrelation,
  computeCmo,
  computeEma,
  computeGapPercent,
  computeHma,
  computeInsideOutside,
  computeKama,
  computeMarketStructure,
  computeRollingCorrelation,
  computeRollingVolatility,
  computeSessionVolume,
  computeVelocity,
  computeVolumeClimax,
  computeVolumeDelta,
  computeVolumeWeightedSpread,
  computeZScore,
  computeBodyRatio,
  computeBollinger,
  computeClv,
  computeDonchian,
  computeKeltner,
  computeMacd,
  computeMfi,
  computePrevDayLevel,
  computeRelativeVolume,
  computeStochastic,
  computeVwap,
  computeWickAsymmetry,
  computeWilliamsR,
  INDICATOR_TYPES,
} from './indicators.ts'

const bar = (date, o, h, l, c) => ({ time: `${date}T00:00`, date, open: o, high: h, low: l, close: c })
const values = (out) => out.map((p) => p.value)

// --- CLV -----------------------------------------------------------------------------------------
// Closed exactly on the high / low / midpoint.
assert(values(computeClv([bar('d1', 5, 10, 0, 10)]))[0] === 1, 'close on high is +1')
assert(values(computeClv([bar('d1', 5, 10, 0, 0)]))[0] === -1, 'close on low is -1')
assert(values(computeClv([bar('d1', 5, 10, 0, 5)]))[0] === 0, 'close mid-range is 0')
// A four-price-doji has no range at all - 0, never NaN, or the chart's autoscale breaks.
assert(values(computeClv([bar('d1', 7, 7, 7, 7)]))[0] === 0, 'zero range is 0, not NaN')

// --- body / range --------------------------------------------------------------------------------
assert(values(computeBodyRatio([bar('d1', 0, 10, 0, 10)]))[0] === 1, 'marubozu is all body')
assert(values(computeBodyRatio([bar('d1', 5, 10, 0, 5)]))[0] === 0, 'doji body is 0')
assert(values(computeBodyRatio([bar('d1', 2, 10, 0, 7)]))[0] === 0.5, 'half the range is 0.5')
assert(values(computeBodyRatio([bar('d1', 7, 7, 7, 7)]))[0] === 0, 'zero range is 0, not NaN')
// Direction must not matter - a red bar of the same size reads the same as a green one.
assert(
  values(computeBodyRatio([bar('d1', 7, 10, 0, 2)]))[0] ===
    values(computeBodyRatio([bar('d1', 2, 10, 0, 7)]))[0],
  'body ratio is unsigned',
)

// --- wick asymmetry --------------------------------------------------------------------------------
// All upper wick: opened and closed on the low, spiked up and got rejected.
assert(values(computeWickAsymmetry([bar('d1', 0, 10, 0, 0)]))[0] === 1, 'pure upper wick is +1')
assert(values(computeWickAsymmetry([bar('d1', 10, 10, 0, 10)]))[0] === -1, 'pure lower wick is -1')
// Symmetric wicks cancel regardless of body size.
assert(values(computeWickAsymmetry([bar('d1', 4, 10, 0, 6)]))[0] === 0, 'even wicks cancel')
assert(values(computeWickAsymmetry([bar('d1', 7, 7, 7, 7)]))[0] === 0, 'zero range is 0, not NaN')
// The invariant that bounds it: body + upper + lower === range, so this can never exit [-1, 1].
for (const b of [bar('d1', 1, 9, 0, 8), bar('d1', 8, 9, 0, 1), bar('d1', 3, 20, 2, 4)]) {
  const v = values(computeWickAsymmetry([b]))[0]
  assert(v >= -1 && v <= 1, `wick asymmetry stays in band, got ${v}`)
}

// --- previous-day levels -----------------------------------------------------------------------------
// Intraday: three bars on d1, two on d2. Every d2 bar must report d1's aggregate, not the bar
// immediately before it - that's the whole point of grouping by date.
const intraday = [
  bar('d1', 100, 110, 95, 105),
  bar('d1', 105, 120, 90, 100),
  bar('d1', 100, 108, 99, 102),
  bar('d2', 103, 130, 80, 125),
  bar('d2', 125, 126, 120, 121),
]
// The first day has no previous day - it contributes no points at all.
assert(computePrevDayLevel(intraday, 'high').length === 2, 'first day emits nothing')
assert(
  values(computePrevDayLevel(intraday, 'high')).every((v) => v === 120),
  'prev day high is the max',
)
assert(
  values(computePrevDayLevel(intraday, 'low')).every((v) => v === 90),
  'prev day low is the min',
)
assert(
  values(computePrevDayLevel(intraday, 'open')).every((v) => v === 100),
  'prev day open is the first',
)
assert(
  values(computePrevDayLevel(intraday, 'close')).every((v) => v === 102),
  'prev day close is the last',
)
// The level holds flat across the whole day rather than tracking price.
assert(new Set(values(computePrevDayLevel(intraday, 'high'))).size === 1, 'level is flat within a day')

// Daily bars: one bar per date, so "previous day" collapses to "previous bar" with no special case.
const daily = [bar('d1', 10, 12, 8, 11), bar('d2', 11, 15, 9, 14), bar('d3', 14, 16, 13, 15)]
assert(values(computePrevDayLevel(daily, 'high')).join() === '12,15', 'daily walks bar to bar')
assert(values(computePrevDayLevel(daily, 'close')).join() === '11,14', 'daily prev close')

// --- trend / momentum / volatility / volume -----------------------------------------------------------
// A long synthetic series to warm every lookback: a steady uptrend, then a steady downtrend, so
// the direction-sensitive ones have both regimes to read.
const trend = []
for (let i = 0; i < 120; i++) {
  const p = i < 60 ? 100 + i : 160 - (i - 60)
  trend.push({ ...bar(`d${i}`, p, p + 2, p - 2, p + 1), volume: 1000 })
}

// MACD: on a sustained rise the fast EMA leads, so the line sits above zero; the histogram is
// exactly line - signal, which is the relationship the whole indicator is read on.
const macd = computeMacd(trend)
assert(macd.macd.length && macd.signal.length && macd.histogram.length, 'macd returns three lines')
assert(macd.macd.find((p) => p.time === trend[59].time).value > 0, 'macd is positive in an uptrend')
assert(macd.macd.at(-1).value < 0, 'macd is negative after the trend flips')
for (const h of macd.histogram) {
  const line = macd.macd.find((p) => p.time === h.time).value
  const sig = macd.signal.find((p) => p.time === h.time).value
  assert(Math.abs(h.value - (line - sig)) < 1e-9, 'histogram is line minus signal')
}
// The signal line starts later than the MACD line - it is an EMA *of* it, so it warms up second.
assert(macd.signal.length < macd.macd.length, 'signal warms up after the macd line')

// ADX: direction-blind strength. Both legs of the series trend hard, so ADX should be high in
// each, while +DI/-DI swap which one leads.
const adx = computeAdx(trend, 14)
const at = (series, i) => series.find((p) => p.time === trend[i].time)?.value
assert(at(adx.plusDI, 55) > at(adx.minusDI, 55), '+DI leads while rising')
assert(at(adx.minusDI, 115) > at(adx.plusDI, 115), '-DI leads while falling')
assert(
  adx.adx.every((p) => p.value >= 0 && p.value <= 100),
  'adx stays in 0..100',
)

// Stochastic and Williams %R read the same window from opposite ends: %K near 100 exactly when
// %R is near 0. Checked against each other rather than a magic number.
const stoch = computeStochastic(trend, 14)
const wr = computeWilliamsR(trend, 14)
for (const p of wr) {
  const k = stoch.k.find((x) => x.time === p.time)
  if (!k) continue
  assert(p.value >= -100 && p.value <= 0, `williams %R in band, got ${p.value}`)
  assert(
    stoch.k.every((x) => x.value >= 0 && x.value <= 100),
    'stochastic %K in band',
  )
}
assert(computeStochastic(trend.slice(0, 5), 14).k.length === 0, 'stochastic needs a full window')

// Bands: upper must sit above the basis, which must sit above lower - for all three families,
// on every bar. A sign slip anywhere inverts them.
for (const [name, bands] of [
  ['bollinger', computeBollinger(trend, 20, 2)],
  ['keltner', computeKeltner(trend, 20, 2)],
  ['donchian', computeDonchian(trend, 20)],
]) {
  assert(bands.upper.length === bands.lower.length, `${name} bands are aligned`)
  for (const u of bands.upper) {
    const m = bands.middle.find((p) => p.time === u.time).value
    const l = bands.lower.find((p) => p.time === u.time).value
    assert(u.value >= m && m >= l, `${name} bands are ordered at ${u.time}`)
  }
}
// Donchian is the literal extreme of the window, not an average of it.
const don = computeDonchian(trend, 20)
assert(
  don.upper.at(-1).value === Math.max(...trend.slice(-20).map((b) => b.high)),
  'donchian upper is the max',
)
assert(
  don.lower.at(-1).value === Math.min(...trend.slice(-20).map((b) => b.low)),
  'donchian lower is the min',
)

// ATR on a series whose every bar spans 4 with no gaps converges to exactly 4.
const flat = Array.from({ length: 60 }, (_, i) => ({ ...bar(`f${i}`, 100, 102, 98, 100), volume: 500 }))
assert(Math.abs(computeAtr(flat, 14).at(-1).value - 4) < 1e-9, 'atr converges to the true range')
assert(
  computeAtr(flat, 14).every((p) => p.value > 0),
  'atr is never negative',
)

// VWAP re-anchors per session. Two days at clearly different prices: each day's VWAP must sit
// inside that day's own range, never drag the first day's level into the second.
const twoDays = [
  { ...bar('d1', 100, 100, 100, 100), volume: 10 },
  { ...bar('d1', 100, 100, 100, 100), volume: 10 },
  { ...bar('d2', 200, 200, 200, 200), volume: 10 },
  { ...bar('d2', 200, 200, 200, 200), volume: 10 },
]
assert(
  computeVwap(twoDays)
    .map((p) => p.value)
    .join() === '100,100,200,200',
  'vwap resets each session',
)
// Volume-weighted, not a plain average: a heavy bar pulls it.
const weighted = [
  { ...bar('d1', 100, 100, 100, 100), volume: 1 },
  { ...bar('d1', 200, 200, 200, 200), volume: 9 },
]
assert(computeVwap(weighted).at(-1).value === 190, 'vwap weights by volume')
// Zero-volume bars must not divide by zero.
assert(computeVwap([{ ...bar('d1', 5, 5, 5, 5), volume: 0 }]).length === 0, 'no volume, no vwap point')

// MFI stays on RSI's scale, and reads high while price rises on constant volume.
const mfi = computeMfi(trend, 14)
assert(
  mfi.every((p) => p.value >= 0 && p.value <= 100),
  'mfi in 0..100',
)
assert(at(mfi, 55) > 80, 'mfi is high in a clean uptrend')
assert(mfi.at(-1).value < 20, 'mfi is low in a clean downtrend')

// Relative volume: a bar at its own average reads 1, and a spike reads its true multiple.
const spiky = Array.from({ length: 25 }, (_, i) => ({ ...bar(`s${i}`, 10, 11, 9, 10), volume: 100 }))
assert(Math.abs(computeRelativeVolume(spiky, 20).at(-1).value - 1) < 1e-9, 'flat volume reads 1')
spiky.push({ ...bar('s25', 10, 11, 9, 10), volume: 500 })
assert(computeRelativeVolume(spiky, 20).at(-1).value > 4, 'a 5x bar reads as a spike')

// --- microstructure approximations ---------------------------------------------------------------------
// Volume delta signs the whole bar by its own close-vs-open, and an unchanged bar contributes 0
// rather than being arbitrarily assigned to a side.
const delta = computeVolumeDelta([
  { ...bar('d1', 10, 12, 9, 11), volume: 500 },
  { ...bar('d2', 11, 12, 9, 10), volume: 300 },
  { ...bar('d3', 10, 11, 9, 10), volume: 700 },
])
assert(values(delta).join() === '500,-300,0', 'volume delta signs by close vs open')

// Velocity is a plain difference over the lookback; acceleration is its own difference again, so
// on a perfectly linear ramp velocity is constant and acceleration is exactly zero.
const ramp = Array.from({ length: 40 }, (_, i) => ({ ...bar(`r${i}`, i, i + 1, i - 1, i), volume: 100 }))
const vel = computeVelocity(ramp, 5)
assert(
  vel.velocity.every((p) => Math.abs(p.value - 5) < 1e-9),
  'constant slope gives constant velocity',
)
assert(
  vel.acceleration.every((p) => Math.abs(p.value) < 1e-9),
  'constant velocity gives zero acceleration',
)

// Volume-weighted spread is range per share; a zero-volume bar must be skipped, not divided by.
const vws = computeVolumeWeightedSpread([
  { ...bar('d1', 10, 20, 10, 15), volume: 5 },
  { ...bar('d2', 10, 20, 10, 15), volume: 0 },
])
assert(vws.length === 1 && vws[0].value === 2, 'vw spread is range per unit volume, skips zero volume')

// Volume climax is a z-score: flat volume has no deviation to report, and one huge bar spikes.
const steadyVol = Array.from({ length: 30 }, (_, i) => ({ ...bar(`v${i}`, 10, 11, 9, 10), volume: 100 }))
assert(
  computeVolumeClimax(steadyVol, 20).every((p) => p.value === 0 || p.value == null),
  'flat volume has no climax',
)
const climaxBars = [...steadyVol, { ...bar('v30', 10, 11, 9, 10), volume: 1000 }]
assert(computeVolumeClimax(climaxBars, 20).at(-1).value > 3, 'a 10x volume bar reads as a climax')

// --- statistical --------------------------------------------------------------------------------------
// Correlation is bounded, and perfectly co-moving price and volume correlate at +1.
const together = Array.from({ length: 30 }, (_, i) => ({
  ...bar(`c${i}`, 100 + i, 101 + i, 99 + i, 100 + i),
  volume: 100 + i,
}))
assert(Math.abs(computeRollingCorrelation(together, 20).at(-1).value - 1) < 1e-9, 'co-moving reads +1')
assert(
  computeRollingCorrelation(trend, 20).every((p) => p.value >= -1 && p.value <= 1),
  'correlation is bounded',
)

// Z-score: a close exactly at its own rolling mean is 0, and the sign follows which side it's on.
const zs = computeZScore(trend, 20)
assert(
  zs.every((p) => Number.isFinite(p.value)),
  'z-score is always finite',
)
assert(at(zs, 55) > 0, 'z-score is positive above the mean')
assert(zs.at(-1).value < 0, 'z-score is negative below the mean')

// Autocorrelation is bounded; a strictly alternating return series is strongly mean-reverting.
const zigzag = []
for (let i = 0; i < 60; i++) {
  const p = 100 + (i % 2 === 0 ? 0 : 5)
  zigzag.push({ ...bar(`z${i}`, p, p + 1, p - 1, p), volume: 100 })
}
assert(computeAutocorrelation(zigzag, 20).at(-1).value < -0.5, 'alternating returns autocorrelate negatively')
assert(
  computeAutocorrelation(trend, 20).every((p) => p.value >= -1 && p.value <= 1),
  'autocorrelation is bounded',
)

// Rolling volatility is a standard deviation - never negative, and exactly zero on a flat series.
const flatPrice = Array.from({ length: 40 }, (_, i) => ({ ...bar(`p${i}`, 50, 50, 50, 50), volume: 10 }))
assert(
  computeRollingVolatility(flatPrice, 20).every((p) => p.value === 0),
  'a flat series has zero volatility',
)
assert(
  computeRollingVolatility(trend, 20).every((p) => p.value >= 0),
  'volatility is never negative',
)

// --- structure -------------------------------------------------------------------------------------------
// Market structure latches: it flips to +1 on a break up and HOLDS until a break down, rather than
// resetting to neutral on every quiet bar.
//
// The fixture needs a real breakout, not just a drift higher: the break is a CLOSE beyond the
// prior window's highest high, so a ramp whose every close sits under the previous bar's high
// (like `trend` above) correctly never breaks anything.
const base = Array.from({ length: 25 }, (_, i) => ({ ...bar(`m${i}`, 100, 101, 99, 100), volume: 100 }))
const breakout = [
  ...base,
  { ...bar('m25', 100, 112, 100, 110), volume: 100 }, // closes clear of the 101 ceiling
  ...Array.from({ length: 5 }, (_, i) => ({ ...bar(`m${26 + i}`, 105, 106, 104, 105), volume: 100 })),
  { ...bar('m31', 100, 100, 88, 90), volume: 100 }, // closes under the base's 99 floor
]
const ms = computeMarketStructure(breakout, 20)
const msAt = (i) => ms.find((p) => p.time === breakout[i].time)?.value
assert(
  ms.every((p) => [-1, 0, 1].includes(p.value)),
  'structure is a three-state reading',
)
assert(msAt(24) === 0, 'no break yet inside the base')
assert(msAt(25) === 1, 'closing above the prior high breaks structure up')
assert(msAt(28) === 1, 'and the bullish reading HOLDS through quiet bars after it')
assert(msAt(31) === -1, 'closing below the prior low flips it bearish')
// The break must be measured against bars that had already closed - never this bar's own high, or
// every new extreme would trivially "break" itself.
assert(
  computeMarketStructure(base, 20).every((p) => p.value === 0),
  'a flat range never breaks its own structure',
)

// Session volume resets at each new date rather than running cumulatively forever.
const sess = computeSessionVolume([
  { ...bar('d1', 1, 1, 1, 1), volume: 10 },
  { ...bar('d1', 1, 1, 1, 1), volume: 15 },
  { ...bar('d2', 1, 1, 1, 1), volume: 7 },
])
assert(values(sess).join() === '10,25,7', 'session volume accumulates then resets')

// Gap: measured from the previous session's CLOSE to this session's OPEN, held across the day.
const gapBars = [
  { ...bar('d1', 100, 100, 100, 100), volume: 1 },
  { ...bar('d2', 110, 115, 105, 112), volume: 1 },
  { ...bar('d2', 112, 115, 105, 108), volume: 1 },
]
const gaps = computeGapPercent(gapBars)
assert(gaps.length === 2 && gaps.every((p) => Math.abs(p.value - 10) < 1e-9), 'gap is +10% held all day')

// Inside/outside classification.
const io = computeInsideOutside([
  bar('d1', 10, 20, 10, 15),
  bar('d2', 12, 21, 9, 15), // engulfs d1 on both sides
  bar('d3', 13, 15, 12, 14), // engulfed by d2
  bar('d4', 14, 25, 14, 20), // higher high but also higher low - neither
])
assert(values(io).join() === '1,-1,0', 'outside +1, inside -1, neither 0')

// --- adaptive moving averages ---------------------------------------------------------------------------
// On a linear ramp every MA must sit ON the line (no lag to speak of for HMA, which is its point),
// and none may wander outside the data's range.
const hma = computeHma(ramp, 16)
assert(
  hma.every((p) => Number.isFinite(p.value)),
  'hma is finite',
)
// Within ~1 bar of slope on a ramp rising 1/bar. HMA reduces lag, it does not eliminate it - the
// residual here is ~0.67, versus ~7.5 for the EMA compared against below.
assert(Math.abs(hma.at(-1).value - ramp.at(-1).close) < 1, 'hma tracks a linear ramp with little lag')
// The lag test that motivates HMA: it should sit closer to price than an EMA of the same period.
const emaLast = computeEma(ramp, 16).at(-1).value
assert(
  Math.abs(hma.at(-1).value - ramp.at(-1).close) < Math.abs(emaLast - ramp.at(-1).close),
  'hma lags less than an ema of the same period',
)

// KAMA converges onto a flat market and stays inside the price range on a trending one.
const kamaFlat = computeKama(flatPrice, 10)
assert(
  kamaFlat.every((p) => Math.abs(p.value - 50) < 1e-9),
  'kama sits still on a flat series',
)
const kamaTrend = computeKama(trend, 10)
const closes = trend.map((b) => b.close)
assert(
  kamaTrend.every((p) => p.value >= Math.min(...closes) && p.value <= Math.max(...closes)),
  'kama stays within the price range',
)

// CMO shares RSI's up/down sums but runs -100..+100, so a pure uptrend pins it at +100.
const cmo = computeCmo(trend, 14)
assert(
  cmo.every((p) => p.value >= -100 && p.value <= 100),
  'cmo is bounded',
)
assert(Math.abs(at(cmo, 55) - 100) < 1e-9, 'an unbroken uptrend gives +100')
assert(Math.abs(cmo.at(-1).value + 100) < 1e-9, 'an unbroken downtrend gives -100')

// --- registry -------------------------------------------------------------------------------------
for (const [key, t] of Object.entries(INDICATOR_TYPES)) {
  assert(typeof t.compute === 'function', `${key} has a compute`)
  assert(typeof t.label === 'string' && t.label, `${key} has a label`)
  // A range is optional (MACD/ATR/relative volume are unbounded), but if declared it must be usable.
  if (t.range) {
    assert(Array.isArray(t.range) && t.range.length === 2, `${key} range is a pair`)
    assert(t.range[0] < t.range[1], `${key} range is ordered`)
  }
  // Multi-line types must return exactly the keys they advertise, or ReplayChart creates series
  // that never receive data - a silent blank line on the chart.
  if (t.lines) {
    const out = t.compute(trend, 14)
    assert(!Array.isArray(out), `${key} declares lines so must return an object`)
    for (const line of t.lines) {
      assert(Array.isArray(out[line.key]), `${key} is missing its "${line.key}" line`)
      assert(typeof line.label === 'string' && line.label, `${key}.${line.key} has a label`)
    }
  } else {
    assert(Array.isArray(t.compute(trend, 14)), `${key} is single-line so must return an array`)
  }
}
// Every bounded series must actually stay inside the range it advertises, and no indicator may
// emit a non-finite value - one NaN poisons its whole pane's autoscale.
for (const [key, t] of Object.entries(INDICATOR_TYPES)) {
  const out = t.compute(trend, 14)
  const series = t.lines ? t.lines.map((l) => out[l.key]) : [out]
  for (const line of series) {
    for (const { value } of line) {
      assert(Number.isFinite(value), `${key} produced ${value}`)
      if (t.range) assert(value >= t.range[0] && value <= t.range[1], `${key} left its range with ${value}`)
    }
  }
}
// The candle-shape trio, on deliberately awkward bars including a four-price doji.
const sample = [bar('d1', 1, 9, 0, 8), bar('d2', 8, 9, 0, 1), bar('d3', 3, 20, 2, 4), bar('d4', 5, 5, 5, 5)]
for (const key of ['clv', 'bodyRatio', 'wickAsym']) {
  const t = INDICATOR_TYPES[key]
  for (const { value } of t.compute(sample)) {
    assert(Number.isFinite(value), `${key} produced ${value}`)
    assert(value >= t.range[0] && value <= t.range[1], `${key} left its range with ${value}`)
  }
}

function assert(ok, message) {
  if (!ok) {
    console.error(`FAILED: ${message}`)
    process.exit(1)
  }
}

console.log(
  'ok - indicators: MACD, ADX, stochastic, Williams %R, Bollinger, ATR, Keltner, Donchian, VWAP,\n' +
    '     MFI, rel volume, CLV, body/range, wick asymmetry, prev-day levels, registry contracts',
)

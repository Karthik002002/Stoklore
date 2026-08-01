// Dimension/metric engine behind the Statistics tab.
//
// Every "<metric> vs [dimension]" chart in the TradesViz reference (PnL vs, win-rate vs, R:R vs,
// hit-ratio vs, best/worst symbols, most-traded, win/loss mix, activity vs PnL) is the same
// reduction with a different grouping key and a different aggregate - so this is one engine with
// two lookup tables, not one function per chart. Add a row to DIMENSIONS or METRICS and every
// chart that reads them picks it up.
//
// Pure + dependency-free (relative import, no '@/' alias) so tradeStats.selfcheck.mjs can run it
// under plain `node` with no bundler or test framework.
import {
  actualRiskAmount,
  expectedR,
  expectedRBucket,
  lossExceededStop,
  lossStreaks,
  recoveryFactor,
  sortinoRatio,
  sqnRating,
  systemQualityNumber,
  tradePnl,
  tradeReturnPct,
  tradeRR,
  underwaterSeries,
  winStreaks,
} from './manualTrades.js'
import { accountReturnPct } from './tradeAccounts.js'

export const closedTrades = (trades) => (trades ?? []).filter((t) => t.exit_price != null)

const chronological = (trades) => [...trades].sort((a, b) => new Date(a.traded_at) - new Date(b.traded_at))

const sum = (values) => values.reduce((s, v) => s + v, 0)
const round = (v, dp = 2) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp)
const defined = (values) => values.filter((v) => v != null)
const mean = (values) => (values.length ? sum(values) / values.length : null)

// Sample (n-1) standard deviation - these are always a sample of a trader's process, never the
// whole population of trades they'll ever take.
const stdev = (values) => {
  if (values.length < 2) return null
  const m = mean(values)
  return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / (values.length - 1))
}

// Linear-interpolated percentile, so a 20-trade journal doesn't snap the 95th percentile onto a
// single trade the way a nearest-rank percentile would.
const percentile = (values, p) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function pnlByDay(trades) {
  const byDay = new Map()
  trades.forEach((t) => {
    const day = t.traded_at.slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + tradePnl(t))
  })
  return byDay
}

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SESSION_ORDER = ['Opening', 'Mid-day', 'Closing', 'After hours']
const R_ORDER = ['-3+R', '-2R', '-1R', '0R', '1R', '2R', '3+R', 'No risk set']

// Re-derived here rather than imported from manualTrades so this module keeps working on plain
// objects in the self-check (dayOfWeek/sessionFor there take the same shape, but pinning the
// weekday locale to en-US matters for DAY_ORDER matching).
const dayName = (t) => new Date(t.traded_at).toLocaleDateString('en-US', { weekday: 'long' })
const hourOf = (t) => new Date(t.traded_at).getHours()

const sessionName = (t) => {
  const d = new Date(t.traded_at)
  const minutes = d.getHours() * 60 + d.getMinutes()
  if (minutes >= 9 * 60 + 15 && minutes < 9 * 60 + 45) return 'Opening'
  if (minutes >= 9 * 60 + 45 && minutes < 14 * 60 + 30) return 'Mid-day'
  if (minutes >= 14 * 60 + 30 && minutes < 15 * 60 + 30) return 'Closing'
  return 'After hours'
}

// Fixed ladders rather than percentiles of the current data - a bucket that silently redefines
// itself every time a trade is added makes two screenshots of the same chart incomparable.
const PRICE_EDGES = [100, 500, 1000, 5000]
const QTY_EDGES = [10, 50, 200, 1000]

const short = (n) => (n >= 1000 ? `${n / 1000}k` : String(n))

function bucketLabels(edges, prefix) {
  return [
    `<${prefix}${short(edges[0])}`,
    ...edges.slice(0, -1).map((e, i) => `${prefix}${short(e)}–${short(edges[i + 1])}`),
    `${prefix}${short(edges.at(-1))}+`,
  ]
}

function bucketOf(value, edges, prefix) {
  const labels = bucketLabels(edges, prefix)
  const index = edges.findIndex((edge) => value < edge)
  return index === -1 ? labels.at(-1) : labels[index]
}

// `of` returns a label, or an array of labels for multi-valued dimensions (a trade with 3 tags
// counts once under each). `order` fixes the axis order where one exists naturally (weekdays,
// months); everything else falls back to ranking by the metric.
export const DIMENSIONS = {
  symbol: { label: 'Symbol', of: (t) => t.symbol },
  setup: { label: 'Setup', of: (t) => t.setup || 'Untagged' },
  tag: { label: 'Tag', of: (t) => (t.tags?.length ? t.tags : ['Untagged']), multi: true },
  emotion: { label: 'Emotion', of: (t) => t.emotion || 'Untagged' },
  direction: {
    label: 'Position',
    of: (t) => (t.direction === 'short' ? 'Short' : 'Long'),
    order: ['Long', 'Short'],
  },
  dayOfWeek: { label: 'Day of week', of: dayName, order: DAY_ORDER },
  session: { label: 'Session', of: sessionName, order: SESSION_ORDER },
  hour: {
    label: 'Time of day',
    of: (t) => `${String(hourOf(t)).padStart(2, '0')}:00`,
    sortByLabel: true,
  },
  month: { label: 'Month', of: (t) => MONTH_LABELS[new Date(t.traded_at).getMonth()], order: MONTH_LABELS },
  year: { label: 'Year', of: (t) => String(new Date(t.traded_at).getFullYear()), sortByLabel: true },
  priceRange: {
    label: 'Price range',
    of: (t) => bucketOf(t.entry_price, PRICE_EDGES, '₹'),
    order: bucketLabels(PRICE_EDGES, '₹'),
  },
  qtyRange: {
    label: 'Quantity range',
    of: (t) => bucketOf(t.quantity, QTY_EDGES, ''),
    order: bucketLabels(QTY_EDGES, ''),
  },
  rBucket: {
    label: 'R-multiple',
    of: (t) => (expectedRBucket(t) == null ? 'No risk set' : `${expectedRBucket(t)}R`),
    order: R_ORDER,
  },
}

function profitFactor(group) {
  const pnls = group.map(tradePnl)
  const gross = sum(pnls.filter((p) => p > 0))
  const loss = Math.abs(sum(pnls.filter((p) => p < 0)))
  if (!loss) return null // no losing trade yet - "infinite" profit factor is noise, not a number
  return round(gross / loss)
}

// `of` reduces a group of closed trades to one number (or null when the inputs for it were never
// captured - e.g. avg R needs ideal_risk_amount). `format` is a hint the UI maps to a formatter;
// keeping it a string keeps this module free of any ₹/locale concern.
export const METRICS = {
  netPnl: { label: 'Net P&L', format: 'inr', of: (g) => round(sum(g.map(tradePnl))) },
  avgPnl: { label: 'Avg P&L', format: 'inr', of: (g) => round(mean(g.map(tradePnl))) },
  winRate: {
    label: 'Win rate',
    format: 'pct',
    of: (g) => (g.length ? round((g.filter((t) => tradePnl(t) > 0).length / g.length) * 100, 1) : null),
  },
  count: { label: 'Trade count', format: 'num', of: (g) => g.length },
  volume: { label: 'Volume (qty)', format: 'num', of: (g) => round(sum(g.map((t) => t.quantity))) },
  turnover: {
    label: 'Turnover',
    format: 'inr',
    of: (g) => round(sum(g.map((t) => t.entry_price * t.quantity))),
  },
  avgR: { label: 'Avg R (expectancy)', format: 'r', of: (g) => round(mean(defined(g.map(expectedR)))) },
  profitFactor: { label: 'Profit factor', format: 'x', of: profitFactor },
  avgReturnPct: {
    label: 'Avg return %',
    format: 'pct',
    of: (g) => round(mean(defined(g.map(tradeReturnPct))), 2),
  },
  avgPlannedRR: { label: 'Planned R:R', format: 'x', of: (g) => round(mean(defined(g.map(tradeRR)))) },
  avgAccountReturnPct: {
    label: 'Avg account return %',
    format: 'pct',
    of: (g) => round(mean(defined(g.map(accountReturnPct))), 2),
  },
}

export function groupTrades(trades, dimKey) {
  const dim = DIMENSIONS[dimKey]
  const groups = new Map()
  trades.forEach((t) => {
    const raw = dim.of(t)
    const labels = dim.multi ? raw : [raw]
    labels.forEach((label) => {
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(t)
    })
  })
  return groups
}

// One row per bucket, carrying enough for every chart that reads it: `value` for the selected
// metric, plus wins/losses/count/netPnl so the win-loss-mix and activity-vs-PnL charts don't each
// need their own pass over the trades.
export function seriesFor(trades, dimKey, metricKey) {
  const metric = METRICS[metricKey]
  const rows = [...groupTrades(trades, dimKey).entries()].map(([label, group]) => {
    const pnls = group.map(tradePnl)
    return {
      label,
      value: metric.of(group),
      count: group.length,
      wins: pnls.filter((p) => p > 0).length,
      losses: pnls.filter((p) => p < 0).length,
      netPnl: round(sum(pnls)),
      volume: round(sum(group.map((t) => t.quantity))),
    }
  })

  const { order, sortByLabel } = DIMENSIONS[dimKey]
  if (order) return rows.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
  if (sortByLabel) return rows.sort((a, b) => a.label.localeCompare(b.label))
  return rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
}

// --- Distribution of gains and losses ---------------------------------------------------------

export const DISTRIBUTION_BASES = {
  pnl: { label: 'P&L', format: 'inr', of: tradePnl },
  returnPct: { label: 'Return %', format: 'pct', of: tradeReturnPct },
  r: { label: 'R-multiple', format: 'r', of: expectedR },
}

// Equal-width bins over the observed range, with the edge nudged so a bin boundary lands exactly
// on zero - a histogram that lumps small winners and small losers into one bin around zero hides
// the single thing it exists to show.
export function distribution(trades, basisKey, binCount = 11) {
  const values = defined(trades.map(DISTRIBUTION_BASES[basisKey].of))
  if (values.length === 0) return []
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const extent = Math.max(Math.abs(max), Math.abs(min)) || 1
  const half = Math.floor(binCount / 2)
  const width = extent / half
  return Array.from({ length: half * 2 }, (_, i) => {
    const from = (i - half) * width
    const to = from + width
    return {
      from: round(from),
      to: round(to),
      count: values.filter((v) => (i === half * 2 - 1 ? v >= from && v <= to : v >= from && v < to)).length,
    }
  })
}

// --- Time series: cumulative metrics per day, and per-trade trend -----------------------------

// Running value of a metric over every trade closed up to and including each day - "is the edge
// holding up as the sample grows", which a per-day (non-cumulative) series can't show.
export function cumulativeByDay(trades, metricKey) {
  const sorted = chronological(trades)
  const days = [...new Set(sorted.map((t) => t.traded_at.slice(0, 10)))].sort()
  const metric = METRICS[metricKey]
  return days.map((day) => {
    const upTo = sorted.filter((t) => t.traded_at.slice(0, 10) <= day)
    return { label: day, value: metric.of(upTo) }
  })
}

export const TREND_BASES = {
  pnl: { label: 'P&L', format: 'inr', of: tradePnl },
  returnPct: { label: 'Return %', format: 'pct', of: tradeReturnPct },
  r: { label: 'R-multiple', format: 'r', of: expectedR },
  cumulativePnl: { label: 'Cumulative P&L', format: 'inr', of: tradePnl, cumulative: true },
}

// Per-trade values in trade order plus a trailing moving average - the reference's "Trend
// Analysis" chart, where the x-axis is trade number rather than a date.
export function trendSeries(trades, basisKey, window = 10) {
  const basis = TREND_BASES[basisKey]
  const sorted = chronological(trades)
  let running = 0
  const points = []
  sorted.forEach((t, i) => {
    const raw = basis.of(t)
    if (raw == null) return
    running += raw
    points.push({ index: i + 1, value: round(basis.cumulative ? running : raw) })
  })
  const movingAverage = points.map((p, i) => {
    const slice = points.slice(Math.max(0, i - window + 1), i + 1)
    return { index: p.index, value: round(mean(slice.map((s) => s.value))) }
  })
  return { points, movingAverage }
}

// --- "When you trade": weekday x hour activity grid -------------------------------------------

export function whenYouTrade(trades) {
  const hours = trades.map(hourOf)
  const from = hours.length ? Math.min(...hours) : 9
  const to = hours.length ? Math.max(...hours) : 15
  const hourList = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const cells = new Map()
  trades.forEach((t) => {
    const key = `${dayName(t)}|${hourOf(t)}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(t)
  })
  return {
    hours: hourList,
    days: DAY_ORDER,
    cellFor: (day, hour) => {
      const group = cells.get(`${day}|${hour}`)
      if (!group) return null
      return { count: group.length, netPnl: round(sum(group.map(tradePnl))) }
    },
  }
}

// --- Compare: any per-trade stat against any other ---------------------------------------------

export const TRADE_AXES = {
  pnl: { label: 'P&L', format: 'inr', of: tradePnl },
  returnPct: { label: 'Return %', format: 'pct', of: tradeReturnPct },
  r: { label: 'R-multiple', format: 'r', of: expectedR },
  plannedRR: { label: 'Planned R:R', format: 'x', of: tradeRR },
  entryPrice: { label: 'Entry price', format: 'inr', of: (t) => t.entry_price },
  quantity: { label: 'Quantity', format: 'num', of: (t) => t.quantity },
  turnover: { label: 'Turnover', format: 'inr', of: (t) => round(t.entry_price * t.quantity) },
  hour: { label: 'Hour of day', format: 'num', of: hourOf },
  targetCapture: { label: 'Target captured %', format: 'pct', of: targetCapturePct },
  stopOverrun: { label: 'Stop overrun %', format: 'pct', of: stopOverrunPct },
  accountReturn: { label: 'Account return %', format: 'pct', of: accountReturnPct },
  accountBalance: {
    label: 'Account balance at trade',
    format: 'inr',
    of: (t) => t.account_balance_at_trade ?? null,
  },
}

export function comparePoints(trades, xKey, yKey) {
  return trades
    .map((t) => ({
      x: TRADE_AXES[xKey].of(t),
      y: TRADE_AXES[yKey].of(t),
      win: tradePnl(t) > 0,
      symbol: t.symbol,
    }))
    .filter((p) => p.x != null && p.y != null)
}

// --- Calendar heatmap: any two METRICS, per day, in a week or month grid -----------------------
// `anchor` is any date inside the period to show - clamped to today so paging forward can never
// land on a period that hasn't happened yet.

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const startOfDay = (d) => {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}
const addDays = (d, n) => {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}
const addMonths = (d, n) => {
  const c = new Date(d)
  c.setMonth(c.getMonth() + n, 1)
  return c
}

function periodBounds(anchor, period) {
  if (period === 'week') {
    const mondayOffset = (anchor.getDay() + 6) % 7 // Sun=0..Sat=6 -> Mon=0..Sun=6
    const start = addDays(anchor, -mondayOffset)
    return { start, end: addDays(start, 6) }
  }
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  return { start, end }
}

// Move the anchor one period forward/backward (direction = 1 or -1), clamped to today - the
// "next" toggle calls this instead of doing its own date math.
export function shiftCalendarAnchor(anchor, period, direction) {
  const today = startOfDay(new Date())
  const base = startOfDay(new Date(anchor))
  const shifted = period === 'week' ? addDays(base, direction * 7) : addMonths(base, direction)
  return isoDate(shifted > today ? today : shifted)
}

export function calendarHeatmap(
  trades,
  { period = 'month', anchor = new Date(), metricA = 'netPnl', metricB = 'count' } = {},
) {
  const today = startOfDay(new Date())
  const clampedAnchor = startOfDay(new Date(anchor))
  const { start, end } = periodBounds(clampedAnchor > today ? today : clampedAnchor, period)

  const byDay = new Map()
  chronological(closedTrades(trades)).forEach((t) => {
    const day = t.traded_at.slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(t)
  })

  const dayCount = Math.round((end - start) / 86400000) + 1
  const cells = Array.from({ length: dayCount }, (_, i) => {
    const date = addDays(start, i)
    const key = isoDate(date)
    const group = byDay.get(key) ?? []
    return {
      date: key,
      dayOfWeek: DAY_ORDER[(date.getDay() + 6) % 7],
      count: group.length,
      a: METRICS[metricA].of(group),
      b: METRICS[metricB].of(group),
      future: date > today,
    }
  })

  return {
    period,
    label:
      period === 'week'
        ? `${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
        : start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    start: isoDate(start),
    end: isoDate(end),
    metricA: { key: metricA, ...METRICS[metricA] },
    metricB: { key: metricB, ...METRICS[metricB] },
    cells,
    canGoBack: true,
    canGoForward: end < today,
  }
}

// --- Exit discipline / disposition effect ------------------------------------------------------
// The classic disposition-effect measure ("sell winners too early, hold losers too long") needs
// hold times, and manual_trades has no exit timestamp. These measure the same behaviour against
// the *plan* instead of the clock: how much of the target a winner actually captured, and how far
// past the stop a loser was allowed to run. Both read fields already captured at entry.

// 100% = winner closed exactly at target. Below 100 = took profit early. Null when no target was
// set, or the "target" was on the wrong side of entry (a typo, not a plan).
export function targetCapturePct(t) {
  if (t.target == null || t.exit_price == null) return null
  const short = t.direction === 'short'
  const planned = short ? t.entry_price - t.target : t.target - t.entry_price
  if (planned <= 0) return null
  const actual = short ? t.entry_price - t.exit_price : t.exit_price - t.entry_price
  return round((actual / planned) * 100, 1)
}

// 100% = loser closed exactly at the stop. Above 100 = the stop was not honoured (slippage, a
// gap, or an override). Losing trades only - a winner has no stop overrun to report.
export function stopOverrunPct(t) {
  const pnl = tradePnl(t)
  const risk = actualRiskAmount(t)
  if (pnl == null || pnl >= 0 || !risk) return null
  return round((Math.abs(pnl) / risk) * 100, 1)
}

// --- Overall statistics (the searchable single-number panel) -----------------------------------

export function overallStats(allTrades) {
  const closed = closedTrades(allTrades)
  const chrono = chronological(closed)
  const pnls = chrono.map(tradePnl)
  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const grossProfit = sum(wins)
  const grossLoss = Math.abs(sum(losses))
  const avgWin = mean(wins)
  const avgLoss = losses.length ? Math.abs(mean(losses)) : null
  const payoff = avgWin != null && avgLoss ? avgWin / avgLoss : null
  const winRate = closed.length ? wins.length / closed.length : null
  // Kelly f* = W - (1-W)/R. Negative means the edge is losing - shown as-is rather than clamped
  // to 0, since "your sizing formula says don't take this trade" is the useful reading.
  const kelly = winRate != null && payoff ? winRate - (1 - winRate) / payoff : null
  const rValues = defined(chrono.map(expectedR))

  let running = 0
  const cumulative = pnls.map((p) => (running += p))
  const { series: underwater, maxDrawdown } = underwaterSeries(cumulative)
  const netPnl = sum(pnls)

  const bySymbol = seriesFor(closed, 'symbol', 'netPnl')
  const daily = [...pnlByDay(chrono).values()]
  const sortedDays = [...new Set(chrono.map((t) => t.traded_at.slice(0, 10)))].sort()
  const withStop = closed.filter((t) => t.stop_loss != null)

  // Sharpe on the daily P&L series rather than per-trade R: a per-trade Sharpe would just be
  // SQN/sqrt(n) restated, and the daily series is what "risk-adjusted return" conventionally
  // means. It's a ratio of ₹ to ₹, so it needs no account value to be meaningful.
  const dailyStdev = stdev(daily)
  const sharpe = dailyStdev ? (mean(daily) / dailyStdev) * Math.sqrt(252) : null

  // Ulcer index over the underwater curve - unlike max drawdown (one number, one moment) this
  // penalises drawdowns for lasting, not just for being deep.
  const ulcer = underwater.length ? Math.sqrt(mean(underwater.map((d) => d ** 2))) : null

  // Annualising is only honest once there's a reasonable span to annualise from - scaling a
  // two-day sample up to a year produces a confident-looking number that means nothing, so
  // Calmar stays blank below a month.
  const spanDays =
    sortedDays.length > 1 ? (new Date(sortedDays.at(-1)) - new Date(sortedDays[0])) / 86400000 : 0
  const annualisedPnl = spanDays >= 30 ? netPnl * (365 / spanDays) : null

  const p95 = percentile(pnls, 0.95)
  const p5 = percentile(pnls, 0.05)

  const winnersWithTarget = defined(chrono.filter((t) => tradePnl(t) > 0).map(targetCapturePct))
  const losersWithStop = defined(chrono.map(stopOverrunPct))

  const winReturns = defined(chrono.filter((t) => tradePnl(t) > 0).map(tradeReturnPct))
  const lossReturns = defined(chrono.filter((t) => tradePnl(t) < 0).map(tradeReturnPct))
  const lossRate = winRate == null ? null : 1 - winRate
  const dailyGains = sum(daily.filter((d) => d > 0))
  const dailyLosses = Math.abs(sum(daily.filter((d) => d < 0)))

  // Trough of the underwater curve, aligned index-for-index with `chrono` - the trade whose date
  // the deepest drawdown was still open on.
  const troughIdx = maxDrawdown ? underwater.findIndex((v) => -v === maxDrawdown) : -1

  // Calendar month/year buckets, not the "month"/"year" DIMENSIONS above (those group by
  // month-of-year / bare year label across years, which is right for seasonality charts but wrong
  // for a frequency count - it'd merge every January together).
  const countBy = (keyFn) => {
    const buckets = new Map()
    chrono.forEach((t) => {
      const key = keyFn(t)
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    })
    return [...buckets.values()]
  }
  const monthCounts = countBy((t) => t.traded_at.slice(0, 7))
  const yearCounts = countBy((t) => t.traded_at.slice(0, 4))
  const quantities = closed.map((t) => t.quantity)

  return [
    {
      group: 'General',
      stats: [
        { label: 'Total trades', value: allTrades.length, format: 'num' },
        { label: 'Closed trades', value: closed.length, format: 'num' },
        { label: 'Open trades', value: allTrades.length - closed.length, format: 'num' },
        { label: 'Symbols traded', value: new Set(closed.map((t) => t.symbol)).size, format: 'num' },
        { label: 'Trading days', value: sortedDays.length, format: 'num' },
        { label: 'First trade', value: sortedDays[0] ?? null, format: 'text' },
        { label: 'Last trade', value: sortedDays.at(-1) ?? null, format: 'text' },
        {
          label: 'Trades per trading day',
          value: sortedDays.length ? round(closed.length / sortedDays.length) : null,
          format: 'num2',
        },
      ],
    },
    {
      group: 'Profit & loss',
      stats: [
        { label: 'Net P&L', value: round(netPnl), format: 'inr' },
        { label: 'Gross profit', value: round(grossProfit), format: 'inr' },
        { label: 'Gross loss', value: round(-grossLoss), format: 'inr' },
        { label: 'Avg P&L per trade', value: round(mean(pnls)), format: 'inr' },
        { label: 'Avg winner', value: round(avgWin), format: 'inr' },
        { label: 'Avg loser', value: avgLoss == null ? null : round(-avgLoss), format: 'inr' },
        { label: 'Largest winner', value: wins.length ? round(Math.max(...wins)) : null, format: 'inr' },
        { label: 'Largest loser', value: losses.length ? round(Math.min(...losses)) : null, format: 'inr' },
        { label: 'Median P&L', value: round(percentile(pnls, 0.5)), format: 'inr' },
        { label: 'P&L standard deviation', value: round(stdev(pnls)), format: 'inr' },
        { label: 'Profit factor', value: profitFactor(closed), format: 'x' },
        { label: 'Payoff ratio (avg win / avg loss)', value: round(payoff), format: 'x' },
        {
          label: 'Gain-to-pain ratio',
          value: grossLoss ? round(netPnl / grossLoss) : null,
          format: 'x',
        },
        { label: 'Avg P&L per trading day', value: round(mean(daily)), format: 'inr' },
        { label: 'Best day', value: daily.length ? round(Math.max(...daily)) : null, format: 'inr' },
        { label: 'Worst day', value: daily.length ? round(Math.min(...daily)) : null, format: 'inr' },
        { label: 'Winning days', value: daily.filter((d) => d > 0).length, format: 'num' },
        { label: 'Losing days', value: daily.filter((d) => d < 0).length, format: 'num' },
        { label: 'Avg winning return %', value: round(mean(winReturns), 2), format: 'pct' },
        {
          label: 'Total winning return %',
          value: winReturns.length ? round(sum(winReturns), 2) : null,
          format: 'pct',
        },
        { label: 'Avg losing return %', value: round(mean(lossReturns), 2), format: 'pct' },
        {
          label: 'Total losing return %',
          value: lossReturns.length ? round(sum(lossReturns), 2) : null,
          format: 'pct',
        },
      ],
    },
    {
      group: 'Win / loss',
      stats: [
        { label: 'Winners', value: wins.length, format: 'num' },
        { label: 'Losers', value: losses.length, format: 'num' },
        { label: 'Breakeven', value: pnls.filter((p) => p === 0).length, format: 'num' },
        { label: 'Win rate', value: winRate == null ? null : round(winRate * 100, 1), format: 'pct' },
        { label: 'Loss rate', value: winRate == null ? null : round((1 - winRate) * 100, 1), format: 'pct' },
        { label: 'Kelly criterion', value: kelly == null ? null : round(kelly * 100, 1), format: 'pct' },
        { label: 'Max consecutive wins', value: winStreaks(chrono).longest, format: 'num' },
        { label: 'Max consecutive losses', value: lossStreaks(chrono).longest, format: 'num' },
        { label: 'Current win streak', value: winStreaks(chrono).current, format: 'num' },
        { label: 'Current loss streak', value: lossStreaks(chrono).current, format: 'num' },
      ],
    },
    {
      group: 'Risk & quality',
      stats: [
        { label: 'Avg R (expectancy)', value: round(mean(rValues)), format: 'r' },
        { label: 'Total R', value: rValues.length ? round(sum(rValues)) : null, format: 'r' },
        { label: 'Best R', value: rValues.length ? round(Math.max(...rValues)) : null, format: 'r' },
        { label: 'Worst R', value: rValues.length ? round(Math.min(...rValues)) : null, format: 'r' },
        { label: 'System quality number (SQN)', value: systemQualityNumber(rValues), format: 'num2' },
        { label: 'SQN rating', value: sqnRating(systemQualityNumber(rValues)), format: 'text' },
        { label: 'Sharpe ratio (annualised, daily P&L)', value: round(sharpe), format: 'num2' },
        { label: 'Sortino ratio', value: sortinoRatio(rValues), format: 'num2' },
        { label: 'Max drawdown', value: maxDrawdown ? round(-maxDrawdown) : 0, format: 'inr' },
        {
          label: 'Max drawdown date',
          value: troughIdx >= 0 ? chrono[troughIdx].traded_at.slice(0, 10) : null,
          format: 'text',
        },
        { label: 'Recovery factor', value: recoveryFactor(netPnl, maxDrawdown), format: 'num2' },
        {
          label: 'Omega ratio',
          value: dailyLosses ? round(dailyGains / dailyLosses) : null,
          format: 'num2',
        },
        {
          label: 'Adjusted win/loss ratio',
          value: payoff != null && lossRate ? round(payoff * (winRate / lossRate)) : null,
          format: 'x',
        },
        {
          label: 'Calmar ratio (annualised / max drawdown)',
          value: annualisedPnl && maxDrawdown ? round(annualisedPnl / maxDrawdown) : null,
          format: 'num2',
        },
        { label: 'Ulcer index', value: round(ulcer), format: 'inr' },
        {
          label: 'Ulcer performance index',
          value: ulcer ? round(netPnl / ulcer) : null,
          format: 'num2',
        },
        {
          label: 'Tail ratio (95th / 5th percentile)',
          value: p5 ? round(Math.abs(p95 / p5)) : null,
          format: 'x',
        },
        { label: 'Avg planned R:R', value: round(mean(defined(closed.map(tradeRR)))), format: 'x' },
        {
          label: 'Avg planned risk',
          value: round(mean(defined(closed.map((t) => t.ideal_risk_amount)))),
          format: 'inr',
        },
        {
          label: 'Avg actual risk (entry to stop)',
          value: round(mean(defined(closed.map(actualRiskAmount)))),
          format: 'inr',
        },
        {
          label: 'Trades with a stop set',
          value: closed.length ? round((withStop.length / closed.length) * 100, 1) : null,
          format: 'pct',
        },
      ],
    },
    {
      group: 'Exit discipline',
      stats: [
        {
          label: 'Avg target captured (winners)',
          value: round(mean(winnersWithTarget), 1),
          format: 'pct',
        },
        {
          label: 'Winners closed before target',
          value: winnersWithTarget.filter((p) => p < 100).length,
          format: 'num',
        },
        {
          label: 'Winners run past target',
          value: winnersWithTarget.filter((p) => p >= 100).length,
          format: 'num',
        },
        { label: 'Avg stop overrun (losers)', value: round(mean(losersWithStop), 1), format: 'pct' },
        {
          label: 'Losses that blew through the stop',
          value: chrono.filter((t) => lossExceededStop(t)).length,
          format: 'num',
        },
        {
          label: 'Disposition gap (stop overrun − target capture)',
          value:
            winnersWithTarget.length && losersWithStop.length
              ? round(mean(losersWithStop) - mean(winnersWithTarget), 1)
              : null,
          format: 'pct',
        },
      ],
    },
    {
      group: 'Size & activity',
      stats: [
        { label: 'Total quantity', value: round(sum(closed.map((t) => t.quantity))), format: 'num' },
        {
          label: 'Total turnover',
          value: round(sum(closed.map((t) => t.entry_price * t.quantity))),
          format: 'inr',
        },
        {
          label: 'Avg position size',
          value: round(mean(closed.map((t) => t.entry_price * t.quantity))),
          format: 'inr',
        },
        {
          label: 'Largest position',
          value: closed.length ? round(Math.max(...closed.map((t) => t.entry_price * t.quantity))) : null,
          format: 'inr',
        },
        { label: 'Long trades', value: closed.filter((t) => t.direction !== 'short').length, format: 'num' },
        { label: 'Short trades', value: closed.filter((t) => t.direction === 'short').length, format: 'num' },
        { label: 'Avg return %', value: round(mean(defined(closed.map(tradeReturnPct))), 2), format: 'pct' },
        {
          label: 'Avg account return % (per trade)',
          value: round(mean(defined(closed.map(accountReturnPct))), 2),
          format: 'pct',
        },
        {
          label: 'Total account return %',
          value: (() => {
            const pcts = defined(closed.map(accountReturnPct))
            return pcts.length ? round(sum(pcts), 2) : null
          })(),
          format: 'pct',
        },
        { label: 'Most profitable symbol', value: bySymbol[0]?.label ?? null, format: 'text' },
        { label: 'Least profitable symbol', value: bySymbol.at(-1)?.label ?? null, format: 'text' },
        {
          label: 'Avg volume per trade',
          value: quantities.length ? round(mean(quantities)) : null,
          format: 'num',
        },
        {
          label: 'Max volume per trade',
          value: quantities.length ? round(Math.max(...quantities)) : null,
          format: 'num',
        },
        {
          label: 'Min volume per trade',
          value: quantities.length ? round(Math.min(...quantities)) : null,
          format: 'num',
        },
        {
          label: 'Avg trades per month',
          value: monthCounts.length ? round(mean(monthCounts)) : null,
          format: 'num2',
        },
        {
          label: 'Max trades per month',
          value: monthCounts.length ? Math.max(...monthCounts) : null,
          format: 'num',
        },
        {
          label: 'Avg trades per year',
          value: yearCounts.length ? round(mean(yearCounts)) : null,
          format: 'num2',
        },
        {
          label: 'Max trades per year',
          value: yearCounts.length ? Math.max(...yearCounts) : null,
          format: 'num',
        },
      ],
    },
  ]
}

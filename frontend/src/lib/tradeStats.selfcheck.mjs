// Self-check for the Statistics tab's reducers: grouping, aggregates, zero-edged histogram,
// cumulative series, and the overall-stats panel. Plain node, no test framework:
//   node src/lib/tradeStats.selfcheck.mjs
import assert from 'node:assert/strict'
import {
  calendarHeatmap,
  comparePoints,
  cumulativeByDay,
  distribution,
  holdingBars,
  holdingComparison,
  holdingDays,
  holdingPeriodRows,
  overallStats,
  seriesFor,
  shiftCalendarAnchor,
  stopOverrunPct,
  targetCapturePct,
  tradeGapRows,
  trendSeries,
  whenYouTrade,
} from './tradeStats.js'

const trade = (over) => ({
  symbol: 'TCS',
  direction: 'long',
  quantity: 10,
  entry_price: 100,
  exit_price: 110,
  stop_loss: 95,
  target: 120,
  tags: [],
  traded_at: '2026-07-06T10:00:00+05:30',
  ideal_risk_amount: 50,
  ...over,
})

// 2 winners (+100 each), 1 loser (-50). Monday and Tuesday.
const TRADES = [
  trade({ symbol: 'TCS', traded_at: '2026-07-06T10:00:00+05:30' }),
  trade({ symbol: 'INFY', traded_at: '2026-07-07T14:45:00+05:30' }),
  trade({ symbol: 'INFY', exit_price: 95, traded_at: '2026-07-07T15:00:00+05:30' }),
  trade({ symbol: 'WIPRO', exit_price: null, traded_at: '2026-07-08T10:00:00+05:30' }), // open
]
const CLOSED = TRADES.filter((t) => t.exit_price != null)

// --- seriesFor: grouping + aggregates ---------------------------------------------------------
const bySymbol = seriesFor(CLOSED, 'symbol', 'netPnl')
assert.equal(bySymbol.length, 2, 'open trade excluded, 2 symbols remain')
assert.deepEqual(
  bySymbol.map((r) => [r.label, r.value]),
  [
    ['TCS', 100],
    ['INFY', 50],
  ],
  'ranked by metric desc; INFY nets +100-50',
)
const infy = bySymbol.find((r) => r.label === 'INFY')
assert.deepEqual([infy.count, infy.wins, infy.losses], [2, 1, 1], 'win/loss mix carried on every row')

// Fixed-order dimensions keep their natural axis order, not the metric ranking.
const byDay = seriesFor(CLOSED, 'dayOfWeek', 'netPnl')
assert.deepEqual(
  byDay.map((r) => r.label),
  ['Monday', 'Tuesday'],
  'weekday order preserved',
)

// A trade with N tags counts once under each; untagged trades land in one bucket.
const tagged = [trade({ tags: ['breakout', 'gap'] }), trade({ tags: [] })]
const byTag = seriesFor(tagged, 'tag', 'count')
assert.deepEqual(
  byTag.map((r) => r.label).sort(),
  ['Untagged', 'breakout', 'gap'],
  'multi-valued dimension fans out',
)
assert.equal(
  byTag.reduce((s, r) => s + r.value, 0),
  3,
  '2 trades, 3 tag memberships',
)

// Metrics that need fields nobody captured return null rather than NaN/0.
assert.equal(seriesFor([trade({ ideal_risk_amount: null })], 'symbol', 'avgR')[0].value, null)
assert.equal(seriesFor(CLOSED, 'symbol', 'winRate')[0].value, 100, 'TCS is 1/1')
// Profit factor with no losing trade is null, not Infinity.
assert.equal(seriesFor([trade({})], 'symbol', 'profitFactor')[0].value, null)
assert.equal(seriesFor(CLOSED, 'symbol', 'profitFactor').find((r) => r.label === 'INFY').value, 2)

// --- distribution: a bin edge must land exactly on zero ---------------------------------------
const bins = distribution(CLOSED, 'pnl')
assert.ok(
  bins.some((b) => b.from === 0),
  'a bin starts at 0 so small winners and small losers never share one',
)
assert.equal(
  bins.reduce((s, b) => s + b.count, 0),
  CLOSED.length,
  'every trade lands in exactly one bin',
)
assert.deepEqual(distribution([], 'pnl'), [], 'no trades -> no bins, no crash')

// --- cumulative + trend ------------------------------------------------------------------------
const cumulative = cumulativeByDay(CLOSED, 'netPnl')
assert.deepEqual(
  cumulative.map((p) => [p.label, p.value]),
  [
    ['2026-07-06', 100],
    ['2026-07-07', 150],
  ],
  'running total across days, not per-day totals',
)

const trend = trendSeries(CLOSED, 'cumulativePnl')
assert.deepEqual(
  trend.points.map((p) => p.value),
  [100, 200, 150],
  'cumulative in trade order',
)
assert.equal(trend.movingAverage.at(-1).value, 150, 'MA over a 10-window = mean of all 3')
assert.equal(trendSeries([trade({ ideal_risk_amount: null })], 'r').points.length, 0, 'nulls dropped')

// --- when-you-trade grid ------------------------------------------------------------------------
const grid = whenYouTrade(CLOSED)
assert.deepEqual(grid.hours, [10, 11, 12, 13, 14, 15], 'hour axis spans observed activity')
assert.equal(grid.cellFor('Tuesday', 15).count, 1)
assert.equal(grid.cellFor('Tuesday', 15).netPnl, -50)
assert.equal(grid.cellFor('Sunday', 10), null, 'empty cell is null, not a zero-filled row')

// --- compare scatter ---------------------------------------------------------------------------
const points = comparePoints(CLOSED, 'entryPrice', 'pnl')
assert.equal(points.length, 3)
assert.deepEqual(
  points.map((p) => p.win),
  [true, true, false],
)

// --- overall stats -----------------------------------------------------------------------------
const stats = overallStats(TRADES)
const find = (label) => stats.flatMap((s) => s.stats).find((s) => s.label === label).value
assert.equal(find('Total trades'), 4)
assert.equal(find('Closed trades'), 3)
assert.equal(find('Open trades'), 1, 'open trades counted but kept out of every P&L aggregate')
assert.equal(find('Net P&L'), 150)
assert.equal(find('Gross loss'), -50)
assert.equal(find('Win rate'), 66.7)
assert.equal(find('Max consecutive wins'), 2)
assert.equal(find('Max drawdown'), -50, 'peak 200 -> 150')
assert.equal(find('Most profitable symbol'), 'TCS')
assert.equal(find('Avg R (expectancy)'), 1, '+100/+100/-50 over ₹50 planned risk')

// --- glossary metrics added on top of the originals --------------------------------------------
assert.equal(find('Median P&L'), 100, 'median of [-50, 100, 100]')
assert.equal(find('Gain-to-pain ratio'), 3, '₹150 net for ₹50 of losses taken')
assert.equal(find('Avg P&L per trading day'), 75, 'day 1 +100, day 2 +50')
assert.equal(find('Winning days'), 2)
assert.equal(find('Losing days'), 0, 'day 2 nets +50 despite containing a loser')
// Cumulative runs 100 -> 200 -> 150, so the underwater curve is [0, 0, -50].
assert.equal(find('Ulcer index'), 28.87, 'sqrt(mean([0,0,2500]))')
assert.equal(find('Ulcer performance index'), 5.2, '150 / 28.87')
assert.ok(Math.abs(find('Sharpe ratio (annualised, daily P&L)') - 33.68) < 0.01)
assert.equal(find('Tail ratio (95th / 5th percentile)'), 2.86, '|p95 100 / p5 -35|')
assert.equal(find('Calmar ratio (annualised / max drawdown)'), null, 'blank under a 30-day span')
assert.equal(find('Avg actual risk (entry to stop)'), 50, '|100-95| x 10')

assert.equal(find('Total R'), 3, '2 + 2 - 1')
assert.equal(find('Max drawdown date'), '2026-07-07', 'INFY loser is the trough of the underwater curve')
assert.equal(find('Avg winning return %'), 10)
assert.equal(find('Total winning return %'), 20, '10% + 10%')
assert.equal(find('Avg losing return %'), -5)
assert.equal(find('Total losing return %'), -5)
assert.equal(find('Omega ratio'), null, 'no losing day yet (day 2 nets positive)')
assert.equal(find('Adjusted win/loss ratio'), 4, 'payoff 2 x (win rate 0.667 / loss rate 0.333)')
assert.deepEqual(
  [find('Avg volume per trade'), find('Max volume per trade'), find('Min volume per trade')],
  [10, 10, 10],
)
assert.equal(find('Avg trades per month'), 3, 'all 3 closed trades fall in July 2026')

// A span wide enough to annualise honestly turns Calmar back on.
const spread = [
  trade({ traded_at: '2026-01-05T10:00:00+05:30' }),
  trade({ exit_price: 95, traded_at: '2026-06-05T10:00:00+05:30' }),
]
const spreadFind = (label) =>
  overallStats(spread)
    .flatMap((s) => s.stats)
    .find((s) => s.label === label).value
assert.ok(spreadFind('Calmar ratio (annualised / max drawdown)') > 0, 'annualises past 30 days')
assert.equal(spreadFind('Omega ratio'), 2, 'day1 +100 gain, day2 -50 loss')
assert.equal(spreadFind('Adjusted win/loss ratio'), 2, 'payoff 2 x (win rate 0.5 / loss rate 0.5)')
assert.equal(spreadFind('Avg trades per month'), 1, 'one trade in Jan, one in Jun')
assert.equal(spreadFind('Max trades per year'), 2, 'both trades fall in 2026')

// --- calendar heatmap ----------------------------------------------------------------------------
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// TCS trade lands on 2026-07-06, a Monday - the week grid should start exactly on it.
const weekHeat = calendarHeatmap(TRADES, { period: 'week', anchor: '2026-07-06T00:00:00+05:30' })
assert.equal(weekHeat.cells.length, 7, 'Mon-Sun grid')
assert.equal(weekHeat.start, '2026-07-06')
const mon = weekHeat.cells.find((c) => c.date === '2026-07-06')
assert.deepEqual([mon.a, mon.b], [100, 1], 'default metrics netPnl/count: TCS +100, 1 trade')
const tue = weekHeat.cells.find((c) => c.date === '2026-07-07')
assert.deepEqual([tue.a, tue.b], [50, 2], 'INFY +100 and -50 nets 50 across 2 trades')
const wed = weekHeat.cells.find((c) => c.date === '2026-07-08')
assert.deepEqual([wed.a, wed.b], [0, 0], 'only an open trade that day - no closed-trade contribution')
assert.equal(weekHeat.canGoForward, true, 'well in the past relative to whenever this test runs')

const monthHeat = calendarHeatmap(TRADES, { period: 'month', anchor: '2026-07-15', metricA: 'winRate' })
assert.equal(monthHeat.start, '2026-07-01')
assert.equal(monthHeat.end, '2026-07-31')
assert.equal(monthHeat.cells.length, 31)
assert.equal(monthHeat.cells.find((c) => c.date === '2026-07-06').a, 100, 'winRate on a 1-winner day')

const currentWeek = calendarHeatmap([], { period: 'week', anchor: new Date() })
assert.equal(currentWeek.canGoForward, false, 'the week containing today can never page forward')

assert.equal(
  shiftCalendarAnchor(new Date(), 'month', 1),
  todayIso(),
  'paging forward from today is clamped to today, not the month after',
)
assert.equal(shiftCalendarAnchor('2026-07-15', 'week', -1), '2026-07-08', 'pages back exactly 7 days')

// --- exit discipline / disposition proxy -------------------------------------------------------
// Winner: entry 100, exit 110, target 120 -> captured half the planned move.
assert.equal(targetCapturePct(trade({})), 50)
// Shorts measure the same way with the sign flipped.
assert.equal(
  targetCapturePct(trade({ direction: 'short', entry_price: 100, exit_price: 90, target: 80 })),
  50,
)
// A target on the wrong side of entry is a typo, not a plan.
assert.equal(targetCapturePct(trade({ target: 90 })), null)
assert.equal(targetCapturePct(trade({ target: null })), null)
// Loser closed exactly at its stop = 100%; winners have no overrun to report.
assert.equal(stopOverrunPct(trade({ exit_price: 95 })), 100)
assert.equal(stopOverrunPct(trade({})), null, 'winner')
assert.equal(stopOverrunPct(trade({ exit_price: 90 })), 200, 'blew through the stop by 2x')

assert.equal(find('Avg target captured (winners)'), 50)
assert.equal(find('Winners closed before target'), 2, 'both winners took profit early')
assert.equal(find('Winners run past target'), 0)
assert.equal(find('Avg stop overrun (losers)'), 100)
assert.equal(find('Losses that blew through the stop'), 0, 'the loser stopped out exactly at plan')
assert.equal(find('Disposition gap (stop overrun − target capture)'), 50, '100% honoured vs 50% captured')

// --- Timing: holding period and cadence ---------------------------------------------------------
// The whole reason these exist as separate functions: the journal carries two clocks. A Bar Replay
// trade is journaled at wall-clock now but exits at a REPLAYED date years earlier, so subtracting
// the two gives a large negative "duration". That must read as unknown, never as a number.
{
  const replayed = trade({
    traded_at: '2026-08-10T20:54:00+05:30',
    exited_at: '2015-07-20T00:00:00+05:30',
    trade_context: { excursion_bars: 8 },
  })
  assert.equal(holdingDays(replayed), null, 'a backwards clock is unknown, not a negative duration')
  assert.equal(holdingBars(replayed), 8, 'the bar count is still valid - it is market time')

  const handLogged = trade({
    traded_at: '2026-01-01T09:30:00+05:30',
    exited_at: '2026-01-04T15:00:00+05:30',
  })
  assert.ok(holdingDays(handLogged) > 3 && holdingDays(handLogged) < 4, 'hand-logged spans ~3.2 days')
  assert.equal(holdingBars(trade({})), null, 'no context snapshot means no bar count')
}

// Bucket boundaries: every bucket is [previous max, own max), so a 1-bar trade must land in the
// first bucket rather than falling through to the second.
{
  const held = (bars, exitPrice) => trade({ trade_context: { excursion_bars: bars }, exit_price: exitPrice })
  const rows = holdingPeriodRows([held(1, 90), held(3, 110), held(25, 110)])
  assert.deepEqual(
    rows.map((r) => r.label),
    ['1 bar', '2-3 bars', '21+ bars'],
    'boundaries land where the labels claim, and empty buckets are dropped',
  )
  assert.equal(rows[0].winRate, 0)
  assert.equal(rows[1].winRate, 100)
}

// Cadence is measured between consecutive market closes, chronologically - the journal arrives
// newest-first, so an unsorted implementation would produce negative gaps.
{
  const at = (day) => trade({ exited_at: `2026-03-${day}T10:00:00+05:30`, exit_price: 110 })
  const rows = tradeGapRows([at('20'), at('11'), at('10'), at('01')]) // newest-first, as the API returns
  assert.deepEqual(
    rows.map((r) => r.label),
    ['1-2 days', '1-4 weeks'],
    'gaps computed in chronological order: 9d, 1d, 9d',
  )
  assert.equal(
    rows.reduce((s, r) => s + r.count, 0),
    3,
    'n trades yield n-1 gaps',
  )
}

// The headline comparison, and its coverage denominator (trades with no snapshot are excluded from
// the medians but still counted in `total`, so the card can say how much of the journal it saw).
{
  const held = (bars, exitPrice) => trade({ trade_context: { excursion_bars: bars }, exit_price: exitPrice })
  const c = holdingComparison([held(10, 110), held(20, 110), held(2, 90), held(4, 90), trade({})])
  assert.equal(c.winMedian, 15, 'median of the winners')
  assert.equal(c.lossMedian, 3, 'median of the losers')
  assert.equal(c.edge, 12, 'winners held 12 bars longer - the healthy direction')
  assert.equal(c.covered, 4)
  assert.equal(c.total, 5, 'the snapshot-less trade still counts toward coverage')

  const none = holdingComparison([])
  assert.equal(none.edge, null, 'no trades, no edge - never NaN')
}

// Empty journal must not throw or emit NaN anywhere.
const empty = overallStats([])
assert.ok(
  empty.flatMap((s) => s.stats).every((s) => !Number.isNaN(s.value)),
  'no NaN on an empty journal',
)

console.log('all checks passed')

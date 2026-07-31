// Self-check for the Statistics tab's reducers: grouping, aggregates, zero-edged histogram,
// cumulative series, and the overall-stats panel. Plain node, no test framework:
//   node src/lib/tradeStats.selfcheck.mjs
import assert from 'node:assert/strict'
import {
  comparePoints,
  cumulativeByDay,
  distribution,
  overallStats,
  seriesFor,
  stopOverrunPct,
  targetCapturePct,
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
assert.deepEqual(byDay.map((r) => r.label), ['Monday', 'Tuesday'], 'weekday order preserved')

// A trade with N tags counts once under each; untagged trades land in one bucket.
const tagged = [trade({ tags: ['breakout', 'gap'] }), trade({ tags: [] })]
const byTag = seriesFor(tagged, 'tag', 'count')
assert.deepEqual(
  byTag.map((r) => r.label).sort(),
  ['Untagged', 'breakout', 'gap'],
  'multi-valued dimension fans out',
)
assert.equal(byTag.reduce((s, r) => s + r.value, 0), 3, '2 trades, 3 tag memberships')

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
assert.equal(bins.reduce((s, b) => s + b.count, 0), CLOSED.length, 'every trade lands in exactly one bin')
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
assert.deepEqual(trend.points.map((p) => p.value), [100, 200, 150], 'cumulative in trade order')
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
assert.deepEqual(points.map((p) => p.win), [true, true, false])

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

// --- exit discipline / disposition proxy -------------------------------------------------------
// Winner: entry 100, exit 110, target 120 -> captured half the planned move.
assert.equal(targetCapturePct(trade({})), 50)
// Shorts measure the same way with the sign flipped.
assert.equal(targetCapturePct(trade({ direction: 'short', entry_price: 100, exit_price: 90, target: 80 })), 50)
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

// Empty journal must not throw or emit NaN anywhere.
const empty = overallStats([])
assert.ok(
  empty.flatMap((s) => s.stats).every((s) => !Number.isNaN(s.value)),
  'no NaN on an empty journal',
)

console.log('all checks passed')

// Self-check for the trade-log Monte Carlo engine. Plain node, no test framework:
//   node src/lib/tradeSimulation.selfcheck.mjs
import assert from 'node:assert/strict'
import {
  correlationMatrix,
  correlationPair,
  dailyTotals,
  drawdownCurve,
  eraseTopWins,
  pearson,
  percentile,
  poolStats,
  riskUnitOf,
  simulate,
  toComparisonCsv,
  toCsv,
  tradeRange,
} from './tradeSimulation.ts'

// A deliberately simple log: 3 wins of +200, 2 losses of -100. PF = 600/200 = 3.
const LOG = [200, -100, 200, -100, 200]

// --- trade range ------------------------------------------------------------------------------
// 1-based and inclusive, counting from the oldest trade - "50 to 95" is what a person reading their
// own log means by it, so that is what the inputs take.
assert.deepEqual(tradeRange(95, 50, 95), { start: 49, end: 95, count: 46, error: null })
assert.deepEqual(tradeRange(95, null, null), { start: 0, end: 95, count: 95, error: null })
assert.equal(tradeRange(95, 50, null).count, 46, 'a blank To runs to the end of the log')
assert.equal(tradeRange(95, null, 10).count, 10, 'a blank From starts at the first trade')
assert.equal(tradeRange(95, 7, 7).count, 1, 'a single-trade range is one trade, not zero')

// Past the end is clamped, not refused: the same range has to be usable across accounts of
// different lengths in the Multiple tab.
assert.deepEqual(tradeRange(20, 10, 500), { start: 9, end: 20, count: 11, error: null })
assert.equal(tradeRange(0, null, null).count, 0, 'an empty log selects nothing and is not an error')

// What the user still has to fix.
assert.match(tradeRange(95, 0, 50).error, /at least 1/)
assert.match(tradeRange(95, 60, 50).error, /greater than or equal/)
assert.match(tradeRange(95, 200, 300).error, /Only 95 trades/)
assert.match(tradeRange(95, 'abc', 50).error, /whole numbers/)
// A rejected range reports the whole log, so nothing downstream has to branch on `error` to have
// usable bounds - the UI blocks the run, the numbers stay sane in the meantime.
assert.equal(tradeRange(95, 60, 50).count, 95)

// --- pool description -------------------------------------------------------------------------
const stats = poolStats(LOG)
assert.equal(stats.n, 5)
assert.equal(stats.winRate, 60)
assert.equal(stats.profitFactor, 3)
assert.equal(stats.avgWin, 200)
assert.equal(stats.avgLoss, -100)
assert.equal(stats.largestLoss, -100)
assert.equal(stats.expectancy, 80)
// Risk unit is the average LOSS, not the average trade - 80 would be the wrong scale.
assert.equal(riskUnitOf(LOG), 100)
assert.equal(riskUnitOf([50, 20]), null)

// --- black-swan erasure -----------------------------------------------------------------------
// 3 winners, 5% of 3 rounds up to 1 - exactly one (the largest) winner leaves.
const erased = eraseTopWins([500, 200, 100, -100])
assert.deepEqual(erased, [200, 100, -100])
// Duplicated winners are separate trades: only one of the two 500s is cut.
assert.deepEqual(eraseTopWins([500, 500, -100]), [500, -100])
// Nothing to erase in an all-loser log.
assert.deepEqual(eraseTopWins([-100, -50]), [-100, -50])

// --- percentiles ------------------------------------------------------------------------------
assert.equal(percentile([0, 10], 0.5), 5)
assert.equal(percentile([0, 10, 20], 0.5), 10)
assert.equal(percentile([1], 0.9), 1)

// --- drawdown ---------------------------------------------------------------------------------
// 100 -> 120 -> 60: the trough is 50% below the 120 peak, not below the 100 start.
const dd = drawdownCurve([100, 120, 60, 120])
assert.equal(dd[0], 0)
assert.equal(dd[1], 0)
assert.equal(dd[2], 50)
assert.equal(dd[3], 0)

// --- shuffle keeps the multiset, bootstrap does not -------------------------------------------
// One run of exactly the log's length, without replacement: every trade is used once, so the
// ending balance MUST equal start + total P&L no matter what order they came in.
const shuffled = simulate({ pnls: LOG, startBalance: 10000, runs: 1, length: 5, model: 'shuffle' })
assert.equal(shuffled.perRun.endBalance[0], 10000 + 400)
// ...and that is the whole point of the model - bootstrap over many runs will not be pinned there.
const boot = simulate({ pnls: LOG, startBalance: 10000, runs: 200, length: 5, model: 'bootstrap' })
assert.ok(Array.from(boot.perRun.endBalance).some((v) => v !== 10400))

// --- slippage comes off every trade -----------------------------------------------------------
// The friction that this whole page exists to make visible: 5 trades at ₹20 of slip is ₹100 gone,
// win or lose, so the same shuffled sequence ends exactly ₹100 lower.
const slipped = simulate({
  pnls: LOG,
  startBalance: 10000,
  runs: 1,
  length: 5,
  model: 'shuffle',
  slip: 20,
})
assert.equal(slipped.perRun.endBalance[0], 10400 - 100)

// --- position sizing --------------------------------------------------------------------------
// Risk unit is 100, so risking ₹200 per trade doubles every outcome: +400 P&L becomes +800.
const sized = simulate({
  pnls: LOG,
  startBalance: 10000,
  runs: 1,
  length: 5,
  model: 'shuffle',
  sizing: { mode: 'fixed-amount', amount: 200 },
})
assert.equal(sized.perRun.endBalance[0], 10800)
// A log with no losses has no risk unit to divide by, so re-sizing quietly falls back to as-logged
// rather than producing NaN curves.
const noLoss = simulate({ pnls: [100, 50], runs: 1, length: 2, sizing: { mode: 'fixed-pct', pct: 2 } })
assert.equal(noLoss.sizingApplied, 'as-logged')

// --- ruin and survival ------------------------------------------------------------------------
// An all-losing log, risking the whole account each time: every run is dead by trade 2.
const ruined = simulate({ pnls: [-5000], startBalance: 10000, runs: 50, length: 10 })
assert.equal(ruined.survivalRate, 0)
assert.equal(ruined.ruinFullPct, 100)
assert.equal(ruined.ruin50Pct, 100)
// Blown accounts flatline at the liquidation floor instead of going negative.
assert.ok(Array.from(ruined.bands.p50).every((v) => v >= 0))
assert.equal(ruined.perRun.endBalance[0], 0)
// A log that only ever wins can't be ruined.
const safe = simulate({ pnls: [100], startBalance: 10000, runs: 20, length: 10 })
assert.equal(safe.survivalRate, 100)
assert.equal(safe.ruin50Pct, 0)

// --- percentile bands are real runs, ordered ---------------------------------------------------
const spread = simulate({ pnls: LOG, startBalance: 10000, runs: 500, length: 40 })
const [p10, p25, p50, p75, p90] = spread.table.endBalance
assert.ok(p10 <= p25 && p25 <= p50 && p50 <= p75 && p75 <= p90)
// Each band curve starts at the opening balance and is one step longer than the trade count.
for (const band of [spread.bands.p10, spread.bands.p50, spread.bands.p90]) {
  assert.equal(band.length, 41)
  assert.equal(band[0], 10000)
}
// The bold curves are actual runs, so the p10 curve must END near the p10 ending balance - a
// cross-sectional band would not have this property, which is exactly why it isn't used.
assert.ok(Math.abs(spread.bands.p10.at(-1) - p10) < 1e-6)
assert.ok(Math.abs(spread.bands.p90.at(-1) - p90) < 1e-6)

// --- streak histogram -------------------------------------------------------------------------
// Percentages over runs, so they add up to 100 (every run has some worst streak >= 1 here).
const total = spread.lossStreakHist.reduce((s, b) => s + b.pct, 0)
assert.ok(Math.abs(total - 100) < 1e-6)
assert.ok(spread.lossStreakHist.every((b) => b.streak >= 1))

// --- determinism ------------------------------------------------------------------------------
// Same seed, same picture. Re-running must not reshuffle the curves under the user.
const a = simulate({ pnls: LOG, runs: 100, length: 20 })
const b = simulate({ pnls: LOG, runs: 100, length: 20 })
assert.deepEqual(a.table.endBalance, b.table.endBalance)
assert.notDeepEqual(
  a.table.endBalance,
  simulate({ pnls: LOG, runs: 100, length: 20, seed: 99 }).table.endBalance,
)

// --- guards -----------------------------------------------------------------------------------
assert.equal(simulate({ pnls: [], runs: 10, length: 10 }), null)
assert.equal(simulate({ pnls: LOG, runs: 0, length: 10 }), null)

// --- csv --------------------------------------------------------------------------------------
const csv = toCsv(a)
assert.ok(csv.startsWith('Percentile summary\n'))
assert.ok(csv.includes('Max consecutive losses'))
// header + 100 runs, plus the summary block above it.
assert.equal(
  csv
    .trim()
    .split('\n')
    .filter((l) => /^\d+,/.test(l)).length,
  100,
)

// --- daily totals -----------------------------------------------------------------------------
// Several trades closed on one day collapse to one observation, and the timestamp is truncated to
// the date so 09:20 and 15:10 on the same Tuesday are the same Tuesday.
const day = dailyTotals([
  { date: '2026-01-05T09:20:00Z', pnl: 100 },
  { date: '2026-01-05T15:10:00Z', pnl: -40 },
  { date: '2026-01-06', pnl: 25 },
  { date: null, pnl: 999 },
  { date: '2026-01-07', pnl: null },
])
assert.equal(day.size, 2)
assert.equal(day.get('2026-01-05'), 60)
assert.equal(day.get('2026-01-06'), 25)

// --- pearson ----------------------------------------------------------------------------------
assert.equal(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1)
assert.equal(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1)
assert.ok(Math.abs(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]) - 0.8) < 1e-9)
// No variance = nothing to correlate. Zero would be a claim; null is the truth.
assert.equal(pearson([5, 5, 5], [1, 2, 3]), null)
// Too few points to mean anything.
assert.equal(pearson([1, 2], [1, 2]), null)

// --- pairwise correlation ----------------------------------------------------------------------
const acctA = dailyTotals([
  { date: '2026-01-01', pnl: 100 },
  { date: '2026-01-02', pnl: -50 },
  { date: '2026-01-03', pnl: 200 },
  { date: '2026-01-04', pnl: -10 },
  { date: '2026-01-09', pnl: 5000 }, // A traded alone that day
])
const acctB = dailyTotals([
  { date: '2026-01-01', pnl: 50 },
  { date: '2026-01-02', pnl: -25 },
  { date: '2026-01-03', pnl: 100 },
  { date: '2026-01-04', pnl: -5 },
  { date: '2026-01-11', pnl: -9000 }, // B traded alone that day
])
const pair = correlationPair(acctA, acctB)
// B is exactly half of A on every shared day -> perfectly correlated.
assert.ok(Math.abs(pair.r - 1) < 1e-12)
// The two solo days are dropped, not zero-filled: padding them would invent agreement between an
// account that made ₹5,000 and one that wasn't trading at all.
assert.equal(pair.overlap, 4)
assert.equal(correlationPair(acctA, dailyTotals([{ date: '2026-06-01', pnl: 1 }])).overlap, 0)

// --- matrix -----------------------------------------------------------------------------------
const inverse = dailyTotals([
  { date: '2026-01-01', pnl: -100 },
  { date: '2026-01-02', pnl: 50 },
  { date: '2026-01-03', pnl: -200 },
  { date: '2026-01-04', pnl: 10 },
])
const matrix = correlationMatrix([acctA, acctB, inverse])
assert.equal(matrix.length, 3)
// Diagonal is 1 by definition, and the matrix is symmetric.
for (let i = 0; i < 3; i++) assert.equal(matrix[i][i].r, 1)
assert.equal(matrix[0][1].r, matrix[1][0].r)
assert.ok(Math.abs(matrix[0][2].r + 1) < 1e-12)

// --- comparison csv ---------------------------------------------------------------------------
const entries = [
  { name: 'Backtest, v2', result: simulate({ pnls: LOG, runs: 50, length: 20 }) },
  { name: 'Paper', result: simulate({ pnls: [150, -120, 150, -120, 150], runs: 50, length: 20 }) },
]
const comparison = toComparisonCsv(entries, correlationMatrix([acctA, acctB]))
// A comma in an account name must not become a new column.
assert.ok(comparison.includes('"Backtest, v2"'))
assert.ok(comparison.includes('Ending balance,"Paper"'))
assert.ok(comparison.includes('Daily P&L correlation'))
assert.ok(comparison.includes('Shared trading days'))

console.log('tradeSimulation.selfcheck: all assertions passed')

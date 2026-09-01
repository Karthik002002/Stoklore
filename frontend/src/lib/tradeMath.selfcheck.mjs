// Self-check for the risk/expectancy modelling math. Plain node, no test framework:
//   node src/lib/tradeMath.selfcheck.mjs
import assert from 'node:assert/strict'
import {
  breakevenWinRate,
  compoundingDivergence,
  drawdownProbabilities,
  expectancyGrid,
  expectancyR,
  riskPaths,
  rng,
  streakSurvival,
} from './tradeMath.ts'

// --- expectancy -----------------------------------------------------------------------------
// 50% at 2:1 wins 2R half the time, loses 1R half the time -> +0.5R per trade.
assert.equal(expectancyR(0.5, 2), 0.5)
// A 1:1 system is breakeven at exactly 50%, and losing below it.
assert.equal(expectancyR(0.5, 1), 0)
assert.ok(expectancyR(0.4, 1) < 0)
// Breakeven win rate is the inverse: 1:1 -> 50%, 3:1 -> 25%.
assert.equal(breakevenWinRate(1), 0.5)
assert.equal(breakevenWinRate(3), 0.25)
// ...and it is, by definition, the win rate where expectancy is zero.
for (const payoff of [1, 2, 3.5, 7]) {
  assert.ok(Math.abs(expectancyR(breakevenWinRate(payoff), payoff)) < 1e-12)
}

// --- grid -----------------------------------------------------------------------------------
const grid = expectancyGrid([0.3, 0.5], [1, 3])
assert.deepEqual(
  grid.map((r) => r.payoff),
  [1, 3],
)
assert.equal(grid[0].cells.length, 2)
// 30% at 1:1 loses, 50% at 3:1 wins - the sign flip the heatmap is drawn to show.
assert.ok(grid[0].cells[0].value < 0)
assert.ok(grid[1].cells[1].value > 0)

// --- PRNG determinism ------------------------------------------------------------------------
// The whole point of seeding: same seed, same sequence, so charts don't reshuffle on re-render.
assert.deepEqual([rng(3)(), rng(3)(), rng(3)()].slice(0, 1), [rng(3)()].slice(0, 1))
const a = rng(42)
const b = rng(42)
assert.deepEqual([a(), a(), a()], [b(), b(), b()])
assert.notDeepEqual([rng(1)()], [rng(2)()])

// --- streak survival -------------------------------------------------------------------------
const survived = streakSurvival({ winRate: 0.5, payoff: 2, riskPct: 1, streakLen: 20, trades: 75 })
assert.equal(survived.points[0].value, 100)
assert.equal(survived.points.length, 76)
// The trough must land at the end of the losing streak, not before or after it.
const troughAt = survived.points.reduce((lo, p) => (p.value < lo.value ? p : lo)).x
assert.equal(troughAt, 20)
assert.ok(survived.trough < 100)
// 20 losses at 1% risk compounds to 0.99^20 ~= 81.8% of the account.
assert.ok(Math.abs(survived.trough - 81.8) < 0.2)
// A positive expectancy must climb back above breakeven, and only after the streak ends.
assert.ok(survived.recoveredAt > 20)
// A negative-expectancy system never recovers - that's the honest answer, not a fudged curve.
const doomed = streakSurvival({ winRate: 0.3, payoff: 1, riskPct: 1, streakLen: 10, trades: 75 })
assert.equal(doomed.recoveredAt, null)

// --- risk paths ------------------------------------------------------------------------------
const paths = riskPaths({ winRate: 0.5, payoff: 2, riskPcts: [1, 2, 3], trades: 100 })
assert.equal(paths.length, 3)
assert.deepEqual(
  paths.map((p) => p.riskPct),
  [1, 2, 3],
)
paths.forEach((p) => assert.equal(p.points.length, 101))
paths.forEach((p) => assert.equal(p.points[0].value, 100))
// Same underlying win/loss sequence at every risk level, so with positive expectancy the bigger
// size must end ahead - the curves differ by amplitude only, which is what the chart claims.
assert.ok(paths[2].points.at(-1).value > paths[1].points.at(-1).value)
assert.ok(paths[1].points.at(-1).value > paths[0].points.at(-1).value)
// Deterministic across calls.
assert.deepEqual(paths, riskPaths({ winRate: 0.5, payoff: 2, riskPcts: [1, 2, 3], trades: 100 }))

// --- compounding asymmetry --------------------------------------------------------------------
const { gains, losses } = compoundingDivergence({ gainPct: 1, lossPct: 1, trades: 100 })
assert.equal(gains[0].value, 0)
assert.equal(losses[0].value, 0)
// 1.01^100 ~= 2.705 -> +170.5%; 0.99^100 ~= 0.366 -> -63.4%. The asymmetry is the whole point:
// the same 1%, won or lost 100 times, does not cancel out.
assert.ok(Math.abs(gains.at(-1).value - 170.5) < 1)
assert.ok(Math.abs(losses.at(-1).value + 63.4) < 1)
assert.ok(gains.at(-1).value > Math.abs(losses.at(-1).value))
// Losses are floored at -100% however long you run them (they approach it, and never cross it);
// gains are not bounded.
const long = compoundingDivergence({ gainPct: 1, lossPct: 1, trades: 5000 })
assert.ok(long.losses.at(-1).value >= -100)
assert.ok(long.gains.at(-1).value > 1e6)

// --- drawdown probability ----------------------------------------------------------------------
const dd = drawdownProbabilities({
  winRate: 0.5,
  payoff: 2,
  riskPcts: [0.5, 1, 2, 5],
  paths: 500,
})
assert.deepEqual(
  dd.map((d) => d.riskPct),
  [0.5, 1, 2, 5],
)
dd.forEach((d) => assert.ok(d.probability >= 0 && d.probability <= 100))
// Monotonic in risk: sizing up can never make a 50% drawdown less likely. This is the claim the
// chart makes, and the reason it's simulated rather than derived from streak probability.
for (let i = 1; i < dd.length; i++) {
  assert.ok(dd[i].probability >= dd[i - 1].probability, `not monotonic at ${dd[i].riskPct}%`)
}
// The extremes must actually separate, or the chart says nothing.
assert.ok(dd.at(-1).probability > dd[0].probability)
// Deterministic across calls.
assert.deepEqual(dd, drawdownProbabilities({ winRate: 0.5, payoff: 2, riskPcts: [0.5, 1, 2, 5], paths: 500 }))

console.log('ok - tradeMath: expectancy, grid, streak survival, risk paths, compounding, drawdown risk')

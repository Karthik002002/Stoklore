// Self-check for the review reducers: checklist score, matrix placement, profit concentration,
// streak effects, Wilson interval, scorecard source split, before/after. Plain node:
//   node src/lib/tradeReview.selfcheck.mjs
import assert from 'node:assert/strict'
import {
  beforeAfter,
  prefillChecks,
  profitConcentration,
  scoreFromChecks,
  setupScorecard,
  sourceOf,
  strategyBehaviorMatrix,
  streakEffects,
  topMistakes,
  wilson,
} from './tradeReview.ts'

let n = 0
// A long of 1 share, so P&L is exit - 100.
const trade = (pnl, extra = {}) => ({
  id: ++n,
  symbol: 'TCS',
  direction: 'long',
  quantity: 1,
  entry_price: 100,
  exit_price: 100 + pnl,
  stop_loss: null,
  ideal_risk_amount: null,
  setup: null,
  tags: [],
  mistakes: null,
  execution_checks: null,
  execution_score: null,
  traded_at: '2026-09-01T10:00:00+05:30',
  created_at: `2026-09-01T10:00:${String(n).padStart(2, '0')}+05:30`,
  ...extra,
})

// Score: none ticked → 1, all six → 10, never scored → null.
const all = (v) =>
  Object.fromEntries(
    ['entry_rules', 'position_size', 'stop_honored', 'exit_rules', 'no_impulse', 'followed_plan'].map((k) => [
      k,
      v,
    ]),
  )
assert.equal(scoreFromChecks(null), null)
assert.equal(scoreFromChecks(all(false)), 1)
assert.equal(scoreFromChecks(all(true)), 10)
assert.equal(scoreFromChecks({ ...all(true), no_impulse: false }), 9) // 1 + 9*5/6 = 8.5 → 9

// Prefill only answers what the journal has evidence for.
assert.deepEqual(prefillChecks(trade(-10, { stop_loss: 95 }), 10), { stop_honored: false }) // lost 10 on a 5 stop
assert.deepEqual(prefillChecks(trade(-5, { stop_loss: 95, ideal_risk_amount: 5 }), 10), {
  position_size: true,
  stop_honored: true,
})
assert.deepEqual(prefillChecks(trade(10), 10), {})

// Matrix: strategy is the SETUP's average, execution is the trade's own score.
const m = strategyBehaviorMatrix([
  trade(30, { setup: 'A', execution_score: 8 }), // A averages +10 → good strategy, good exec
  trade(-10, { setup: 'A', execution_score: 3 }), //                  good strategy, poor exec
  trade(-10, { setup: 'A', execution_score: 9 }),
  trade(-20, { setup: 'B', execution_score: 9 }), // B negative → review strategy
  trade(5, { setup: 'B', execution_score: 2 }), //                   undiagnosed
  trade(5, { execution_score: 9 }), // no setup
  trade(5, { setup: 'A' }), // no score (still counts toward A's average: 30-10-10+5 = +3.75)
  trade(0, { setup: 'A', exit_price: null }), // open: ignored
])
assert.equal(m.cells.keep.count, 2)
assert.equal(m.cells.fixBehavior.count, 1)
assert.equal(m.cells.reviewStrategy.count, 1)
assert.deepEqual(m.cells.reviewStrategy.setups, ['B'])
assert.equal(m.cells.undiagnosed.count, 1)
assert.equal(m.noSetup, 1)
assert.equal(m.noScore, 1)
assert.equal(m.cells.keep.netPnl, 20)

// Concentration: without its top 2 winners this log is negative.
const c = profitConcentration([trade(50), trade(40), trade(5), trade(-30), trade(-30)], 2)
assert.equal(c.topSum, 90)
assert.equal(c.net, 35)
assert.equal(c.netWithoutTop, -55)
assert.equal(c.shareOfGross, 94.7)
assert.equal(profitConcentration([]), null)

// Streaks, in logged order: L L [W] L L [L] [W] W {L} - [] follow 2+ losses, {} 2+ wins.
const s = streakEffects([-1, -1, 5, -1, -1, -2, 3, 3, -4].map((p) => trade(p)))
assert.equal(s.afterLosses.count, 3)
assert.equal(s.afterLosses.winRate, 66.7)
assert.equal(s.afterWins.count, 1)
assert.equal(s.afterWins.avgPnl, -4)
assert.equal(s.all.count, 9)

// Wilson: bounded, and wide on a small sample.
assert.deepEqual(wilson(0, 0), null)
const w = wilson(6, 10)
assert.ok(w.low > 25 && w.low < 35 && w.high > 80 && w.high < 88, JSON.stringify(w))
assert.equal(wilson(10, 10).high, 100)

// Scorecard: split by source off the tags the replay/paper writers add.
assert.equal(sourceOf({ tags: ['replay', 'x'] }), 'Replay')
assert.equal(sourceOf({ tags: ['paper'] }), 'Paper')
assert.equal(sourceOf({ tags: [] }), 'Journal')
const sc = setupScorecard([
  trade(10, { setup: 'A', tags: ['replay'] }),
  trade(-5, { setup: 'A', tags: ['replay'] }),
  trade(8, { setup: 'A', tags: ['paper'] }),
  trade(3),
])
assert.equal(sc[0].setup, 'A')
assert.equal(sc[0].all.count, 3)
assert.equal(sc[0].all.thin, true)
assert.equal(sc[0].bySource.Replay.winRate, 50)
assert.equal(sc[0].bySource.Paper.count, 1)
assert.equal(sc[0].bySource.Journal, null)
assert.equal(sc[1].setup, 'Untagged')

// Before/after splits on the LOGGED day; a real mistake rate ignores 'Normal loss'.
const ba = beforeAfter(
  [
    trade(-5, { created_at: '2026-09-10T10:00:00', mistakes: ['FOMO'] }),
    trade(-5, { created_at: '2026-09-10T11:00:00', mistakes: ['Normal loss'] }),
    trade(10, { created_at: '2026-09-21T09:00:00', mistakes: [], execution_score: 8 }),
    trade(4, { created_at: '2026-09-22T09:00:00' }),
  ],
  '2026-09-21',
)
assert.equal(ba.before.count, 2)
assert.equal(ba.before.mistakeRate, 50)
assert.equal(ba.after.count, 2)
assert.equal(ba.after.winRate, 100)
assert.equal(ba.after.reviewed, 1)
assert.equal(ba.after.avgScore, 8)

// Bounded by the next change: the 22nd belongs to the next rule, not this one.
const bounded = beforeAfter(
  [
    trade(-5, { created_at: '2026-09-10T10:00:00' }),
    trade(10, { created_at: '2026-09-21T09:00:00' }),
    trade(4, { created_at: '2026-09-22T09:00:00' }),
  ],
  '2026-09-21',
  '2026-09-11',
  '2026-09-22',
)
assert.equal(bounded.before.count, 0)
assert.equal(bounded.after.count, 1)

assert.deepEqual(
  topMistakes([trade(-5, { mistakes: ['FOMO', 'Normal loss'] }), trade(-9, { mistakes: ['FOMO', 'Exit'] })]),
  [
    { mistake: 'FOMO', count: 2, netPnl: -14 },
    { mistake: 'Exit', count: 1, netPnl: -9 },
  ],
)

console.log(
  'ok - tradeReview: score, prefill, matrix, concentration, streaks, wilson, scorecard, before/after',
)

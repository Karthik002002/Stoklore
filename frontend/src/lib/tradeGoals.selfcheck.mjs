// Self-check for goal scoring: period bucketing, target vs limit achievement, binary mode, and
// the per-row average. Plain node, no test framework:
//   node src/lib/tradeGoals.selfcheck.mjs
import assert from 'node:assert/strict'
import {
  achievement,
  currentPeriodProgress,
  evaluateGoals,
  GOAL_METRICS,
  goalLabel,
  periodKey,
} from './tradeGoals.js'

const trade = (over) => ({
  symbol: 'TCS',
  direction: 'long',
  quantity: 10,
  entry_price: 100,
  exit_price: 110, // +100
  stop_loss: 95,
  target: 120,
  tags: [],
  traded_at: '2026-07-06T10:00:00+05:30',
  ideal_risk_amount: 50,
  ...over,
})

// --- period bucketing ---------------------------------------------------------------------------
// 2026-07-06 is a Monday, 2026-07-08 a Wednesday - same week, different days.
assert.equal(periodKey('2026-07-06T10:00:00+05:30', 'daily'), '2026-07-06')
assert.equal(periodKey('2026-07-08T10:00:00+05:30', 'daily'), '2026-07-08')
assert.equal(periodKey('2026-07-08T10:00:00+05:30', 'weekly'), '2026-07-06', 'weeks start Monday')
assert.equal(periodKey('2026-07-06T10:00:00+05:30', 'weekly'), '2026-07-06', 'Monday is its own start')
assert.equal(periodKey('2026-07-12T10:00:00+05:30', 'weekly'), '2026-07-06', 'Sunday closes that week')
assert.equal(periodKey('2026-07-13T10:00:00+05:30', 'weekly'), '2026-07-13', 'next Monday starts a new one')
assert.equal(periodKey('2026-07-08T10:00:00+05:30', 'monthly'), '2026-07')

// --- achievement: targets (gt) --------------------------------------------------------------------
const target = { operator: 'gt', target: 1000, mode: 'continuous' }
assert.equal(achievement(target, 500), 50, 'halfway to the target')
assert.equal(achievement(target, 1000), 100)
assert.equal(achievement(target, 4000), 100, 'overshooting still caps at 100')
assert.equal(achievement(target, -500), 0, 'a loss never scores negative')
assert.equal(achievement(target, null), null, 'nothing to score')
// A non-positive target has no ratio to take, so it falls back to pass/fail.
assert.equal(achievement({ operator: 'gt', target: 0, mode: 'continuous' }, 5), 100)
assert.equal(achievement({ operator: 'gt', target: 0, mode: 'continuous' }, -1), 0)

// --- achievement: limits (lt) ---------------------------------------------------------------------
const limit = { operator: 'lt', target: 2, mode: 'continuous' }
assert.equal(achievement(limit, 0), 100, 'well under the limit')
assert.equal(achievement(limit, 2), 100, 'exactly at the limit still counts as met')
assert.equal(achievement(limit, 4), 50, 'twice the limit scores half')
assert.equal(achievement(limit, 100), 2, 'far past the limit decays but never goes negative')
// "Zero tolerance" limits are pass/fail - there's no ratio past a limit of zero.
assert.equal(achievement({ operator: 'lt', target: 0, mode: 'continuous' }, 0), 100)
assert.equal(achievement({ operator: 'lt', target: 0, mode: 'continuous' }, 1), 0)

// --- binary mode ------------------------------------------------------------------------------
assert.equal(achievement({ operator: 'gt', target: 1000, mode: 'binary' }, 999), 0, 'no partial credit')
assert.equal(achievement({ operator: 'gt', target: 1000, mode: 'binary' }, 1000), 100)
assert.equal(achievement({ operator: 'lt', target: 2, mode: 'binary' }, 3), 0)

// --- evaluateGoals: bucketing + row average ------------------------------------------------------
const TRADES = [
  trade({ traded_at: '2026-07-06T10:00:00+05:30' }), // Mon +100
  trade({ traded_at: '2026-07-08T10:00:00+05:30' }), // Wed +100
  trade({ exit_price: 95, traded_at: '2026-07-08T11:00:00+05:30' }), // Wed -50
  trade({ exit_price: null, traded_at: '2026-07-08T12:00:00+05:30' }), // open - never scored
]

const GOALS = [
  { id: 'a', metric: 'netPnl', operator: 'gt', target: 200, period: 'daily', mode: 'continuous' },
  { id: 'b', metric: 'losses', operator: 'lt', target: 0, period: 'daily', mode: 'continuous' },
  { id: 'c', metric: 'netPnl', operator: 'gt', target: 500, period: 'weekly', mode: 'continuous' },
]

const daily = evaluateGoals(TRADES, GOALS, 'daily')
assert.equal(daily.goals.length, 2, 'only the daily goals are scored here')
assert.deepEqual(
  daily.rows.map((r) => r.key),
  ['2026-07-08', '2026-07-06'],
  'newest period first',
)

const wed = daily.rows[0]
assert.equal(wed.trades, 2, 'the open trade is excluded from the bucket')
assert.equal(wed.cells[0].actual, 50, '+100 and -50')
assert.equal(wed.cells[0].pct, 25, '50 of a 200 target')
assert.equal(wed.cells[1].actual, 1, 'one loser')
assert.equal(wed.cells[1].pct, 0, 'a zero-tolerance limit was breached')
assert.equal(wed.total, 12.5, 'row total is the average of its goal percentages')

const mon = daily.rows[1]
assert.equal(mon.cells[0].pct, 50, '100 of a 200 target')
assert.equal(mon.cells[1].pct, 100, 'no losers that day')
assert.equal(mon.total, 75)

const weekly = evaluateGoals(TRADES, GOALS, 'weekly')
assert.equal(weekly.rows.length, 1, 'all three closed trades fall in one week')
assert.equal(weekly.rows[0].cells[0].actual, 150)
assert.equal(weekly.rows[0].cells[0].pct, 30, '150 of a 500 weekly target')

// A goal referencing a metric this build doesn't know scores as unrated instead of throwing.
const unknown = evaluateGoals(
  TRADES,
  [{ id: 'x', metric: 'nope', operator: 'gt', target: 1, period: 'daily' }],
  'daily',
)
assert.equal(unknown.rows[0].cells[0].pct, null)
assert.equal(unknown.rows[0].total, null, 'an all-unrated row has no total')

// --- current period -------------------------------------------------------------------------------
// Nothing traded today, so the goals are still listed but unscored - "not started", not missing.
const today = currentPeriodProgress(TRADES, GOALS, 'daily')
assert.equal(today.trades, 0)
assert.equal(today.cells.length, 2, 'both daily goals still listed')
assert.equal(today.total, null)

const live = currentPeriodProgress([trade({ traded_at: new Date().toISOString() })], GOALS, 'daily')
assert.equal(live.trades, 1)
assert.equal(live.cells[0].pct, 50, '+100 against a 200 target')

// A Bar Replay trade: taken on 2013 bars, journaled just now. Goals track the work done today, so
// it belongs to today's period - bucketing it by traded_at would file it under 2013 and leave the
// day scoring as if nothing had been traded.
const replayed = currentPeriodProgress(
  [trade({ traded_at: '2013-03-20T00:00:00+05:30', created_at: new Date().toISOString() })],
  GOALS,
  'daily',
)
assert.equal(replayed.trades, 1, 'journaled today, so it counts today')
assert.equal(replayed.cells[0].pct, 50)

// ...and a row with no created_at at all still falls back to traded_at.
assert.equal(
  currentPeriodProgress([trade({ traded_at: new Date().toISOString() })], GOALS, 'daily').trades,
  1,
)

// --- labels + metric coverage -----------------------------------------------------------------------
assert.equal(goalLabel(GOALS[0]), 'Net P&L ≥ 200')
assert.equal(goalLabel({ ...GOALS[1] }), 'Losing trades ≤ 0')
assert.equal(goalLabel({ ...GOALS[0], label: 'Pay the rent' }), 'Pay the rent', 'custom label wins')
// The goal metrics extend the Statistics tab's, so a goal can't disagree with the chart of the
// same name.
assert.ok(GOAL_METRICS.netPnl && GOAL_METRICS.winRate && GOAL_METRICS.profitFactor)
assert.ok(GOAL_METRICS.losses && GOAL_METRICS.maxDrawdown && GOAL_METRICS.maxRisk)
assert.equal(GOAL_METRICS.maxDrawdown.of([trade({}), trade({ exit_price: 95 })]), 50, 'peak 100 -> 50')

console.log('all checks passed')

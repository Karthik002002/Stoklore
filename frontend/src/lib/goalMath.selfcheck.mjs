// Self-check for net worth + goal arithmetic. Plain node, no test framework:
//   node src/lib/goalMath.selfcheck.mjs
import assert from 'node:assert/strict'
import {
  focus,
  futureValue,
  goalProgress,
  latestValues,
  monthsBetween,
  netWorth,
  netWorthSeries,
  overAllocated,
  projectSavings,
  simulateSavings,
  requiredMonthly,
} from './goalMath.ts'

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`)
const item = (id, kind, asset_class, over = {}) => ({
  id,
  name: `item${id}`,
  kind,
  asset_class,
  is_liquid: false,
  interest_pct: null,
  source: 'manual',
  external_key: null,
  archived: false,
  ...over,
})

// months
assert.equal(monthsBetween('2026-01-15', '2026-07-15'), 6)
assert.equal(monthsBetween('2026-01-15', '2026-07-14'), 5)
assert.equal(monthsBetween('2026-07-15', '2026-01-15'), -6)

// FV / PMT round-trip, and the zero-rate path
near(futureValue(0, 10000, 0, 12), 120000, 0)
near(requiredMonthly(120000, 0, 0, 12), 10000, 0)
const pmt = requiredMonthly(1_000_000, 100_000, 12, 60)
near(futureValue(100_000, pmt, 12, 60), 1_000_000)
assert.equal(requiredMonthly(100, 200, 7, 12), 0) // already there
assert.equal(requiredMonthly(500, 200, 7, 0), 300) // no time left: the lump sum
// 12% annual is ~0.949%/month, so a year of 0 contributions grows 100 to 112, not 112.68
near(futureValue(100, 0, 12, 12), 112, 0.001)

// latest values + net worth, liability subtracts, carry-forward
const items = [
  item(1, 'bank', 'cash', { is_liquid: true }),
  item(2, 'mf', 'equity'),
  item(3, 'credit_card', 'other'),
]
const snaps = [
  { item_id: 1, as_of: '2026-01-01', value: 100 },
  { item_id: 1, as_of: '2026-02-01', value: 150 },
  { item_id: 2, as_of: '2026-01-01', value: 1000 },
  { item_id: 3, as_of: '2026-02-01', value: 50 },
]
assert.equal(latestValues(snaps).get(1).value, 150)
assert.equal(latestValues(snaps, '2026-01-15').get(1).value, 100)
assert.equal(latestValues(snaps, '2026-01-15').has(3), false)
const nw = netWorth(items, snaps)
assert.deepEqual([nw.assets, nw.liabilities, nw.net, nw.liquid], [1150, 50, 1100, 150])
assert.equal(nw.byClass.equity, 1000)
const series = netWorthSeries(items, snaps)
assert.deepEqual(
  series.map((p) => [p.as_of, p.net]),
  [
    ['2026-01-01', 1100],
    ['2026-02-01', 1100],
  ],
)

// goal progress + statuses
const latest = latestValues(snaps)
const goal = (over) => ({
  id: 1,
  name: 'Car',
  category: 'purchase',
  target_amount: 1000,
  target_date: '2027-02-01',
  priority: 2,
  expected_return_pct: 0,
  monthly_contribution: 0,
  funding: [{ item_id: 2, pct: 50 }],
  ...over,
})
const p = goalProgress(goal(), latest, '2026-02-01')
assert.equal(p.funded, 500)
assert.equal(p.months, 12)
near(p.required, 500 / 12, 0.01)
assert.equal(p.status, 'off-track')
assert.equal(goalProgress(goal({ monthly_contribution: 42 }), latest, '2026-02-01').status, 'on-track') // 500+504
assert.equal(goalProgress(goal({ monthly_contribution: 35 }), latest, '2026-02-01').status, 'at-risk') // 920
assert.equal(goalProgress(goal({ funding: [{ item_id: 2, pct: 100 }] }), latest, '2026-02-01').status, 'done')
assert.equal(goalProgress(goal({ target_date: '2026-01-01' }), latest, '2026-02-01').status, 'overdue')

// double-counted earmarks
assert.deepEqual(overAllocated([goal(), goal({ funding: [{ item_id: 2, pct: 60 }] })]), [
  { item_id: 2, pct: 110 },
])
assert.deepEqual(overAllocated([goal(), goal()]), [])

// focus: the order of priorities holds
const settings = { emergency_months: 6, target_equity_pct: 60, target_debt_pct: 30, target_gold_pct: 10 }
const findings = focus({
  items,
  snapshots: snaps,
  goals: [goal()],
  cashflow: [{ month: '2026-01-01', income: 100, expenses: 80 }],
  settings,
  today: '2026-02-10',
})
const titles = findings.map((f) => f.title)
assert.equal(titles[0], 'Build the emergency fund first') // 150 liquid vs 480 needed
assert.equal(titles[1], 'Pay down item3') // credit card
assert.equal(titles[2], 'Car is off-track')
assert.ok(titles.includes('Goals need more than you save')) // needs ~41.7/mo, surplus 20
assert.ok(titles.some((t) => t.startsWith('Car is 11 months away'))) // short goal in an equity MF
assert.ok(titles.includes('Allocation has drifted')) // ~87% equity
assert.equal(
  focus({ items, snapshots: [], goals: [], cashflow: [], settings, today: '2026-02-10' })[0].title,
  'Record your balances',
)
assert.ok(
  focus({ items, snapshots: snaps, goals: [], cashflow: [], settings, today: '2026-06-01' }).some(
    (f) => f.title === 'Balances are out of date',
  ),
)

// savings projection
const plan = { start: 100000, monthly: 10000, stepUpPct: 0, returnPct: 12, years: 10, inflationPct: 6 }
const rows = projectSavings(plan)
assert.equal(rows.length, 11)
near(rows.at(-1).value, futureValue(100000, 10000, 12, 120)) // same arithmetic as goals
assert.equal(rows.at(-1).invested, 100000 + 10000 * 120)
near(rows.at(-1).real, rows.at(-1).value / 1.06 ** 10)
const flat0 = projectSavings({ ...plan, returnPct: 0 })
assert.equal(flat0.at(-1).value, 1_300_000)
// step-up: year 1 at 10k/mo, year 2 at 11k/mo
const stepped = projectSavings({ ...plan, start: 0, returnPct: 0, years: 2, stepUpPct: 10 })
near(stepped.at(-1).invested, 120000 + 132000, 0.01)

// simulation: zero volatility = the projection; the median tracks it with volatility; seeded
const sim0 = simulateSavings(plan, { volatilityPct: 0, runs: 50, target: 1 })
near(sim0.years.at(-1).p10, rows.at(-1).value, 0.5)
near(sim0.years.at(-1).p90, rows.at(-1).value, 0.5)
assert.equal(sim0.successRate, 1)
const sim = simulateSavings(plan, { volatilityPct: 18, runs: 4000, target: rows.at(-1).value })
const y = sim.years.at(-1)
assert.ok(y.p10 < y.p25 && y.p25 < y.p50 && y.p50 < y.p75 && y.p75 < y.p90)
assert.ok(Math.abs(y.p50 / rows.at(-1).value - 1) < 0.06, `median ${y.p50} vs ${rows.at(-1).value}`)
assert.ok(sim.successRate > 0.4 && sim.successRate < 0.6) // target = the projection ~ a coin flip
assert.deepEqual(
  simulateSavings(plan, { volatilityPct: 18, runs: 100 }).years.at(-1),
  simulateSavings(plan, { volatilityPct: 18, runs: 100 }).years.at(-1),
)
assert.equal(simulateSavings(plan, { volatilityPct: 18, runs: 10 }).successRate, null)

console.log('goalMath selfcheck: all passed')

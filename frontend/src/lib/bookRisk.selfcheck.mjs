// node src/lib/bookRisk.selfcheck.mjs
import assert from 'node:assert/strict'
import { correlatedPairs, daysUntil, groupRisk, nextResults, positionRisk } from './bookRisk.ts'

const long = { key: '1', symbol: 'A', account: 'P', direction: 'long', quantity: 10, entry: 100, price: 110, stops: [{ price: 95, qty: 10 }] }
let r = positionRisk(long)
assert.equal(r.atRisk, 150, 'from 110 down to 95, 10 shares')
assert.equal(r.stoppedPnl, -50, 'stopping out books -5 x 10 against entry')
assert.equal(r.uncoveredQty, 0)

// a stop trailed above entry: profit locked, risk only what is given back from here
r = positionRisk({ ...long, stops: [{ price: 105, qty: 10 }] })
assert.deepEqual([r.atRisk, r.stoppedPnl], [50, 50])

// half covered: the rest is unprotected, valued at the mark
r = positionRisk({ ...long, stops: [{ price: 95, qty: 4 }] })
assert.deepEqual([r.atRisk, r.uncoveredQty, r.unprotectedValue], [60, 6, 660])

// legs covering more than the position count only up to its size
r = positionRisk({ ...long, stops: [{ price: 95, qty: 8 }, { price: 90, qty: 8 }] })
assert.equal(r.atRisk, 15 * 8 + 20 * 2)

// short: risk is the stop above the price
r = positionRisk({ ...long, direction: 'short', price: 90, stops: [{ price: 104, qty: 10 }] })
assert.deepEqual([r.atRisk, r.stoppedPnl], [140, -40])

// already through the stop: nothing more at risk (the stop should have filled)
assert.equal(positionRisk({ ...long, price: 94 }).atRisk, 0)

const groups = groupRisk([long, { ...long, key: '2', account: 'Q', stops: [] }], (p) => p.account)
assert.deepEqual(groups.map((g) => [g.key, g.atRisk, g.unprotected]), [['P', 150, 0], ['Q', 0, 1]])

// correlation: B tracks A, C moves against it, D is too short to judge
const bars = (f) => Array.from({ length: 40 }, (_, i) => ({ time: i, close: 100 + f(i) }))
const pairs = correlatedPairs({
  A: bars((i) => Math.sin(i) * 5 + i),
  B: bars((i) => Math.sin(i) * 5.2 + i),
  C: bars((i) => -Math.sin(i) * 5 - i),
  D: bars((i) => i).slice(0, 10),
})
assert.ok(pairs.some((p) => p.a === 'A' && p.b === 'B' && p.r > 0.9))
assert.ok(pairs.some((p) => p.a === 'A' && p.b === 'C' && p.r < -0.9), 'an opposite bet shows too')
assert.ok(!pairs.some((p) => p.a === 'D' || p.b === 'D'), 'too few shared days')

const today = new Date(2026, 9, 16)
assert.equal(daysUntil('2026-10-17', today), 1)
assert.equal(daysUntil('2026-10-16', today), 0)
const next = nextResults(
  [{ symbol: 'A', date: '2026-10-30' }, { symbol: 'A', date: '2026-10-20' }, { symbol: 'B', date: '2026-10-01' }],
  today,
)
assert.equal(next.get('A'), '2026-10-20', 'the soonest')
assert.equal(next.has('B'), false, 'past meetings dropped')
console.log('ok - book risk: risk to stops, locked profit, unprotected, groups, correlation, results dates')

// node src/design-system/components/marketMath.selfcheck.ts
import assert from 'node:assert/strict'
import { heat, monthGrid, readTicket } from './marketMath.ts'

// long: entry 986.25, stop 960, target 1062, risk ₹2,500
let t = readTicket('buy', 986.25, 960, 1062, 2500)
assert.equal(t.riskPerShare, 26.25)
assert.equal(t.qtyForRisk, 95) // floor(2500 / 26.25) = 95.2
assert.ok(Math.abs(t.rr! - 75.75 / 26.25) < 1e-9)
assert.deepEqual(t.errors, [])

// stop on the wrong side
t = readTicket('buy', 986.25, 1002, 1062, 2500)
assert.equal(t.riskPerShare, null)
assert.equal(t.qtyForRisk, null)
assert.equal(t.rr, null)
assert.deepEqual(t.errors, ['Stop must be below entry for a long'])

// short mirrors it
t = readTicket('sell', 1889, 1902, 1850, 1300)
assert.equal(t.riskPerShare, 13)
assert.equal(t.qtyForRisk, 100)
assert.equal(t.rr, 3)
assert.deepEqual(readTicket('sell', 100, 95, 90, 100).errors, ['Stop must be above entry for a short'])
assert.deepEqual(readTicket('sell', 100, 105, 110, 100).errors, ['Target must be below entry for a short'])

// no stop / no target: nothing to size, no complaint
t = readTicket('buy', 100, null, null, 1000)
assert.deepEqual([t.riskPerShare, t.qtyForRisk, t.rr, t.errors], [null, null, null, []])
// risk smaller than one share
assert.deepEqual(readTicket('buy', 1000, 900, null, 50).errors, [
  'Risk is smaller than one share’s stop distance',
])
// missing price
assert.deepEqual(readTicket('buy', null, 90, 110, 100).errors, ['Enter a price'])

// Nov 2026 starts on a Sunday -> first week begins Mon 26 Oct
const weeks = monthGrid('2026-11', {
  '2026-11-02': 1200,
  '2026-11-03': -400,
  '2026-10-30': 999,
  '2026-11-30': 50,
})
assert.equal(weeks[0].cells[0].date, '2026-10-26')
assert.equal(weeks[0].cells[6].date, '2026-11-01')
assert.ok(weeks.every((w) => w.cells.length === 7))
assert.equal(weeks.at(-1)!.cells.at(-1)!.date, '2026-12-06')
assert.equal(weeks.length, 6)
// out-of-month day never counted
assert.equal(weeks[0].total, 0)
assert.equal(weeks[0].cells[4].value, null)
assert.deepEqual([weeks[1].total, weeks[1].traded], [800, 2])
assert.equal(weeks.at(-1)!.total, 50)
// a month that starts on Monday and ends on Sunday has no padding
const feb = monthGrid('2027-02', {})
assert.equal(feb[0].cells[0].date, '2027-02-01')
assert.equal(feb.length, 4)
assert.ok(feb.flatMap((w) => w.cells).every((c) => c.inMonth))

assert.equal(heat(0, 100), 0)
assert.equal(heat(100, 100), 1)
assert.equal(heat(-25, 100), 0.5)
assert.equal(heat(500, 100), 1)
assert.equal(heat(10, 0), 0)

console.log('marketMath.selfcheck: ok')

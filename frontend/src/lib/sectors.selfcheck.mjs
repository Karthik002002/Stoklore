// node src/lib/sectors.selfcheck.mjs
import assert from 'node:assert/strict'
import { breadth, bucketShares, croreShort, heatColor, sectorSummary } from './sectors.ts'

assert.match(heatColor(2), /^rgba\(34, 197, 94, 0\.54\)$/)
assert.match(heatColor(-8), /^rgba\(239, 68, 68, 0\.90\)$/, 'saturates past 4%')
assert.equal(heatColor(0), heatColor(null), 'flat and unknown look alike')

assert.deepEqual(bucketShares([2, 3, 0, 8, 1]).map((x) => Math.round(x * 100) / 100), [14.29, 21.43, 0, 57.14, 7.14])
assert.deepEqual(bucketShares([0, 0, 0, 0, 0]), [0, 0, 0, 0, 0])

assert.equal(breadth({ advance: 9, decline: 3 }), 0.75)
assert.equal(breadth({ advance: 0, decline: 0 }), null)

const s = sectorSummary([
  { name: 'A', mcap_cr: 110, mcap_change_cr: 10, change_pct: 10, advance: 1, decline: 0 },
  { name: 'B', mcap_cr: 90, mcap_change_cr: -10, change_pct: -10, advance: 0, decline: 1 },
  { name: 'C', mcap_cr: 50, mcap_change_cr: 0, change_pct: 0, advance: 0, decline: 0 },
])
assert.deepEqual([s.up, s.down, s.flat, s.mcap, s.change], [1, 1, 1, 250, 0])
assert.equal(s.changePct, 0, 'cap-weighted: +10 and -10 cancel')
assert.equal(s.best.name, 'A')
assert.equal(s.worst.name, 'B')

assert.equal(croreShort(586347.55), '5.86L Cr')
assert.equal(croreShort(8112.12), '8,112 Cr')
assert.equal(croreShort(null), '—')
console.log('ok - sectors: heat colours, breadth buckets, cap-weighted summary, crore formatting')

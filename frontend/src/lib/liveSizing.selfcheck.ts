// Self-check for the live position-size reading. Plain asserts, no framework, no DOM:
//
//     node frontend/src/lib/liveSizing.selfcheck.ts
//
// The cases worth pinning are the ones about NOT knowing: a balance that hasn't loaded yet must
// produce no percentage and no warning, because a zero there would read as an empty account and
// warn about every order.
import assert from 'node:assert/strict'
import { positionSize } from './liveSizing.ts'

const CAPS = { max_order_value: 25000, max_position_pct: 20 }

// A comfortable position: a fifth of the wallet, under the rupee cap.
const ok = positionSize(10, 1000, 100000, CAPS)
assert.equal(ok.value, 10000)
assert.equal(ok.pctOfWallet, 10)
assert.deepEqual(ok.warnings, [])

// Over the rupee cap - the same sentence the backend refuses with.
const overCap = positionSize(30, 1000, 500000, CAPS)
assert.equal(overCap.warnings.length, 1)
assert.match(overCap.warnings[0], /over the ₹25,000 per-order cap/)

// Over the share-of-wallet limit, but well under the rupee cap: the percentage is the whole point,
// since ₹20,000 is nothing on one account and most of another.
const overPct = positionSize(20, 1000, 50000, CAPS)
assert.equal(overPct.pctOfWallet, 40)
assert.equal(overPct.warnings.length, 1)
assert.match(overPct.warnings[0], /40.0% of the wallet/)

// Costs more than the account holds - worst first, ahead of the cap warning it also trips.
const unaffordable = positionSize(100, 1000, 40000, CAPS)
assert.equal(unaffordable.warnings.length, 3)
assert.match(unaffordable.warnings[0], /more than the ₹40,000 available/)

// Nothing known yet: no balance means no percentage and no warnings, never a 0% or a false alarm.
const noBalance = positionSize(10, 1000, null, CAPS)
assert.equal(noBalance.value, 10000)
assert.equal(noBalance.pctOfWallet, null)
assert.deepEqual(noBalance.warnings, [])
assert.equal(positionSize(10, 1000, 0, CAPS).pctOfWallet, null, 'a zero balance is not a divisor')

// Nothing typed yet: no value, no reading, no complaints.
assert.deepEqual(positionSize(0, 1000, 100000, CAPS), {
  value: null,
  pctOfWallet: null,
  warnings: [],
})
assert.equal(positionSize(10, null, 100000, CAPS).value, null, 'a market order with no price yet')

// Caps left unset simply do not fire.
assert.deepEqual(positionSize(1000, 1000, 100000, {}).warnings.length, 1, 'only the affordability one')

console.log('ok - liveSizing: value, share of wallet, cap warnings, unknown balance')

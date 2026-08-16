// Self-check for autoResult's P&L classification - the neutral band and the NaN guard. Money
// path with branches, so it gets a runnable check. Plain node, no test framework:
//   node src/lib/manualTrades.selfcheck.mjs
import assert from 'node:assert/strict'
import { autoResult, NEUTRAL_PNL_BAND, tradePnl, tradeRR, tradeRRDisplay } from './manualTrades.js'

const long = (exit, qty = 1) => ({
  direction: 'long',
  quantity: qty,
  entry_price: 100,
  exit_price: exit,
})

assert.equal(NEUTRAL_PNL_BAND, 20)

// --- the band ---------------------------------------------------------------------------------
// Clear of the band on either side.
assert.equal(autoResult(long(150)), 'profit') // +50
assert.equal(autoResult(long(50)), 'loss') // -50
// Inside it - a scratch, not a win or a loss. These are the two cases the band exists for.
assert.equal(autoResult(long(120)), 'neutral') // +20
assert.equal(autoResult(long(90)), 'neutral') // -10
assert.equal(autoResult(long(100)), 'neutral') // exactly flat
// Boundaries: the band is inclusive, so exactly +/-20 is neutral and a paisa beyond it is not.
assert.equal(tradePnl(long(120)), 20)
assert.equal(autoResult(long(120)), 'neutral')
assert.equal(autoResult(long(120.01)), 'profit')
assert.equal(autoResult(long(80)), 'neutral') // -20
assert.equal(autoResult(long(79.99)), 'loss')

// --- the band is in rupees, so quantity moves it ------------------------------------------------
// +₹2/share is neutral on 1 share and a real win on 100 - the whole reason quantity has to be
// passed in rather than the classification being done on price difference alone.
assert.equal(autoResult(long(102, 1)), 'neutral') // +2
assert.equal(autoResult(long(102, 100)), 'profit') // +200

// --- shorts invert --------------------------------------------------------------------------
const short = (exit, qty = 1) => ({
  direction: 'short',
  quantity: qty,
  entry_price: 100,
  exit_price: exit,
})
assert.equal(autoResult(short(50)), 'profit')
assert.equal(autoResult(short(150)), 'loss')
assert.equal(autoResult(short(90)), 'neutral') // +10 on a short

// --- unknown must not read as neutral ---------------------------------------------------------
// The regression this guards: tradePnl multiplies by quantity, so a missing one yields NaN, which
// fails both comparisons and used to fall through to 'neutral' - labelling every Bar Replay trade
// flat regardless of how it actually went.
assert.equal(autoResult({ direction: 'long', entry_price: 100, exit_price: 150 }), null)
assert.equal(autoResult({ direction: 'long', entry_price: 100, exit_price: 150, quantity: '' }), null)
// A still-open trade has no result yet, which is different from a flat one.
assert.equal(autoResult({ direction: 'long', entry_price: 100, exit_price: null, quantity: 10 }), null)

// --- caller-supplied band ---------------------------------------------------------------------
assert.equal(autoResult(long(150), 100), 'neutral')
assert.equal(autoResult(long(150), 10), 'profit')

// --- R:R, and the exit-as-target fallback -----------------------------------------------------
// Planned: target 120 vs stop 90 on a 100 entry is 20 reward over 10 risk.
const planned = { direction: 'long', entry_price: 100, stop_loss: 90, target: 120, exit_price: 105 }
assert.equal(tradeRR(planned), 2)
assert.deepEqual(tradeRRDisplay(planned), { rr: 2, planned: true })

// No target: the exit stands in for one, and the result is signed - a winner is positive, a
// stopped-out trade negative. An absolute value here would print a loss as a healthy reward.
const noTarget = { direction: 'long', entry_price: 100, stop_loss: 90, target: null, exit_price: 115 }
assert.equal(tradeRR(noTarget), null)
assert.deepEqual(tradeRRDisplay(noTarget), { rr: 1.5, planned: false })
assert.deepEqual(tradeRRDisplay({ ...noTarget, exit_price: 90 }), { rr: -1, planned: false })

// Shorts measure the move the other way.
const shortTrade = { direction: 'short', entry_price: 100, stop_loss: 110, target: null, exit_price: 85 }
assert.deepEqual(tradeRRDisplay(shortTrade), { rr: 1.5, planned: false })

// Nothing to divide by, or nothing to measure: still null rather than a made-up number.
assert.equal(tradeRRDisplay({ ...noTarget, stop_loss: null }), null)
assert.equal(tradeRRDisplay({ ...noTarget, exit_price: null }), null)
assert.equal(tradeRRDisplay({ ...noTarget, stop_loss: 100 }), null)

console.log('ok - manualTrades: autoResult neutral band, quantity scaling, shorts, NaN guard, R:R fallback')

// Self-check for the per-account trading-cost math - both sides of a round trip, the two slippage
// bases, and the open-trade half-charge. Money path, so it gets a runnable check. Plain node:
//   node src/lib/tradeCosts.selfcheck.mjs
import assert from 'node:assert/strict'
import {
  accountHasCosts,
  NO_COSTS,
  roundTripCost,
  sideCost,
  tradeCosts,
  tradeNetPnl,
  tradeNetReturnPct,
} from './tradeCosts.ts'

// A ₹20-a-side discount broker: 20 flat, 0.1% of turnover in statutory charges, 5 paise a share of
// slippage.
const account = {
  slippage_value: 0.05,
  slippage_type: 'per_share',
  brokerage_flat: 20,
  brokerage_pct: 0,
  other_charges_pct: 0.1,
}

// --- one side ---------------------------------------------------------------------------------
// 100 shares at ₹200 = ₹20,000 turnover: 100 x 0.05 slippage, 20 brokerage, 0.1% = 20 charges.
const side = sideCost(account, 200, 100)
assert.equal(side.slippage, 5)
assert.equal(side.brokerage, 20)
assert.equal(side.charges, 20)
assert.equal(side.total, 45)

// bps slippage is measured on the fill, not per share: 10bps of ₹20,000 = ₹20.
assert.equal(sideCost({ ...account, slippage_type: 'bps', slippage_value: 10 }, 200, 100).slippage, 20)

// A percentage brokerage plan stacks with the flat fee, which is how capped plans actually bill.
assert.equal(sideCost({ ...account, brokerage_pct: 0.03 }, 200, 100).brokerage, 26)

// --- a closed round trip ----------------------------------------------------------------------
const closed = { direction: 'long', quantity: 100, entry_price: 200, exit_price: 210 }
const costs = tradeCosts(closed, account)
// Entry side ₹45, exit side at the higher price: 5 slippage + 20 brokerage + 21 charges = 46.
assert.equal(costs.total, 91)
assert.equal(costs.slippage, 10)
assert.equal(costs.brokerage, 40)
assert.equal(costs.charges, 41)
assert.equal(costs.roundTrip, true)
// Gross is 100 x ₹10 = ₹1,000, so net is ₹909.
assert.equal(tradeNetPnl(closed, account), 909)
// Net return is measured against capital deployed (₹20,000), same basis as the gross figure.
assert.equal(tradeNetReturnPct(closed, account), 4.55)

// --- an open trade ----------------------------------------------------------------------------
// Only the entry has happened, so only the entry is charged - and net P&L stays null, because
// nothing has been realised to take the cost out of.
const open = { direction: 'long', quantity: 100, entry_price: 200, exit_price: null }
assert.equal(tradeCosts(open, account).total, 45)
assert.equal(tradeCosts(open, account).roundTrip, false)
assert.equal(tradeNetPnl(open, account), null)

// --- shorts -----------------------------------------------------------------------------------
// Costs don't care about direction; the P&L underneath them does.
const short = { direction: 'short', quantity: 100, entry_price: 210, exit_price: 200 }
assert.equal(tradeNetPnl(short, account), 909)

// --- no account, no rate card -----------------------------------------------------------------
// Unpriced is not free: with no account the gross figure passes through untouched rather than
// pretending a cost of zero was verified.
assert.equal(tradeCosts(closed, null), null)
assert.equal(tradeNetPnl(closed, null), 1000)

// A costless account is a real answer, though - net equals gross.
assert.equal(tradeNetPnl(closed, NO_COSTS), 1000)
assert.equal(accountHasCosts(NO_COSTS), false)
assert.equal(accountHasCosts(account), true)
assert.equal(accountHasCosts(null), false)

// --- the settings preview ---------------------------------------------------------------------
assert.deepEqual(roundTripCost(account, 200, 100), {
  slippage: 10,
  brokerage: 40,
  charges: 40,
  total: 90,
})

// Garbage in the rate fields is treated as zero, not NaN - a half-typed number in the settings
// form must never turn every P&L on the page into NaN.
assert.equal(sideCost({ ...account, slippage_value: '' }, 200, 100).slippage, 0)
assert.equal(sideCost({ ...account, brokerage_flat: undefined }, 200, 100).brokerage, 0)

console.log('ok - tradeCosts: per-side charging, bps vs per-share slippage, open trades, no-account')

// Plain assert-based check, no framework - run with `node orderEngine.test.js`. Money-path logic
// (which price a stop-loss/target actually fills at) is exactly the kind of thing that should
// fail loudly if it regresses, especially the gap-through case (see the comment on levelHit in
// orderEngine.js for why it exists).
import assert from 'node:assert'
import {
  processBarForOrders,
  riskReward,
  setLegQty,
  preferredQuantity,
  sizeByRisk,
  sizeWarnings,
  trailStops,
  withStopsAtBreakeven,
} from './orderEngine.ts'
import type { ReplayOrder } from './store.ts'

// Each fixture below carries exactly the fields the path under test reads - a stop-loss test has
// no reason to invent a quantity. `asOrder` is where that stops being a lie to the type system,
// in the test rather than by loosening the engine's own types.
const asOrder = (order: object) => order as ReplayOrder

// Normal touch - the bar's range includes the stop-loss level itself. Single-leg SL/target
// covering the whole position (the common case, and how a plain "one stop loss" order looks).
{
  const order = {
    id: '1',
    status: 'open',
    direction: 'long',
    entryPrice: 97,
    stopLosses: [{ id: 'l1', price: 95, qty: 10 }],
    targets: [{ id: 't1', price: 110, qty: 10 }],
  }
  const bar = { open: 98, high: 99, low: 94, close: 96 }
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'stop_loss')
  assert.equal(triggeredCloses[0].exitPrice, 95)
  assert.equal(triggeredCloses[0].leg.qty, 10)
}

// Gapped clean through a long's stop-loss (whole bar below it, never touched) - fills at the
// bar's open instead of the stale stop-loss price.
{
  const order = {
    id: '2',
    status: 'open',
    direction: 'long',
    entryPrice: 995,
    stopLosses: [{ id: 'l1', price: 991.78, qty: 5 }],
    targets: [{ id: 't1', price: 1106.3, qty: 5 }],
  }
  const bar = { open: 940, high: 955, low: 920, close: 925.71 }
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'stop_loss')
  assert.equal(triggeredCloses[0].exitPrice, 940)
}

// Gapped clean through a short's target (whole bar below it) - fills at the bar's open.
{
  const order = {
    id: '3',
    status: 'open',
    direction: 'short',
    entryPrice: 100,
    stopLosses: [{ id: 'l1', price: 110, qty: 5 }],
    targets: [{ id: 't1', price: 90, qty: 5 }],
  }
  const bar = { open: 85, high: 88, low: 80, close: 82 }
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'target')
  assert.equal(triggeredCloses[0].exitPrice, 85)
}

// Bar stays entirely between the levels - no trigger.
{
  const order = {
    id: '4',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    stopLosses: [{ id: 'l1', price: 90, qty: 5 }],
    targets: [{ id: 't1', price: 110, qty: 5 }],
  }
  const bar = { open: 99, high: 102, low: 98, close: 101 }
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 0)
}

// Both stop-loss and target touched by one RED bar (close < open) - the intrabar heuristic
// says SL was reached first for a long.
{
  const order = {
    id: '5',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    stopLosses: [{ id: 'l1', price: 95, qty: 5 }],
    targets: [{ id: 't1', price: 105, qty: 5 }],
  }
  const bar = { open: 100, high: 106, low: 94, close: 96 } // red
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'stop_loss')
}

// Same double-touch but on a GREEN bar (close > open) - target wins for a long.
{
  const order = {
    id: '5g',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    stopLosses: [{ id: 'l1', price: 95, qty: 5 }],
    targets: [{ id: 't1', price: 105, qty: 5 }],
  }
  const bar = { open: 96, high: 106, low: 94, close: 105 } // green
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'target')
}

// Short mirrors it - a green bar drifted up, so for a short the STOP (above entry) is what got
// hit first, not the target below.
{
  const order = {
    id: '5s',
    status: 'open',
    direction: 'short',
    entryPrice: 100,
    stopLosses: [{ id: 'l1', price: 105, qty: 5 }],
    targets: [{ id: 't1', price: 95, qty: 5 }],
  }
  const bar = { open: 96, high: 106, low: 94, close: 105 } // green
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'stop_loss')
}

// Doji (close === open) with both sides hit - conservative fallback: SL wins.
{
  const order = {
    id: '5d',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    stopLosses: [{ id: 'l1', price: 95, qty: 5 }],
    targets: [{ id: 't1', price: 105, qty: 5 }],
  }
  const bar = { open: 100, high: 106, low: 94, close: 100 }
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'stop_loss')
}

// Laddered stop-loss: bar only reaches the nearer (tighter) leg, not the farther one - only that
// leg closes; the farther leg is left untouched for the caller to keep the remainder open with.
{
  const order = {
    id: '6',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    stopLosses: [
      { id: 'far', price: 90, qty: 4 },
      { id: 'near', price: 95, qty: 6 },
    ],
    targets: [],
  }
  const bar = { open: 97, high: 98, low: 93, close: 94 } // touches 95, not 90
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].leg.id, 'near')
  assert.equal(triggeredCloses[0].exitPrice, 95)
}

// Laddered stop-loss: a gap blows clean through both legs in one bar - both close, each getting
// its own triggeredCloses entry (so the caller can journal them as separate partial exits).
{
  const order = {
    id: '7',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    stopLosses: [
      { id: 'far', price: 90, qty: 4 },
      { id: 'near', price: 95, qty: 6 },
    ],
    targets: [],
  }
  const bar = { open: 85, high: 88, low: 80, close: 82 } // whole bar below both levels
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 2)
  assert.deepEqual(triggeredCloses.map((c) => c.leg.id).sort(), ['far', 'near'])
  triggeredCloses.forEach((c) => assert.equal(c.exitPrice, 85))
}

// Laddered target: bar only reaches the nearer target leg, not the farther one - only that leg
// closes (scale out at a near target, let the rest run toward the farther one).
{
  const order = {
    id: '8',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    stopLosses: [],
    targets: [
      { id: 'near', price: 105, qty: 6 },
      { id: 'far', price: 115, qty: 4 },
    ],
  }
  const bar = { open: 103, high: 107, low: 102, close: 106 } // touches 105, not 115
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'target')
  assert.equal(triggeredCloses[0].leg.id, 'near')
  assert.equal(triggeredCloses[0].exitPrice, 105)
}

// Laddered target: a gap blows clean through both target legs in one bar - both close.
{
  const order = {
    id: '9',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    stopLosses: [],
    targets: [
      { id: 'near', price: 105, qty: 6 },
      { id: 'far', price: 115, qty: 4 },
    ],
  }
  const bar = { open: 120, high: 125, low: 118, close: 122 } // whole bar above both levels
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 0)
  assert.equal(triggeredCloses.length, 2)
  assert.deepEqual(triggeredCloses.map((c) => c.leg.id).sort(), ['far', 'near'])
  triggeredCloses.forEach((c) => assert.equal(c.exitPrice, 120))
}

// Freshly-filled limit doesn't also stop out on the same bar - a broker arms exits from the
// next bar. Without this a limit that fills on a wide bar could immediately trigger its own SL.
{
  const order = {
    id: '10',
    status: 'pending',
    direction: 'long',
    entryPrice: 100,
    stopLosses: [{ id: 'sl', price: 95, qty: 5 }],
    targets: [],
  }
  const bar = { open: 101, high: 102, low: 94, close: 100 }
  const { nextOrders, triggeredCloses } = processBarForOrders([asOrder(order)], bar, 42)
  assert.equal(nextOrders[0].status, 'open')
  assert.equal(nextOrders[0].entryBarIndex, 42)
  assert.equal(triggeredCloses.length, 0)
}

// The very next bar - now that entryBarIndex !== barIndex - can trigger the SL normally.
{
  const order = {
    id: '11',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    entryBarIndex: 42,
    stopLosses: [{ id: 'sl', price: 95, qty: 5 }],
    targets: [],
  }
  const bar = { open: 96, high: 97, low: 93, close: 94 }
  const { triggeredCloses } = processBarForOrders([asOrder(order)], bar, 43)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'stop_loss')
}

// --- riskReward -------------------------------------------------------------------------------
// Feeds both the order ticket (before placing) and the on-chart entry pill (after), so a slip
// here shows the trader two different R:R numbers for one position.

// Single leg each side, long: risk 5/share over 10 shares, reward 10/share over 10.
{
  const rr = riskReward({
    direction: 'long',
    entryPrice: 100,
    stopLosses: [{ price: 95, qty: 10 }],
    targets: [{ price: 110, qty: 10 }],
  })
  assert.equal(rr.risk, 50)
  assert.equal(rr.reward, 100)
  assert.equal(rr.rr, 2)
}

// Short mirrors it exactly - the stop is ABOVE entry and the target below.
{
  const rr = riskReward({
    direction: 'short',
    entryPrice: 100,
    stopLosses: [{ price: 105, qty: 10 }],
    targets: [{ price: 90, qty: 10 }],
  })
  assert.equal(rr.risk, 50)
  assert.equal(rr.reward, 100)
  assert.equal(rr.rr, 2)
}

// Ladders blend by quantity: half out at +5, half at +15 is 100 of reward, not 150 (taking the
// far leg alone) and not 50 (taking the near one).
{
  const rr = riskReward({
    direction: 'long',
    entryPrice: 100,
    stopLosses: [{ price: 95, qty: 10 }],
    targets: [
      { price: 105, qty: 5 },
      { price: 115, qty: 5 },
    ],
  })
  assert.equal(rr.reward, 100)
  assert.equal(rr.rr, 2)
}

// Uncovered quantity isn't counted - a stop on 4 of 10 shares is 4 shares of risk, not 10.
{
  const rr = riskReward({
    direction: 'long',
    entryPrice: 100,
    stopLosses: [{ price: 90, qty: 4 }],
    targets: [{ price: 110, qty: 10 }],
  })
  assert.equal(rr.risk, 40)
}

// One side missing is not a ratio - rr stays null rather than reporting Infinity or 0.
{
  assert.equal(riskReward({ direction: 'long', entryPrice: 100, targets: [{ price: 110, qty: 1 }] }).rr, null)
  assert.equal(
    riskReward({ direction: 'long', entryPrice: 100, stopLosses: [{ price: 90, qty: 1 }] }).rr,
    null,
  )
  const none = riskReward({ direction: 'long', entryPrice: 100 })
  assert.equal(none.risk, null)
  assert.equal(none.reward, null)
  assert.equal(none.rr, null)
}

// A leg on the wrong side of entry contributes 0, never negative - otherwise a mistyped level
// would silently cancel out a correct one and flatter the ratio.
{
  const rr = riskReward({
    direction: 'long',
    entryPrice: 100,
    stopLosses: [
      { price: 95, qty: 10 },
      { price: 120, qty: 10 }, // above entry on a long - nonsense, must not subtract
    ],
    targets: [{ price: 110, qty: 10 }],
  })
  assert.equal(rr.risk, 50)
}

// Half-typed rows (price or qty still blank) are ignored rather than counted as zero-price legs.
{
  const rr = riskReward({
    direction: 'long',
    entryPrice: 100,
    stopLosses: [
      { price: 95, qty: 10 },
      { price: null, qty: 5 },
      { price: 90, qty: null },
    ],
    targets: [{ price: 110, qty: 10 }],
  })
  assert.equal(rr.risk, 50)
}

// --- sizeByRisk -------------------------------------------------------------------------------

// 1% of ₹1L = ₹1000 risk / ₹5 per share = 200 shares.
{
  const qty = sizeByRisk({
    balance: 100000,
    riskPct: 1,
    entryPrice: 100,
    direction: 'long',
    stopLosses: [{ price: 95, qty: 0 }],
  })
  assert.equal(qty, 200)
}

// Nearest-to-entry SL leg sets the divisor - a laddered stop with a tight leg near entry and a
// looser one further out sizes off the TIGHT one (worst-case per-share loss).
{
  const qty = sizeByRisk({
    balance: 100000,
    riskPct: 1,
    entryPrice: 100,
    direction: 'long',
    stopLosses: [
      { price: 95, qty: 0 }, // 5 away
      { price: 98, qty: 0 }, // 2 away - tighter
    ],
  })
  assert.equal(qty, 500) // 1000 / 2
}

// Short mirrors: nearest stop above entry (= lowest price) is the tightest.
{
  const qty = sizeByRisk({
    balance: 100000,
    riskPct: 1,
    entryPrice: 100,
    direction: 'short',
    stopLosses: [
      { price: 105, qty: 0 },
      { price: 102, qty: 0 },
    ],
  })
  assert.equal(qty, 500)
}

// Missing/invalid inputs return null - lets the UI say "size me" is unavailable rather than
// silently showing 0 shares.
{
  assert.equal(
    sizeByRisk({ balance: 0, riskPct: 1, entryPrice: 100, direction: 'long', stopLosses: [] }),
    null,
  )
  assert.equal(
    sizeByRisk({ balance: 100000, riskPct: 0, entryPrice: 100, direction: 'long', stopLosses: [] }),
    null,
  )
  assert.equal(
    sizeByRisk({
      balance: 100000,
      riskPct: 1,
      entryPrice: 100,
      direction: 'long',
      stopLosses: [{ price: null }],
    }),
    null,
  )
  // A stop on the wrong side of entry doesn't count.
  assert.equal(
    sizeByRisk({
      balance: 100000,
      riskPct: 1,
      entryPrice: 100,
      direction: 'long',
      stopLosses: [{ price: 105 }],
    }),
    null,
  )
}

// --- withStopsAtBreakeven ---------------------------------------------------------------------

{
  const order = {
    id: 'be1',
    direction: 'long',
    entryPrice: 100,
    stopLosses: [
      { id: 'a', price: 95, qty: 5 },
      { id: 'b', price: 90, qty: 5 },
    ],
    targets: [{ id: 't', price: 110, qty: 10 }],
  }
  const moved = withStopsAtBreakeven(asOrder(order))
  assert.deepEqual(
    moved.stopLosses.map((l) => l.price),
    [100, 100],
  )
  // Targets untouched.
  assert.deepEqual(moved.targets, order.targets)
}

// No stops = pass-through, not a crash.
{
  const order = { id: 'be2', direction: 'long', entryPrice: 100, stopLosses: [], targets: [] }
  const moved = withStopsAtBreakeven(asOrder(order))
  assert.deepEqual(moved.stopLosses, [])
}

// --- trailStops -------------------------------------------------------------------------------
// A synthetic run of rising bars for a long trailing 1×ATR - stop should only ratchet UP, never
// back down when a bar prints a lower high.

{
  const bars = []
  for (let i = 0; i < 30; i++) {
    // Steady uptrend, tight ATR (~1) so numbers stay readable.
    bars.push({
      time: i,
      date: `d${i}`,
      open: 100 + i,
      high: 101 + i,
      low: 99.5 + i,
      close: 100.5 + i,
      volume: 0,
    })
  }
  const order = {
    id: 'tr1',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    entryBarIndex: 0,
    stopLosses: [{ id: 's', price: 95, qty: 10 }],
    targets: [],
    trailing: { atrPeriod: 14, atrMult: 2 },
  }
  const first = trailStops([asOrder(order)], bars.slice(0, 20))
  const later = trailStops(first.orders, bars)
  assert.ok(first.changed, 'first ratchet should raise SL from 95')
  assert.ok(first.orders[0].stopLosses[0].price > 95, 'SL raised')
  assert.ok(later.orders[0].stopLosses[0].price >= first.orders[0].stopLosses[0].price, 'never lowered')
}

// A single bar's dip doesn't lower a prior high's stop - the extreme is the highest high SINCE
// ENTRY, not just this bar's.
{
  const bars = []
  for (let i = 0; i < 20; i++) {
    bars.push({
      time: i,
      date: `d${i}`,
      open: 100 + i,
      high: 101 + i,
      low: 99.5 + i,
      close: 100.5 + i,
      volume: 0,
    })
  }
  // Then one lower bar.
  bars.push({ time: 20, date: 'd20', open: 118, high: 119, low: 117, close: 117.5, volume: 0 })
  const order = {
    id: 'tr2',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    entryBarIndex: 0,
    stopLosses: [{ id: 's', price: 95, qty: 10 }],
    targets: [],
    trailing: { atrPeriod: 14, atrMult: 2 },
  }
  const highBar = trailStops([asOrder(order)], bars.slice(0, 20))
  const dipBar = trailStops(highBar.orders, bars)
  assert.equal(dipBar.orders[0].stopLosses[0].price, highBar.orders[0].stopLosses[0].price)
}

// Short trails the other way: uses lowest low since entry, adds k*ATR (never raises SL).
{
  const bars = []
  for (let i = 0; i < 30; i++) {
    bars.push({
      time: i,
      date: `d${i}`,
      open: 200 - i,
      high: 200.5 - i,
      low: 199 - i,
      close: 199.5 - i,
      volume: 0,
    })
  }
  const order = {
    id: 'tr3',
    status: 'open',
    direction: 'short',
    entryPrice: 200,
    entryBarIndex: 0,
    stopLosses: [{ id: 's', price: 205, qty: 10 }],
    targets: [],
    trailing: { atrPeriod: 14, atrMult: 2 },
  }
  const trailed = trailStops([asOrder(order)], bars)
  assert.ok(trailed.orders[0].stopLosses[0].price < 205, 'short SL trailed DOWN from 205')
}

// An order without a `trailing` config is untouched even in a big move.
{
  const bars = [
    { time: 0, open: 100, high: 200, low: 100, close: 200, volume: 0 },
    { time: 1, open: 200, high: 210, low: 195, close: 205, volume: 0 },
  ]
  const order = {
    id: 'tr4',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    entryBarIndex: 0,
    stopLosses: [{ id: 's', price: 95, qty: 10 }],
    targets: [],
    // No trailing.
  }
  const trailed = trailStops([asOrder(order)], bars)
  assert.equal(trailed.changed, false)
  assert.equal(trailed.orders[0].stopLosses[0].price, 95)
}

// setLegQty - the on-chart pill's editable quantity. The total across one side's legs is what
// matters: raising one leg is fine while the side still fits inside the position, rejected once
// it doesn't, and the two sides are counted independently of each other.
{
  const order = {
    id: 'q1',
    status: 'open',
    direction: 'long',
    quantity: 10,
    entryPrice: 100,
    stopLosses: [{ id: 's1', price: 95, qty: 10 }],
    targets: [
      { id: 't1', price: 110, qty: 4 },
      { id: 't2', price: 120, qty: 4 },
    ],
  }
  // 4 -> 6 keeps the target side at 10, exactly the position size.
  const ok = setLegQty(asOrder(order), 'target', 't1', 6)
  assert.equal(ok.error, undefined)
  assert.equal(ok.order?.targets[0].qty, 6)
  assert.equal(ok.order?.targets[1].qty, 4, 'sibling leg untouched')
  assert.equal(order.targets[0].qty, 4, 'input order not mutated')
  // 7 would put the target side at 11 against a position of 10.
  assert.ok(setLegQty(asOrder(order), 'target', 't1', 7).error, 'over-covering rejected')
  assert.equal(setLegQty(asOrder(order), 'target', 't1', 7).order, undefined)
  // The stop side has its own budget - the full 10 there is fine despite the targets.
  assert.equal(setLegQty(asOrder(order), 'stopLoss', 's1', 10).error, undefined)
  // Junk input.
  assert.ok(setLegQty(asOrder(order), 'target', 't1', 0).error)
  assert.ok(setLegQty(asOrder(order), 'target', 't1', -3).error)
  assert.ok(setLegQty(asOrder(order), 'target', 't1', 2.5).error)
  assert.ok(setLegQty(asOrder(order), 'target', 't1', Number.NaN).error)
  assert.ok(setLegQty(asOrder(order), 'target', 'nope', 2).error)
}

// Order-sizing preference (Settings > Preferences).
{
  const qty = { sizeMode: 'qty', defaultQty: 5, capitalPct: 10 }
  const pct = { sizeMode: 'pctCapital', defaultQty: 5, capitalPct: 10 }
  // Fixed mode ignores balance and price entirely.
  assert.equal(preferredQuantity(qty, 100000, 250), 5)
  assert.equal(preferredQuantity(qty, null, null), 5)
  // 10% of 1,00,000 = 10,000 / 250 = exactly 40.
  assert.equal(preferredQuantity(pct, 100000, 250), 40)
  // Rounds DOWN, never up: 10,000 / 300 = 33.33 shares is 33, not 34 (34 would overspend).
  assert.equal(preferredQuantity(pct, 100000, 300), 33)
  // Never sizes to zero - a budget too small for one share still enters with one.
  assert.equal(preferredQuantity({ ...pct, capitalPct: 0.1 }, 1000, 500), 1)
  // Missing inputs fall back to the fixed quantity rather than refusing to size.
  assert.equal(preferredQuantity(pct, null, 250), 5)
  assert.equal(preferredQuantity(pct, 0, 250), 5)
  assert.equal(preferredQuantity(pct, 100000, null), 5)
  assert.equal(preferredQuantity({ ...pct, capitalPct: 0 }, 100000, 250), 5)
}

console.log('orderEngine.test.js: all assertions passed')

// A filled limit stamps the bar's DATE, not just its index: the index is only meaningful against
// the bars array it filled on, and collecting more history prepends older bars to that array.
// This is what the journal writes as the trade's entry - a missing one used to fall through to
// wall-clock, dating a 2017 replay trade to today.
{
  const pending = {
    id: 'p1',
    status: 'pending',
    direction: 'long',
    quantity: 1,
    entryPrice: 100,
    stopLosses: [],
    targets: [],
    entryBarIndex: null,
    entryDate: null,
  }
  const bar = { date: '2017-05-12', time: '2017-05-12', open: 99, high: 101, low: 98, close: 100.5 }
  const { nextOrders } = processBarForOrders([asOrder(pending)], bar, 7)
  assert.equal(nextOrders[0].status, 'open')
  assert.equal(nextOrders[0].entryDate, '2017-05-12')
  assert.equal(nextOrders[0].entryBarIndex, 7)
}

console.log('orderEngine.test.js: entryDate assertions passed')

// --- size warnings ------------------------------------------------------------------------------
// The case this exists for: Rs 10,000 account, 10% per position, Rs 5,000 a share. The intended
// budget is Rs 1,000, which buys 0.2 shares - so preferredQuantity floors to 1 and the position is
// half the account. Silent before; a warning now.
{
  const settings = { sizeMode: 'pctCapital', capitalPct: 10, defaultQty: 1 }
  const qty = preferredQuantity(settings, 10000, 5000)
  assert.strictEqual(qty, 1, 'one share is the floor, however unaffordable the rule makes it')
  const warnings = sizeWarnings({ quantity: qty, price: 5000, balance: 10000, settings })
  assert.strictEqual(warnings.length, 1, warnings.join(' | '))
  assert.match(warnings[0], /50\.0% of the account/)
  assert.match(warnings[0], /asks for 10%/)
  assert.match(warnings[0], /no smaller size exists/, 'a 1-share position has no smaller alternative')
}

// Rounding up by a few percent is unavoidable and not worth a modal: 10% of 10,000 at Rs 1,100 can
// only be Rs 1,100 or nothing.
{
  const settings = { sizeMode: 'pctCapital', capitalPct: 10, defaultQty: 1 }
  assert.deepStrictEqual(sizeWarnings({ quantity: 1, price: 1100, balance: 10000, settings }), [])
  // ...but past the tolerance it is.
  assert.strictEqual(sizeWarnings({ quantity: 1, price: 1300, balance: 10000, settings }).length, 1)
}

// A hand-typed size in the ticket is judged the same way - the preference is the rule either way,
// and this one is nowhere near a single unaffordable share.
{
  const settings = { sizeMode: 'pctCapital', capitalPct: 10, defaultQty: 1 }
  const warnings = sizeWarnings({ quantity: 40, price: 100, balance: 10000, settings })
  assert.strictEqual(warnings.length, 1)
  assert.match(warnings[0], /40\.0% of the account/)
  assert.ok(!/no smaller size exists/.test(warnings[0]), 'plenty of smaller sizes exist at 40 shares')
}

// Unaffordable outright: both warnings, balance first.
{
  const settings = { sizeMode: 'pctCapital', capitalPct: 10, defaultQty: 1 }
  const warnings = sizeWarnings({ quantity: 3, price: 5000, balance: 10000, settings })
  assert.strictEqual(warnings.length, 2)
  assert.match(warnings[0], /more than the account's whole balance/)
}

// Fixed-quantity sizing sets no budget to breach, so only affordability is checked.
{
  const settings = { sizeMode: 'qty', defaultQty: 1 }
  assert.deepStrictEqual(sizeWarnings({ quantity: 1, price: 5000, balance: 10000, settings }), [])
  assert.strictEqual(sizeWarnings({ quantity: 5, price: 5000, balance: 10000, settings }).length, 1)
}

// No account selected (Bar Replay allows that), or nothing to size: nothing to say, no crash.
assert.deepStrictEqual(sizeWarnings({ quantity: 1, price: 5000, balance: 0, settings: {} }), [])
assert.deepStrictEqual(sizeWarnings({ quantity: 0, price: 5000, balance: 10000, settings: {} }), [])

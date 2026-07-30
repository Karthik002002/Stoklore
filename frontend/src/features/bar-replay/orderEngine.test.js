// Plain assert-based check, no framework - run with `node orderEngine.test.js`. Money-path logic
// (which price a stop-loss/target actually fills at) is exactly the kind of thing that should
// fail loudly if it regresses, especially the gap-through case (see the comment on levelHit in
// orderEngine.js for why it exists).
import assert from 'node:assert'
import { processBarForOrders } from './orderEngine.js'

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
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
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
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
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
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
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
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
  assert.equal(triggeredCloses.length, 0)
}

// A bar that touches (or gaps past) both stop-loss and target - stop-loss wins.
{
  const order = {
    id: '5',
    status: 'open',
    direction: 'long',
    entryPrice: 100,
    stopLosses: [{ id: 'l1', price: 95, qty: 5 }],
    targets: [{ id: 't1', price: 105, qty: 5 }],
  }
  const bar = { open: 100, high: 106, low: 94, close: 96 }
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
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
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
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
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
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
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
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
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
  assert.equal(triggeredCloses.length, 2)
  assert.deepEqual(triggeredCloses.map((c) => c.leg.id).sort(), ['far', 'near'])
  triggeredCloses.forEach((c) => assert.equal(c.exitPrice, 120))
}

console.log('orderEngine.test.js: all assertions passed')

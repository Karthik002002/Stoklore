// Plain assert-based check, no framework - run with `node orderEngine.test.js`. Money-path logic
// (which price a stop-loss/target actually fills at) is exactly the kind of thing that should
// fail loudly if it regresses, especially the gap-through case (see the comment on levelHit in
// orderEngine.js for why it exists).
import assert from 'node:assert'
import { processBarForOrders } from './orderEngine.js'

// Normal touch - the bar's range includes the stop-loss level itself.
{
  const order = { id: '1', status: 'open', direction: 'long', stopLoss: 95, target: 110 }
  const bar = { open: 98, high: 99, low: 94, close: 96 }
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'stop_loss')
  assert.equal(triggeredCloses[0].exitPrice, 95)
}

// Gapped clean through a long's stop-loss (whole bar below it, never touched) - fills at the
// bar's open instead of the stale stop-loss price.
{
  const order = { id: '2', status: 'open', direction: 'long', stopLoss: 991.78, target: 1106.3 }
  const bar = { open: 940, high: 955, low: 920, close: 925.71 }
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'stop_loss')
  assert.equal(triggeredCloses[0].exitPrice, 940)
}

// Gapped clean through a short's target (whole bar below it) - fills at the bar's open.
{
  const order = { id: '3', status: 'open', direction: 'short', stopLoss: 110, target: 90 }
  const bar = { open: 85, high: 88, low: 80, close: 82 }
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'target')
  assert.equal(triggeredCloses[0].exitPrice, 85)
}

// Bar stays entirely between the levels - no trigger.
{
  const order = { id: '4', status: 'open', direction: 'long', stopLoss: 90, target: 110 }
  const bar = { open: 99, high: 102, low: 98, close: 101 }
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
  assert.equal(triggeredCloses.length, 0)
}

// A bar that touches (or gaps past) both stop-loss and target - stop-loss wins.
{
  const order = { id: '5', status: 'open', direction: 'long', stopLoss: 95, target: 105 }
  const bar = { open: 100, high: 106, low: 94, close: 96 }
  const { triggeredCloses } = processBarForOrders([order], bar, 0)
  assert.equal(triggeredCloses.length, 1)
  assert.equal(triggeredCloses[0].reason, 'stop_loss')
}

console.log('orderEngine.test.js: all assertions passed')

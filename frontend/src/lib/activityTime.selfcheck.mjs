// Self-check for the local activity-time ledger. Plain node, no framework:
//   node src/lib/activityTime.selfcheck.mjs
import assert from 'node:assert/strict'
import { addSeconds, dayKey, markSynced, pendingSync, prune, secondsOn } from './activityTime.js'

// --- day keys -----------------------------------------------------------------------------------
// Local, not UTC: an 11pm session belongs to the evening it happened in, not to tomorrow.
const late = new Date(2026, 7, 23, 23, 30)
assert.equal(dayKey(late), '2026-08-23')
assert.equal(dayKey(new Date(2026, 0, 5, 9, 0)), '2026-01-05', 'single-digit month and day are padded')

// --- accumulating -------------------------------------------------------------------------------
let store = {}
store = addSeconds(store, '2026-08-23', 20)
store = addSeconds(store, '2026-08-23', 20)
assert.equal(secondsOn(store, '2026-08-23'), 40)
assert.equal(secondsOn(store, '2026-08-22'), 0, 'a day never counted reads as zero, not undefined')

// A clock jumping backwards produces a negative delta; it must not eat the day's total.
const guarded = addSeconds(store, '2026-08-23', -500)
assert.equal(secondsOn(guarded, '2026-08-23'), 40)
assert.equal(secondsOn(addSeconds(store, '2026-08-23', Number.NaN), '2026-08-23'), 40)

// --- syncing ------------------------------------------------------------------------------------
const first = pendingSync(store)
assert.deepEqual(first, [{ date: '2026-08-23', seconds: 40 }])

// The whole point of the rewrite: time keeps being counted while the request is in flight, and
// confirming the 40 must not swallow the 15 that arrived after it was sent.
let racing = addSeconds(store, '2026-08-23', 15)
racing = markSynced(racing, first)
assert.deepEqual(pendingSync(racing), [{ date: '2026-08-23', seconds: 15 }])

// A failed sync is a no-op - nothing is marked, so the backlog is still there for the next flush.
assert.deepEqual(pendingSync(store), first, 'not calling markSynced leaves the backlog intact')

// Fully caught up: nothing to send, and no empty request made.
assert.deepEqual(pendingSync(markSynced(store, first)), [])

// Per DAY, oldest first - a backlog built up overnight lands on the day it was spent rather than
// all going to whenever the sync finally succeeded.
let spanning = addSeconds(addSeconds({}, '2026-08-24', 30), '2026-08-23', 90)
assert.deepEqual(pendingSync(spanning), [
  { date: '2026-08-23', seconds: 90 },
  { date: '2026-08-24', seconds: 30 },
])
spanning = markSynced(spanning, [{ date: '2026-08-23', seconds: 90 }])
assert.deepEqual(pendingSync(spanning), [{ date: '2026-08-24', seconds: 30 }], 'partial confirms are fine')

// Confirming more than was ever counted can't push synced past total (and so can't make the
// backlog go negative and start subtracting from a later day's send).
const overshoot = markSynced(store, [{ date: '2026-08-23', seconds: 999 }])
assert.equal(overshoot['2026-08-23'].synced, 40)
assert.deepEqual(pendingSync(overshoot), [])

// A day the store never heard of is ignored rather than invented.
assert.deepEqual(markSynced(store, [{ date: '2020-01-01', seconds: 10 }]), store)

// --- pruning ------------------------------------------------------------------------------------
const old = { '2026-08-01': { total: 60, synced: 60 }, '2026-08-23': { total: 40, synced: 0 } }
const kept = prune(old, '2026-08-23')
assert.deepEqual(Object.keys(kept), ['2026-08-23'], 'three weeks back is dropped')
assert.deepEqual(
  Object.keys(prune(old, '2026-08-05')),
  ['2026-08-01', '2026-08-23'],
  'inside the window, kept',
)

console.log('ok - activityTime: local day keys, accumulation, sync backlog, pruning')

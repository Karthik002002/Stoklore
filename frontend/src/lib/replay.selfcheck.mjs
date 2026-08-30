// Self-check for the Bar Replay pure helpers. Plain node, no test framework:
//   node src/lib/replay.selfcheck.mjs
import assert from 'node:assert/strict'
import { aggregateBars, elapsedLabel, measureRange } from './replay.ts'

const daily = (date, close, volume = 1000) => ({
  date,
  time: date,
  open: close,
  high: close,
  low: close,
  close,
  volume,
})

// --- aggregateBars ------------------------------------------------------------------------------
const week = [daily('2026-01-05', 100), daily('2026-01-06', 110), daily('2026-01-12', 120)]
const weekly = aggregateBars(week, '1W')
assert.equal(weekly.length, 2, 'Mon 5th and Tue 6th are one ISO week, the 12th starts the next')
assert.equal(weekly[0].close, 110)
assert.equal(weekly[0].volume, 2000, 'volume sums within a bucket')
assert.deepEqual(aggregateBars(week, '1D'), week, '1D passes straight through')

// --- elapsed ------------------------------------------------------------------------------------
assert.equal(elapsedLabel(17 * 86400000), '17d')
assert.equal(elapsedLabel(-2 * 86400000), '2d', 'measuring right-to-left reads the same')
assert.equal(elapsedLabel(90 * 60000), '1h 30m')
assert.equal(elapsedLabel(45 * 60000), '45m')
assert.equal(elapsedLabel(null), null)

// --- measureRange -------------------------------------------------------------------------------
const bars = [daily('2026-03-02', 100, 500), daily('2026-03-03', 105, 700), daily('2026-03-04', 110, 900)]

const up = measureRange(bars, { index: 0, price: 100 }, { index: 2, price: 112.5 })
assert.equal(up.change, 12.5)
assert.equal(up.pct, 12.5)
assert.equal(up.bars, 3, 'inclusive - three candles are covered')
assert.equal(up.volume, 2100)
assert.equal(up.elapsed, '2d')
assert.equal(up.up, true)

// Dragged right-to-left and downwards: the change is signed off the FIRST anchor, but bars, volume
// and elapsed don't care which end was clicked first.
const down = measureRange(bars, { index: 2, price: 110 }, { index: 0, price: 99 })
assert.equal(down.change, -11)
assert.equal(down.up, false)
assert.equal(down.bars, 3)
assert.equal(down.volume, 2100)
assert.equal(down.elapsed, '2d')

// Prices come from the anchors, never from the candles underneath - measuring to a level that no
// bar closed at is the normal case.
assert.equal(measureRange(bars, { index: 0, price: 50 }, { index: 1, price: 75 }).change, 25)

// The replay chart keeps empty space to the right of the last bar. An anchor dropped in it clamps
// to the last real candle instead of counting phantom bars or summing undefined volume.
const past = measureRange(bars, { index: 1, price: 105 }, { index: 40, price: 105 })
assert.equal(past.bars, 2)
assert.equal(past.volume, 1600)
assert.equal(past.pct, 0)

// A single bar reads as one bar and no time elapsed, not as an error.
const dot = measureRange(bars, { index: 1, price: 105 }, { index: 1, price: 105 })
assert.equal(dot.bars, 1)
assert.equal(dot.elapsed, '0m')

// No data at all: still answers about price, says nothing about bars it never had.
const empty = measureRange([], { index: 0, price: 100 }, { index: 5, price: 110 })
assert.equal(empty.change, 10)
assert.equal(empty.bars, 0)
assert.equal(empty.volume, null)
assert.equal(empty.elapsed, null)

console.log('ok - replay: aggregateBars, elapsed labels, measure readings')

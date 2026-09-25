// node src/lib/engine.selfcheck.mjs
import assert from 'node:assert/strict'
import { comboCount, drawdown, markerRange, parseValues, sweepGrid, tradeMarkers } from './engine.ts'

assert.deepEqual(parseValues('9'), [9])
assert.deepEqual(parseValues(' 5, 9 ,13,9 '), [5, 9, 13])
assert.deepEqual(parseValues('5:20:5'), [5, 10, 15, 20])
assert.deepEqual(parseValues('0.1:0.3:0.1'), [0.1, 0.2, 0.3])
assert.deepEqual(parseValues('3, 10:12:1'), [3, 10, 11, 12])
assert.deepEqual(parseValues(''), [])
assert.equal(parseValues('a'), null)
assert.equal(parseValues('5:1:1'), null)
assert.equal(parseValues('1:5:0'), null)
assert.equal(comboCount([[1, 2, 3], [4, 5], []]), 6)

const runs = [
  { id: 'a', params: { fast: 5, slow: 21 } },
  { id: 'b', params: { fast: 9, slow: 21 } },
  { id: 'c', params: { fast: 5, slow: 34 } },
]
const g = sweepGrid(runs, 'fast', 'slow')
assert.deepEqual(g.rows, [5, 9])
assert.deepEqual(g.cols, [21, 34])
assert.equal(g.cell(5, 34)[0].id, 'c')
assert.deepEqual(g.cell(9, 34), [])
assert.deepEqual(sweepGrid(runs, 'fast').cols, [0])

assert.deepEqual(
  drawdown([
    [1, 0],
    [2, 100],
    [3, 40],
    [4, 120],
    [5, -10],
  ]).map((p) => p[1]),
  [0, 0, -60, 0, -130],
)
// --- trade markers ---------------------------------------------------------------------------
const C = { up: 'green', down: 'red' }
// [symbol, entry, exit, signed qty, entry px, exit px, pnl]
const long = ['INFY', 100, 200, 5, 10, 12, 10]
const short = ['INFY', 300, 400, -5, 12, 13, -5]
const other = ['RELIANCE', 150, 250, 1, 9, 9, 0]

const m = tradeMarkers([long, short, other], 'INFY', C)
assert.equal(m.length, 4, 'two markers per trade, and only this symbol')
assert.deepEqual(
  m.map((x) => [x.time, x.shape, x.position, x.color, x.text]),
  [
    [100, 'arrowUp', 'belowBar', 'green', 'B 5'], // long entry: up, from under the bar
    [200, 'arrowDown', 'aboveBar', 'green', '+10'], // its exit: mirrored, green because it won
    [300, 'arrowDown', 'aboveBar', 'red', 'S 5'], // short entry: down, from above
    [400, 'arrowUp', 'belowBar', 'red', '-5'], // its exit: red because it lost
  ],
)
// A losing long still shows a green entry (that is what was done) and a red exit (how it went).
assert.deepEqual(
  tradeMarkers([['INFY', 1, 2, 1, 10, 9, -1]], 'INFY', C).map((x) => x.color),
  ['green', 'red'],
)
// A flat trade counts as won rather than lost - it did not cost anything.
assert.equal(tradeMarkers([['INFY', 1, 2, 1, 10, 10, 0]], 'INFY', C)[1].color, 'green')
// Only the most recent `limit` trades are marked, and markers come back in time order.
const many = Array.from({ length: 10 }, (_, i) => ['INFY', i * 10, i * 10 + 5, 1, 1, 1, 1])
const capped = tradeMarkers(many, 'INFY', C, 3)
assert.equal(capped.length, 6)
assert.equal(capped[0].time, 70, 'the last three trades, not the first')
assert.deepEqual(
  [...capped].sort((a, b) => a.time - b.time),
  capped,
)
assert.deepEqual(tradeMarkers([other], 'INFY', C), [], 'no trades for this symbol')

// The opening window covers the marks with a margin, and is null when there is nothing to frame.
assert.equal(markerRange([]), null)
const r = markerRange(m)
assert.ok(r.from < 100 && r.to > 400, JSON.stringify(r))
// Margin never collapses to zero on a single-instant range, which would be an unusable window.
const tiny = markerRange(tradeMarkers([['INFY', 5, 5, 1, 1, 1, 1]], 'INFY', C))
assert.ok(tiny.to - tiny.from >= 120, JSON.stringify(tiny))

console.log('engine selfcheck passed')

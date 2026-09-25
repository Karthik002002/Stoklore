// node src/lib/engine.selfcheck.mjs
import assert from 'node:assert/strict'
import {
  fanPaths,
  histogram,
  noTrades,
  oatSeries,
  runSheets,
  runsSheet,
  sweepSheets,
  SUMMARY_COLUMNS,
  spread,
  sweepCount,
  comboCount,
  drawdown,
  markerRange,
  parseValues,
  sweepGrid,
  tradeMarkers,
} from './engine.ts'

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

assert.equal(
  sweepCount('oat', [
    { values: [5, 9, 13], base: 9 },
    { values: [21, 34], base: 21 },
    { values: [1], base: 1 },
  ]),
  4,
)
assert.equal(sweepCount('oat', [{ values: [5, 13], base: 9 }]), 3)
assert.equal(
  sweepCount('grid', [
    { values: [5, 9, 13], base: 9 },
    { values: [21, 34], base: 21 },
  ]),
  6,
)
assert.equal(sweepCount('grid', [{ values: [1], base: 1 }]), 0)
const oat = [
  { params: { fast: 9, slow: 21 }, axis: '' },
  { params: { fast: 5, slow: 21 }, axis: 'fast' },
  { params: { fast: 13, slow: 21 }, axis: 'fast' },
  { params: { fast: 9, slow: 34 }, axis: 'slow' },
]
const series = oatSeries(oat, ['fast', 'slow'])
assert.deepEqual(
  series[0].points.map((p) => [p.value, p.isBase]),
  [
    [5, false],
    [9, true],
    [13, false],
  ],
)
assert.deepEqual(
  series[1].points.map((p) => p.value),
  [21, 34],
)
assert.equal(spread([3, -2, 7]), 9)
assert.equal(spread([]), 0)
// exports
const sum = {
  net: 50,
  gross: 60,
  costs: 10,
  trades: 2,
  sharpe: 1.5,
  max_dd: 20,
  from: 1718104500,
  to: 1718190900,
}
const run = {
  id: 'bt-1',
  source: 'backtest',
  strategy: 'ema_cross',
  label: null,
  symbols: ['TCS'],
  interval: '5m',
  params: { fast: 9 },
  summary: sum,
  created: '2026-09-25',
  trades: [['TCS', 1718104500, 1718106300, -3, 100, 90, 30]],
  daily: [
    [1718064000, 30],
    [1718150400, 20],
  ],
  by_symbol: { TCS: { pnl: 30, trades: 1 } },
  equity: [
    [1718104500, 0],
    [1718106300, 30],
    [1718190900, 10],
  ],
}
const rs = runSheets(run)
assert.deepEqual(
  rs.map((x) => x.sheet),
  ['Summary', 'Trades', 'Daily', 'By symbol', 'Equity'],
)
assert.deepEqual(rs[1].rows[0], ['TCS', 'Short', 3, '2024-06-11 11:15', 100, '2024-06-11 11:45', 90, 30, 30])
assert.deepEqual(
  rs[2].rows.map((r) => r[2]),
  [30, 50],
)
assert.deepEqual(
  rs[4].rows.map((r) => r[2]),
  [0, 0, -20],
)
assert.ok(rs[0].rows.some((r) => r[0] === 'param: fast' && r[1] === 9))
const list = runsSheet([run])
assert.equal(list.headers.length, list.rows[0].length)
assert.equal(list.rows[0][list.headers.indexOf('Net P&L')], 50)
assert.equal(list.rows[0][list.headers.indexOf('Profit factor')], null, 'older runs lack new metrics')
const sw = {
  id: 'sw-1',
  mode: 'oat',
  strategy: 'ema_cross',
  label: null,
  symbols: ['TCS'],
  interval: '5m',
  cost_bps: 3,
  base: { fast: 9, qty: 1 },
  axes: { fast: [5, 13] },
  created: '2026-09-25',
  runs: [
    { params: { fast: 9, qty: 1 }, axis: '', summary: { net: 10 } },
    { params: { fast: 5, qty: 1 }, axis: 'fast', summary: { net: -5 } },
    { params: { fast: 13, qty: 1 }, axis: 'fast', summary: { net: 40 } },
  ],
}
const ss = sweepSheets(sw)
assert.deepEqual(
  ss.map((x) => x.sheet),
  ['Sweep', 'Runs', 'Impact'],
)
assert.deepEqual(ss[1].headers.slice(0, 3), ['Varies', 'fast', 'qty'])
assert.deepEqual(
  ss[1].rows.map((r) => r[0]),
  ['base', 'fast', 'fast'],
)
assert.deepEqual(ss[2].rows[0].slice(0, 5), ['fast', 9, 3, 13, 45])
assert.deepEqual(
  sweepSheets({ ...sw, mode: 'grid' }).map((x) => x.sheet),
  ['Sweep', 'Runs'],
)
assert.equal(SUMMARY_COLUMNS.length, 15)

// --- multi-run views -------------------------------------------------------------------------
assert.equal(noTrades({ trades: 0 }), true, 'a run that took no trades is not a result')
assert.equal(noTrades({}), true, 'missing is dead too')
assert.equal(noTrades({ trades: 8 }), false)

const h = histogram([0, 1, 2, 3, 4, 10], 5)
assert.deepEqual([h.lo, h.hi, h.width], [0, 10, 2])
assert.deepEqual(h.counts, [2, 2, 1, 0, 1], 'the top value lands in the last bin, not past it')
assert.deepEqual(histogram([], 5).counts, [])
assert.deepEqual(histogram([7, 7, 7], 4).counts, [3, 0, 0, 0], 'a flat set does not divide by zero')

// two runs of different length still span the full width, on one shared scale (0 always included)
const fan = fanPaths(
  [
    [0, 10],
    [0, -5, 5],
  ],
  100,
  100,
)
assert.deepEqual([fan.lo, fan.hi, fan.zero], [-5, 10, 100 - (5 / 15) * 100])
assert.deepEqual(
  fan.paths[0].split(' ').map((p) => p.split(',')[0]),
  ['0', '100'],
)
assert.deepEqual(
  fan.paths[1].split(' ').map((p) => p.split(',')[0]),
  ['0', '50', '100'],
)
assert.equal(fanPaths([[1]]).paths[0], '', 'one point is not a curve')

console.log('engine selfcheck passed')

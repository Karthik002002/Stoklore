// node src/lib/engine.selfcheck.mjs
import assert from 'node:assert/strict'
import { comboCount, drawdown, parseValues, sweepGrid } from './engine.ts'

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
console.log('engine selfcheck passed')

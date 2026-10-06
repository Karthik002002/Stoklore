// node src/lib/sortRows.selfcheck.mjs
import assert from 'node:assert/strict'
import { nextSort, sortRows } from './sortRows.ts'

const rows = [
  { s: 'TCS', p: 3.2 },
  { s: 'infy', p: null },
  { s: 'HDFC', p: -1 },
  { s: 'abb', p: 3.2 },
  { s: 'NIFTY 100', p: Number.NaN },
  { s: 'NIFTY 50', p: 0 },
]
const get = { s: (r) => r.s, p: (r) => r.p }
const syms = (out) => out.map((r) => r.s)

assert.deepEqual(sortRows(rows, null, get), rows, 'no sort = given order')
assert.deepEqual(syms(sortRows(rows, { key: 'p', dir: 'desc' }, get)), ['TCS', 'abb', 'NIFTY 50', 'HDFC', 'infy', 'NIFTY 100'])
// missing still last when ascending; ties keep their original order
assert.deepEqual(syms(sortRows(rows, { key: 'p', dir: 'asc' }, get)), ['HDFC', 'NIFTY 50', 'TCS', 'abb', 'infy', 'NIFTY 100'])
// case-insensitive, number-aware text
assert.deepEqual(syms(sortRows(rows, { key: 's', dir: 'asc' }, get)), ['abb', 'HDFC', 'infy', 'NIFTY 50', 'NIFTY 100', 'TCS'])
assert.deepEqual(sortRows(rows, { key: 'nope', dir: 'asc' }, get), rows, 'unknown column = given order')
assert.equal(rows[0].s, 'TCS', 'input not mutated')

assert.deepEqual(nextSort(null, 'p', 'desc'), { key: 'p', dir: 'desc' })
assert.deepEqual(nextSort({ key: 'p', dir: 'desc' }, 'p', 'desc'), { key: 'p', dir: 'asc' })
assert.equal(nextSort({ key: 'p', dir: 'asc' }, 'p', 'desc'), null, 'third click = original order')
assert.deepEqual(nextSort({ key: 'p', dir: 'asc' }, 's', 'asc'), { key: 's', dir: 'asc' })
console.log('ok - sortRows: numbers, text, missing last, stable, three-state header clicks')

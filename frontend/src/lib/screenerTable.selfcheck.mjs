// Self-check for the screener cell reader. Plain asserts, no framework, no DOM:
//
//     node frontend/src/lib/screenerTable.selfcheck.mjs
//
// The case worth pinning is the em dash: screener writes an absent quarter as "—", and reading it
// as 0 would print a 75-point collapse under a holding that simply wasn't filed.
import assert from 'node:assert/strict'
import { cellChange, cellNumber } from './screenerTable.ts'

assert.equal(cellNumber('74.90%'), 74.9)
assert.equal(cellNumber('1,02,345'), 102345)
assert.equal(cellNumber('-2,145'), -2145)
assert.equal(cellNumber('₹ 590'), 590)
assert.equal(cellNumber('—'), null, 'an em dash is a missing quarter, not zero')
assert.equal(cellNumber(''), null)
assert.equal(cellNumber(null), null)

assert.deepEqual(cellChange('30.53%', '26.89%'), { text: '+3.64%', up: true })
assert.deepEqual(cellChange('26.89%', '30.53%'), { text: '−3.64%', up: false })
assert.equal(cellChange('74.90%', '74.90%'), null, 'a flat quarter says nothing')
assert.equal(cellChange('74.90%', '74.899%'), null, 'below what two decimals can show')
assert.deepEqual(cellChange('60,164', '60,670'), { text: '−506', up: false })
assert.equal(cellChange('—', '74.90%'), null, 'no quarter, no change')
assert.equal(cellChange('74.90%', '—'), null)
assert.deepEqual(cellChange('0.00%', '0.01%'), { text: '−0.01%', up: false })

console.log('all checks passed')

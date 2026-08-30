// node frontend/src/lib/exportFile.selfcheck.mjs
// Checks the hand-rolled xlsx zip against a real zip reader (unzip -t verifies every CRC), and
// that the sheet carries the values that went in. Numbers must land as numbers, not text.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mdTable, xlsxBlob } from './exportFile.ts'

const blob = xlsxBlob({
  sheet: 'Trades',
  headers: ['Symbol', 'Net P&L', 'Notes'],
  rows: [
    ['TCS', -1234.5, 'a & b <tag>'],
    ['INFY', 0, ''],
  ],
})

const file = join(tmpdir(), 'exportFile.selfcheck.xlsx')
writeFileSync(file, Buffer.from(await blob.arrayBuffer()))

execFileSync('unzip', ['-t', file])
const sheet = execFileSync('unzip', ['-p', file, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' })

assert.match(sheet, /<c r="A1" t="inlineStr"><is><t xml:space="preserve">Symbol<\/t>/)
assert.match(sheet, /<c r="B2"><v>-1234.5<\/v><\/c>/, 'numbers must be numeric cells')
assert.match(sheet, /a &amp; b &lt;tag&gt;/, 'XML must be escaped')
assert.match(sheet, /<c r="B3"><v>0<\/v><\/c>/, 'zero is a value, not a blank')
assert.doesNotMatch(sheet, /r="C3"/, 'empty cells are omitted')

assert.equal(mdTable(['A', 'B'], [['x|y', null]]), '| A | B |\n| --- | --- |\n| x\\|y | — |')

console.log('exportFile selfcheck PASSED')

// node frontend/src/lib/exportFile.selfcheck.mjs
// Checks the hand-rolled xlsx zip against a real zip reader (unzip -t verifies every CRC), and
// that the sheet carries the values that went in. Numbers must land as numbers, not text.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { csvText, mdTable, xlsxBlob } from './exportFile.ts'

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

// several sheets: every part present, names cleaned and made unique
const multi = join(tmpdir(), 'exportFile.selfcheck.multi.xlsx')
const book = xlsxBlob([
  { sheet: 'Summary', headers: ['k', 'v'], rows: [['net', 5]] },
  { sheet: 'Trades/All', headers: ['s'], rows: [['TCS']] },
  { sheet: 'summary', headers: ['x'], rows: [] },
])
writeFileSync(multi, Buffer.from(await book.arrayBuffer()))
execFileSync('unzip', ['-t', multi])
const wb = execFileSync('unzip', ['-p', multi, 'xl/workbook.xml'], { encoding: 'utf8' })
assert.deepEqual(
  [...wb.matchAll(/name="([^"]+)"/g)].map((m) => m[1]),
  ['Summary', 'Trades All', 'summary 3'],
)
assert.match(execFileSync('unzip', ['-p', multi, 'xl/worksheets/sheet2.xml'], { encoding: 'utf8' }), /TCS/)
assert.match(
  execFileSync('unzip', ['-p', multi, '\\[Content_Types].xml'], { encoding: 'utf8' }),
  /sheet3\.xml/,
)

assert.equal(
  csvText({
    headers: ['a', 'b', 'c'],
    rows: [
      ['x,y', 'say "hi"', -1.5],
      [null, 0, 'line\nbreak'],
    ],
  }),
  '\ufeffa,b,c\r\n"x,y","say ""hi""",-1.5\r\n,0,"line\nbreak"\r\n',
)

console.log('exportFile selfcheck PASSED')

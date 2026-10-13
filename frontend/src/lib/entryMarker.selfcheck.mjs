// node src/lib/entryMarker.selfcheck.mjs
import assert from 'node:assert/strict'
import { barOfFill } from './entryMarker.ts'

const utc = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000
// a fill at 10:15 IST on 6 Oct
const fill = '2026-10-06T10:15:00+05:30'

// Yahoo daily: sessions at 00:00 on the chart clock
const yahoo = [5, 6, 7].map((d) => ({ time: utc(2026, 10, d) }))
assert.equal(barOfFill(yahoo, fill), yahoo[1])

// price_history daily: sessions at IST midnight as a plain instant (18:30 UTC the day before)
const db = [5, 6, 7].map((d) => ({ time: utc(2026, 10, d) - 19800 }))
assert.equal(barOfFill(db, fill), db[1])

// intraday 15m on the chart clock: 10:15 IST is its own bar, 10:20 falls in it too
const m15 = [0, 15, 30].map((m) => ({ time: utc(2026, 10, 6, 10, m) }))
assert.equal(barOfFill(m15, fill), m15[1])
assert.equal(barOfFill(m15, '2026-10-06T10:20:00+05:30'), m15[1])

// day-keyed bars
const days = [{ time: '2026-10-05' }, { time: '2026-10-06' }, { time: '2026-10-07' }]
assert.equal(barOfFill(days, fill), days[1])
// a weekend fill lands on the last session before it
assert.equal(barOfFill(days, '2026-10-10T11:00:00+05:30'), days[2])

// before the first bar, or nothing to place
assert.equal(barOfFill(yahoo, '2026-09-01T10:00:00+05:30'), null)
assert.equal(barOfFill(yahoo, null), null)
assert.equal(barOfFill([], fill), null)
console.log('ok - entry marker: Yahoo, price_history and intraday stamps, day keys, out of range')

// node mobile/check.mjs - asserts on assets/lib.js (the app's pure data + maths). No network.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const L = createRequire(import.meta.url)('./assets/lib.js')

// heat: themed, deeper with the move, readable text on top
const dark = L.resolveTheme('terminal-dark'), mono = L.resolveTheme('mono-dark')
assert.notEqual(L.heat(3, dark.colors).bg, L.heat(-3, dark.colors).bg)
assert.notEqual(L.heat(1, dark.colors).bg, L.heat(4, dark.colors).bg)
assert.equal(L.heat(4, dark.colors).bg, L.heat(9, dark.colors).bg) // saturates at ±4%
assert.equal(L.heat(4, mono.colors).fg, '#0b0b0b') // near-white fill -> dark text
assert.ok(!/34, 197, 94|239, 68, 68/.test(L.heat(2, mono.colors).bg)) // no hard-coded green/red left

// themes: every preset has every token; custom overrides only valid hex over its base
for (const t of L.THEMES) for (const [k] of L.THEME_TOKENS) assert.ok(L.isHex(t.colors[k]), `${t.id}.${k}`)
const c = L.resolveTheme('custom', { base: 'mono-light', colors: { up: '#3b82f6', down: 'nope' } })
assert.equal(c.colors.up, '#3b82f6'); assert.equal(c.colors.down, L.resolveTheme('mono-light').colors.down); assert.equal(c.mode, 'light')
assert.equal(L.resolveTheme('missing').id, 'terminal-dark')

// movers: cap buckets by mcap rank, direction, size
const sectors = [{ members: Array.from({ length: 300 }, (_, i) => ({ id: i, mcap_cr: 1e6 - i, change_pct: (i % 7) - 3 })) }]
const all = L.allStocks(sectors)
assert.equal(all[99].cap, 'large'); assert.equal(all[100].cap, 'mid'); assert.equal(all[250].cap, 'small')
const g = L.movers(all, 'mid', 'gainers', 5)
assert.equal(g.length, 5); assert.ok(g.every((m) => m.cap === 'mid' && m.change_pct === 3))
assert.ok(L.movers(all, 'all', 'losers').every((m) => m.change_pct < 0))

// bars: bad rows dropped, 1D keeps the last IST session only
const day1 = Date.UTC(2026, 10, 25, 4) / 1000, day2 = Date.UTC(2026, 10, 26, 4) / 1000
const j = { s: 'ok', t: [day1, day2, day2 + 300, day2 + 600], o: [1, 2, 3, null], h: [1, 2, 3, 4], l: [1, 2, 3, 4], c: [1, 2, 3, 4], v: [1, 1, 1, 1] }
assert.equal(L.mcBars(j, '1M').length, 3)
assert.deepEqual(L.mcBars(j, '1D').map((b) => b.t), [day2, day2 + 300])
assert.deepEqual(L.mcBars({ s: 'no_data' }, '1D'), [])

// axis ticks: round steps inside the range
assert.deepEqual(L.ticks(101, 139, 4), [110, 120, 130])
assert.deepEqual(L.ticks(5, 5), [5])
console.log('mobile/check.mjs: all passed')

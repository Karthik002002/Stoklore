// Self-check for the treemap layout. Plain node, no framework:
//   node src/components/charts/squarify.selfcheck.mjs
import assert from 'node:assert/strict'
import { squarify } from './squarify.ts'

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b))
const byKey = (tiles) => Object.fromEntries(tiles.map((t) => [t.item.key, t]))

// Areas are proportional to size, and the tiles exactly cover the rectangle.
const items = [
  { key: 'TCS', size: 6 },
  { key: 'INFY', size: 6 },
  { key: 'RAIN', size: 4 },
  { key: 'BEL', size: 3 },
  { key: 'VBL', size: 2 },
  { key: 'DOMS', size: 2 },
  { key: 'NPST', size: 1 },
]
const W = 600
const H = 400
const tiles = squarify(items, (i) => i.size, W, H)
assert.equal(tiles.length, items.length)
const total = items.reduce((s, i) => s + i.size, 0)
for (const t of tiles) {
  assert.ok(close(t.w * t.h, (t.item.size / total) * W * H), `${t.item.key} area is its share`)
  assert.ok(
    t.x >= -1e-9 && t.y >= -1e-9 && t.x + t.w <= W + 1e-6 && t.y + t.h <= H + 1e-6,
    `${t.item.key} stays inside`,
  )
}
assert.ok(
  close(
    tiles.reduce((s, t) => s + t.w * t.h, 0),
    W * H,
  ),
  'the tiles cover the whole panel',
)

// No two tiles overlap.
for (let i = 0; i < tiles.length; i++) {
  for (let j = i + 1; j < tiles.length; j++) {
    const a = tiles[i]
    const b = tiles[j]
    const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    assert.ok(overlapW <= 1e-6 || overlapH <= 1e-6, `${a.item.key} and ${b.item.key} don't overlap`)
  }
}

// Squarified: no sliver - the worst aspect ratio stays modest for a spread like this.
const worst = Math.max(...tiles.map((t) => Math.max(t.w / t.h, t.h / t.w)))
assert.ok(worst < 4, `tiles stay near-square (worst ${worst.toFixed(2)})`)

// Four equal items in a square are four equal quarters.
const quarters = squarify(
  [1, 2, 3, 4].map((k) => ({ key: k, size: 1 })),
  (i) => i.size,
  100,
  100,
)
for (const t of quarters) assert.ok(close(t.w, 50) && close(t.h, 50), 'equal tiles in a square are quarters')

// Nothing to lay out is an empty layout, not a crash.
assert.deepEqual(
  squarify([], (i) => i.size, 100, 100),
  [],
)
assert.deepEqual(
  squarify([{ key: 'a', size: 5 }], (i) => i.size, 0, 100),
  [],
  'an unmeasured panel draws nothing yet',
)
assert.deepEqual(
  squarify(
    [
      { key: 'a', size: 0 },
      { key: 'b', size: -3 },
    ],
    (i) => i.size,
    100,
    100,
  ),
  [],
  'no positive size, no tiles',
)
assert.equal(
  byKey(squarify([{ key: 'a', size: 5 }], (i) => i.size, 80, 40)).a.w,
  80,
  'one tile fills the panel',
)

console.log('ok - squarify: proportional areas, full coverage, no overlap, near-square, edge cases')

// node src/lib/dock.selfcheck.mjs
import assert from 'node:assert/strict'
import { dockLayout } from './dock.ts'

// a strip like the sector rows: a few giants, then a long tail of slivers
const weights = [400, 120, 80, 50, 30, ...Array.from({ length: 35 }, (_, i) => 10 - i * 0.2)]
const W = 560

const centreOf = (widths, i) => widths.slice(0, i).reduce((a, b) => a + b, 0) + widths[i] / 2

// at rest: no swell, the weights pass through
const rest = dockLayout(weights, null, W)
assert.equal(rest.focus, -1)
assert.ok(rest.swell.every((g) => g === 0))

for (const x of [40, 300, 420, 470, 520, 555]) {
  const { widths, swell, focus } = dockLayout(weights, x, W)
  assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - W) < 1e-6, 'fills the strip exactly')
  // the most-swollen segment is the one under the pointer, and it sits where the pointer is
  const top = swell.indexOf(Math.max(...swell))
  assert.ok(Math.abs(top - focus) <= 1, `swell peaks under the pointer at x=${x} (top ${top}, focus ${focus})`)
  assert.ok(Math.abs(centreOf(widths, focus) - x) <= widths[focus] / 2 + 1e-6, `focus contains x=${x}`)
  // a sliver under the pointer is now big enough to hit
  assert.ok(widths[focus] >= 18 || weights[focus] / weights.reduce((a, b) => a + b, 0) * W > 18, `wide enough at x=${x}`)
}
console.log('ok - dock: swell centred under the pointer in the magnified layout, fills the strip, slivers grow')

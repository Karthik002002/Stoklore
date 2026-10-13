// node src/lib/homeLayout.selfcheck.mjs
import assert from 'node:assert/strict'
import { DEFAULT_LAYOUT, HOME_PANELS, useHomeLayout } from './homeLayout.ts'

const st = () => useHomeLayout.getState()
assert.deepEqual(st().layout, DEFAULT_LAYOUT)
assert.ok(HOME_PANELS.every((p) => !p.layout || DEFAULT_LAYOUT[p.id]), 'every grid panel has a default place')

// the grid reports only what's on screen: others keep their place
st().setLayout([{ i: 'indices', x: 6, y: 0, w: 3, h: 11 }])
assert.deepEqual(st().layout.indices, { x: 6, y: 0, w: 3, h: 11 })
assert.deepEqual(st().layout.sectors, DEFAULT_LAYOUT.sectors)

// an unchanged report is a no-op (no new object, so no re-render loop)
const before = st().layout
st().setLayout([{ i: 'indices', x: 6, y: 0, w: 3, h: 11 }])
assert.equal(st().layout, before)

st().setHidden('movers', true)
st().setHidden('movers', true)
assert.deepEqual(st().hidden, ['movers'], 'hiding twice is once')
st().setHidden('movers', false)
assert.deepEqual(st().hidden, [])

st().setHidden('ticker', true)
st().reset()
assert.deepEqual([st().layout, st().hidden], [DEFAULT_LAYOUT, []])
console.log('ok - home layout: defaults, merged moves, no-op reports, hide/show, reset')

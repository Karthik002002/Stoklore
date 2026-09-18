// node frontend/src/dashboards/shaped.selfcheck.mjs
import assert from 'node:assert/strict'
import { matchesShape } from './shaped.ts'

const rows = { rows: [], columns: [], total: 0 }
const series = { series: [] }
const aggregate = { items: [{ key: 'a', value: 1, count: 1 }], total: 1 }
const stat = { value: 1, previous: null, change: null, at: null, spark: [] }
const heatmap = { x: [], y: [], cells: [] }
const treemap = { items: [{ key: 'a', size: 1, color: 0, count: 1 }], color_max: 1 }

for (const [shape, data] of [
  ['rows', rows],
  ['timeseries', series],
  ['aggregate', aggregate],
  ['stat', stat],
  ['heatmap', heatmap],
  ['treemap', treemap],
]) {
  assert.equal(matchesShape(shape, data), true, `${shape} accepts its own data`)
}

// The crash: a table's rows arriving at a heatmap while the new query runs.
assert.equal(matchesShape('heatmap', rows), false, "a heatmap refuses a table's rows")
assert.equal(matchesShape('rows', heatmap), false, "a table refuses a heatmap's cells")
// The pair that share a field name.
assert.equal(matchesShape('treemap', aggregate), false, 'a treemap refuses bar/pie items')
assert.equal(matchesShape('aggregate', treemap), false, 'a bar refuses treemap tiles')
// Nothing to draw yet.
for (const empty of [null, undefined, 'nope', 42]) {
  assert.equal(matchesShape('rows', empty), false, 'only an object can be shaped data')
}

console.log('ok - dashboard panels: every shape accepts its own data and refuses the others')

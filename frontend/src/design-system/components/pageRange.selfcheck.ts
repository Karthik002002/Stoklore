// node src/design-system/components/pageRange.selfcheck.ts
import assert from 'node:assert/strict'
import { pageRange, rangeLabel } from './pageRange.ts'

assert.deepEqual(pageRange(1, 0), [])
assert.deepEqual(pageRange(1, 1), [1])
assert.deepEqual(pageRange(1, 2), [1, 2])
assert.deepEqual(pageRange(1, 5), [1, 2, 3, 4, 5])
assert.deepEqual(pageRange(1, 10), [1, 2, 'gap', 10])
assert.deepEqual(pageRange(5, 10), [1, 'gap', 4, 5, 6, 'gap', 10])
assert.deepEqual(pageRange(10, 10), [1, 'gap', 9, 10])
// a one-page gap shows the page instead
assert.deepEqual(pageRange(4, 10), [1, 2, 3, 4, 5, 'gap', 10])
assert.deepEqual(pageRange(7, 10), [1, 'gap', 6, 7, 8, 9, 10])
// out-of-range pages clamp
assert.deepEqual(pageRange(99, 10), pageRange(10, 10))
assert.deepEqual(pageRange(-3, 10), pageRange(1, 10))
assert.deepEqual(pageRange(50, 100, 2), [1, 'gap', 48, 49, 50, 51, 52, 'gap', 100])
// no duplicates, ascending, ends present
for (let count = 1; count <= 30; count++)
  for (let page = 1; page <= count; page++) {
    const nums = pageRange(page, count).filter((x): x is number => x !== 'gap')
    assert.deepEqual(
      nums,
      [...new Set(nums)].sort((a, b) => a - b),
      `${page}/${count}`,
    )
    assert.ok(nums.includes(1) && nums.includes(count) && nums.includes(page), `${page}/${count} ends`)
  }

assert.equal(rangeLabel(1, 25, 1842), '1–25 of 1,842')
assert.equal(rangeLabel(74, 25, 1842), '1,826–1,842 of 1,842')
assert.equal(rangeLabel(1, 25, 0), '0 of 0')

console.log('pageRange.selfcheck: ok')

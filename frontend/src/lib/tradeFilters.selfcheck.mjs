// Self-check for the trade filter engine. Plain asserts, no framework, no DOM:
//
//     node frontend/src/lib/tradeFilters.selfcheck.mjs
//
// The parts worth pinning: exclude semantics on a multi-valued facet (a trade tagged
// [breakout, revenge] must go when `revenge` is excluded), and that a filter survives a round
// trip through the URL - values here are user-typed tags, which contain the delimiters.
import assert from 'node:assert/strict'
import {
  EMPTY_FILTERS,
  FACETS,
  NONE,
  activeCount,
  facetValues,
  filterTrades,
  isEmpty,
  parseFilters,
  serializeFilters,
  setFacet,
  toggleValue,
} from './tradeFilters.js'

const facet = (key) => FACETS.find((f) => f.key === key)

const trade = (over) => ({
  id: Math.random(),
  symbol: 'TCS',
  setup: 'Breakout',
  direction: 'long',
  tags: [],
  emotion: null,
  result: 'profit',
  is_open: false,
  quantity: 10,
  entry_price: 100,
  exit_price: 110,
  stop_loss: 95,
  ideal_risk_amount: 50,
  traded_at: '2026-01-05T10:00:00',
  ...over,
})

const TRADES = [
  trade({ symbol: 'TCS', tags: ['breakout'] }),
  trade({ symbol: 'INFY', tags: ['breakout', 'revenge'] }),
  trade({ symbol: 'WIPRO', tags: [], setup: null, result: 'loss', exit_price: 90 }),
  trade({ symbol: 'TCS', tags: ['revenge'], emotion: 'FOMO' }),
]

const only = (filters) => filterTrades(TRADES, filters).map((t) => t.symbol)

function test_no_filters_is_the_identity() {
  assert.equal(filterTrades(TRADES, EMPTY_FILTERS), TRADES, 'should hand back the same array')
  assert.ok(isEmpty(EMPTY_FILTERS))
  assert.equal(activeCount(EMPTY_FILTERS), 0)
}

function test_include_keeps_only_the_picked_values() {
  const f = setFacet(EMPTY_FILTERS, 'symbol', { mode: 'include', values: ['TCS', 'INFY'] })
  assert.deepEqual(only(f), ['TCS', 'INFY', 'TCS'])
}

function test_exclude_drops_the_picked_values() {
  const f = setFacet(EMPTY_FILTERS, 'symbol', { mode: 'exclude', values: ['TCS'] })
  assert.deepEqual(only(f), ['INFY', 'WIPRO'], 'skipping a stock should leave every other one')
}

function test_exclude_on_a_tag_drops_a_trade_that_merely_carries_it() {
  // The INFY trade is tagged [breakout, revenge]. Excluding `revenge` must drop it even though it
  // is also tagged with something that wasn't excluded - otherwise "hide my revenge trades"
  // quietly keeps the worst of them.
  const f = setFacet(EMPTY_FILTERS, 'tag', { mode: 'exclude', values: ['revenge'] })
  assert.deepEqual(only(f), ['TCS', 'WIPRO'])
}

function test_untagged_trades_are_selectable_as_a_value() {
  const f = setFacet(EMPTY_FILTERS, 'tag', { mode: 'exclude', values: [NONE] })
  assert.deepEqual(only(f), ['TCS', 'INFY', 'TCS'], 'only the untagged WIPRO trade should go')
}

function test_facets_combine_with_and() {
  let f = setFacet(EMPTY_FILTERS, 'symbol', { mode: 'include', values: ['TCS'] })
  f = setFacet(f, 'tag', { mode: 'exclude', values: ['revenge'] })
  assert.deepEqual(only(f), ['TCS'], 'one TCS trade is revenge-tagged and must drop out')
  assert.equal(activeCount(f), 2)
}

function test_r_range_drops_trades_with_no_r_at_all() {
  // WIPRO lost 100 on a 50 risk => -2R; the winners are +2R.
  assert.deepEqual(only({ ...EMPTY_FILTERS, minR: '0' }), ['TCS', 'INFY', 'TCS'])
  assert.deepEqual(only({ ...EMPTY_FILTERS, maxR: '-1' }), ['WIPRO'])
  const noRisk = [trade({ symbol: 'NOPLAN', ideal_risk_amount: null })]
  assert.deepEqual(
    filterTrades(noRisk, { ...EMPTY_FILTERS, minR: '0' }),
    [],
    'a trade with no planned risk has no R, so an R filter cannot claim it matches',
  )
}

function test_toggle_adds_then_removes_and_clears_the_facet() {
  let f = toggleValue(EMPTY_FILTERS, 'symbol', 'TCS')
  assert.deepEqual(f.facets.symbol.values, ['TCS'])
  f = toggleValue(f, 'symbol', 'TCS')
  assert.ok(isEmpty(f), 'unpicking the last value should leave no facet behind')
}

function test_counts_are_per_value_and_sorted() {
  const values = facetValues(facet('symbol'), TRADES)
  assert.deepEqual(values[0], { value: 'TCS', count: 2, label: 'TCS' })
  assert.equal(values.length, 3)

  const setups = facetValues(facet('setup'), TRADES)
  assert.deepEqual(
    setups.find((v) => v.value === NONE),
    { value: NONE, count: 1, label: 'Not set' },
    'a missing setup must still be a countable, pickable value',
  )
}

function test_url_round_trip_survives_awkward_tags() {
  let f = setFacet(EMPTY_FILTERS, 'tag', {
    mode: 'exclude',
    // Every delimiter the format uses, plus a space - tags are free text.
    values: ['a,b', 'c|d', 'e:f', 'plain tag'],
  })
  f = setFacet(f, 'symbol', { mode: 'include', values: ['TCS'] })
  f = { ...f, minR: '0.5', maxR: '3' }

  const round = parseFilters(serializeFilters(f))
  assert.deepEqual(round, f, `round trip lost data: ${serializeFilters(f)}`)
}

function test_parse_ignores_junk() {
  assert.deepEqual(parseFilters(''), EMPTY_FILTERS)
  assert.deepEqual(parseFilters(undefined), EMPTY_FILTERS)
  assert.deepEqual(
    parseFilters('nonsense:i:x|symbol:i:TCS').facets,
    { symbol: { mode: 'include', values: ['TCS'] } },
    'an unknown facet key from a hand-edited URL must be dropped, not crash the page',
  )
  assert.deepEqual(parseFilters('symbol:i:').facets, {}, 'an empty value list is not a filter')
}

function test_serialize_of_nothing_is_undefined() {
  // undefined, not '' - the router drops undefined params from the URL entirely, so a cleared
  // filter leaves no `?f=` behind.
  assert.equal(serializeFilters(EMPTY_FILTERS), undefined)
}

for (const t of [
  test_no_filters_is_the_identity,
  test_include_keeps_only_the_picked_values,
  test_exclude_drops_the_picked_values,
  test_exclude_on_a_tag_drops_a_trade_that_merely_carries_it,
  test_untagged_trades_are_selectable_as_a_value,
  test_facets_combine_with_and,
  test_r_range_drops_trades_with_no_r_at_all,
  test_toggle_adds_then_removes_and_clears_the_facet,
  test_counts_are_per_value_and_sorted,
  test_url_round_trip_survives_awkward_tags,
  test_parse_ignores_junk,
  test_serialize_of_nothing_is_undefined,
]) {
  t()
}
console.log('all checks passed')

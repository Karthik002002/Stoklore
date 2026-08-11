// Include/exclude filtering for the trade journal, shared by the Overview, Trades and Statistics
// tabs so all three describe the same set of trades.
//
// Why include AND exclude rather than just a picker: the two questions are different sizes. "Only
// my breakout trades" is a pick of one; "everything except that one revenge-tagged disaster" is a
// pick of one *out of forty*, and expressing it as an include list means re-listing thirty-nine
// symbols and re-editing them every time a new one is traded. Exclude keeps the set open-ended.
//
// Pure functions, no React - the panel renders these, the tabs consume them, and the self-check
// (`node frontend/src/lib/tradeFilters.selfcheck.mjs`) runs them with no DOM.
import { expectedR, riskStatus, sessionFor } from './manualTrades.js'

// Stands in for "this trade has no value for this facet" (no setup, no tags, no emotion). A real
// token rather than a skip, so "exclude untagged trades" is expressible at all.
export const NONE = '—'

const RISK_LABEL = { good: 'Good risk', over: 'Over-risked', under: 'Under-risked' }

// `of` returns the trade's value(s) for the facet: a string, null (→ NONE), or an array (tags).
// `label` renders a stored value for display; omitted means the value is already human-readable.
export const FACETS = [
  { key: 'symbol', label: 'Symbols', of: (t) => t.symbol },
  { key: 'setup', label: 'Setups', of: (t) => t.setup },
  { key: 'tag', label: 'Tags', of: (t) => t.tags ?? [] },
  { key: 'result', label: 'Result', of: (t) => (t.is_open ? 'open' : t.result) },
  { key: 'direction', label: 'Direction', of: (t) => t.direction },
  { key: 'session', label: 'Session', of: (t) => sessionFor(t) },
  { key: 'emotion', label: 'Emotion', of: (t) => t.emotion },
  { key: 'risk', label: 'Risk sizing', of: (t, tol) => riskStatus(t, tol), label_: RISK_LABEL },
]

const FACET_BY_KEY = Object.fromEntries(FACETS.map((f) => [f.key, f]))

export const facetLabel = (facet, value) => (value === NONE ? 'Not set' : (facet.label_?.[value] ?? value))

// Always an array, so multi-valued (tags) and single-valued facets match by the same rule.
function valuesOf(facet, trade, tolerancePct) {
  const raw = facet.of(trade, tolerancePct)
  const list = Array.isArray(raw) ? raw : [raw]
  const clean = list.filter((v) => v != null && v !== '')
  return clean.length ? clean : [NONE]
}

export const EMPTY_FILTERS = { facets: {}, minR: '', maxR: '' }

export function isEmpty(filters) {
  return !filters.minR && !filters.maxR && !Object.values(filters.facets ?? {}).some((f) => f?.values?.length)
}

export function activeCount(filters) {
  const facets = Object.values(filters.facets ?? {}).filter((f) => f?.values?.length).length
  return facets + (filters.minR ? 1 : 0) + (filters.maxR ? 1 : 0)
}

/** Filters for one facet, or an empty include selection when it has none yet. */
export const facetFilter = (filters, key) => filters.facets?.[key] ?? { mode: 'include', values: [] }

export function setFacet(filters, key, next) {
  const facets = { ...filters.facets }
  if (!next.values.length) delete facets[key]
  else facets[key] = next
  return { ...filters, facets }
}

export function toggleValue(filters, key, value) {
  const current = facetFilter(filters, key)
  const values = current.values.includes(value)
    ? current.values.filter((v) => v !== value)
    : [...current.values, value]
  return setFacet(filters, key, { ...current, values })
}

export function filterTrades(trades, filters, tolerancePct = 10) {
  if (isEmpty(filters)) return trades
  const entries = Object.entries(filters.facets ?? {}).filter(([, f]) => f.values?.length)
  const min = filters.minR === '' || filters.minR == null ? null : Number(filters.minR)
  const max = filters.maxR === '' || filters.maxR == null ? null : Number(filters.maxR)

  return trades.filter((t) => {
    for (const [key, { mode, values }] of entries) {
      const facet = FACET_BY_KEY[key]
      if (!facet) continue
      // A trade "hits" a facet when any of its values was picked - so a trade tagged
      // [breakout, revenge] is excluded by an exclude-revenge filter even though `breakout`
      // wasn't picked. Excluding is about the presence of the bad thing, not the absence of
      // everything else.
      const hit = valuesOf(facet, t, tolerancePct).some((v) => values.includes(v))
      if (mode === 'exclude' ? hit : !hit) return false
    }
    if (min != null || max != null) {
      const r = expectedR(t)
      if (r == null) return false
      if (min != null && r < min) return false
      if (max != null && r > max) return false
    }
    return true
  })
}

/**
 * Every value this facet takes across `trades`, with how many trades carry it - the counts in the
 * panel. Counted over the trades *other* facets already narrowed to (the caller passes those in),
 * so a count never promises rows that a different filter has already removed.
 */
export function facetValues(facet, trades, tolerancePct = 10) {
  const counts = new Map()
  for (const t of trades) {
    for (const v of valuesOf(facet, t, tolerancePct)) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts]
    .map(([value, count]) => ({ value, count, label: facetLabel(facet, value) }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1))
}

// --- URL encoding ------------------------------------------------------------------------------
// One search param instead of two per facet (`symbols=` + `symbolsMode=` × 8 would be sixteen).
// Shape: `symbol:i:TCS,INFY|tag:x:revenge|r:0.5,3`, with each value percent-encoded - tags are
// free text and can contain the delimiters, and encodeURIComponent escapes `,` `:` and `|`.

const MODE_CODE = { include: 'i', exclude: 'x' }
const CODE_MODE = { i: 'include', x: 'exclude' }

export function serializeFilters(filters) {
  const parts = Object.entries(filters.facets ?? {})
    .filter(([key, f]) => FACET_BY_KEY[key] && f.values?.length)
    .map(([key, f]) => `${key}:${MODE_CODE[f.mode] ?? 'i'}:${f.values.map(encodeURIComponent).join(',')}`)
  if (filters.minR || filters.maxR) parts.push(`r:${filters.minR ?? ''},${filters.maxR ?? ''}`)
  return parts.join('|') || undefined
}

export function parseFilters(str) {
  if (!str) return EMPTY_FILTERS
  const out = { facets: {}, minR: '', maxR: '' }
  for (const part of String(str).split('|')) {
    const [key, a, b] = part.split(':')
    if (key === 'r') {
      const [minR = '', maxR = ''] = (a ?? '').split(',')
      out.minR = minR
      out.maxR = maxR
      continue
    }
    if (!FACET_BY_KEY[key] || !b) continue
    const values = b.split(',').filter(Boolean).map(decodeURIComponent)
    if (values.length) out.facets[key] = { mode: CODE_MODE[a] ?? 'include', values }
  }
  return out
}

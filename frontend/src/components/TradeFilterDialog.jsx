import { useEffect, useMemo, useState } from 'react'
import { ChevronRightIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  activeCount,
  EMPTY_FILTERS,
  facetFilter,
  facetLabel,
  facetValues,
  filterTrades,
  isEmpty,
  setFacet,
  toggleValue,
  TRADE_SPEC,
} from '@/lib/tradeFilters'

// Two-pane filter panel: facets down the left, that facet's values with counts on the right.
//
// Edits are staged in local state and only committed on Apply. Every tab downstream recomputes an
// equity curve and a statistics table off this selection, so live-applying each checkbox would
// mean recomputing the whole page between two clicks of the same list.
//
// `spec` is what it filters (see lib/tradeFilters.js) - the journal by default, the shareholding
// screener when that page passes its own facets. Nothing below knows what a trade is.
export default function TradeFilterDialog({
  open,
  onOpenChange,
  trades,
  filters,
  onApply,
  tolerancePct,
  spec = TRADE_SPEC,
}) {
  const FACETS = spec.facets
  const [draft, setDraft] = useState(filters)
  const [active, setActive] = useState(FACETS[0].key)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (open) {
      setDraft(filters)
      setSearch('')
    }
  }, [open, filters])

  const facet = FACETS.find((f) => f.key === active) ?? FACETS[0]
  const current = facetFilter(draft, facet.key)

  // Counts come from the trades the *other* facets already allow, so a number in this list never
  // promises rows another filter has removed. This facet's own selection is left out - otherwise
  // picking one symbol would drop every other symbol's count to zero and there'd be nothing left
  // to pick.
  const scoped = useMemo(
    () =>
      filterTrades(trades, setFacet(draft, facet.key, { mode: 'include', values: [] }), tolerancePct, spec),
    [trades, draft, facet.key, tolerancePct, spec],
  )
  const values = useMemo(() => facetValues(facet, scoped, tolerancePct), [facet, scoped, tolerancePct])
  const shown = search ? values.filter((v) => v.label.toLowerCase().includes(search.toLowerCase())) : values

  const matched = useMemo(
    () => filterTrades(trades, draft, tolerancePct, spec),
    [trades, draft, tolerancePct, spec],
  )

  const setMode = (mode) => setDraft((d) => setFacet(d, facet.key, { ...facetFilter(d, facet.key), mode }))
  const setRange = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-4 py-3">
          <DialogTitle>Filters</DialogTitle>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {matched.length} of {trades.length} {spec.noun} match
            </span>
            {!isEmpty(draft) && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(EMPTY_FILTERS)}>
                <XIcon className="size-3.5" />
                Clear all
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                onApply(draft)
                onOpenChange(false)
              }}
            >
              Apply filters
            </Button>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[13rem_1fr]">
          <nav className="overflow-y-auto border-r bg-muted/30 p-2">
            {FACETS.map((f) => {
              const picked = facetFilter(draft, f.key)
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    setActive(f.key)
                    setSearch('')
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    f.key === active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted'
                  }`}
                >
                  <span className="truncate">{f.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {picked.values.length > 0 && (
                      <Badge variant={picked.mode === 'exclude' ? 'destructive' : 'secondary'}>
                        {picked.mode === 'exclude' ? '−' : ''}
                        {picked.values.length}
                      </Badge>
                    )}
                    <ChevronRightIcon className="size-3.5 opacity-40" />
                  </span>
                </button>
              )
            })}

            <div className="mt-3 space-y-1.5 border-t px-3 pt-3">
              <p className="text-xs text-muted-foreground">{spec.range.label}</p>
              <div className="flex gap-1.5">
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Min"
                  value={draft.minR}
                  onChange={setRange('minR')}
                  className="h-8"
                />
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Max"
                  value={draft.maxR}
                  onChange={setRange('maxR')}
                  className="h-8"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">{spec.range.hint}</p>
            </div>
          </nav>

          <section className="flex min-h-0 flex-col">
            <div className="space-y-2 border-b p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{facet.label}</p>
                <div className="flex overflow-hidden rounded-lg border text-xs">
                  {['include', 'exclude'].map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setMode(mode)}
                      className={`px-3 py-1.5 capitalize transition-colors ${
                        current.mode === mode
                          ? mode === 'exclude'
                            ? 'bg-destructive text-white'
                            : 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative">
                <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${facet.label.toLowerCase()}…`}
                  className="pl-8"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {current.mode === 'exclude'
                  ? 'Ticked values are dropped. Everything else stays, including values added later.'
                  : 'Ticked values are kept. Nothing ticked means this filter is off.'}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {shown.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {values.length === 0 ? 'No values on these trades.' : 'Nothing matches that search.'}
                </p>
              ) : (
                shown.map((v) => (
                  <label
                    key={v.value}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={current.values.includes(v.value)}
                      onChange={() => setDraft((d) => toggleValue(d, facet.key, v.value))}
                    />
                    <span className="flex-1 truncate">{v.label}</span>
                    <span className="tabular-nums text-muted-foreground">{v.count}</span>
                  </label>
                ))
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Opens the panel; carries how many filters are on, so the toolbar shows it without a chip row. */
export function FilterButton({ filters, onOpen }) {
  const count = activeCount(filters)
  return (
    <Button size="sm" variant={count > 0 ? 'default' : 'outline'} onClick={onOpen}>
      <SlidersHorizontalIcon className="size-4" />
      Filters
      {count > 0 && (
        <Badge variant="secondary" className="ml-1">
          {count}
        </Badge>
      )}
    </Button>
  )
}

/**
 * The active filters, as removable chips - so the page says what it's hiding without opening the
 * panel. Renders nothing when no filter is on, which is what keeps it out of the way of the tabs.
 */
export function FilterChips({ filters, onChange, spec = TRADE_SPEC }) {
  const count = activeCount(filters)
  if (count === 0) return null
  const FACETS = spec.facets

  return (
    <div className="flex flex-wrap items-center gap-2">
      {FACETS.filter((f) => filters.facets?.[f.key]?.values?.length).map((f) => {
        const { mode, values } = filters.facets[f.key]
        return (
          <Badge
            key={f.key}
            variant={mode === 'exclude' ? 'destructive' : 'secondary'}
            className="cursor-pointer gap-1"
            onClick={() => onChange(setFacet(filters, f.key, { mode, values: [] }))}
          >
            {mode === 'exclude' ? 'Not ' : ''}
            {f.label.toLowerCase()}:{' '}
            {values.length <= 2 ? values.map((v) => facetLabel(f, v)).join(', ') : `${values.length} picked`}
            <XIcon className="size-3" />
          </Badge>
        )
      })}
      {(filters.minR || filters.maxR) && (
        <Badge
          variant="secondary"
          className="cursor-pointer gap-1"
          onClick={() => onChange({ ...filters, minR: '', maxR: '' })}
        >
          {spec.range.label} {filters.minR || '−∞'} to {filters.maxR || '∞'}
          <XIcon className="size-3" />
        </Badge>
      )}
      <Button size="sm" variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
        Clear
      </Button>
    </div>
  )
}

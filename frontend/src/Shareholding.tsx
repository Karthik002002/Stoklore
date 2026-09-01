import { useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { DateRangePicker } from '@/components/DatePicker'
import TradeFilterDialog, { FilterButton, FilterChips } from '@/components/TradeFilterDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { compact, formatDate } from '@/lib/format'
import { EMPTY_FILTERS, filterTrades, setFacet } from '@/lib/tradeFilters'
import { usePageTitle } from '@/lib/usePageTitle'
import type { FilterSpec } from '@/lib/tradeFilters'
import type { ShareholdingRow } from '@/services/api'
import { getShareholding, getShareholdingStatus, syncShareholding } from '@/services/api'

// The promoter-holding screener. Its whole job is to be a NOISE FILTER: ~2,500 companies file a
// shareholding pattern every quarter, almost all of them boring, and the handful that moved are
// worth reading the actual filing for. Sorting by "did promoter % go up" is what this replaces -
// that question can't separate a promoter buying shares from a promoter being GIVEN new ones, and
// those two mean opposite things (see app/core/shareholding.py for the worked example).
//
// Every number here is computed server-side from stored filings; this file only renders and
// filters. No derived value is stored anywhere, so a filing whose XBRL detail arrives days later
// upgrades its own verdict with no backfill.

const FLAGS: Record<string, { label: string; variant: 'destructive' | 'success' | 'outline'; hint: string }> =
  {
    verify: {
      label: 'Verify',
      variant: 'destructive',
      hint: 'The share counts say this was not a market purchase — or they are missing. Read the filing.',
    },
    organic: {
      label: 'Organic',
      variant: 'success',
      hint: 'Total shares unchanged: whatever the promoter gained came out of the public’s hands.',
    },
    quiet: { label: 'Quiet', variant: 'outline', hint: 'Nothing material moved this filing.' },
  }

// Written as %, not pp. It IS a change in percentage points - a promoter going 26.89% -> 30.53%
// moved +3.64 of them, not by 3.64% of their holding - and the column headers say so, but every
// other number on this page is a % of shares outstanding and switching units mid-row read worse
// than the ambiguity does.
const pp = (value: number | null | undefined) =>
  value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`

const toneFor = (value: number | null | undefined) =>
  value == null || Math.abs(value) < 0.005 ? '' : value > 0 ? 'text-up' : 'text-down'

/** The shape of the holding, not a chart library: eight bars is enough to see "steady climb" vs
 *  "flat then a cliff", which is the entire question the sparkline is answering. */
function Spark({ points }: { points: ShareholdingRow['spark'] }) {
  const values = points.map((p) => p.promoter_pct).filter((v): v is number => v != null)
  if (values.length < 2) return <span className="text-xs text-muted-foreground">—</span>
  const low = Math.min(...values)
  const high = Math.max(...values)
  const span = high - low || 1
  return (
    <span className="flex h-6 items-end gap-0.5" title={`${low.toFixed(2)}% → ${high.toFixed(2)}%`}>
      {values.map((v, i) => (
        <span
          key={`${points[i]?.period_date ?? i}`}
          className="w-1 rounded-sm bg-primary/70"
          style={{ height: `${8 + ((v - low) / span) * 16}px` }}
        />
      ))}
    </span>
  )
}

const FLAG_LABEL: Record<string, string> = { verify: 'Needs verifying', organic: 'Organic', quiet: 'Quiet' }

/** What the journal's filter panel filters here instead of trades (see lib/tradeFilters.js). The
 *  facets are the questions the four inline controls can't ask: not "did it move" but "did it move
 *  the same way, at the same pace, in a quarter whose share counts have actually been read". */
const specFor = (verdicts: Record<string, string>): FilterSpec<ShareholdingRow> => ({
  noun: 'companies',
  facets: [
    { key: 'flag', label: 'Flag', of: (r) => r.flag, label_: FLAG_LABEL },
    { key: 'verdict', label: 'What happened', of: (r) => r.last_change?.verdict, label_: verdicts },
    {
      key: 'shape',
      label: 'How it arrived',
      of: (r) => (r.window?.gradual == null ? null : r.window.gradual ? 'Gradual' : 'One step'),
    },
    {
      key: 'direction',
      label: 'Direction',
      of: (r) => {
        const pp = r.last_change?.promoter_pp
        return pp == null ? null : pp > 0.005 ? 'Promoter up' : pp < -0.005 ? 'Promoter down' : 'Flat'
      },
    },
    { key: 'timing', label: 'Filing timing', of: (r) => (r.off_cycle ? 'Off-cycle' : 'Quarter end') },
    { key: 'detail', label: 'Share counts', of: (r) => (r.has_detail ? 'Read' : 'Not read yet') },
    { key: 'period', label: 'Latest period', of: (r) => r.period_date },
  ],
  // The holding itself, as opposed to the change - "show me every 70%+ promoter that sold" is a
  // different question from anything the Δ columns can express.
  range: {
    label: 'Promoter %',
    hint: 'The holding, not the change. A company with no filed promoter % drops out.',
    of: (r) => r.promoter_pct,
  },
})

// The default view, expressed as a filter rather than as a hidden rule: everything except the
// quiet rows, which is most of the market most quarters. It shows up as a removable chip, so the
// page's opinion is visible and one click undoes it.
const DEFAULT_FILTERS = setFacet(EMPTY_FILTERS, 'flag', { mode: 'exclude', values: ['quiet'] })

const ROW_LIMITS = ['50', '100', '250', 'all']

/** A sortable column header. The sort is a server round trip, not a re-render of what's on screen:
 *  the table shows a slice of ~2,400 companies, and "the ten biggest falls" is a question about the
 *  rows that aren't rendered. */
function SortHead({
  id,
  sort,
  onSort,
  title,
  className,
  children,
}: {
  id: string
  sort: { key: string; order: string }
  onSort: (id: string) => void
  title?: string
  className?: string
  children: React.ReactNode
}) {
  const active = sort.key === id || (id === 'delta' && sort.key === 'move')
  const Icon = !active
    ? ArrowUpDownIcon
    : sort.key === 'move'
      ? ArrowUpDownIcon
      : sort.order === 'asc'
        ? ArrowUpIcon
        : ArrowDownIcon
  return (
    <TableHead className={className} title={title}>
      <button
        type="button"
        onClick={() => onSort(id)}
        className={`flex items-center gap-1 whitespace-nowrap ${active ? 'text-foreground' : 'hover:text-foreground'}`}
      >
        {children}
        <Icon className={`size-3 ${active ? '' : 'opacity-30'}`} />
      </button>
    </TableHead>
  )
}

function Row({ row, verdicts }: { row: ShareholdingRow; verdicts: Record<string, string> }) {
  const change = row.last_change
  const flag = FLAGS[row.flag] ?? FLAGS.quiet
  const window = row.window

  return (
    <TableRow>
      <TableCell>
        <Link to="/stock/$symbol" params={{ symbol: row.symbol }} className="font-medium hover:underline">
          {row.symbol}
        </Link>
        <p className="max-w-56 truncate text-xs text-muted-foreground">{row.company}</p>
      </TableCell>
      <TableCell className="tabular-nums">
        {row.promoter_pct == null ? '—' : `${row.promoter_pct.toFixed(2)}%`}
      </TableCell>
      <TableCell className={`tabular-nums ${toneFor(change?.promoter_pp)}`}>
        {pp(change?.promoter_pp)}
      </TableCell>
      <TableCell className={`tabular-nums ${toneFor(window?.total_pp)}`}>
        {pp(window?.total_pp)}
        {window?.gradual != null && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {window.gradual ? 'gradual' : 'one step'}
          </span>
        )}
      </TableCell>
      <TableCell>
        <Spark points={row.spark} />
      </TableCell>
      <TableCell>
        <Badge variant={flag.variant} title={flag.hint}>
          {flag.label}
        </Badge>
      </TableCell>
      <TableCell className="text-xs">
        {(change && verdicts[change.verdict]) ?? '—'}
        {/* The two corroborating numbers, when the XBRL has been read: new shares mean the move was
            an issue, not a purchase, and the public holder count says whether anyone actually sold. */}
        {change?.total_shares_delta != null && change.total_shares_delta !== 0 && (
          <p className="text-muted-foreground">
            {change.total_shares_delta > 0 ? '+' : ''}
            {compact(change.total_shares_delta)} shares created
          </p>
        )}
        {change?.public_holders_delta != null && change.public_holders_delta !== 0 && (
          <p className="text-muted-foreground">
            {change.public_holders_delta > 0 ? '+' : ''}
            {compact(change.public_holders_delta)} public holders
          </p>
        )}
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        {formatDate(row.period_date)}
        {row.off_cycle && (
          <Badge
            variant="outline"
            className="ml-1.5"
            title="Not a quarter end — SEBI only requires an off-cycle filing after a capital change over 2%, so this date is itself a corporate-action flag."
          >
            off-cycle
          </Badge>
        )}
      </TableCell>
    </TableRow>
  )
}

export default function Shareholding() {
  usePageTitle('Shareholding')
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [sort, setSort] = useState<{ key: string; order: string }>({ key: 'move', order: 'desc' })
  const [limit, setLimit] = useState('100')
  const [minPp, setMinPp] = useState('0.5')
  const [search, setSearch] = useState('')
  const [years, setYears] = useState('1')
  // An explicit span, when "the last N years" isn't the question - re-pulling one quarter, or
  // reaching back to a period the years shorthand doesn't cover. Empty = use the shorthand.
  const [range, setRange] = useState({ from: '', to: '' })
  const ranged = !!(range.from && range.to)

  // The sort is part of the key: the server orders the whole collected universe, and the table
  // renders the head of it. keepPreviousData is what stops the table blanking between two clicks
  // of the same header.
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['shareholding', sort.key, sort.order],
    queryFn: () => getShareholding({ sort: sort.key, order: sort.order }),
    placeholderData: keepPreviousData,
  })
  // Polled only while a sweep is running - the collector is a background thread, and there is
  // nothing to watch the rest of the time.
  const { data: status } = useQuery({
    queryKey: ['shareholdingStatus'],
    queryFn: getShareholdingStatus,
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  })
  const running = !!status?.running

  const sync = useMutation({
    mutationFn: () =>
      ranged
        ? syncShareholding({ from: range.from, to: range.to })
        : syncShareholding({ years: Number(years) }),
    onSuccess: () => {
      toast.success(
        ranged
          ? `Collecting filings from ${range.from} to ${range.to} in the background`
          : `Collecting ${years} year${years === '1' ? '' : 's'} of filings in the background`,
      )
      queryClient.invalidateQueries({ queryKey: ['shareholdingStatus'] })
    },
    onError: (e) => toast.error(e.message),
  })

  const spec = useMemo(() => specFor(data?.verdicts ?? {}), [data?.verdicts])

  // Server order in, server order out - filtering never reorders, so the header still describes
  // what the table is showing.
  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const floor = Number(minPp) || 0
    const needle = search.trim().toUpperCase()
    const matched = all.filter((r) => {
      if (needle && !r.symbol.includes(needle) && !(r.company ?? '').toUpperCase().includes(needle)) {
        return false
      }
      // The off-cycle escape: a filing NSE only required because capital changed by over 2% is
      // worth reading whatever the percentage did.
      return Math.abs(r.last_change?.promoter_pp ?? 0) >= floor || r.off_cycle
    })
    return filterTrades(matched, filters, 0, spec)
  }, [data, filters, minPp, search, spec])

  const shown = useMemo(() => (limit === 'all' ? rows : rows.slice(0, Number(limit))), [rows, limit])

  // Δ latest is three questions, not one: biggest buy, biggest sell, then biggest move either way
  // (the default - a -4pp exit is as worth reading as a +4pp accumulation). Every other column is
  // an ordinary asc/desc toggle.
  const onSort = (key: string) =>
    setSort((s) => {
      if (key !== 'delta') {
        if (s.key === key) return { key, order: s.order === 'asc' ? 'desc' : 'asc' }
        return { key, order: key === 'symbol' ? 'asc' : 'desc' }
      }
      const cycle = [
        { key: 'delta', order: 'desc' },
        { key: 'delta', order: 'asc' },
        { key: 'move', order: 'desc' },
      ]
      const at = cycle.findIndex((c) => c.key === s.key && c.order === s.order)
      return cycle[(at + 1) % cycle.length]
    })

  const coverage = data?.coverage

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Promoter shareholding</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Not "did promoter holding go up" — <span className="font-medium">how</span> it went up. A steady
            climb is usually a promoter buying with their own money; a jump is usually shares being issued to
            them, and the percentage alone cannot tell the two apart. Rows marked{' '}
            <span className="font-medium">Verify</span> are the ones worth opening the filing for.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Two ways to say the same thing, and the span wins when it is filled in: "last N
              years" is the common case, a named period is the deliberate one (re-pulling a single
              quarter, or reaching back further than the shorthand offers). */}
          <Select value={years} onValueChange={(v) => setYears(String(v))} disabled={ranged}>
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['1', '2', '3', '5'].map((y) => (
                <SelectItem key={y} value={y}>
                  {y} year{y === '1' ? '' : 's'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateRangePicker
            from={range.from}
            to={range.to}
            onChange={setRange}
            placeholder="or a date range"
            max={new Date().toISOString().slice(0, 10)}
            align="end"
          />
          {ranged && (
            <Button size="sm" variant="ghost" onClick={() => setRange({ from: '', to: '' })}>
              Clear
            </Button>
          )}
          <Button size="sm" disabled={running || sync.isPending} onClick={() => sync.mutate()}>
            {running ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" />}
            Collect
          </Button>
        </div>
      </div>

      {running && (
        <p className="rounded-lg border bg-card p-2.5 text-xs text-muted-foreground">
          {status.phase === 'detail'
            ? `Reading filing detail — ${status.done}/${status.total}`
            : `Sweeping filings — window ${status.done}/${status.total}`}
          {status.new > 0 && ` · ${status.new} new`}
          {status.details > 0 && ` · ${status.details} filings read`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-56"
          placeholder="Symbol or company"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FilterButton filters={filters} onOpen={() => setFilterOpen(true)} />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Min move</span>
          <Input
            type="number"
            step="0.1"
            min="0"
            className="h-8 w-20"
            value={minPp}
            onChange={(e) => setMinPp(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
        <Select value={limit} onValueChange={(v) => setLimit(String(v))}>
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROW_LIMITS.map((n) => (
              <SelectItem key={n} value={n}>
                {n === 'all' ? 'All rows' : `${n} rows`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {isFetching && <Spinner className="size-3" />}
          {shown.length < rows.length && `showing ${shown.length} of `}
          {rows.length} of {data?.rows?.length ?? 0} companies
          {coverage?.latest_period && ` · newest filing ${formatDate(coverage.latest_period)}`}
          {(coverage?.without_detail ?? 0) > 0 && ` · ${coverage?.without_detail} without share counts`}
        </span>
      </div>

      <FilterChips filters={filters} onChange={setFilters} spec={spec} />
      <TradeFilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        trades={data?.rows ?? []}
        filters={filters}
        onApply={setFilters}
        tolerancePct={0}
        spec={spec}
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {coverage?.filings
            ? 'No company matches these filters.'
            : 'Nothing collected yet — hit Collect to pull the filings NSE has published.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead id="symbol" sort={sort} onSort={onSort}>
                  Company
                </SortHead>
                <SortHead
                  id="promoter"
                  sort={sort}
                  onSort={onSort}
                  title="Promoter + promoter group holding at the latest filing, as a % of shares outstanding"
                >
                  Promoter
                </SortHead>
                <SortHead
                  id="delta"
                  sort={sort}
                  onSort={onSort}
                  title="Change at the latest filing, in percentage points of shares outstanding (26.89% → 30.53% shows as +3.64%). Clicks cycle: biggest increase, biggest fall, then biggest move either way."
                >
                  Δ latest
                </SortHead>
                <SortHead
                  id="window"
                  sort={sort}
                  onSort={onSort}
                  title="Cumulative change over the last four filings, in percentage points of shares outstanding, and whether it arrived steadily or in one step"
                >
                  Δ window
                </SortHead>
                <TableHead>Shape</TableHead>
                <TableHead>Flag</TableHead>
                <TableHead>What happened</TableHead>
                <SortHead id="period" sort={sort} onSort={onSort} title="Date of the latest filing held">
                  Period
                </SortHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <Row key={row.symbol} row={row} verdicts={data?.verdicts ?? {}} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

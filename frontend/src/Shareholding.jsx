import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { compact, formatDate } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
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

const FLAGS = {
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

const pp = (value) => (value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}pp`)

const toneFor = (value) =>
  value == null || Math.abs(value) < 0.005 ? '' : value > 0 ? 'text-up' : 'text-down'

/** The shape of the holding, not a chart library: eight bars is enough to see "steady climb" vs
 *  "flat then a cliff", which is the entire question the sparkline is answering. */
function Spark({ points }) {
  const values = points.map((p) => p.promoter_pct).filter((v) => v != null)
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

function Row({ row, verdicts }) {
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
        {verdicts[change?.verdict] ?? '—'}
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
  const [flag, setFlag] = useState('moved')
  const [minPp, setMinPp] = useState('0.5')
  const [search, setSearch] = useState('')
  const [years, setYears] = useState('1')

  const { data, isLoading } = useQuery({ queryKey: ['shareholding'], queryFn: () => getShareholding() })
  // Polled only while a sweep is running - the collector is a background thread, and there is
  // nothing to watch the rest of the time.
  const { data: status } = useQuery({
    queryKey: ['shareholdingStatus'],
    queryFn: getShareholdingStatus,
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  })
  const running = !!status?.running

  const sync = useMutation({
    mutationFn: () => syncShareholding(Number(years)),
    onSuccess: () => {
      toast.success(`Collecting ${years} year${years === '1' ? '' : 's'} of filings in the background`)
      queryClient.invalidateQueries({ queryKey: ['shareholdingStatus'] })
    },
    onError: (e) => toast.error(e.message),
  })

  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const floor = Number(minPp) || 0
    const needle = search.trim().toUpperCase()
    return all.filter((r) => {
      if (needle && !r.symbol.includes(needle) && !(r.company ?? '').toUpperCase().includes(needle)) {
        return false
      }
      if (flag === 'verify' && r.flag !== 'verify') return false
      if (flag === 'organic' && r.flag !== 'organic') return false
      // 'moved' is the default view: everything that actually changed, either way, which is the
      // list this page exists to produce.
      if (flag === 'moved' && r.flag === 'quiet') return false
      return Math.abs(r.last_change?.promoter_pp ?? 0) >= floor || r.off_cycle
    })
  }, [data, flag, minPp, search])

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
          <Select value={years} onValueChange={setYears}>
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
        <Select value={flag} onValueChange={setFlag}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="moved">Moved</SelectItem>
            <SelectItem value="verify">Needs verifying</SelectItem>
            <SelectItem value="organic">Organic only</SelectItem>
            <SelectItem value="all">Everything</SelectItem>
          </SelectContent>
        </Select>
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
          <span className="text-xs text-muted-foreground">pp</span>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} of {data?.rows?.length ?? 0} companies
          {coverage?.latest_period && ` · newest filing ${formatDate(coverage.latest_period)}`}
          {coverage?.without_detail > 0 && ` · ${coverage.without_detail} without share counts`}
        </span>
      </div>

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
                <TableHead>Company</TableHead>
                <TableHead>Promoter</TableHead>
                <TableHead title="Change at the latest filing">Δ latest</TableHead>
                <TableHead title="Cumulative change over the last four filings, and whether it arrived steadily or in one step">
                  Δ window
                </TableHead>
                <TableHead>Shape</TableHead>
                <TableHead>Flag</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Period</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <Row key={row.symbol} row={row} verdicts={data.verdicts} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

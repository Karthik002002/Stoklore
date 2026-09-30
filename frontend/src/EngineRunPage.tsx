// One algo-engine run in full, at /engine/runs/$runId - the run id is the whole key. Everything
// here is derived from the run's own report file (lib/engine.ts runAnalytics), plus the run's bars
// for MAE/MFE, so it works for backtests, paper and live runs alike; parts a run doesn't have (sizing,
// the engine command, a job) are simply left out for it.
import { useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import type { UTCTimestamp } from 'lightweight-charts'
import { ArrowLeftIcon, CopyIcon, PencilIcon, PlayIcon, PrinterIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import SeriesChart from '@/components/charts/SeriesChart'
import { seriesColor } from '@/components/charts/colors'
import type { Dataset } from '@/components/charts/colors'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { excursions, histogram, istTime, pinnedRange, runAnalytics, runSheets, tradeCost } from '@/lib/engine'
import type { RunAnalytics, RunBucket, RunTrade } from '@/lib/engine'
import { fmt, formatDateTime, inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import {
  deleteEngineRun,
  getEngineRun,
  getEngineRuns,
  getIntradayBars,
  runEngineBacktest,
  saveEngineRunNotes,
} from '@/services/api'
import type { EngineBacktestRequest, EngineRun } from '@/services/api'
import { DailyBars, ExecutionsChart, ExportMenu, HistoryLine, PREFILL_KEY, Stat, pnlClass, runName } from './engineUi'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PAGE = 100
const MAX_BAR_SYMBOLS = 10 // MAE/MFE loads each symbol's bars; past this it'd be a lot of fetching
export const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${fmt(v, d)}%`)
export const num = (v: number | null | undefined, d = 2) => (v == null ? '—' : fmt(v, d))
export const hold = (min: number) => (min < 60 ? `${fmt(min, 0)}m` : min < 1440 ? `${fmt(min / 60, 1)}h` : `${fmt(min / 1440, 1)}d`)
export const points = (xs: [number, number][]) => xs.map(([t, v]) => ({ time: t as UTCTimestamp, value: v }))

/** The exact request that makes this run again: its own when it kept one (with this run's params,
 *  not the whole batch's grid), else rebuilt from the report, on the very bars it ran on. */
function rerunRequest(run: EngineRun): EngineBacktestRequest {
  const { cost_bps, sizing, capital, carry, ...params } = run.params
  void carry
  const base = run.request
  return {
    strategy: run.strategy,
    symbols: run.symbols,
    interval: run.interval,
    params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, [v]])),
    cost_bps: cost_bps ?? base?.cost_bps ?? 3,
    sizing:
      run.sizing ??
      (sizing ? { mode: sizing === 2 ? 'all_in' : 'scale', capital } : { mode: 'fixed', capital: 100000 }),
    label: run.label ?? null,
    range: pinnedRange(run.history, run.coverage),
  }
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 break-inside-avoid">
      <h2 className="text-sm font-medium">
        {title}
        {hint && <span className="font-normal text-muted-foreground"> · {hint}</span>}
      </h2>
      <div className="rounded-xl border bg-card p-4">{children}</div>
    </section>
  )
}

function MetricsGrid({ run, a }: { run: EngineRun; a: RunAnalytics }) {
  const s = run.summary
  const items: [string, React.ReactNode, string?, string?][] = [
    ['Net P&L', inr(s.net), pnlClass(s.net)],
    ['Return', pct(a.returnPct), pnlClass(s.net), `on ${inr(a.capital)} (${a.capitalBasis})`],
    ['CAGR', pct(a.cagr), pnlClass(a.cagr ?? 0), 'compounded yearly rate over the run'],
    ['Max drawdown', `${inr(s.max_dd)} · ${pct(a.maxDdPct)}`, 'text-destructive'],
    ['Sharpe', num(s.sharpe), pnlClass(s.sharpe), 'daily P&L, annualised'],
    ['Sortino', num(a.sortino), pnlClass(a.sortino), 'Sharpe on downside days only'],
    ['Calmar', num(a.calmar), pnlClass(a.calmar ?? 0), 'CAGR / max drawdown %'],
    ['Ulcer index', num(a.ulcer), undefined, 'depth and length of drawdowns, in %'],
    ['Profit factor', num(s.profit_factor), undefined, 'gross wins / gross losses'],
    ['Win rate', pct(s.win_rate)],
    ['Expectancy', inr(s.expectancy), pnlClass(s.expectancy ?? 0), 'net per trade'],
    ['Payoff ratio', num(a.payoff), undefined, 'avg win / avg loss, net'],
    ['SQN', num(a.sqn), pnlClass(a.sqn ?? 0), 'Van Tharp: √n × mean / sd of net trades (n ≤ 100)'],
    ['Kelly', pct(a.kelly), pnlClass(a.kelly ?? 0), 'the edge-optimal stake - most trade a fraction of it'],
    ['Trades', fmt(s.trades, 0)],
    ['Trades / month', num(a.tradesPerMonth, 1)],
    ['Exposure', pct(a.exposurePct), undefined, 'time with any position open'],
    ['Hold (avg / median)', `${hold(s.avg_hold_min ?? 0)} / ${hold(a.medianHoldMin)}`],
    ['Avg win / loss', `${inr(a.avgWin)} / ${inr(a.avgLoss)}`],
    ['Largest win / loss', `${inr(a.largestWin)} / ${inr(a.largestLoss)}`],
    ['Streaks (win / loss)', `${a.winStreak} / ${a.lossStreak}`],
    ['Costs', `${inr(s.costs)} · ${pct(a.costDragPct)} of gross`],
    ['Return / drawdown', num(s.ret_dd)],
    ['Sessions', fmt(s.days, 0)],
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {items.map(([label, value, cls, title]) => (
        <div key={label} title={title}>
          <Stat label={label} value={value} className={cls} />
        </div>
      ))}
    </div>
  )
}

export function ReturnsHeatmap({ a }: { a: RunAnalytics }) {
  const years = [...new Set(a.monthly.map((m) => m.year))].sort()
  const max = Math.max(1, ...a.monthly.map((m) => Math.abs(m.pnl)))
  const cell = (key: number, pnl: number | undefined, pctV: number | null | undefined) =>
    pnl === undefined ? (
      <td key={key} className="p-1" />
    ) : (
      <td
        key={key}
        className="rounded p-1 text-center tabular-nums"
        style={{
          background: `rgba(${pnl >= 0 ? '34,197,94' : '239,68,68'},${0.12 + (0.6 * Math.abs(pnl)) / max})`,
        }}
        title={inr(pnl)}
      >
        {pctV == null ? fmt(pnl, 0) : fmt(pctV, 1)}
      </td>
    )
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="p-1 text-left font-normal">% of capital</th>
            {MONTHS.map((m) => (
              <th key={m} className="p-1 font-normal">
                {m}
              </th>
            ))}
            <th className="p-1 font-normal">Year</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            const yr = a.yearly.find((x) => x.year === y)
            return (
              <tr key={y}>
                <td className="p-1 text-muted-foreground">{y}</td>
                {MONTHS.map((_, m) => {
                  const hit = a.monthly.find((x) => x.year === y && x.month === m)
                  return cell(m, hit?.pnl, hit?.pct)
                })}
                <td className={cn('p-1 text-center font-medium tabular-nums', pnlClass(yr?.pnl ?? 0))} title={inr(yr?.pnl)}>
                  {yr?.pct == null ? fmt(yr?.pnl ?? 0, 0) : fmt(yr.pct, 1)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function BucketBars({ title, rows }: { title: string; rows: RunBucket[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)))
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{title}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[3.5rem_1fr_5.5rem_3rem] items-center gap-2 text-xs">
            <span className="text-muted-foreground">{r.label}</span>
            <div className="flex h-3 items-center">
              <div
                className={cn('h-full rounded-sm', r.net >= 0 ? 'bg-success' : 'bg-destructive')}
                style={{ width: `${(100 * Math.abs(r.net)) / max}%` }}
              />
            </div>
            <span className={cn('text-right tabular-nums', pnlClass(r.net))}>{fmt(r.net, 0)}</span>
            <span className="text-right tabular-nums text-muted-foreground" title={`${r.trades} trades`}>
              {fmt(r.winRate, 0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Histogram({ values }: { values: number[] }) {
  const h = histogram(values, 30)
  const max = Math.max(1, ...h.counts)
  return (
    <div>
      <div className="flex h-28 items-end gap-px">
        {h.counts.map((c, i) => {
          const lo = h.lo + i * h.width
          return (
            <div
              key={i}
              className={cn('flex-1 rounded-t-sm', lo + h.width / 2 >= 0 ? 'bg-success/70' : 'bg-destructive/70')}
              style={{ height: `${(100 * c) / max}%` }}
              title={`${fmt(lo, 0)} to ${fmt(lo + h.width, 0)}: ${c} trades`}
            />
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{inr(h.lo)}</span>
        <span>net P&L per trade</span>
        <span>{inr(h.hi)}</span>
      </div>
    </div>
  )
}

type SortKey = 'exit' | 'entry' | 'net' | 'ret' | 'hold' | 'qty' | 'mae' | 'mfe'

export function TradeLog({
  run,
  a,
  exc,
  focus,
  onFocus,
}: {
  run: EngineRun
  a: RunAnalytics
  exc: Map<RunTrade, { mae: number; mfe: number } | null>
  focus: RunTrade | null
  onFocus: (t: RunTrade) => void
}) {
  const [symbol, setSymbol] = useState('all')
  const [side, setSide] = useState('all')
  const [result, setResult] = useState('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'exit', dir: -1 })
  const [page, setPage] = useState(0)
  const costBps = run.params.cost_bps ?? 3
  const rows = useMemo(() => {
    const all = a.trades.map((t, i) => {
      const net = a.nets[i]
      const e = exc.get(t)
      return {
        t,
        n: i + 1,
        net,
        cost: tradeCost(t, costBps),
        ret: (100 * net) / Math.abs(t[3] * t[4]),
        hold: (t[2] - t[1]) / 60,
        mae: e?.mae ?? null,
        mfe: e?.mfe ?? null,
      }
    })
    const val = (r: (typeof all)[number]) =>
      ({ exit: r.t[2], entry: r.t[1], net: r.net, ret: r.ret, hold: r.hold, qty: Math.abs(r.t[3]), mae: r.mae ?? 0, mfe: r.mfe ?? 0 })[sort.key]
    return all
      .filter(
        (r) =>
          (symbol === 'all' || r.t[0] === symbol) &&
          (side === 'all' || (side === 'long') === r.t[3] > 0) &&
          (result === 'all' || (result === 'win') === r.net > 0),
      )
      .sort((x, y) => (val(x) - val(y)) * sort.dir)
  }, [a, exc, symbol, side, result, sort, costBps])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE)
  const head = (key: SortKey, label: string, right = true) => (
    <TableHead
      className={cn('cursor-pointer select-none whitespace-nowrap', right && 'text-right')}
      onClick={() => {
        setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))
        setPage(0)
      }}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </TableHead>
  )
  const pick = (value: string, set: (v: string) => void, options: [string, string][]) => (
    <Select
      value={value}
      onValueChange={(v) => {
        set(v as string)
        setPage(0)
      }}
    >
      <SelectTrigger size="sm" className="w-32">
        <SelectValue>{(v: string) => options.find(([k]) => k === v)?.[1]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([k, l]) => (
          <SelectItem key={k} value={k}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {pick(symbol, setSymbol, [['all', 'All symbols'], ...run.symbols.map((s): [string, string] => [s, s])])}
        {pick(side, setSide, [['all', 'Long & short'], ['long', 'Long'], ['short', 'Short']])}
        {pick(result, setResult, [['all', 'Wins & losses'], ['win', 'Wins'], ['loss', 'Losses']])}
        <span>
          {fmt(rows.length, 0)} trade{rows.length === 1 ? '' : 's'} · net {inr(rows.reduce((s, r) => s + r.net, 0))} · click a
          row to zoom the chart onto it
        </span>
        {pages > 1 && (
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Prev
            </Button>
            {page + 1} / {pages}
            <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </span>
        )}
      </div>
      <div className="max-h-[36rem] overflow-auto rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead>#</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              {head('qty', 'Qty')}
              {head('entry', 'Entry', false)}
              <TableHead className="text-right">Entry px</TableHead>
              {head('exit', 'Exit', false)}
              <TableHead className="text-right">Exit px</TableHead>
              {head('hold', 'Held')}
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              {head('net', 'Net')}
              {head('ret', 'Return')}
              {head('mae', 'MAE')}
              {head('mfe', 'MFE')}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => {
              const [sym, tin, tout, qty, pin, pout, gross] = r.t
              return (
                <TableRow
                  key={r.n}
                  className={cn('cursor-pointer', focus === r.t && 'bg-muted')}
                  onClick={() => onFocus(r.t)}
                >
                  <TableCell className="tabular-nums text-muted-foreground">{r.n}</TableCell>
                  <TableCell className="font-medium">{sym}</TableCell>
                  <TableCell>{qty > 0 ? 'Long' : 'Short'}</TableCell>
                  <TableCell className="text-right tabular-nums">{Math.abs(qty)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{istTime(tin)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(pin)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{istTime(tout)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(pout)}</TableCell>
                  <TableCell className="text-right tabular-nums">{hold(r.hold)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', pnlClass(gross))}>{fmt(gross)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(r.cost)}</TableCell>
                  <TableCell className={cn('text-right font-medium tabular-nums', pnlClass(r.net))}>{fmt(r.net)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', pnlClass(r.ret))}>{pct(r.ret, 2)}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">{r.mae == null ? '—' : fmt(r.mae)}</TableCell>
                  <TableCell className="text-right tabular-nums text-success">{r.mfe == null ? '—' : fmt(r.mfe)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function Notes({ run }: { run: EngineRun }) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState(run.note ?? '')
  const [tags, setTags] = useState((run.tags ?? []).join(', '))
  const save = useMutation({
    mutationFn: () =>
      saveEngineRunNotes(
        run.id,
        note.trim() || null,
        tags.split(',').map((t) => t.trim()).filter(Boolean),
      ),
    onSuccess: (r) => {
      queryClient.setQueryData<EngineRun>(['engineRun', run.id], (old) => old && { ...old, ...r })
      queryClient.invalidateQueries({ queryKey: ['engineRuns'] })
      toast.success('Saved with the run')
    },
    onError: (e) => toast.error(e.message),
  })
  const dirty = note !== (run.note ?? '') || tags !== (run.tags ?? []).join(', ')
  return (
    <div className="space-y-2">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What you learned from this run, what to try next…"
        className="min-h-24 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="tags, comma separated"
          className="h-8 max-w-sm"
        />
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Spinner className="size-3.5" />}
          Save note
        </Button>
        {(run.tags ?? []).map((t) => (
          <Badge key={t} variant="secondary">
            {t}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function Compare({ run }: { run: EngineRun }) {
  const { data: runs = [] } = useQuery({ queryKey: ['engineRuns'], queryFn: getEngineRuns })
  const [other, setOther] = useState<string | null>(null)
  const { data: that } = useQuery({
    queryKey: ['engineRun', other],
    queryFn: () => getEngineRun(other!),
    enabled: !!other,
  })
  const choices = runs.filter((r) => r.id !== run.id).slice(0, 200)
  const datasets: Dataset[] = [
    { key: runName(run), color: seriesColor(0), points: points(run.equity) },
    ...(that ? [{ key: runName(that), color: seriesColor(2), points: points(that.equity) }] : []),
  ]
  return (
    <div className="space-y-2">
      <Select value={other ?? ''} onValueChange={(v) => setOther((v as string) || null)}>
        <SelectTrigger size="sm" className="w-full max-w-md">
          <SelectValue placeholder="Pick a run to overlay…">
            {(v: string) => {
              const r = runs.find((x) => x.id === v)
              return r ? runName(r) : 'Pick a run to overlay…'
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {choices.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {runName(r)} · {r.symbols.length > 2 ? `${r.symbols.length} stocks` : r.symbols.join(', ')} · {inr(r.summary.net)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {that && (
        <>
          <div className="h-64">
            <SeriesChart datasets={datasets} fill format={inr} />
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead />
                {['Net', 'Trades', 'Win rate', 'Profit factor', 'Sharpe', 'Max DD'].map((h) => (
                  <TableHead key={h} className="text-right">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[run, that].map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-64 truncate font-medium">{runName(r)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', pnlClass(r.summary.net))}>{inr(r.summary.net)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.summary.trades}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.summary.win_rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.summary.profit_factor)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.summary.sharpe)}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">{inr(r.summary.max_dd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  )
}

export default function EngineRunPage() {
  const { runId } = useParams({ from: '/engine/runs/$runId' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: run, error } = useQuery({
    queryKey: ['engineRun', runId],
    queryFn: () => getEngineRun(runId),
    refetchInterval: (q) => (q.state.data && q.state.data.source !== 'backtest' ? 60_000 : false),
  })
  usePageTitle(run ? runName(run) : runId)
  const [focus, setFocus] = useState<RunTrade | null>(null)
  const a = useMemo(() => (run ? runAnalytics(run) : null), [run])

  // MAE/MFE need the bars each trade was held over: the same bars (and cache entries) as the chart
  const period = run && { start: istTime(run.summary.from).slice(0, 10), end: istTime(run.summary.to).slice(0, 10) }
  const barSymbols = run && run.symbols.length <= MAX_BAR_SYMBOLS ? run.symbols : []
  const barQueries = useQueries({
    queries: barSymbols.map((sym) => ({
      queryKey: ['intradayBars', sym, run!.interval, period!.start, period!.end],
      queryFn: () => getIntradayBars(sym, run!.interval, period!),
      staleTime: 5 * 60_000,
    })),
  })
  const barsReady = barQueries.filter((q) => q.data).length
  const exc = useMemo(() => {
    const out = new Map<RunTrade, { mae: number; mfe: number } | null>()
    if (!a) return out
    barSymbols.forEach((sym, i) => {
      const bars = barQueries[i]?.data?.bars
      if (!bars) return
      const mine = a.trades.filter((t) => t[0] === sym)
      excursions(mine, bars).forEach((e, j) => out.set(mine[j], e))
    })
    return out
    // barsReady stands in for the query results, which are a new array every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, barsReady])

  const rerun = useMutation({
    mutationFn: () => runEngineBacktest(rerunRequest(run!)),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['engineRuns'] })
      toast.success('Re-ran with the same config')
      navigate({ to: '/engine/runs/$runId', params: { runId: res.runs[0].id } })
    },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: () => deleteEngineRun(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['engineRuns'] })
      navigate({ to: '/engine', search: { tab: 'backtest' } })
    },
    onError: (e) => toast.error(e.message),
  })

  const back = (
    <Link to="/engine" search={{ tab: 'backtest', run: runId }} className="no-print inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon className="size-4" /> Algo engine
    </Link>
  )
  if (error)
    return (
      <div className="space-y-4">
        {back}
        <p className="text-sm text-destructive">{error.message}</p>
      </div>
    )
  if (!run || !a)
    return (
      <div className="space-y-4">
        {back}
        <Spinner className="size-4" />
      </div>
    )

  const s = run.summary
  const sized = run.sizing && run.sizing.mode !== 'fixed'
  const equity: Dataset[] = [{ key: 'Equity', color: seriesColor(0), points: points(run.equity) }]
  const underwater: Dataset[] = [{ key: 'Under water %', color: seriesColor(3), points: points(a.underwater) }]
  const bySymbolCurves: Dataset[] = a.bySymbol
    .slice(0, 8)
    .map((x, i) => ({ key: x.symbol, color: seriesColor(i), points: points(dedupe(x.curve)) }))
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {back}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-lg font-medium">{runName(run)}</h1>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant={run.source === 'live' ? 'destructive' : run.source === 'paper' ? 'secondary' : 'outline'}>
                {run.source}
              </Badge>
              {run.halted && <Badge variant="destructive">halted</Badge>}
              {sized && <Badge>{run.sizing!.mode === 'all_in' ? 'All-in' : 'Scale qty'} · {inr(run.sizing!.capital)}</Badge>}
              {run.job != null && (
                <Link to="/engine" search={{ tab: 'jobs' }}>
                  <Badge variant="secondary">job #{run.job}</Badge>
                </Link>
              )}
              <span>
                {run.strategy} · {run.interval} · {run.symbols.join(', ')} ·{' '}
                {Object.entries(run.params)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' ')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {istTime(s.from)} → {istTime(s.to)} IST · created {formatDateTime(run.created)}
              {run.batch && (
                <>
                  {' · batch '}
                  <Link to="/engine" search={{ tab: 'backtest', batch: run.batch, run: run.id }} className="text-primary hover:underline">
                    {run.batch}
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            {run.source === 'backtest' && (
              <>
                <Button size="sm" disabled={rerun.isPending} onClick={() => rerun.mutate()} title="Same strategy, params, symbols, sizing and bars">
                  {rerun.isPending ? <Spinner className="size-3.5" /> : <PlayIcon />} Re-run
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(rerunRequest(run)))
                    navigate({ to: '/engine', search: { tab: 'backtest' } })
                  }}
                >
                  <PencilIcon /> Re-run & edit
                </Button>
              </>
            )}
            <ExportMenu name={run.id} sheets={() => runSheets(run)} csvSheet={1} />
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <PrinterIcon /> PDF
            </Button>
            <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2Icon /> Delete
            </Button>
          </div>
        </div>
      </div>

      <Section title="Performance" hint={`% figures on ${inr(a.capital)} - ${a.capitalBasis === 'compound' ? 'the Compound capital' : 'the most notional this run had open at once'}`}>
        <MetricsGrid run={run} a={a} />
      </Section>

      <Section title="Equity, drawdown and consistency">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Equity (₹)</p>
            <div className="h-64">
              <SeriesChart datasets={equity} fill format={inr} />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Under water - % below the account's peak</p>
            <div className="h-64">
              <SeriesChart datasets={underwater} fill format={(v) => `${fmt(v, 2)}%`} />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Daily P&L</p>
            <DailyBars daily={run.daily} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Rolling Sharpe · 63 sessions</p>
            {a.rollingSharpe.length ? (
              <div className="h-44">
                <SeriesChart datasets={[{ key: 'Sharpe', color: seriesColor(1), points: points(a.rollingSharpe) }]} fill />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Needs at least 63 sessions.</p>
            )}
          </div>
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Monthly returns">
          <ReturnsHeatmap a={a} />
        </Section>
        <Section title="Worst drawdowns" hint="peak to recovery">
          {a.drawdowns.length ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Peak</TableHead>
                  <TableHead>Trough</TableHead>
                  <TableHead>Recovered</TableHead>
                  <TableHead className="text-right">Depth</TableHead>
                  <TableHead className="text-right">Length</TableHead>
                  <TableHead className="text-right">Recovery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.drawdowns.map((d) => (
                  <TableRow key={d.start}>
                    <TableCell className="tabular-nums">{istTime(d.start).slice(0, 10)}</TableCell>
                    <TableCell className="tabular-nums">{istTime(d.trough).slice(0, 10)}</TableCell>
                    <TableCell className="tabular-nums">{d.end ? istTime(d.end).slice(0, 10) : <span className="text-destructive">not yet</span>}</TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {inr(-d.depth)} · {pct(d.pct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{d.days}d</TableCell>
                    <TableCell className="text-right tabular-nums">{d.recovery == null ? '—' : `${d.recovery}d`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Never below a previous high.</p>
          )}
        </Section>
      </div>

      <Section title="Per symbol" hint="net of costs">
        <div className="grid gap-4 lg:grid-cols-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead className="text-right">Win rate</TableHead>
                <TableHead className="text-right">PF</TableHead>
                <TableHead className="text-right">Avg hold</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {a.bySymbol.map((x) => (
                <TableRow key={x.symbol}>
                  <TableCell className="font-medium">{x.symbol}</TableCell>
                  <TableCell className="text-right tabular-nums">{x.trades}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', pnlClass(x.net))}>{inr(x.net)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(x.share)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(x.winRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(x.profitFactor)}</TableCell>
                  <TableCell className="text-right tabular-nums">{hold(x.avgHoldMin)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Each symbol's own net P&L{a.bySymbol.length > 8 ? ' · top 8' : ''}
            </p>
            <div className="h-64">
              <SeriesChart datasets={bySymbolCurves} fill format={inr} />
            </div>
          </div>
        </div>
        <div className="mt-4">
          <ExecutionsChart run={run} focus={focus} />
        </div>
      </Section>

      <Section title="When it makes its money" hint="net by entry time · % = win rate">
        <div className="grid gap-6 md:grid-cols-3">
          {run.interval !== '1D' && <BucketBars title="Hour of day (IST)" rows={a.byHour} />}
          <BucketBars title="Weekday" rows={a.byWeekday} />
          <BucketBars title="Month" rows={a.byMonth} />
        </div>
      </Section>

      <Section
        title="Trades"
        hint={
          barSymbols.length < run.symbols.length
            ? `MAE/MFE are shown for runs of up to ${MAX_BAR_SYMBOLS} symbols`
            : barsReady < barSymbols.length
              ? `loading bars for MAE/MFE (${barsReady}/${barSymbols.length})`
              : 'MAE / MFE = worst / best open P&L while held'
        }
      >
        <div className="space-y-4">
          <Histogram values={a.nets} />
          <TradeLog run={run} a={a} exc={exc} focus={focus} onFocus={setFocus} />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Costs & sizing">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Gross P&L" value={inr(s.gross)} className={pnlClass(s.gross)} />
            <Stat label="Costs" value={inr(s.costs)} />
            <Stat label="Net P&L" value={inr(s.net)} className={pnlClass(s.net)} />
            <Stat label="Cost drag" value={pct(a.costDragPct)} />
            <Stat label="Cost / trade" value={inr(s.trades ? s.costs / s.trades : 0)} />
            <Stat label="Cost (bps/side)" value={fmt(run.params.cost_bps ?? 3, 1)} />
            {sized && (
              <>
                <Stat label="Starting capital" value={inr(run.sizing!.capital)} />
                <Stat label="Ending account" value={inr(run.sizing!.capital + s.net)} className={pnlClass(s.net)} />
                <Stat label="Sizing" value={run.sizing!.mode === 'all_in' ? 'All-in' : 'Scale qty'} />
              </>
            )}
          </div>
          <p className="mb-1 mt-4 text-xs text-muted-foreground">
            Shares per trade, at entry{sized ? ' - compounding moves it with the account' : ''}
          </p>
          <div className="h-44">
            <SeriesChart datasets={[{ key: 'Qty', color: seriesColor(4), points: points(dedupe(a.sizes)) }]} fill format={(v) => fmt(v, 0)} />
          </div>
        </Section>

        <Section title="Data provenance" hint="what the run's bars actually covered">
          {run.source === 'backtest' ? (
            <div className="space-y-3">
              <HistoryLine history={run.history} coverage={run.coverage} skipped={run.skipped} />
              {run.coverage && (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Symbol</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                      <TableHead className="text-right">Missing</TableHead>
                      <TableHead>Adjusted</TableHead>
                      <TableHead>Jumps to check</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(run.coverage).map(([sym, c]) => (
                      <TableRow key={sym}>
                        <TableCell className="font-medium">{sym}</TableCell>
                        <TableCell className="tabular-nums">{c.from}</TableCell>
                        <TableCell className="tabular-nums">{c.to}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.sessions}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', c.missing?.sessions && 'text-destructive')} title={c.missing ? `${c.missing.from} → ${c.missing.to}` : undefined}>
                          {c.missing?.sessions ?? 0}
                        </TableCell>
                        <TableCell className="text-xs">{c.adjusted?.map((x) => `${x.date} ×${fmt(x.ratio, 3)}`).join(', ') || '—'}</TableCell>
                        <TableCell className="text-xs text-destructive">{c.jumps?.map((x) => `${x.date} ${pct(x.move * 100, 0)}`).join(', ') || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">A {run.source} session: its bars are the live market's, not a stored range.</p>
          )}
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="How it was made">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Run id</dt>
            <dd className="font-mono text-xs">{run.id}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDateTime(run.created)}</dd>
            <dt className="text-muted-foreground">Started by</dt>
            <dd>{run.job != null ? `background job #${run.job}` : run.source === 'backtest' ? 'Run now' : `the ${run.source} engine`}</dd>
            {run.engine && (
              <>
                <dt className="text-muted-foreground">Engine build</dt>
                <dd className="font-mono text-xs">{run.engine.build ?? 'unknown'}</dd>
                <dt className="text-muted-foreground">Engine time</dt>
                <dd>{fmt(run.engine.ms, 0)} ms</dd>
                <dt className="text-muted-foreground">Command</dt>
                <dd className="flex items-start gap-1">
                  <code className="break-all rounded bg-muted px-1.5 py-1 text-xs">{run.engine.cmd}</code>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Copy command"
                    className="no-print"
                    onClick={() => navigator.clipboard.writeText(run.engine!.cmd).then(() => toast.success('Copied'))}
                  >
                    <CopyIcon />
                  </Button>
                </dd>
              </>
            )}
          </dl>
          {!run.engine && run.source === 'backtest' && (
            <p className="mt-2 text-xs text-muted-foreground">Runs made before this page existed didn't record their engine command or build.</p>
          )}
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Every param and the request</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted p-2">
              {JSON.stringify({ params: run.params, request: run.request ?? rerunRequest(run) }, null, 2)}
            </pre>
          </details>
        </Section>
        <Section title="Notes & tags" hint="saved inside the run's own file">
          <Notes key={run.id} run={run} />
        </Section>
      </div>

      <Section title="Compare with another run">
        <Compare run={run} />
      </Section>
    </div>
  )
}

/** A line series needs strictly increasing times: several trades can exit on the same bar. */
export function dedupe(xs: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [t, v] of [...xs].sort((a, b) => a[0] - b[0])) {
    if (out.length && out[out.length - 1][0] === t) out[out.length - 1][1] = v
    else if (!out.length || t > out[out.length - 1][0]) out.push([t, v])
  }
  return out
}

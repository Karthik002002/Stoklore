import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { HistogramSeries, createChart } from 'lightweight-charts'
import type { UTCTimestamp } from 'lightweight-charts'
import { PlayIcon, RefreshCwIcon, SettingsIcon, Trash2Icon, XIcon } from 'lucide-react'
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
import { comboCount, drawdown, istTime, parseValues, sweepGrid } from '@/lib/engine'
import { fmt, formatDateTime, inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import type { EngineRun, EngineRunRow, EngineSettings } from '@/services/api'
import {
  deleteEngineBatch,
  deleteEngineRun,
  getEngineRun,
  getEngineRuns,
  getEngineSettings,
  getEngineStrategies,
  runEngineBacktest,
  syncEngineLive,
} from '@/services/api'

// The C++ engine (a separate repo, located via the settings dialog) seen from Stoklore: start backtests and parameter sweeps on
// Stoklore's own bars, and read backtest, paper and live runs side by side. Every run is the
// engine's report JSON (app/routers/engine.py), so all three sources render through the same views.

const INTERVALS = ['1m', '5m', '15m', '1H', '4H']
const SOURCES = ['all', 'backtest', 'paper', 'live'] as const
type Source = (typeof SOURCES)[number]
type Metric = 'net' | 'sharpe' | 'max_dd' | 'win_rate'
const METRICS: Record<Metric, { label: string; better: 1 | -1; format: (v: number) => string }> = {
  net: { label: 'Net P&L', better: 1, format: inr },
  sharpe: { label: 'Sharpe', better: 1, format: (v) => fmt(v) },
  max_dd: { label: 'Max drawdown', better: -1, format: inr },
  win_rate: { label: 'Win rate', better: 1, format: (v) => `${fmt(v, 1)}%` },
}
type SortKey = 'created' | Metric | 'trades'
const COLORS = { text: '#9ca3af', grid: 'rgba(148, 163, 184, 0.15)', up: '#22c55e', down: '#ef4444' }

const pnlClass = (v: number) => (v > 0 ? 'text-success' : v < 0 ? 'text-destructive' : '')

/** The params that tell runs apart: the ones the sweep varied, or all but cost for a single run. */
const paramText = (r: EngineRunRow) =>
  Object.entries(r.params)
    .filter(([k]) => (r.varied?.length ? r.varied.includes(k) : k !== 'cost_bps'))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')

const runName = (r: EngineRunRow) =>
  r.source === 'backtest'
    ? `${r.label ?? r.strategy} ${paramText(r)}`
    : `${r.source} ${r.id.replace(/^(paper|live)-/, '')}`

function Panel({
  title,
  actions,
  children,
}: {
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="rounded-xl border bg-card p-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className={cn('text-lg font-semibold tabular-nums', className)}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function RunForm({ onDone }: { onDone: (batch: string, ids: string[]) => void }) {
  const { data: strategies, error } = useQuery({
    queryKey: ['engineStrategies'],
    queryFn: getEngineStrategies,
  })
  const [name, setName] = useState<string | null>(null)
  const [symbols, setSymbols] = useState('RELIANCE, INFY')
  const [barInterval, setBarInterval] = useState('5m')
  const [values, setValues] = useState<Record<string, string>>({})
  const [cost, setCost] = useState('3')
  const [label, setLabel] = useState('')

  const strategy = strategies?.find((s) => s.name === name) ?? strategies?.[0]
  const parsed = Object.entries(strategy?.params ?? {}).map(
    ([k, d]) => [k, parseValues(values[k] ?? String(d))] as const,
  )
  const invalid = parsed.filter(([, v]) => v === null).map(([k]) => k)
  const count = comboCount(parsed.map(([, v]) => v ?? []))

  const run = useMutation({
    mutationFn: () =>
      runEngineBacktest({
        strategy: strategy!.name,
        symbols: symbols.split(/[\s,]+/).filter(Boolean),
        interval: barInterval,
        params: Object.fromEntries(parsed.filter(([, v]) => v?.length)) as Record<string, number[]>,
        cost_bps: Number(cost) || 0,
        label: label.trim() || null,
      }),
    onSuccess: (res) => {
      toast.success(`${res.runs.length} backtest${res.runs.length === 1 ? '' : 's'} done`)
      onDone(
        res.batch,
        res.runs.map((r) => r.id),
      )
    },
    onError: (e) => toast.error(e.message),
  })

  if (error) return <p className="text-sm text-destructive">{error.message}</p>
  if (!strategy) return <Spinner className="size-4" />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Strategy">
          <Select
            value={strategy.name}
            onValueChange={(v) => {
              setName(v as string)
              setValues({})
            }}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {strategies!.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Symbols">
          <Input
            value={symbols}
            onChange={(e) => setSymbols(e.target.value)}
            className="h-7 w-52 uppercase"
          />
        </Field>
        <Field label="Bars">
          <Select value={barInterval} onValueChange={(v) => setBarInterval(v as string)}>
            <SelectTrigger size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVALS.map((i) => (
                <SelectItem key={i} value={i}>
                  {i}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {parsed.map(([k]) => (
          <Field key={k} label={k}>
            <Input
              value={values[k] ?? String(strategy.params[k])}
              onChange={(e) => setValues({ ...values, [k]: e.target.value })}
              aria-invalid={invalid.includes(k)}
              className="h-7 w-28 font-mono text-xs"
            />
          </Field>
        ))}
        <Field label="Cost (bps/side)">
          <Input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            inputMode="decimal"
            className="h-7 w-20"
          />
        </Field>
        <Field label="Label">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="optional"
            className="h-7 w-32"
          />
        </Field>
        <Button
          size="sm"
          disabled={invalid.length > 0 || count > 200 || run.isPending}
          onClick={() => run.mutate()}
        >
          {run.isPending ? <Spinner className="size-3.5" /> : <PlayIcon />}
          Run {count > 1 ? `${count} backtests` : 'backtest'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Each param takes one value, a list <code>5,9,13</code> or a range <code>5:20:5</code> - every
        combination runs (max 200). Orders fill at the next bar's open; positions square off at 15:15.
      </p>
    </div>
  )
}

function SyncLive({ settings }: { settings?: EngineSettings }) {
  const queryClient = useQueryClient()
  const sync = useMutation({
    mutationFn: syncEngineLive,
    onSuccess: (r) => {
      toast.success(`${r.reports} paper/live session report${r.reports === 1 ? '' : 's'}`)
      queryClient.invalidateQueries({ queryKey: ['engineRuns'] })
      queryClient.invalidateQueries({ queryKey: ['engineRun'] })
    },
    onError: (e) => toast.error(e.message),
  })
  if (!settings?.vps) return null
  return (
    <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
      {sync.isPending ? <Spinner className="size-3.5" /> : <RefreshCwIcon />}
      Sync live
    </Button>
  )
}

function DailyBars({ daily }: { daily: [number, number][] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !daily.length) return
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: COLORS.text, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: COLORS.grid } },
      timeScale: { borderVisible: false },
      rightPriceScale: { borderVisible: false },
      localization: { priceFormatter: (p: number) => inr(p) },
    })
    chart.addSeries(HistogramSeries, { priceLineVisible: false }).setData(
      daily.map(([t, v]) => ({
        time: t as UTCTimestamp,
        value: v,
        color: v >= 0 ? COLORS.up : COLORS.down,
      })),
    )
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [daily])
  return <div ref={ref} className="h-44" />
}

function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: run, error } = useQuery({
    queryKey: ['engineRun', id],
    queryFn: () => getEngineRun(id),
    refetchInterval: (q) => (q.state.data && q.state.data.source !== 'backtest' ? 60_000 : false),
  })
  const remove = useMutation({
    mutationFn: () => deleteEngineRun(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['engineRuns'] })
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })
  const datasets = useMemo<Dataset[]>(
    () =>
      run
        ? [
            {
              key: 'Equity',
              color: seriesColor(0),
              points: run.equity.map(([t, v]) => ({ time: t as UTCTimestamp, value: v })),
            },
            {
              key: 'Drawdown',
              color: seriesColor(3),
              points: drawdown(run.equity).map(([t, v]) => ({ time: t as UTCTimestamp, value: v })),
            },
          ]
        : [],
    [run],
  )

  const title = run ? runName(run) : id
  const actions = (
    <>
      <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
        <Trash2Icon /> Delete
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}>
        <XIcon />
      </Button>
    </>
  )
  if (error)
    return (
      <Panel title={title} actions={actions}>
        <p className="text-sm text-destructive">{error.message}</p>
      </Panel>
    )
  if (!run)
    return (
      <Panel title={title} actions={actions}>
        <Spinner className="size-4" />
      </Panel>
    )

  const s = run.summary
  const trades = run.trades.slice(-300).reverse()
  return (
    <Panel title={title} actions={actions}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge
            variant={run.source === 'live' ? 'destructive' : run.source === 'paper' ? 'secondary' : 'outline'}
          >
            {run.source}
          </Badge>
          {run.halted && <Badge variant="destructive">halted</Badge>}
          <span>
            {run.strategy} · {run.interval} · {run.symbols.join(', ')} ·{' '}
            {Object.entries(run.params)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ')}
          </span>
          <span className="ml-auto">
            {istTime(s.from)} → {istTime(s.to)} IST
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Net P&L" value={inr(s.net)} className={pnlClass(s.net)} />
          <Stat label="Gross P&L" value={inr(s.gross)} className={pnlClass(s.gross)} />
          <Stat label="Costs" value={inr(s.costs)} />
          <Stat label="Trades" value={fmt(s.trades, 0)} />
          <Stat label="Win rate" value={`${fmt(s.win_rate, 1)}%`} />
          <Stat label="Avg win / loss" value={`${fmt(s.avg_win)} / ${fmt(s.avg_loss)}`} />
          <Stat label="Max drawdown" value={inr(s.max_dd)} className="text-destructive" />
          <Stat label={`Sharpe (${s.days} days)`} value={fmt(s.sharpe)} className={pnlClass(s.sharpe)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-72 lg:col-span-2">
            <SeriesChart datasets={datasets} fill format={inr} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Daily P&L</p>
            <DailyBars daily={run.daily} />
            <Table className="mt-2">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Gross P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(run.by_symbol).map(([sym, v]) => (
                  <TableRow key={sym}>
                    <TableCell className="font-medium">{sym}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.trades}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', pnlClass(v.pnl))}>
                      {inr(v.pnl)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Trades{' '}
            {run.trades.length > trades.length ? `(latest ${trades.length} of ${run.trades.length})` : ''}
          </p>
          <div className="max-h-96 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead className="text-right">Entry px</TableHead>
                  <TableHead>Exit</TableHead>
                  <TableHead className="text-right">Exit px</TableHead>
                  <TableHead className="text-right">Gross P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map(([sym, tin, tout, qty, pin, pout, pnl], i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{sym}</TableCell>
                    <TableCell>{qty > 0 ? 'Long' : 'Short'}</TableCell>
                    <TableCell className="text-right tabular-nums">{Math.abs(qty)}</TableCell>
                    <TableCell className="tabular-nums">{istTime(tin)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(pin)}</TableCell>
                    <TableCell className="tabular-nums">{istTime(tout)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(pout)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', pnlClass(pnl))}>{inr(pnl)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function CompareChart({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const [mode, setMode] = useState<'equity' | 'drawdown'>('equity')
  // combine is memoized by TanStack while the query results are unchanged, so the chart only
  // rebuilds when a run loads or the mode flips
  const combine = useCallback(
    (results: UseQueryResult<EngineRun>[]) => {
      const seen = new Map<string, number>()
      const datasets = results.flatMap((r, i): Dataset[] => {
        if (!r.data) return []
        const base = runName(r.data)
        const n = (seen.get(base) ?? 0) + 1
        seen.set(base, n)
        const curve = mode === 'equity' ? r.data.equity : drawdown(r.data.equity)
        return [
          {
            key: n > 1 ? `${base} (${n})` : base,
            color: seriesColor(i),
            points: curve.map(([t, v]) => ({ time: t as UTCTimestamp, value: v })),
          },
        ]
      })
      return { datasets, loading: results.some((r) => r.isPending) }
    },
    [mode],
  )
  const { datasets, loading } = useQueries({
    queries: ids.map((id) => ({ queryKey: ['engineRun', id], queryFn: () => getEngineRun(id) })),
    combine,
  })

  return (
    <Panel
      title={`Compare ${ids.length} run${ids.length === 1 ? '' : 's'}`}
      actions={
        <>
          {(['equity', 'drawdown'] as const).map((m) => (
            <Button key={m} size="sm" variant={mode === m ? 'secondary' : 'ghost'} onClick={() => setMode(m)}>
              {m === 'equity' ? 'Equity' : 'Drawdown'}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </>
      }
    >
      {loading && !datasets.length ? (
        <Spinner className="size-4" />
      ) : (
        <div className="h-80">
          <SeriesChart datasets={datasets} fill format={inr} />
        </div>
      )}
    </Panel>
  )
}

function SweepHeatmap({
  runs,
  onOpen,
  onCompare,
  onDeleted,
}: {
  runs: EngineRunRow[]
  onOpen: (id: string) => void
  onCompare: (ids: string[]) => void
  onDeleted: () => void
}) {
  const queryClient = useQueryClient()
  const varied = runs[0]?.varied ?? []
  const [metric, setMetric] = useState<Metric>('net')
  const [axes, setAxes] = useState<[string, string?]>([varied[0], varied[1]])
  const rowKey = varied.includes(axes[0]) ? axes[0] : varied[0]
  const colKey =
    axes[1] && varied.includes(axes[1]) && axes[1] !== rowKey ? axes[1] : varied.find((k) => k !== rowKey)
  const remove = useMutation({
    mutationFn: () => deleteEngineBatch(runs[0].batch!),
    onSuccess: (r) => {
      toast.success(`Deleted ${r.deleted} runs`)
      queryClient.invalidateQueries({ queryKey: ['engineRuns'] })
      onDeleted()
    },
    onError: (e) => toast.error(e.message),
  })

  const value = (r: EngineRunRow) => r.summary[metric]
  const m = METRICS[metric]
  const best = (cell: EngineRunRow[]) =>
    cell.reduce<EngineRunRow | undefined>(
      (a, r) => (!a || (value(r) - value(a)) * m.better > 0 ? r : a),
      undefined,
    )
  const all = runs.map(value)
  const [lo, hi] = [Math.min(...all), Math.max(...all)]
  // rank colour within this sweep: best green, worst red, whatever the absolute numbers are
  const heat = (v: number) => {
    const score = hi === lo ? 0.5 : m.better === 1 ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)
    return score >= 0.5
      ? `color-mix(in oklch, var(--success) ${Math.round((score - 0.5) * 120)}%, transparent)`
      : `color-mix(in oklch, var(--destructive) ${Math.round((0.5 - score) * 120)}%, transparent)`
  }
  const grid = varied.length ? sweepGrid(runs, rowKey, colKey) : null
  const top = [...runs].sort((a, b) => (value(b) - value(a)) * m.better)[0]

  return (
    <Panel
      title={`Sweep ${runs[0]?.label ?? runs[0]?.strategy} · ${runs.length} runs · ${runs[0]?.symbols.join(', ')} ${runs[0]?.interval}`}
      actions={
        <>
          <Select value={metric} onValueChange={(v) => setMetric(v as Metric)}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(METRICS) as Metric[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {METRICS[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => onCompare(runs.map((r) => r.id).slice(0, 12))}>
            Compare all
          </Button>
          <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
            <Trash2Icon /> Delete sweep
          </Button>
        </>
      }
    >
      {top && (
        <p className="mb-3 text-sm">
          Best by {m.label.toLowerCase()}:{' '}
          <button
            type="button"
            className="font-medium underline-offset-4 hover:underline"
            onClick={() => onOpen(top.id)}
          >
            {paramText(top) || top.strategy}
          </button>{' '}
          - {m.format(value(top))}
        </p>
      )}
      {!grid ? (
        <p className="text-sm text-muted-foreground">
          Single run - give a param a list or range to sweep it.
        </p>
      ) : (
        <div className="space-y-2">
          {varied.length > 2 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Rows
              {[0, 1].map((i) => (
                <Select
                  key={i}
                  value={i === 0 ? rowKey : colKey}
                  onValueChange={(v) => setAxes(i === 0 ? [v as string, colKey] : [rowKey, v as string])}
                >
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {varied.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
              columns · each cell shows its best run over the other params
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="text-xs tabular-nums">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-normal text-muted-foreground">
                    {rowKey} {colKey ? `↓ ${colKey} →` : ''}
                  </th>
                  {colKey &&
                    grid.cols.map((c) => (
                      <th key={c} className="px-2 py-1 text-right font-medium">
                        {c}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row}>
                    <th className="px-2 py-1 text-left font-medium">{row}</th>
                    {grid.cols.map((col) => {
                      const r = best(grid.cell(row, col))
                      return (
                        <td key={col} className="p-0.5">
                          {r ? (
                            <button
                              type="button"
                              title={runName(r)}
                              onClick={() => onOpen(r.id)}
                              className="w-full min-w-20 rounded px-2 py-1.5 text-right hover:ring-2 hover:ring-ring"
                              style={{ background: heat(value(r)) }}
                            >
                              {m.format(value(r))}
                            </button>
                          ) : (
                            <span className="block px-2 py-1.5 text-right text-muted-foreground">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}

function RunsTable({
  runs,
  selected,
  onToggle,
  onOpen,
  active,
}: {
  runs: EngineRunRow[]
  selected: string[]
  onToggle: (id: string) => void
  onOpen: (r: EngineRunRow) => void
  active?: string
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created', dir: -1 })
  const key = (r: EngineRunRow) =>
    sort.key === 'created' ? r.created : sort.key === 'trades' ? r.summary.trades : r.summary[sort.key]
  const sorted = [...runs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * sort.dir)
  const Head = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <TableHead className={cn(k !== 'created' && 'text-right')}>
      <button
        type="button"
        className="hover:text-foreground"
        onClick={() => setSort({ key: k, dir: sort.key === k ? (-sort.dir as 1 | -1) : -1 })}
      >
        {children}
        {sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
    </TableHead>
  )

  if (!runs.length)
    return <p className="text-sm text-muted-foreground">No runs yet - start a backtest above.</p>
  return (
    <div className="max-h-[32rem] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8" />
            <TableHead>Run</TableHead>
            <TableHead>Symbols</TableHead>
            <Head k="net">Net P&L</Head>
            <Head k="trades">Trades</Head>
            <Head k="win_rate">Win %</Head>
            <Head k="max_dd">Max DD</Head>
            <Head k="sharpe">Sharpe</Head>
            <Head k="created">When</Head>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow
              key={r.id}
              className={cn('cursor-pointer', active === r.id && 'bg-muted')}
              onClick={() => onOpen(r)}
            >
              <TableCell onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Compare ${runName(r)}`}
                  checked={selected.includes(r.id)}
                  onChange={() => onToggle(r.id)}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  {r.source !== 'backtest' && (
                    <Badge variant={r.source === 'live' ? 'destructive' : 'secondary'}>{r.source}</Badge>
                  )}
                  <span className="font-medium">{r.label ?? r.strategy}</span>
                  <span className="font-mono text-xs text-muted-foreground">{paramText(r)}</span>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {r.symbols.join(', ')} · {r.interval}
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', pnlClass(r.summary.net))}>
                {inr(r.summary.net)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.summary.trades}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(r.summary.win_rate, 1)}</TableCell>
              <TableCell className="text-right tabular-nums">{inr(r.summary.max_dd)}</TableCell>
              <TableCell className={cn('text-right tabular-nums', pnlClass(r.summary.sharpe))}>
                {fmt(r.summary.sharpe)}
              </TableCell>
              <TableCell className="text-muted-foreground">{formatDateTime(r.created)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default function Engine() {
  const { run, batch } = useSearch({ from: '/engine' })
  const navigate = useNavigate({ from: '/engine' })
  const queryClient = useQueryClient()
  const { data: runs = [] } = useQuery({
    queryKey: ['engineRuns'],
    queryFn: getEngineRuns,
    refetchInterval: 60_000,
  })
  const { data: settings } = useQuery({ queryKey: ['engineSettings'], queryFn: getEngineSettings })
  usePageTitle(settings?.name ?? 'Algo engine')
  const [source, setSource] = useState<Source>('all')
  const [picked, setPicked] = useState<string[]>([])

  const ids = new Set(runs.map((r) => r.id))
  const selected = picked.filter((id) => ids.has(id))
  const shown = source === 'all' ? runs : runs.filter((r) => r.source === source)
  const activeBatch = batch && runs.some((r) => r.batch === batch) ? batch : runs.find((r) => r.batch)?.batch
  const open = (id?: string, nextBatch = activeBatch) => navigate({ search: { run: id, batch: nextBatch } })

  return (
    <div className="space-y-6">
      <h1 className="font-medium">{settings?.name}</h1>
      <Panel
        title="New backtest"
        actions={
          <>
            <SyncLive settings={settings} />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Engine settings"
              render={<Link to="/settings" search={{ tab: 'engine' }} />}
            >
              <SettingsIcon />
            </Button>
          </>
        }
      >
        {!settings ? (
          <Spinner className="size-4" />
        ) : !settings.engine_dir ? (
          <div className="space-y-2 text-sm">
            <p>
              Point Stoklore at your checkout of the C++ trading engine: clone it anywhere, run{' '}
              <code>make</code> in it, then set its folder in Settings.
            </p>
            <Button size="sm" render={<Link to="/settings" search={{ tab: 'engine' }} />}>
              <SettingsIcon /> Set engine folder
            </Button>
          </div>
        ) : !settings.built ? (
          <p className="text-sm">
            The engine in <code>{settings.engine_dir}</code> isn't built yet - run <code>make</code> there,
            then reload.
          </p>
        ) : (
          <RunForm
            onDone={(b, newIds) => {
              queryClient.invalidateQueries({ queryKey: ['engineRuns'] })
              setPicked(newIds.slice(0, 12))
              open(newIds.length === 1 ? newIds[0] : undefined, b)
            }}
          />
        )}
      </Panel>

      {run && <RunDetail key={run} id={run} onClose={() => open(undefined)} />}

      {selected.length > 0 && <CompareChart ids={selected} onClear={() => setPicked([])} />}

      {activeBatch && (
        <SweepHeatmap
          key={activeBatch}
          runs={runs.filter((r) => r.batch === activeBatch)}
          onOpen={(id) => open(id)}
          onCompare={setPicked}
          onDeleted={() => open(undefined, undefined)}
        />
      )}

      <Panel
        title={`Runs (${shown.length})`}
        actions={SOURCES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={source === s ? 'secondary' : 'ghost'}
            onClick={() => setSource(s)}
          >
            {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
          </Button>
        ))}
      >
        <RunsTable
          runs={shown}
          selected={selected}
          active={run}
          onToggle={(id) =>
            setPicked(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
          }
          onOpen={(r) => open(r.id, r.batch ?? activeBatch)}
        />
      </Panel>
    </div>
  )
}

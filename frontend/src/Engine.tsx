import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { CandlestickSeries, HistogramSeries, createChart, createSeriesMarkers } from 'lightweight-charts'
import type { UTCTimestamp } from 'lightweight-charts'
import { DownloadIcon, PlayIcon, RefreshCwIcon, SettingsIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import SeriesChart from '@/components/charts/SeriesChart'
import { seriesColor } from '@/components/charts/colors'
import type { Dataset } from '@/components/charts/colors'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  comboCount,
  drawdown,
  fanPaths,
  focusRange,
  histogram,
  istTime,
  markerRange,
  noTrades,
  oatSeries,
  runSheets,
  runsSheet,
  sweepSheets,
  parseValues,
  spread,
  sweepCount,
  sweepGrid,
  tradeMarkers,
} from '@/lib/engine'
import type { RunTrade } from '@/lib/engine'
import { fmt, formatDateTime, inr } from '@/lib/format'
import type { SheetData } from '@/lib/exportFile'
import { downloadCsv, downloadXlsx } from '@/lib/exportFile'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import type { EngineRun, EngineRunRow, EngineSettings, EngineSweepRow, EngineSweepRun } from '@/services/api'
import {
  deleteEngineBatch,
  deleteEngineRun,
  deleteEngineSweep,
  getEngineRun,
  getEngineRuns,
  getEngineSettings,
  getEngineStrategies,
  getEngineSweep,
  getEngineSweeps,
  getIntradayBars,
  runEngineBacktest,
  runEngineSweep,
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

//: How many markers (two per trade) the executions chart frames when it opens - see ExecutionsChart.
const OPENING_MARKERS = 40

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
    : `${r.strategy} ${r.source} ${r.id.slice(-10)}` // live ids end in the date: <strategy>-<source>-YYYY-MM-DD

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

/** Excel gets every sheet; CSV holds one table, so it gets `csvSheet` (the main one). Sheets are
 *  built on click, not on every render - a sweep can have thousands of rows. */
function ExportMenu({
  name,
  sheets,
  csvSheet = 0,
}: {
  name: string
  sheets: () => SheetData[]
  csvSheet?: number
}) {
  const file = name.replace(/[^\w.-]+/g, '_')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
        <DownloadIcon /> Export
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => downloadXlsx(sheets(), file)}>
          Excel (.xlsx) - all sheets
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            const all = sheets()
            downloadCsv(
              all[csvSheet],
              `${file}-${(all[csvSheet].sheet ?? 'data').toLowerCase().replace(/\W+/g, '_')}`,
            )
          }}
        >
          CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

type Mode = 'single' | 'oat' | 'grid'
const MODES: Record<Mode, string> = { single: 'Backtest', oat: 'One at a time', grid: 'Grid' }
const MODE_HELP: Record<Mode, React.ReactNode> = {
  single: (
    <>
      Each param takes one value, or a list <code>5,9,13</code> / range <code>5:20:5</code> to run every
      combination as full backtests (max 200).
    </>
  ),
  oat: (
    <>
      Give each param to calibrate a range (<code>5:20:1</code>) or list; every swept param walks its range
      while the others stay at their <em>base</em>, so each chart shows that param's effect alone. A param
      with one value is fixed.
    </>
  ),
  grid: (
    <>
      Every combination of the swept params' values (max 20,000), to see how they interact. A param with one
      value is fixed.
    </>
  ),
}

function RunForm({
  onDone,
  onSweep,
}: {
  onDone: (batch: string, ids: string[]) => void
  onSweep: (id: string) => void
}) {
  const { data: strategies, error } = useQuery({
    queryKey: ['engineStrategies'],
    queryFn: getEngineStrategies,
  })
  const [name, setName] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('oat')
  const [symbols, setSymbols] = useState('RELIANCE, INFY')
  const [barInterval, setBarInterval] = useState('5m')
  const [values, setValues] = useState<Record<string, string>>({})
  const [bases, setBases] = useState<Record<string, string>>({})
  const [cost, setCost] = useState('3')
  const [label, setLabel] = useState('')

  const strategy = strategies?.find((s) => s.name === name) ?? strategies?.[0]
  const text = (k: string) => values[k] ?? String(strategy?.params[k] ?? '')
  const baseOf = (k: string) => {
    const b = bases[k]?.trim()
    return b ? Number(b) : (strategy?.params[k] ?? 0)
  }
  const parsed = Object.keys(strategy?.params ?? {}).map((k) => [k, parseValues(text(k))] as const)
  const invalid = [
    ...parsed.filter(([, v]) => v === null).map(([k]) => k),
    ...Object.entries(bases)
      .filter(([, b]) => b.trim() && !Number.isFinite(Number(b)))
      .map(([k]) => k),
  ]
  const count =
    mode === 'single'
      ? comboCount(parsed.map(([, v]) => v ?? []))
      : sweepCount(
          mode,
          parsed.map(([k, v]) => ({ values: v ?? [], base: baseOf(k) })),
        )
  const limit = mode === 'single' ? 200 : 20000
  const common = () => ({
    strategy: strategy!.name,
    symbols: symbols.split(/[\s,]+/).filter(Boolean),
    interval: barInterval,
    cost_bps: Number(cost) || 0,
    label: label.trim() || null,
  })

  const run = useMutation({
    mutationFn: async () => {
      if (mode === 'single') {
        const res = await runEngineBacktest({
          ...common(),
          params: Object.fromEntries(parsed.filter(([, v]) => v?.length)) as Record<string, number[]>,
        })
        toast.success(`${res.runs.length} backtest${res.runs.length === 1 ? '' : 's'} done`)
        onDone(
          res.batch,
          res.runs.map((r) => r.id),
        )
        return
      }
      const res = await runEngineSweep({
        ...common(),
        mode,
        params: Object.fromEntries(parsed.map(([k]) => [k, text(k)])),
        base:
          mode === 'oat'
            ? Object.fromEntries(
                Object.entries(bases)
                  .filter(([, b]) => b.trim())
                  .map(([k, b]) => [k, Number(b)]),
              )
            : {},
      })
      toast.success(`${res.runs.length} runs swept`)
      onSweep(res.id)
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
              setBases({})
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
        <Field label="Mode">
          <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue>{(v: Mode) => MODES[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODES) as Mode[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {MODES[m]}
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
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {parsed.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1">
            <Field label={k}>
              <Input
                value={text(k)}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                aria-invalid={invalid.includes(k)}
                placeholder="5:20:1"
                className="h-7 w-32 font-mono text-xs"
              />
            </Field>
            {mode === 'oat' && (v?.length ?? 0) > 1 && (
              <Input
                value={bases[k] ?? ''}
                onChange={(e) => setBases({ ...bases, [k]: e.target.value })}
                placeholder={`base ${strategy.params[k]}`}
                aria-label={`${k} base value`}
                className="h-6 w-32 font-mono text-xs"
              />
            )}
          </div>
        ))}
        <Button
          size="sm"
          disabled={invalid.length > 0 || count < 1 || count > limit || run.isPending}
          onClick={() => run.mutate()}
        >
          {run.isPending ? <Spinner className="size-3.5" /> : <PlayIcon />}
          {mode === 'single'
            ? `Run ${count > 1 ? `${count} backtests` : 'backtest'}`
            : count
              ? `Run ${fmt(count, 0)} ${mode === 'oat' ? 'one at a time' : 'grid'}`
              : 'Give a param a range'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {MODE_HELP[mode]} Orders fill at the next bar's open; positions square off at 15:15.
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

/** The run's own bars, with its executions marked on them.
 *
 *  The candles come from the same source the engine backtested against (`minute_data`, at the run's
 *  own interval), so an arrow sits on the exact bar that filled - no resampling in between to argue
 *  with. Entry prices in the trade list are that bar's open, which is what makes this worth looking
 *  at: you can see what the strategy saw. */
function ExecutionsChart({ run, focus }: { run: EngineRun; focus: RunTrade | null }) {
  const [symbol, setSymbol] = useState(run.symbols[0] ?? '')
  const ref = useRef<HTMLDivElement>(null)
  const {
    data: bars,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['intradayBars', symbol, run.interval],
    queryFn: () => getIntradayBars(symbol, run.interval),
    enabled: !!symbol,
    staleTime: 5 * 60_000,
  })

  // A clicked trade switches the symbol tab to its own, if it isn't showing already.
  useEffect(() => {
    if (focus) setSymbol(focus[0])
  }, [focus])

  const markers = useMemo(() => tradeMarkers(run.trades, symbol, COLORS), [run.trades, symbol])
  const total = useMemo(() => run.trades.filter((t) => t[0] === symbol).length, [run.trades, symbol])

  useEffect(() => {
    const rows = bars?.bars
    if (!ref.current || !rows?.length) return
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: COLORS.text, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: COLORS.grid } },
      // Bar times are already IST-shifted (see minute_data.py) and the chart renders UTC, so the
      // axis reads as market-local time.
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderVisible: false },
      localization: { priceFormatter: (p: number) => fmt(p) },
    })
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      borderVisible: false,
    })
    candles.setData(
      rows.map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    )
    if (markers.length) createSeriesMarkers(candles, markers as never)
    // A clicked trade wins: zoom tight on its own entry/exit. Otherwise open on the LAST few trades,
    // not on all of them - 300 trades can span months of 5m bars, and at that zoom every arrow is a
    // smear. The rest are still there to pan and zoom out to.
    const range =
      focus && focus[0] === symbol
        ? focusRange(focus[1], focus[2], run.interval)
        : markerRange(markers.slice(-OPENING_MARKERS))
    if (range) {
      chart.timeScale().setVisibleRange({ from: range.from as UTCTimestamp, to: range.to as UTCTimestamp })
    } else {
      chart.timeScale().fitContent()
    }
    return () => chart.remove()
  }, [bars, markers, focus, symbol, run.interval])

  if (!run.symbols.length) return null
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          Executions on {run.interval} candles
          {total > markers.length / 2 ? ` (latest ${markers.length / 2} of ${total} trades)` : ''}
        </p>
        <span className="text-[11px] text-muted-foreground">
          ▲ buy · ▼ sell · exit arrow green when that trade made money
        </span>
        {run.symbols.length > 1 && (
          <div className="ml-auto flex gap-1">
            {run.symbols.map((sym) => (
              <Button
                key={sym}
                size="sm"
                variant={sym === symbol ? 'secondary' : 'ghost'}
                onClick={() => setSymbol(sym)}
              >
                {sym}
              </Button>
            ))}
          </div>
        )}
      </div>
      {error ? (
        <p className="rounded-lg border p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Could not load bars'}
        </p>
      ) : isLoading ? (
        <div className="flex h-96 items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground">
          <Spinner className="size-4" /> Loading {symbol} {run.interval} bars — the first fetch of a symbol
          takes a few seconds
        </div>
      ) : (
        <div ref={ref} className="h-96 rounded-lg border" />
      )}
    </div>
  )
}

function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: run, error } = useQuery({
    queryKey: ['engineRun', id],
    queryFn: () => getEngineRun(id),
    refetchInterval: (q) => (q.state.data && q.state.data.source !== 'backtest' ? 60_000 : false),
  })
  const [focus, setFocus] = useState<RunTrade | null>(null)
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
      {run && <ExportMenu name={run.id} sheets={() => runSheets(run)} csvSheet={1} />}
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
        <ExecutionsChart run={run} focus={focus} />
        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Trades{' '}
            {run.trades.length > trades.length ? `(latest ${trades.length} of ${run.trades.length})` : ''}
            {' · click a row to zoom the chart above onto it'}
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
                {trades.map((trade, i) => {
                  const [sym, tin, tout, qty, pin, pout, pnl] = trade
                  const active = focus?.[0] === sym && focus?.[1] === tin && focus?.[2] === tout
                  return (
                    <TableRow
                      key={i}
                      className={cn('cursor-pointer', active && 'bg-muted')}
                      onClick={() => setFocus(trade)}
                    >
                      <TableCell className="font-medium">{sym}</TableCell>
                      <TableCell>{qty > 0 ? 'Long' : 'Short'}</TableCell>
                      <TableCell className="text-right tabular-nums">{Math.abs(qty)}</TableCell>
                      <TableCell className="tabular-nums">{istTime(tin)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(pin)}</TableCell>
                      <TableCell className="tabular-nums">{istTime(tout)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(pout)}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', pnlClass(pnl))}>
                        {inr(pnl)}
                      </TableCell>
                    </TableRow>
                  )
                })}
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
  // Runs that took no trades score 0 on everything. On the scale they drag it and read as losses,
  // so they are held out of it and drawn as what they are.
  const live = runs.filter((r) => !noTrades(r.summary))
  const deadCount = runs.length - live.length
  const best = (cell: EngineRunRow[]) =>
    (cell.some((r) => !noTrades(r.summary)) ? cell.filter((r) => !noTrades(r.summary)) : cell).reduce<
      EngineRunRow | undefined
    >((a, r) => (!a || (value(r) - value(a)) * m.better > 0 ? r : a), undefined)
  const all = live.map(value)
  const [lo, hi] = [Math.min(...all), Math.max(...all)]
  // rank colour within this sweep: best green, worst red, whatever the absolute numbers are
  const heat = (v: number) => {
    const score = hi === lo ? 0.5 : m.better === 1 ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)
    return score >= 0.5
      ? `color-mix(in oklch, var(--success) ${Math.round((score - 0.5) * 120)}%, transparent)`
      : `color-mix(in oklch, var(--destructive) ${Math.round((0.5 - score) * 120)}%, transparent)`
  }
  const grid = varied.length ? sweepGrid(runs, rowKey, colKey) : null
  const top = [...live].sort((a, b) => (value(b) - value(a)) * m.better)[0]

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
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        {top ? (
          <span>
            Best by {m.label.toLowerCase()}:{' '}
            <button
              type="button"
              className="font-medium underline-offset-4 hover:underline"
              onClick={() => onOpen(top.id)}
            >
              {paramText(top) || top.strategy}
            </button>{' '}
            - {m.format(value(top))}
          </span>
        ) : (
          <span className="text-muted-foreground">No run in this batch took a trade.</span>
        )}
        {deadCount > 0 && top && (
          <span className="text-xs text-muted-foreground">
            {deadCount} of {runs.length} took no trades
          </span>
        )}
      </div>
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
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs tabular-nums">
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
                      const dead = r && noTrades(r.summary)
                      return (
                        <td key={col} className="p-0.5">
                          {r ? (
                            <button
                              type="button"
                              title={`${runName(r)} · ${dead ? 'no trades' : `${r.summary.trades} trades`}`}
                              onClick={() => onOpen(r.id)}
                              className={cn(
                                'w-full min-w-20 rounded px-2 py-1 text-right leading-tight hover:ring-2 hover:ring-ring',
                                dead && 'border border-dashed text-muted-foreground/70',
                                r === top && 'ring-2 ring-foreground',
                              )}
                              style={{ background: dead ? undefined : heat(value(r)) }}
                            >
                              <span className="block font-medium">{dead ? '—' : m.format(value(r))}</span>
                              <span className="block text-[10px] opacity-70">
                                {dead ? 'no trades' : `${r.summary.trades} tr`}
                              </span>
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
          <HeatLegend metric={metric} dead={deadCount} />
        </div>
      )}
    </Panel>
  )
}

// --- parameter sweeps: calibration view -----------------------------------------------------------

type SweepMetric =
  | 'net'
  | 'sharpe'
  | 'ret_dd'
  | 'profit_factor'
  | 'expectancy'
  | 'max_dd'
  | 'win_rate'
  | 'trades'
  | 'trades_per_day'
  | 'avg_hold_min'
// better: which direction is good (0 = neither - activity/holding are for reading, not ranking)
const SWEEP_METRICS: Record<
  SweepMetric,
  { label: string; short: string; better: 1 | -1 | 0; format: (v: number) => string }
> = {
  net: { label: 'Net P&L', short: 'Net', better: 1, format: inr },
  sharpe: { label: 'Sharpe', short: 'Sharpe', better: 1, format: (v) => fmt(v) },
  ret_dd: { label: 'Return / drawdown', short: 'Ret/DD', better: 1, format: (v) => fmt(v) },
  profit_factor: { label: 'Profit factor', short: 'PF', better: 1, format: (v) => fmt(v) },
  expectancy: { label: 'Expectancy / trade', short: 'Exp/trade', better: 1, format: inr },
  max_dd: { label: 'Max drawdown', short: 'Max DD', better: -1, format: inr },
  win_rate: { label: 'Win rate', short: 'Win %', better: 1, format: (v) => `${fmt(v, 1)}%` },
  trades: { label: 'Trades', short: 'Trades', better: 0, format: (v) => fmt(v, 0) },
  trades_per_day: { label: 'Trades / day', short: '/day', better: 0, format: (v) => fmt(v, 1) },
  avg_hold_min: { label: 'Avg hold (min)', short: 'Hold', better: 0, format: (v) => `${fmt(v, 0)}m` },
}
const RANKABLE = (Object.keys(SWEEP_METRICS) as SweepMetric[]).filter((k) => SWEEP_METRICS[k].better)
const metricOf = (r: EngineSweepRun, m: SweepMetric) => r.summary[m] ?? 0

//: Curves drawn on the equity fan. Past this the fan is a solid block and the browser is doing work
//  nobody can read; the runs left out are still in the table.
const FAN_LIMIT = 200

/** Rank colour within the sweep: best green, worst red, whatever the absolute numbers are. */
function heatFor(values: number[], better: 1 | -1 | 0) {
  const [lo, hi] = [Math.min(...values), Math.max(...values)]
  return (v: number) => {
    if (!better || hi === lo) return undefined
    const score = better === 1 ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)
    return score >= 0.5
      ? `color-mix(in oklch, var(--success) ${Math.round((score - 0.5) * 110)}%, transparent)`
      : `color-mix(in oklch, var(--destructive) ${Math.round((0.5 - score) * 110)}%, transparent)`
  }
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const [lo, hi] = [Math.min(0, ...values), Math.max(0, ...values)]
  const y = (v: number) => (hi === lo ? 10 : 19 - ((v - lo) / (hi - lo)) * 18)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 80},${y(v)}`).join(' ')
  return (
    <svg viewBox="0 0 80 20" className="h-5 w-20" aria-hidden>
      <line x1="0" x2="80" y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.2" />
      <polyline
        points={pts}
        fill="none"
        strokeWidth="1.5"
        stroke={values.at(-1)! >= 0 ? COLORS.up : COLORS.down}
      />
    </svg>
  )
}

/** One swept param's effect: a bar per value, the base run outlined. Click a bar to open that run. */
function AxisBars({
  points,
  metric,
  onOpen,
}: {
  points: { value: number; run: EngineSweepRun; isBase: boolean }[]
  metric: SweepMetric
  onOpen: (r: EngineSweepRun) => void
}) {
  const m = SWEEP_METRICS[metric]
  const vals = points.map((p) => metricOf(p.run, metric))
  const [lo, hi] = [Math.min(0, ...vals), Math.max(0, ...vals)]
  const H = 120
  const y = (v: number) => (hi === lo ? H / 2 : H - ((v - lo) / (hi - lo)) * H)
  const w = 100 / points.length
  const labelEvery = Math.ceil(points.length / 12)
  return (
    <div>
      <svg viewBox={`0 0 100 ${H + 14}`} preserveAspectRatio="none" className="h-40 w-full">
        <line
          x1="0"
          x2="100"
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          strokeOpacity="0.25"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => {
          const v = vals[i]
          const good = m.better === 0 ? true : v * (m.better === -1 ? -1 : 1) >= 0 || metric === 'max_dd'
          return (
            <g key={p.value} className="cursor-pointer" onClick={() => onOpen(p.run)}>
              <title>{`${p.value}${p.isBase ? ' (base)' : ''}: ${m.format(v)}`}</title>
              <rect
                x={i * w + w * 0.12}
                width={w * 0.76}
                y={Math.min(y(v), y(0))}
                height={Math.max(Math.abs(y(v) - y(0)), 0.5)}
                fill={metric === 'max_dd' ? COLORS.down : good ? COLORS.up : COLORS.down}
                fillOpacity={p.isBase ? 1 : 0.6}
                stroke={p.isBase ? 'currentColor' : 'none'}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
      </svg>
      <div className="flex text-[10px] text-muted-foreground tabular-nums">
        {points.map((p, i) => (
          <span
            key={p.value}
            className={cn('flex-1 truncate text-center', p.isBase && 'font-semibold text-foreground')}
          >
            {i % labelEvery === 0 || p.isBase ? p.value : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The colour scale under a heatmap, and the count of runs that never traded - without it a grid of
 *  grey cells is a mystery, and a single green cell reads as a win rather than as "least bad". */
function HeatLegend({ metric, dead }: { metric: SweepMetric; dead: number }) {
  const m = SWEEP_METRICS[metric]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        worst
        <span
          className="h-2.5 w-24 rounded-full"
          style={{
            background:
              'linear-gradient(90deg, color-mix(in oklch, var(--destructive) 55%, transparent), transparent, color-mix(in oklch, var(--success) 55%, transparent))',
          }}
        />
        best {m.label.toLowerCase()} in this sweep
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm ring-2 ring-foreground" /> best run
      </span>
      {dead > 0 && (
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border border-dashed" /> {dead} run
          {dead === 1 ? '' : 's'} took no trades (left off the scale)
        </span>
      )}
    </div>
  )
}

/** Every run's equity curve on one pair of axes. This is the one view that says whether a sweep
 *  found a strategy or found a parameter: a tight bundle means the edge survives the params, while
 *  one curve climbing out of a flat mess is that run getting lucky. Best and worst are picked out. */
function EquityFan({
  runs,
  metric,
  onOpen,
}: {
  runs: EngineSweepRun[]
  metric: SweepMetric
  onOpen: (r: EngineSweepRun) => void
}) {
  const m = SWEEP_METRICS[metric]
  const ranked = [...runs.filter((r) => !noTrades(r.summary))].sort(
    (a, b) => (metricOf(b, metric) - metricOf(a, metric)) * (m.better || 1),
  )
  // Every Nth of the ranked runs, not the top N: a fan of only the winners hides the spread, which
  // is the whole point of drawing it. The ends are always kept so best and worst are on the chart.
  const step = Math.max(1, Math.ceil(ranked.length / FAN_LIMIT))
  const shown = ranked.filter((_, i) => i % step === 0)
  if (ranked.length > 1 && shown.at(-1) !== ranked.at(-1)) shown.push(ranked.at(-1)!)
  const fan = fanPaths(
    shown.map((r) => r.spark),
    100,
    100,
  )
  if (shown.length < 2) return null
  const ends = [0, shown.length - 1]

  return (
    <div className="rounded-lg border p-3">
      <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">Equity of every run</span>
        <span className="text-xs text-muted-foreground">
          one curve per parameter set, on a shared scale · green = best {m.label.toLowerCase()}, red = worst ·
          click either to open it
          {shown.length < ranked.length ? ` · showing ${shown.length} of ${ranked.length}` : ''}
        </span>
      </p>
      <div className="relative">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-56 w-full">
          <line
            x1="0"
            x2="100"
            y1={fan.zero}
            y2={fan.zero}
            stroke="currentColor"
            strokeOpacity="0.3"
            vectorEffect="non-scaling-stroke"
          />
          {fan.paths.map((d, i) =>
            ends.includes(i) ? null : (
              <polyline
                key={i}
                points={d}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.16}
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}
          {ends.map((i, n) => (
            <g key={i} className="cursor-pointer" onClick={() => onOpen(shown[i])}>
              <title>{`${n === 0 ? 'best' : 'worst'}: ${m.format(metricOf(shown[i], metric))}`}</title>
              <polyline
                points={fan.paths[i]}
                fill="none"
                strokeWidth={n === 0 ? 2.5 : 1.5}
                stroke={n === 0 ? COLORS.up : COLORS.down}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
        </svg>
        <span className="pointer-events-none absolute top-0 left-0 text-[10px] text-muted-foreground tabular-nums">
          {inr(fan.hi)}
        </span>
        <span className="pointer-events-none absolute bottom-0 left-0 text-[10px] text-muted-foreground tabular-nums">
          {inr(fan.lo)}
        </span>
      </div>
    </div>
  )
}

/** How the chosen metric is spread across the sweep. A single tall bar with one straggler out to the
 *  right is an overfit; a broad hump means most parameter sets land in the same place. */
function MetricSpread({
  runs,
  metric,
  heat,
}: {
  runs: EngineSweepRun[]
  metric: SweepMetric
  heat: (v: number) => string | undefined
}) {
  const m = SWEEP_METRICS[metric]
  const values = runs.filter((r) => !noTrades(r.summary)).map((r) => metricOf(r, metric))
  const { lo, hi, width, counts } = histogram(values, Math.min(24, Math.max(6, values.length)))
  if (values.length < 3) return null
  const peak = Math.max(...counts)
  const sorted = [...values].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]

  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{m.label} across the sweep</span>
        <span className="text-xs text-muted-foreground">
          {values.length} runs that traded · median {m.format(median)}
        </span>
      </p>
      <div className="flex h-28 items-end gap-px">
        {counts.map((c, i) => (
          <div
            key={i}
            className="min-h-px flex-1 rounded-t bg-muted"
            style={{
              height: `${peak ? (c / peak) * 100 : 0}%`,
              background: c ? (heat(lo + width * (i + 0.5)) ?? 'var(--muted)') : undefined,
            }}
            title={`${m.format(lo + width * i)} … ${m.format(lo + width * (i + 1))}: ${c} run${c === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{m.format(lo)}</span>
        <span>{m.format(hi)}</span>
      </div>
    </div>
  )
}

function SweepView({
  id,
  onClose,
  onOpenRun,
}: {
  id: string
  onClose: () => void
  onOpenRun: (runId: string, batch: string) => void
}) {
  const queryClient = useQueryClient()
  const { data: sweep, error } = useQuery({
    queryKey: ['engineSweep', id],
    queryFn: () => getEngineSweep(id),
  })
  const [metric, setMetric] = useState<SweepMetric>('net')
  const [sort, setSort] = useState<{ key: SweepMetric; dir: 1 | -1 }>({ key: 'net', dir: -1 })
  const [gridAxes, setGridAxes] = useState<[string?, string?]>([])

  const remove = useMutation({
    mutationFn: () => deleteEngineSweep(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['engineSweeps'] })
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })
  // A sweep keeps summaries only; opening a run re-runs that exact parameter set as a full backtest
  const openRun = useMutation({
    mutationFn: (r: EngineSweepRun) => {
      const { cost_bps, ...params } = r.params
      return runEngineBacktest({
        strategy: sweep!.strategy,
        symbols: sweep!.symbols,
        interval: sweep!.interval,
        params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, [v]])),
        cost_bps: cost_bps ?? sweep!.cost_bps,
        label: sweep!.label ?? `${sweep!.strategy} sweep`,
      })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['engineRuns'] })
      onOpenRun(res.runs[0].id, res.batch)
    },
    onError: (e) => toast.error(e.message),
  })

  const swept = useMemo(() => Object.keys(sweep?.axes ?? {}), [sweep])
  const series = useMemo(() => (sweep?.mode === 'oat' ? oatSeries(sweep.runs, swept) : []), [sweep, swept])

  const actions = (
    <>
      <Select value={metric} onValueChange={(v) => setMetric(v as SweepMetric)}>
        <SelectTrigger size="sm" className="w-44">
          <SelectValue>{(v: SweepMetric) => SWEEP_METRICS[v].label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {RANKABLE.map((k) => (
            <SelectItem key={k} value={k}>
              {SWEEP_METRICS[k].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {sweep && <ExportMenu name={sweep.id} sheets={() => sweepSheets(sweep)} csvSheet={1} />}
      {openRun.isPending && <Spinner className="size-3.5" />}
      <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
        <Trash2Icon /> Delete
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}>
        <XIcon />
      </Button>
    </>
  )
  if (error || !sweep)
    return (
      <Panel title="Sweep" actions={actions}>
        {error ? <p className="text-sm text-destructive">{error.message}</p> : <Spinner className="size-4" />}
      </Panel>
    )

  const m = SWEEP_METRICS[metric]
  // Runs that never traded score 0 on everything. Left in, they pin the colour scale and fill the
  // grid with red zeroes that look like losses; they are a separate fact, counted on its own tile.
  const live = sweep.runs.filter((r) => !noTrades(r.summary))
  const deadCount = sweep.runs.length - live.length
  const heat = heatFor(
    live.map((r) => metricOf(r, metric)),
    m.better,
  )
  const cellHeat = (r: EngineSweepRun) => (noTrades(r.summary) ? undefined : heat(metricOf(r, metric)))
  const ranked = [...live].sort((a, b) => (metricOf(b, metric) - metricOf(a, metric)) * (m.better || 1))
  const best = ranked[0]
  const baseRun = sweep.runs.find((r) => r.axis === '')
  const fixed = Object.entries(sweep.base).filter(([k]) => !swept.includes(k))
  const medianOf = (k: SweepMetric) => {
    const v = live.map((r) => metricOf(r, k)).sort((a, b) => a - b)
    return v.length ? v[Math.floor(v.length / 2)] : 0
  }
  // dead runs always last, whatever the sorted column: they are rows of zeroes, not results
  const sorted = [...sweep.runs].sort(
    (a, b) =>
      Number(noTrades(a.summary)) - Number(noTrades(b.summary)) ||
      (metricOf(a, sort.key) - metricOf(b, sort.key)) * sort.dir,
  )
  const shown = sorted.slice(0, 300)
  // impact: how far each swept param moves the metric across its own range (oat only)
  const impact = series
    .map((s) => ({
      ...s,
      spread: spread(s.points.map((p) => metricOf(p.run, metric))),
      best: [...s.points].sort(
        (a, b) => (metricOf(b.run, metric) - metricOf(a.run, metric)) * (m.better || 1),
      )[0],
    }))
    .sort((a, b) => b.spread - a.spread)
  const maxSpread = Math.max(...impact.map((i) => i.spread), 0)
  const rowKey = gridAxes[0] && swept.includes(gridAxes[0]) ? gridAxes[0] : swept[0]
  const colKey =
    gridAxes[1] && swept.includes(gridAxes[1]) && gridAxes[1] !== rowKey
      ? gridAxes[1]
      : swept.find((k) => k !== rowKey)
  const grid = sweep.mode === 'grid' ? sweepGrid(sweep.runs, rowKey, colKey) : null
  // a cell's best traded run, or - when every run in it is dead - the dead one, so the cell can say so
  const bestIn = (cell: EngineSweepRun[]) =>
    (cell.some((r) => !noTrades(r.summary)) ? cell.filter((r) => !noTrades(r.summary)) : cell).reduce<
      EngineSweepRun | undefined
    >((a, r) => (!a || (metricOf(r, metric) - metricOf(a, metric)) * (m.better || 1) > 0 ? r : a), undefined)
  const paramsText = (r: EngineSweepRun) => swept.map((k) => `${k}=${r.params[k]}`).join(' ')
  const cols: SweepMetric[] = [
    'net',
    'sharpe',
    'ret_dd',
    'profit_factor',
    'expectancy',
    'max_dd',
    'win_rate',
    'trades',
    'trades_per_day',
    'avg_hold_min',
  ]

  return (
    <Panel
      title={`${sweep.mode === 'oat' ? 'One-at-a-time' : 'Grid'} sweep · ${sweep.label ?? sweep.strategy} · ${fmt(sweep.runs.length, 0)} runs · ${sweep.symbols.join(', ')} ${sweep.interval}`}
      actions={actions}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            {sweep.mode === 'oat' ? 'Base' : 'Fixed'}:{' '}
            <span className="font-mono text-foreground">
              {(sweep.mode === 'oat' ? Object.entries(sweep.base) : fixed)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ') || '—'}
            </span>
          </span>
          <span>
            Swept:{' '}
            <span className="font-mono text-foreground">
              {Object.entries(sweep.axes)
                .map(([k, v]) => `${k} ${v[0]}…${v.at(-1)} (${v.length})`)
                .join(', ')}
            </span>
          </span>
          <span>created {formatDateTime(sweep.created)}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label={
              best ? `Best ${m.label.toLowerCase()} · ${paramsText(best)}` : `Best ${m.label.toLowerCase()}`
            }
            value={best ? m.format(metricOf(best, metric)) : '—'}
            className={!best || metric === 'max_dd' ? undefined : pnlClass(metricOf(best, metric))}
          />
          <Stat
            label={`Median ${m.label.toLowerCase()} · runs that traded`}
            value={live.length ? m.format(medianOf(metric)) : '—'}
            className={metric === 'max_dd' ? undefined : pnlClass(medianOf(metric))}
          />
          {baseRun && (
            <Stat
              label="Base run"
              value={m.format(metricOf(baseRun, metric))}
              className={metric === 'max_dd' ? undefined : pnlClass(metricOf(baseRun, metric))}
            />
          )}
          <Stat
            label="Runs with positive net P&L"
            value={`${sweep.runs.filter((r) => r.summary.net > 0).length} / ${sweep.runs.length}`}
          />
          <Stat
            label={deadCount ? 'Took no trades - not a result' : 'Every run traded'}
            value={`${deadCount} / ${sweep.runs.length}`}
            className={deadCount ? 'text-muted-foreground' : undefined}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <EquityFan runs={sweep.runs} metric={metric} onOpen={(r) => openRun.mutate(r)} />
          <MetricSpread runs={sweep.runs} metric={metric} heat={heat} />
        </div>

        {sweep.mode === 'oat' && (
          <>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Parameter impact on {m.label.toLowerCase()} - how far each param moves it across its range.
                Big = sensitive, tune carefully; flat = safe to leave.
              </p>
              <div className="space-y-1.5">
                {impact.map((i) => (
                  <div key={i.param} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 font-mono">{i.param}</span>
                    <div className="h-2 flex-1 rounded bg-muted">
                      <div
                        className="h-2 rounded bg-primary"
                        style={{ width: `${maxSpread ? (i.spread / maxSpread) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right tabular-nums">{m.format(i.spread)}</span>
                    <span className="w-44 shrink-0 text-xs text-muted-foreground">
                      best at <span className="font-mono text-foreground">{i.best.value}</span> (base{' '}
                      {sweep.base[i.param]})
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {series.map((s) => (
                <div key={s.param} className="rounded-lg border p-3">
                  <p className="mb-1 text-sm">
                    <span className="font-mono font-medium">{s.param}</span>{' '}
                    <span className="text-xs text-muted-foreground">
                      vs {m.label.toLowerCase()}, others at base · outlined = base · click a bar to open
                    </span>
                  </p>
                  <AxisBars points={s.points} metric={metric} onOpen={(r) => openRun.mutate(r)} />
                </div>
              ))}
            </div>
          </>
        )}

        {grid && (
          <div className="space-y-2">
            {swept.length > 2 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                Rows
                {[0, 1].map((i) => (
                  <Select
                    key={i}
                    value={i === 0 ? rowKey : colKey}
                    onValueChange={(v) =>
                      setGridAxes(i === 0 ? [v as string, colKey] : [rowKey, v as string])
                    }
                  >
                    <SelectTrigger size="sm" className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {swept.map((k) => (
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
            <div className="max-h-[28rem] overflow-auto rounded-lg border">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr>
                    <th className="sticky top-0 z-10 bg-card px-2 py-1.5 text-left font-normal text-muted-foreground">
                      {rowKey} {colKey ? `↓ ${colKey} →` : ''}
                    </th>
                    {colKey &&
                      grid.cols.map((c) => (
                        <th key={c} className="sticky top-0 z-10 bg-card px-2 py-1.5 text-right font-medium">
                          {c}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((row) => (
                    <tr key={row}>
                      <th className="bg-card px-2 py-1 text-left font-medium">{row}</th>
                      {grid.cols.map((col) => {
                        const r = bestIn(grid.cell(row, col))
                        const dead = r && noTrades(r.summary)
                        return (
                          <td key={col} className="p-0.5">
                            {r ? (
                              <button
                                type="button"
                                title={`${paramsText(r)} · ${dead ? 'no trades' : `${fmt(r.summary.trades, 0)} trades`}`}
                                onClick={() => openRun.mutate(r)}
                                className={cn(
                                  'w-full min-w-20 rounded px-2 py-1 text-right leading-tight hover:ring-2 hover:ring-ring',
                                  dead && 'border border-dashed text-muted-foreground/70',
                                  r === best && 'ring-2 ring-foreground',
                                )}
                                style={{ background: cellHeat(r) }}
                              >
                                <span className="block font-medium">
                                  {dead ? '—' : m.format(metricOf(r, metric))}
                                </span>
                                <span className="block text-[10px] opacity-70">
                                  {dead ? 'no trades' : `${fmt(r.summary.trades, 0)} tr`}
                                </span>
                              </button>
                            ) : (
                              <span className="block px-2 py-1 text-right text-muted-foreground">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <HeatLegend metric={metric} dead={deadCount} />
          </div>
        )}

        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            All runs
            {sorted.length > shown.length
              ? ` (top ${shown.length} of ${sorted.length} by the sorted column)`
              : ''}{' '}
            · click a row to open it as a full backtest with charts and trades
            {deadCount > 0 ? ' · runs that took no trades sit at the bottom' : ''}
          </p>
          <div className="max-h-[32rem] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {sweep.mode === 'oat' && <TableHead>Varies</TableHead>}
                  {swept.map((k) => (
                    <TableHead key={k} className="font-mono">
                      {k}
                    </TableHead>
                  ))}
                  {cols.map((k) => (
                    <TableHead key={k} className="text-right">
                      <button
                        type="button"
                        className="hover:text-foreground"
                        title={SWEEP_METRICS[k].label}
                        onClick={() => setSort({ key: k, dir: sort.key === k ? (-sort.dir as 1 | -1) : -1 })}
                      >
                        {SWEEP_METRICS[k].short}
                        {sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                      </button>
                    </TableHead>
                  ))}
                  <TableHead>Equity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r, i) => {
                  const dead = noTrades(r.summary)
                  return (
                    <TableRow
                      key={i}
                      className={cn('cursor-pointer', dead && 'text-muted-foreground/60')}
                      onClick={() => openRun.mutate(r)}
                    >
                      {sweep.mode === 'oat' && (
                        <TableCell className="text-xs text-muted-foreground">{r.axis || 'base'}</TableCell>
                      )}
                      {swept.map((k) => (
                        <TableCell
                          key={k}
                          className={cn(
                            'font-mono text-xs',
                            sweep.mode === 'oat' && r.axis === k && 'font-semibold',
                          )}
                        >
                          {r.params[k]}
                        </TableCell>
                      ))}
                      {dead ? (
                        <TableCell colSpan={cols.length} className="text-xs italic">
                          no trades taken
                        </TableCell>
                      ) : (
                        cols.map((k) => (
                          <TableCell
                            key={k}
                            className={cn(
                              'text-right tabular-nums',
                              (k === 'net' || k === 'expectancy' || k === 'sharpe') &&
                                pnlClass(metricOf(r, k)),
                            )}
                            style={k === metric ? { background: heat(metricOf(r, k)) } : undefined}
                          >
                            {SWEEP_METRICS[k].format(metricOf(r, k))}
                          </TableCell>
                        ))
                      )}
                      <TableCell>
                        <Sparkline values={r.spark} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function SweepsList({
  sweeps,
  active,
  onOpen,
}: {
  sweeps: EngineSweepRow[]
  active?: string
  onOpen: (id: string) => void
}) {
  if (!sweeps.length)
    return (
      <p className="text-sm text-muted-foreground">
        No sweeps yet - pick <em>One at a time</em> or <em>Grid</em> above and give a param a range.
      </p>
    )
  return (
    <div className="max-h-80 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Sweep</TableHead>
            <TableHead>Swept</TableHead>
            <TableHead>Symbols</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead>Best by net P&L</TableHead>
            <TableHead className="text-right">Net</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sweeps.map((s) => (
            <TableRow
              key={s.id}
              className={cn('cursor-pointer', active === s.id && 'bg-muted')}
              onClick={() => onOpen(s.id)}
            >
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline">{s.mode === 'oat' ? 'one at a time' : 'grid'}</Badge>
                  <span className="font-medium">{s.label ?? s.strategy}</span>
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {Object.keys(s.axes).join(', ')}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {s.symbols.join(', ')} · {s.interval}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmt(s.count, 0)}</TableCell>
              <TableCell className="font-mono text-xs">
                {s.best &&
                  Object.keys(s.axes)
                    .map((k) => `${k}=${s.best!.params[k]}`)
                    .join(' ')}
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', s.best && pnlClass(s.best.summary.net))}>
                {s.best ? inr(s.best.summary.net) : '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">{formatDateTime(s.created)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
  const { run, batch, sweep } = useSearch({ from: '/engine' })
  const navigate = useNavigate({ from: '/engine' })
  const queryClient = useQueryClient()
  const { data: runs = [] } = useQuery({
    queryKey: ['engineRuns'],
    queryFn: getEngineRuns,
    refetchInterval: 60_000,
  })
  const { data: sweeps = [] } = useQuery({ queryKey: ['engineSweeps'], queryFn: getEngineSweeps })
  const { data: settings } = useQuery({ queryKey: ['engineSettings'], queryFn: getEngineSettings })
  usePageTitle(settings?.name ?? 'Algo engine')
  const [source, setSource] = useState<Source>('all')
  const [picked, setPicked] = useState<string[]>([])

  const ids = new Set(runs.map((r) => r.id))
  const selected = picked.filter((id) => ids.has(id))
  const shown = source === 'all' ? runs : runs.filter((r) => r.source === source)
  const activeBatch = batch && runs.some((r) => r.batch === batch) ? batch : runs.find((r) => r.batch)?.batch
  const open = (id?: string, nextBatch = activeBatch) =>
    navigate({ search: (prev) => ({ ...prev, run: id, batch: nextBatch }) })
  const openSweep = (id?: string) => navigate({ search: (prev) => ({ ...prev, sweep: id }) })

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
            onSweep={(id) => {
              queryClient.invalidateQueries({ queryKey: ['engineSweeps'] })
              openSweep(id)
            }}
          />
        )}
      </Panel>

      {sweep && (
        <SweepView
          key={sweep}
          id={sweep}
          onClose={() => openSweep(undefined)}
          onOpenRun={(id, b) => open(id, b)}
        />
      )}

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

      <Panel title={`Sweeps (${sweeps.length})`}>
        <SweepsList sweeps={sweeps} active={sweep} onOpen={openSweep} />
      </Panel>

      <Panel
        title={`Runs (${shown.length})`}
        actions={[
          <ExportMenu key="export" name={`runs-${source}`} sheets={() => [runsSheet(shown)]} />,
          ...SOURCES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={source === s ? 'secondary' : 'ghost'}
              onClick={() => setSource(s)}
            >
              {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
            </Button>
          )),
        ]}
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { CandlestickSeries, HistogramSeries, createChart, createSeriesMarkers } from 'lightweight-charts'
import type { UTCTimestamp } from 'lightweight-charts'
import {
  CheckIcon,
  ChevronsUpDownIcon,
  DownloadIcon,
  PlayIcon,
  RefreshCwIcon,
  SettingsIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  autotuneBatchSheet,
  autotuneSheets,
  comboCount,
  coverageNotes,
  drawdown,
  fanPaths,
  focusRange,
  histogram,
  historyError,
  historyText,
  holdText,
  istTime,
  markerRange,
  noTrades,
  oatSeries,
  portfolioCurve,
  runSheets,
  runsSheet,
  sweepSheets,
  paramsLabel,
  parseValues,
  pickedSets,
  pinnedRange,
  spread,
  sweepCount,
  sweepGrid,
  tradeMarkers,
  tuneVerdict,
  windowOfTrade,
} from '@/lib/engine'
import type { RunTrade } from '@/lib/engine'
import { fmt, formatDateTime, inr } from '@/lib/format'
import type { SheetData } from '@/lib/exportFile'
import type { EngineTab } from './router'
import { downloadCsv, downloadXlsx } from '@/lib/exportFile'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import type {
  BarRange,
  EngineAutotuneReport,
  EngineAutotuneRequest,
  EngineAutotuneCell,
  EngineAutotuneRow,
  EngineCoverage,
  EngineHistory,
  EngineRun,
  EngineRunRow,
  EngineSettings,
  EngineSkipped,
  EngineSweepRow,
  EngineSweepRun,
} from '@/services/api'
import {
  deleteEngineAutotune,
  deleteEngineAutotuneBatch,
  deleteEngineBatch,
  deleteEngineRun,
  deleteEngineSweep,
  getEngineAutotune,
  getEngineAutotunes,
  getEngineRun,
  getEngineRuns,
  getEngineSettings,
  getEngineStrategies,
  getEngineSweep,
  getEngineSweeps,
  getIntradayBars,
  getWatchlist,
  runEngineAutotune,
  runEngineBacktest,
  runEngineSweep,
  searchStocksMaster,
  syncEngineLive,
} from '@/services/api'

// The C++ engine (a separate repo, located via the settings dialog) seen from Stoklore: start backtests and parameter sweeps on
// Stoklore's own bars, and read backtest, paper and live runs side by side. Every run is the
// engine's report JSON (app/routers/engine.py), so all three sources render through the same views.

const INTERVALS = ['1m', '5m', '15m', '1H', '4H', '1D']
/** Cost per side a run starts from. 1D positions are held overnight, so they pay delivery charges -
 *  STT is 0.1% on each side for delivery vs 0.025% on the sell side intraday - about 12 bps a side
 *  with stamp duty and exchange fees, against ~3 for intraday. */
const defaultCost = (interval: string) => (interval === '1D' ? 12 : 3)
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

// The last symbol selections, so reopening the page doesn't start from scratch every time. The two
// forms keep their own: a quick backtest basket and a tuning universe are rarely the same list.
const SYMBOLS_KEY = 'engine.symbols'
const TUNE_SYMBOLS_KEY = 'engine.autotuneSymbols'
const TUNE_FORM_KEY = 'engine.autotuneForm'

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

/** State remembered per browser under `key`. Storage can be blocked (private window, cleared site
 *  data) or hold something stale; `valid` rejects the latter and the field starts from `initial`. */
function useStored<T>(key: string, initial: T, valid: (v: unknown) => boolean) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      return saved !== null && valid(saved) ? saved : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // not remembered this time - nothing else depends on it
    }
  }, [key, value])
  return [value, setValue] as const
}

const isRecord = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v)

const useStoredSymbols = (key: string) =>
  useStored<string[]>(key, [], (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'))

/** Multi-select of symbols: the watchlist first, grouped by list, then - once something is typed -
 *  every listed NSE stock that matches (the stocks master, whether or not it was ever scraped), so a
 *  stock outside the watchlist is one search away. Any symbol can be run whether or not its bars are
 *  cached yet: the backend pulls and caches an uncached one on the first run that needs it, which
 *  costs that run a few extra seconds instead of failing. */
function SymbolPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data: watchlist } = useQuery({ queryKey: ['watchlist'], queryFn: getWatchlist })
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const query = search.trim()
  const { data: found } = useQuery({
    queryKey: ['stockSearch', query],
    queryFn: () => searchStocksMaster(query),
    enabled: open && query.length > 0,
  })
  const groups = useMemo(() => {
    const byList = new Map<string, string[]>()
    for (const { symbol, list_name } of watchlist ?? [])
      byList.set(list_name, [...(byList.get(list_name) ?? []), symbol])
    return [...byList.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [watchlist])
  const listed = new Set((watchlist ?? []).map((w) => w.symbol))
  const others = (found?.stocks ?? []).filter((m) => !listed.has(m.symbol))
  const toggle = (sym: string) =>
    onChange(value.includes(sym) ? value.filter((s) => s !== sym) : [...value, sym])
  const check = (sym: string) => <CheckIcon className={cn('size-3.5', !value.includes(sym) && 'opacity-0')} />

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" className="h-7 w-44 justify-between font-normal" />}
      >
        <span className={cn('truncate', !value.length && 'text-muted-foreground')}>
          {value.length === 0 ? 'Select symbols' : value.length === 1 ? value[0] : `${value.length} stocks`}
        </span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Watchlist, or search any stock…"
          />
          <CommandList className="max-h-80">
            <CommandEmpty>
              {query
                ? 'No matches.'
                : watchlist?.length
                  ? 'No matches.'
                  : 'No watchlist symbols yet - type to search every NSE stock.'}
            </CommandEmpty>
            {groups.map(([listName, syms]) => (
              <CommandGroup key={listName} heading={listName}>
                {syms.map((sym) => (
                  <CommandItem key={sym} value={sym} onSelect={() => toggle(sym)}>
                    {check(sym)}
                    {sym}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {others.length > 0 && (
              <CommandGroup heading="All NSE stocks">
                {others.map((m) => (
                  // the name is in the value too, so a match on the company name isn't filtered out
                  <CommandItem
                    key={m.symbol}
                    value={`${m.symbol} ${m.name ?? ''}`}
                    onSelect={() => toggle(m.symbol)}
                  >
                    {check(m.symbol)}
                    <span className="font-medium">{m.symbol}</span>
                    <span className="truncate text-xs text-muted-foreground">{m.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** The picked symbols as removable chips, on a line of their own under a form's first row - inside
 *  that row they grow with the list and push every other field out of line. Outlined = not in a
 *  watchlist. */
function SymbolChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data: watchlist } = useQuery({ queryKey: ['watchlist'], queryFn: getWatchlist })
  if (!value.length) return null
  const listed = new Set((watchlist ?? []).map((w) => w.symbol))
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5">
      <span className="mr-1 text-xs text-muted-foreground">
        {value.length} stock{value.length === 1 ? '' : 's'}
      </span>
      {value.map((sym) => (
        <Badge
          key={sym}
          variant={listed.has(sym) ? 'secondary' : 'outline'}
          className="gap-1 pr-1"
          title={listed.has(sym) ? undefined : 'Not in a watchlist'}
        >
          {sym}
          <button
            type="button"
            aria-label={`Remove ${sym}`}
            onClick={() => onChange(value.filter((s) => s !== sym))}
            className="rounded-sm hover:bg-muted-foreground/20"
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      {value.length > 1 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="ml-auto px-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  )
}

const HISTORY_MODES = { all: 'All available', years: 'Last N years', dates: 'Date range' } as const
/** Today in IST as "YYYY-MM-DD" - the market's date, whatever timezone the browser is in. */
const todayIST = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)

/** Which stretch of history a run uses. Every stock has its own: one listed last year just brings
 *  less to a "last 5 years" run, and one with nothing in the range is skipped - the run's report
 *  says what each had. */
function HistoryPicker({ value, onChange }: { value: BarRange; onChange: (v: BarRange) => void }) {
  const today = todayIST()
  const setMode = (mode: BarRange['mode']) =>
    onChange(
      mode === 'years'
        ? { mode, years: value.years ?? 1 }
        : mode === 'dates'
          ? { mode, start: value.start ?? null, end: value.end ?? null }
          : { mode: 'all' },
    )
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={value.mode} onValueChange={(v) => setMode(v as BarRange['mode'])}>
        <SelectTrigger size="sm" className="w-36">
          <SelectValue>{(v: BarRange['mode']) => HISTORY_MODES[v]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(HISTORY_MODES) as BarRange['mode'][]).map((m) => (
            <SelectItem key={m} value={m}>
              {HISTORY_MODES[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.mode === 'years' && (
        <>
          <Input
            type="number"
            min={0.5}
            max={30}
            step={0.5}
            value={value.years ?? ''}
            onChange={(e) =>
              onChange({ mode: 'years', years: e.target.value === '' ? null : Number(e.target.value) })
            }
            aria-label="Years of history"
            className="h-7 w-16"
          />
          <span className="text-xs text-muted-foreground">years</span>
        </>
      )}
      {value.mode === 'dates' && (
        <>
          <Input
            type="date"
            max={value.end || today}
            value={value.start ?? ''}
            onChange={(e) => onChange({ ...value, start: e.target.value || null })}
            aria-label="History from"
            className="h-7 w-36"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            min={value.start || undefined}
            max={today}
            value={value.end ?? ''}
            onChange={(e) => onChange({ ...value, end: e.target.value || null })}
            aria-label="History to"
            className="h-7 w-36"
          />
        </>
      )}
    </div>
  )
}

/** A run's history in one line: what it was given, which stocks didn't fill it, which were left out. */
function HistoryLine({
  history,
  coverage,
  skipped,
}: {
  history?: EngineHistory | number | null
  coverage?: EngineCoverage
  skipped?: EngineSkipped
}) {
  const notes = typeof history === 'number' ? [] : coverageNotes(history, coverage)
  return (
    <p className="text-xs text-muted-foreground">
      History: <span className="text-foreground">{historyText(history)}</span>
      {notes.length > 0 && <span> · {notes.join(' · ')}</span>}
      {skipped?.length ? (
        <span className="text-destructive">
          {' '}
          · skipped {skipped.map((x) => `${x.symbol} (${x.reason})`).join(', ')}
        </span>
      ) : null}
    </p>
  )
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
  const [symbols, setSymbols] = useStoredSymbols(SYMBOLS_KEY)
  const [barInterval, setBarInterval] = useState('5m')
  const [values, setValues] = useState<Record<string, string>>({})
  const [bases, setBases] = useState<Record<string, string>>({})
  const [cost, setCost] = useState<string | null>(null) // null: the interval's default
  const costText = cost ?? String(defaultCost(barInterval))
  const [label, setLabel] = useState('')
  const [history, setHistory] = useState<BarRange>({ mode: 'all' })
  const historyProblem = historyError(history, todayIST())

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
    symbols,
    interval: barInterval,
    cost_bps: Number(costText) || 0,
    label: label.trim() || null,
    range: history,
  })

  const run = useMutation({
    mutationFn: async () => {
      if (mode === 'single') {
        const res = await runEngineBacktest({
          ...common(),
          params: Object.fromEntries(parsed.filter(([, v]) => v?.length)) as Record<string, number[]>,
        })
        toast.success(`${res.runs.length} backtest${res.runs.length === 1 ? '' : 's'} done`)
        for (const x of res.skipped) toast.warning(`${x.symbol} skipped - ${x.reason}`)
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
      for (const x of res.skipped ?? []) toast.warning(`${x.symbol} skipped - ${x.reason}`)
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
          <SymbolPicker value={symbols} onChange={setSymbols} />
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
        <Field label="History">
          <HistoryPicker value={history} onChange={setHistory} />
        </Field>
        <Field label="Cost (bps/side)">
          <Input
            value={costText}
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
      <SymbolChips value={symbols} onChange={setSymbols} />
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
          disabled={
            invalid.length > 0 ||
            count < 1 ||
            count > limit ||
            !symbols.length ||
            !!historyProblem ||
            run.isPending
          }
          onClick={() => run.mutate()}
        >
          {run.isPending ? <Spinner className="size-3.5" /> : <PlayIcon />}
          {!symbols.length
            ? 'Select symbols'
            : historyProblem
              ? historyProblem
              : mode === 'single'
                ? `Run ${count > 1 ? `${count} backtests` : 'backtest'}`
                : count
                  ? `Run ${fmt(count, 0)} ${mode === 'oat' ? 'one at a time' : 'grid'}`
                  : 'Give a param a range'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {MODE_HELP[mode]} Orders fill at the next bar's open;{' '}
        {barInterval === '1D'
          ? "on 1D bars positions are held across days until the strategy exits (costs default to delivery's ~12 bps)."
          : 'positions square off at 15:15.'}{' '}
        A symbol picked for the first time takes a few extra seconds while its bars are fetched and cached.
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
  // the run's own dates: a backtest on an old range would otherwise get today's newest bars, and
  // its arrows would land on candles that were never loaded
  const period = { start: istTime(run.summary.from).slice(0, 10), end: istTime(run.summary.to).slice(0, 10) }
  const ref = useRef<HTMLDivElement>(null)
  const {
    data: bars,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['intradayBars', symbol, run.interval, period.start, period.end],
    queryFn: () => getIntradayBars(symbol, run.interval, period),
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
      timeScale: { borderVisible: false, timeVisible: run.interval !== '1D', secondsVisible: false },
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
        {run.source === 'backtest' && (
          <HistoryLine history={run.history} coverage={run.coverage} skipped={run.skipped} />
        )}
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
  avg_hold_min: { label: 'Avg hold', short: 'Hold', better: 0, format: holdText },
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
        // the same bars the sweep ran on, not today's history - or the numbers won't match the cell
        range: pinnedRange(sweep!.history, sweep!.coverage),
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
        <HistoryLine history={sweep.history} coverage={sweep.coverage} skipped={sweep.skipped} />

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

// --- walk-forward auto-tune (docs/autotune-blueprint.md, Phase 1) ---------------------------------
// Report-only: tunes on past sessions, trades the pick on the next ones it never saw, and shows how
// that compares with just trading the strategy's defaults. Nothing here deploys anything.

const TUNE_NUMBERS = [
  ['train', 'Train sessions', 60],
  ['test', 'Test sessions', 5],
  ['min_trades', 'Min trades', 30],
  ['margin', 'Switch margin', 0.15],
  ['cost_bps', 'Cost (bps/side)', 3],
] as const
// A 1D session is one bar: a 60-bar train window can't hold 30 trades, so a daily walk starts from a
// year of train, a month of test, all the history there is, and delivery costs.
const DAILY_TUNE: Partial<Record<(typeof TUNE_NUMBERS)[number][0], number>> = {
  train: 250,
  test: 20,
  min_trades: 10,
  cost_bps: defaultCost('1D'),
}
const MAX_TUNE_CELLS = 5000 // app/core/autotune.py MAX_CELLS

/** A test window's first bar, on the same IST-read-as-UTC clock as every engine time. */
const sessionTime = (date: string) => (Date.parse(`${date}T09:15:00Z`) / 1000) as UTCTimestamp

/** A titled group inside a form, so a long form reads as a few decisions instead of one wall. */
function FormSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-medium">
        {title}
        {hint && <span className="font-normal text-muted-foreground"> · {hint}</span>}
      </p>
      {children}
    </section>
  )
}

const MAX_TUNE_SYMBOLS = 30 // EngineAutotuneRequest.symbols max_length

function AutotuneForm({ onDone }: { onDone: (batch: string, ids: string[]) => void }) {
  const { data: strategies, error } = useQuery({
    queryKey: ['engineStrategies'],
    queryFn: getEngineStrategies,
  })
  // the whole form is remembered, so a tuning setup survives a reload; a strategy that's gone falls
  // back to the first one, and its params' text only ever reads the current strategy's keys
  const [name, setName] = useStored<string | null>(`${TUNE_FORM_KEY}.strategy`, null, (v) => typeof v === 'string')
  const [symbols, setSymbols] = useStoredSymbols(TUNE_SYMBOLS_KEY)
  const [barInterval, setBarInterval] = useStored(`${TUNE_FORM_KEY}.interval`, '5m', (v) =>
    INTERVALS.includes(v as string),
  )
  const [values, setValues] = useStored<Record<string, string>>(`${TUNE_FORM_KEY}.params`, {}, isRecord)
  const [nums, setNums] = useStored<Record<string, string>>(`${TUNE_FORM_KEY}.numbers`, {}, isRecord)
  // untouched, it follows the bars: a year of intraday sessions, all of a daily history
  const [historyChoice, setHistory] = useStored<BarRange | null>(`${TUNE_FORM_KEY}.history`, null, isRecord)
  const history: BarRange =
    historyChoice ?? (barInterval === '1D' ? { mode: 'all' } : { mode: 'years', years: 1 })
  const historyProblem = historyError(history, todayIST())

  const strategy = strategies?.find((s) => s.name === name) ?? strategies?.[0]
  const text = (k: string) => values[k] ?? String(strategy?.params[k] ?? '')
  const parsed = Object.keys(strategy?.params ?? {}).map((k) => [k, parseValues(text(k))] as const)
  const invalid = parsed.filter(([, v]) => v === null).map(([k]) => k)
  const tuned = parsed.filter(([, v]) => (v?.length ?? 0) > 1)
  const cells = comboCount(tuned.map(([, v]) => v ?? []))
  // an untouched field follows the interval's default; one you typed in stays
  const valueOf = (k: (typeof TUNE_NUMBERS)[number][0], d: number) =>
    nums[k] ?? String((barInterval === '1D' ? DAILY_TUNE[k] : undefined) ?? d)
  const numbers = TUNE_NUMBERS.map(([k, , d]) => [k, Number(valueOf(k, d))] as const)
  const badNumber = numbers.some(([, v]) => !Number.isFinite(v))

  const run = useMutation({
    mutationFn: () =>
      runEngineAutotune({
        strategy: strategy!.name,
        symbols,
        interval: barInterval,
        range: history,
        params: Object.fromEntries(parsed.map(([k]) => [k, text(k)])),
        ...Object.fromEntries(numbers),
      } as EngineAutotuneRequest),
    onSuccess: (r) => {
      toast.success(`${r.reports.length} stock${r.reports.length === 1 ? '' : 's'} walked forward`)
      // the rest still ran - say which ones didn't, and why
      for (const e of r.errors) toast.error(`${e.symbol}: ${e.error}`)
      onDone(
        r.batch,
        r.reports.map((x) => x.id),
      )
    },
    onError: (e) => toast.error(e.message),
  })

  if (error) return <p className="text-sm text-destructive">{error.message}</p>
  if (!strategy) return <Spinner className="size-4" />

  const numberField = ([k, label, d]: (typeof TUNE_NUMBERS)[number], className = 'h-7 w-full') => (
    <Field key={k} label={label}>
      <Input
        value={valueOf(k, d)}
        onChange={(e) => setNums({ ...nums, [k]: e.target.value })}
        inputMode="decimal"
        aria-invalid={!Number.isFinite(Number(valueOf(k, d)))}
        className={className}
      />
    </Field>
  )

  return (
    <div className="space-y-4">
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
          <SymbolPicker value={symbols} onChange={setSymbols} />
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
        {numberField(TUNE_NUMBERS.find(([k]) => k === 'cost_bps')!, 'h-7 w-24')}
      </div>
      <SymbolChips value={symbols} onChange={setSymbols} />

      <FormSection title="Walk" hint="how much history, and how it's cut into windows">
        <Field label="History">
          <HistoryPicker value={history} onChange={setHistory} />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TUNE_NUMBERS.filter(([k]) => k !== 'cost_bps').map((f) => numberField(f))}
        </div>
      </FormSection>

      <FormSection title="Parameters" hint="a range 5:20:1 or list 5,9,13 is tuned · one value is fixed">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {parsed.map(([k, v]) => (
            <Field key={k} label={`${k}${(v?.length ?? 0) > 1 ? ` · ${v!.length} values` : ''}`}>
              <Input
                value={text(k)}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                aria-invalid={invalid.includes(k)}
                placeholder="5:20:1"
                className={cn('h-7 w-full font-mono text-xs', (v?.length ?? 0) > 1 && 'border-primary/60')}
              />
            </Field>
          ))}
        </div>
      </FormSection>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <details className="max-w-3xl text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">How the walk works</summary>
          <p className="mt-2">
            Each stock is walked on its own and gets its own parameters - never one set pooled across them.
            Every window tunes a grid over the params given a range on its <em>train</em> sessions, then
            trades the pick on the next <em>test</em> sessions - which it never saw - next to the strategy's
            fixed defaults. A cell is only picked with at least <em>min trades</em> in-sample and a positive
            score across its neighbours; otherwise the window is sat out. The pick changes only when a new
            cell scores better by the <em>switch margin</em>. Bars come up to today: the minute dataset ends
            in January 2026 and the rest is fetched from moneycontrol. Report only - nothing is deployed.
          </p>
        </details>
        <Button
          size="sm"
          className="ml-auto"
          disabled={
            !symbols.length ||
            symbols.length > MAX_TUNE_SYMBOLS ||
            invalid.length > 0 ||
            !tuned.length ||
            cells > MAX_TUNE_CELLS ||
            badNumber ||
            !!historyProblem ||
            run.isPending
          }
          onClick={() => run.mutate()}
        >
          {run.isPending ? <Spinner className="size-3.5" /> : <PlayIcon />}
          {!symbols.length
            ? 'Select symbols'
            : historyProblem
              ? historyProblem
              : symbols.length > MAX_TUNE_SYMBOLS
                ? `${symbols.length} stocks - keep it to ${MAX_TUNE_SYMBOLS}`
                : !tuned.length
                  ? 'Give a param a range'
                  : cells > MAX_TUNE_CELLS
                    ? `${fmt(cells, 0)} cells - keep it under ${fmt(MAX_TUNE_CELLS, 0)}`
                    : `Walk forward ${symbols.length > 1 ? `${symbols.length} stocks` : symbols[0]} · ${fmt(cells, 0)} cells per window`}
        </Button>
      </div>
    </div>
  )
}

type CellSort = 'net' | 'profit_factor' | 'win_rate' | 'picked'
const CELL_SORTS: Record<CellSort, string> = {
  net: 'Net',
  profit_factor: 'PF',
  win_rate: 'Win %',
  picked: 'Picked',
}

/** Every grid cell as if traded, unchanged, in every test window - which part of the grid actually
 *  held up out-of-sample, against what the tuner picked. Hindsight: no walk could have known the
 *  winner in advance, which is the point of comparing it with the picks. */
function CellTable({
  cells,
  axes,
  sort,
  onSort,
}: {
  cells: EngineAutotuneCell[]
  axes: string[]
  sort: CellSort
  onSort: (s: CellSort) => void
}) {
  const bestNet = cells[0]?.net
  const rows = [...cells].sort((a, b) => b[sort] - a[sort]).slice(0, 200)
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">
        Every combination, traded unchanged in every window (hindsight) · {cells.length} combinations
        {cells.length > rows.length ? `, top ${rows.length} shown` : ''} · highlighted = the tuner picked it
      </p>
      <div className="max-h-80 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {axes.map((k) => (
                <TableHead key={k} className="font-mono">
                  {k}
                </TableHead>
              ))}
              {(Object.keys(CELL_SORTS) as CellSort[]).map((k) => (
                <TableHead key={k} className="text-right">
                  <button type="button" className="hover:text-foreground" onClick={() => onSort(k)}>
                    {CELL_SORTS[k]}
                    {sort === k ? ' ↓' : ''}
                  </button>
                </TableHead>
              ))}
              <TableHead className="text-right">Trades</TableHead>
              <TableHead className="text-right">Windows won</TableHead>
              <TableHead className="text-right">In-sample / window</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={paramsLabel(c.params, axes)} className={cn(c.picked > 0 && 'bg-primary/5')}>
                {axes.map((k) => (
                  <TableCell key={k} className="font-mono text-xs">
                    {c.params[k]}
                  </TableCell>
                ))}
                <TableCell className={cn('text-right tabular-nums', pnlClass(c.net))}>
                  {inr(c.net)}
                  {c.net === bestNet && c.trades > 0 && (
                    <Badge variant="outline" className="ml-1.5 text-success">
                      best
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.trades ? fmt(c.profit_factor) : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.trades ? `${fmt(c.win_rate, 0)}%` : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.picked ? `×${c.picked}` : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{c.trades}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.positive_windows}/{c.windows}
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', pnlClass(c.is_net))}>
                  {inr(c.is_net)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function AutotuneView({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: r, error } = useQuery({
    queryKey: ['engineAutotune', id],
    queryFn: () => getEngineAutotune(id),
  })
  const remove = useMutation({
    mutationFn: () => deleteEngineAutotune(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['engineAutotunes'] })
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })
  const swept = useMemo(() => Object.keys(r?.axes ?? {}), [r])
  // Drill-down: a window row filters the trades and zooms the chart onto it; a trade row zooms to
  // that trade. Tuned and fixed-default executions are both kept, one shown at a time.
  const [selected, setSelected] = useState<number | null>(null)
  const [focusTrade, setFocusTrade] = useState<RunTrade | null>(null)
  const [side, setSide] = useState<'tuned' | 'fixed'>('tuned')
  const [cellSort, setCellSort] = useState<CellSort>('net')
  const trades = useMemo(() => (side === 'tuned' ? r?.oos.trades : r?.baseline.trades) ?? [], [r, side])
  const tradeWindow = useMemo(() => (r ? trades.map((t) => windowOfTrade(t, r.windows)) : []), [r, trades])
  const shownTrades = useMemo(
    () => (selected == null ? trades : trades.filter((_, i) => tradeWindow[i] === selected)),
    [trades, tradeWindow, selected],
  )
  // The executions chart takes a run; this is the walk's out-of-sample trades dressed as one. With a
  // window selected, its bars run from that window's train start (context) to its test end - the
  // chart gets the newest 30k bars of what it asks for, which on 1m wouldn't reach an old window.
  const execRun = useMemo(() => {
    if (!r) return null
    const w = selected == null ? null : r.windows[selected]
    const from = w ? sessionTime(w.train[0]) : (r.windows[0]?.start ?? sessionTime(r.sessions[0]))
    const to = w ? (w.end ?? sessionTime(w.test[1])) : (r.windows.at(-1)?.end ?? sessionTime(r.sessions[1]))
    return {
      id: r.id,
      symbols: [r.symbol],
      interval: r.interval,
      trades: shownTrades,
      summary: { from, to },
    } as unknown as EngineRun
  }, [r, selected, shownTrades])
  const focus = useMemo<RunTrade | null>(() => {
    if (focusTrade) return focusTrade
    const w = selected == null || !r ? null : r.windows[selected]
    return w && r
      ? [r.symbol, w.start ?? sessionTime(w.test[0]), w.end ?? sessionTime(w.test[1]), 0, 0, 0, 0]
      : null
  }, [focusTrade, selected, r])
  const curves = useMemo<Dataset[]>(() => {
    if (!r) return []
    const pts = (curve: [number, number][]) => curve.map(([t, v]) => ({ time: t as UTCTimestamp, value: v }))
    const start = r.oos.equity[0]?.[0]
    const promised: [number, number][] =
      start != null && r.promised.length && start < r.promised[0][0]
        ? [[start, 0], ...r.promised]
        : r.promised
    return [
      { key: 'Tuned (out-of-sample)', color: seriesColor(0), points: pts(r.oos.equity) },
      { key: 'Fixed defaults (out-of-sample)', color: seriesColor(3), points: pts(r.baseline.equity) },
      { key: 'In-sample promise', color: seriesColor(1), points: pts(promised) },
    ]
  }, [r])
  const paths = useMemo<Dataset[]>(
    () =>
      r
        ? swept.map((k, i) => ({
            key: k,
            color: seriesColor(i),
            points: r.windows
              .filter((w) => w.chosen)
              .map((w) => ({ time: sessionTime(w.test[0]), value: w.chosen![k] })),
          }))
        : [],
    [r, swept],
  )

  const actions = (
    <>
      {r && <ExportMenu name={r.id} sheets={() => autotuneSheets(r)} csvSheet={2} />}
      <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
        <Trash2Icon /> Delete
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}>
        <XIcon />
      </Button>
    </>
  )
  if (error || !r)
    return (
      <Panel title="Walk-forward" actions={actions}>
        {error ? <p className="text-sm text-destructive">{error.message}</p> : <Spinner className="size-4" />}
      </Panel>
    )

  const st = r.stats
  const tuned = r.oos.summary
  const base = r.baseline.summary
  // what happened, in numbers - not advice
  const verdict = !st.traded_windows
    ? 'No cell made money in-sample in any window, so the tuner never traded. This grid has nothing to tune.'
    : tuned.net <= 0
      ? `Tuned parameters lost ${inr(-tuned.net)} out-of-sample${st.beats_baseline ? ` - less than fixed defaults (${inr(base.net)}), largely by sitting out ${st.sat_out} of ${st.windows} windows` : ''}. No out-of-sample edge.`
      : st.beats_baseline
        ? `Tuned parameters made ${inr(tuned.net)} out-of-sample, against ${inr(base.net)} for fixed defaults. Read it with the efficiency, deflated Sharpe and stability below before trusting it.`
        : `Tuned parameters made ${inr(tuned.net)} out-of-sample, but fixed defaults made more (${inr(base.net)}) - tuning added nothing here.`

  return (
    <Panel
      title={`Walk-forward · ${r.strategy} · ${r.symbol} ${r.interval} · ${st.windows} windows`}
      actions={actions}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            {r.sessions[0]} → {r.sessions[1]} · train {r.train} / test {r.test} sessions · min {r.min_trades}{' '}
            trades · switch margin {fmt(r.margin * 100, 0)}% · cost {r.cost_bps} bps
          </span>
          <span>
            Tuned:{' '}
            <span className="font-mono text-foreground">
              {swept.map((k) => `${k} ${r.axes[k][0]}…${r.axes[k].at(-1)} (${r.axes[k].length})`).join(', ')}
            </span>
          </span>
          <span>
            Fixed defaults:{' '}
            <span className="font-mono text-foreground">
              {swept.map((k) => `${k}=${r.defaults[k]}`).join(' ')}
            </span>
          </span>
          <span>created {formatDateTime(r.created)}</span>
        </div>
        <HistoryLine history={r.history} coverage={r.coverage && { [r.symbol]: r.coverage }} />

        <p
          className={cn(
            'text-sm',
            tuned.net > 0 && st.beats_baseline ? 'text-success' : 'text-muted-foreground',
          )}
        >
          {verdict}
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Tuned net · out-of-sample" value={inr(tuned.net)} className={pnlClass(tuned.net)} />
          <Stat
            label="Fixed defaults net · out-of-sample"
            value={inr(base.net)}
            className={pnlClass(base.net)}
          />
          <Stat label="Trades · tuned vs fixed" value={`${fmt(tuned.trades, 0)} vs ${fmt(base.trades, 0)}`} />
          <Stat
            label="Profit factor · tuned vs fixed"
            value={`${fmt(tuned.profit_factor)} vs ${fmt(base.profit_factor)}`}
          />
          <Stat label="Max drawdown · tuned vs fixed" value={`${inr(tuned.max_dd)} vs ${inr(base.max_dd)}`} />
          <Stat
            label="Walk-forward efficiency · want ≥ 0.5"
            value={st.wfe == null ? '—' : fmt(st.wfe)}
            className={st.wfe == null ? undefined : st.wfe >= 0.5 ? 'text-success' : 'text-destructive'}
          />
          <Stat
            label={`Deflated Sharpe · ${st.trials} tries/window · want ≥ 90%`}
            value={st.dsr == null ? '—' : `${fmt(st.dsr * 100, 0)}%`}
            className={st.dsr == null ? undefined : st.dsr >= 0.9 ? 'text-success' : 'text-destructive'}
          />
          <Stat label="Windows traded" value={`${st.traded_windows} / ${st.windows}`} />
          <Stat
            label="Param stability · want ≥ 70%"
            value={st.stability == null ? '—' : `${fmt(st.stability * 100, 0)}%`}
            className={
              st.stability == null ? undefined : st.stability >= 0.7 ? 'text-success' : 'text-destructive'
            }
          />
          <Stat label="Pick switches" value={fmt(st.switches, 0)} />
        </div>

        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Out-of-sample equity, stitched window to window. The gap between the tuned line and the in-sample
            promise is how much of the in-sample result was fit to noise.
          </p>
          <div className="h-72">
            <SeriesChart datasets={curves} fill format={inr} />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <p className="mb-1 text-xs text-muted-foreground">
              What the tuner picked - each parameter set it traded, and what those windows made out-of-sample
            </p>
            <div className="max-h-80 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Params</TableHead>
                    <TableHead className="text-right">Windows</TableHead>
                    <TableHead className="text-right">Won</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pickedSets(r.windows, swept).map((g) => (
                    <TableRow key={paramsLabel(g.params, swept)}>
                      <TableCell className="font-mono text-xs">{paramsLabel(g.params, swept)}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.windows}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {g.positive}/{g.windows}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{g.trades}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', pnlClass(g.net))}>
                        {inr(g.net)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!st.traded_windows && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-xs text-muted-foreground italic">
                        Nothing picked - every window was sat out.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="xl:col-span-3">
            {r.cells?.length ? (
              <CellTable cells={r.cells} axes={swept} sort={cellSort} onSort={setCellSort} />
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                Every combination's out-of-sample result is kept on walk-forwards run from now on - re-run
                this one to see which parameter sets held up across all its windows.
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground">
              Executed trades, out-of-sample
              {selected != null &&
                ` - window ${r.windows[selected].test[0]} → ${r.windows[selected].test[1]}`}
              {' · click a trade to zoom to it'}
            </p>
            {selected != null && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setSelected(null)
                  setFocusTrade(null)
                }}
              >
                All windows <XIcon />
              </Button>
            )}
            <div className="ml-auto flex gap-1">
              {(['tuned', 'fixed'] as const).map((k) => (
                <Button
                  key={k}
                  size="xs"
                  variant={side === k ? 'secondary' : 'ghost'}
                  onClick={() => {
                    setSide(k)
                    setFocusTrade(null)
                  }}
                >
                  {k === 'tuned'
                    ? `Tuned (${r.oos.trades?.length ?? 0})`
                    : `Fixed defaults (${r.baseline.trades?.length ?? 0})`}
                </Button>
              ))}
            </div>
          </div>
          {r.oos.trades ? (
            <div className="space-y-2">
              {execRun && <ExecutionsChart key={`${side}-${selected}`} run={execRun} focus={focus} />}
              <div className="max-h-80 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Window</TableHead>
                      {side === 'tuned' && <TableHead>Params</TableHead>}
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
                    {shownTrades.slice(-1000).map((t, i) => {
                      const w = r.windows[windowOfTrade(t, r.windows)]
                      const active = focusTrade?.[1] === t[1] && focusTrade?.[2] === t[2]
                      return (
                        <TableRow
                          key={`${t[1]}-${i}`}
                          className={cn('cursor-pointer', active && 'bg-muted')}
                          onClick={() => setFocusTrade(t)}
                        >
                          <TableCell className="text-xs text-muted-foreground tabular-nums">
                            {w ? `${w.test[0]} → ${w.test[1]}` : '—'}
                          </TableCell>
                          {side === 'tuned' && (
                            <TableCell className="font-mono text-xs">
                              {w?.chosen ? paramsLabel(w.chosen, swept) : '—'}
                            </TableCell>
                          )}
                          <TableCell>{t[3] > 0 ? 'Long' : 'Short'}</TableCell>
                          <TableCell className="text-right tabular-nums">{Math.abs(t[3])}</TableCell>
                          <TableCell className="tabular-nums">{istTime(t[1])}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(t[4])}</TableCell>
                          <TableCell className="tabular-nums">{istTime(t[2])}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(t[5])}</TableCell>
                          <TableCell className={cn('text-right tabular-nums', pnlClass(t[6]))}>
                            {inr(t[6])}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {!shownTrades.length && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-xs text-muted-foreground italic">
                          No trades {selected != null ? 'in this window' : ''}.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {shownTrades.length > 1000 && (
                <p className="text-[11px] text-muted-foreground">
                  Showing the latest 1,000 of {shownTrades.length} - pick a window to see its own. Export has
                  them all.
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
              Executed trades are kept on walk-forwards run from now on - re-run this one to see them on the
              chart.
            </p>
          )}
        </div>

        {paths.some((p) => p.points.length > 1) && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Parameter path - the pick at each window's start. A line that jumps around the grid means there
              is no stable optimum to tune toward.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              {paths.map((p) => (
                <div key={p.key} className="h-40">
                  <SeriesChart datasets={[p]} fill />
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Windows · click one to see its trades on the chart · <em>pick rank</em> is where the tuner's
            choice finished among every combination on that window's unseen bars
          </p>
          <div className="max-h-[28rem] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Test sessions</TableHead>
                  {swept.map((k) => (
                    <TableHead key={k} className="font-mono">
                      {k}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Eligible cells</TableHead>
                  <TableHead className="text-right">In-sample net</TableHead>
                  <TableHead className="text-right">Out-of-sample net</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Fixed defaults net</TableHead>
                  <TableHead className="text-right">Pick rank</TableHead>
                  <TableHead>Best combination (hindsight)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.windows.map((w, wi) => (
                  <TableRow
                    key={w.test[0]}
                    className={cn(
                      'cursor-pointer',
                      !w.chosen && 'text-muted-foreground/60',
                      selected === wi && 'bg-muted',
                    )}
                    onClick={() => {
                      setSelected(selected === wi ? null : wi)
                      setFocusTrade(null)
                    }}
                  >
                    <TableCell className="tabular-nums">
                      {w.test[0]} → {w.test[1]}
                      {w.switched && (
                        <Badge variant="outline" className="ml-2">
                          switched
                        </Badge>
                      )}
                    </TableCell>
                    {w.chosen ? (
                      swept.map((k) => (
                        <TableCell key={k} className="font-mono text-xs">
                          {w.chosen![k]}
                        </TableCell>
                      ))
                    ) : (
                      <TableCell colSpan={swept.length} className="text-xs italic">
                        sat out
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums">
                      {w.eligible} / {w.cells}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', w.is && pnlClass(w.is.net))}>
                      {w.is ? inr(w.is.net) : '—'}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', w.oos && pnlClass(w.oos.net))}>
                      {w.oos ? inr(w.oos.net) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{w.oos ? w.oos.trades : '—'}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', pnlClass(w.baseline.net))}>
                      {inr(w.baseline.net)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        w.rank != null && w.of
                          ? w.rank <= Math.ceil(w.of / 3)
                            ? 'text-success'
                            : w.rank > Math.floor((2 * w.of) / 3)
                              ? 'text-destructive'
                              : ''
                          : '',
                      )}
                    >
                      {w.rank != null && w.of ? `${w.rank}/${w.of}` : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {w.best ? (
                        <>
                          {paramsLabel(w.best.params, swept)}{' '}
                          <span className={pnlClass(w.best.net)}>{inr(w.best.net)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
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

const VERDICT_BADGE = {
  held: { label: 'held up', className: 'text-success' },
  failed: { label: 'no edge', className: 'text-destructive' },
  idle: { label: 'never traded', className: 'text-muted-foreground' },
} as const

/** A multi-stock run: every stock's own walk-forward side by side, and the batch traded as one book.
 *  Each stock was tuned on its own; this only adds their results up. */
function AutotuneBatchView({
  batch,
  rows,
  onOpen,
  onClose,
}: {
  batch: string
  rows: EngineAutotuneRow[]
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => deleteEngineAutotuneBatch(batch),
    onSuccess: (r) => {
      toast.success(`Deleted ${r.deleted} reports`)
      queryClient.invalidateQueries({ queryKey: ['engineAutotunes'] })
      onClose()
    },
    onError: (e) => toast.error(e.message),
  })
  // the portfolio curve needs each stock's daily P&L, which the list rows leave out
  const combine = useCallback((results: UseQueryResult<EngineAutotuneReport>[]) => {
    const loaded = results.flatMap((r) => (r.data ? [r.data] : []))
    const pts = (curve: [number, number][]) => curve.map(([t, v]) => ({ time: t as UTCTimestamp, value: v }))
    return {
      loading: results.some((r) => r.isPending),
      datasets: loaded.length
        ? [
            {
              key: 'Tuned (out-of-sample)',
              color: seriesColor(0),
              points: pts(portfolioCurve(loaded.map((d) => d.oos.daily))),
            },
            {
              key: 'Fixed defaults (out-of-sample)',
              color: seriesColor(3),
              points: pts(portfolioCurve(loaded.map((d) => d.baseline.daily))),
            },
          ]
        : [],
    }
  }, [])
  const { datasets, loading } = useQueries({
    queries: rows.map((r) => ({
      queryKey: ['engineAutotune', r.id],
      queryFn: () => getEngineAutotune(r.id),
    })),
    combine,
  })

  const sorted = [...rows].sort((a, b) => b.oos.net - a.oos.net)
  const actions = (
    <>
      <ExportMenu name={`autotune-${batch}`} sheets={() => [autotuneBatchSheet(sorted)]} />
      <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
        <Trash2Icon /> Delete all
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}>
        <XIcon />
      </Button>
    </>
  )
  if (!rows.length)
    return (
      <Panel title="Walk-forward batch" actions={actions}>
        <Spinner className="size-4" />
      </Panel>
    )

  const first = rows[0]
  const verdicts = sorted.map(tuneVerdict)
  const held = verdicts.filter((v) => v === 'held').length
  const idle = verdicts.filter((v) => v === 'idle').length
  const tunedNet = rows.reduce((n, r) => n + r.oos.net, 0)
  const fixedNet = rows.reduce((n, r) => n + r.baseline.net, 0)
  const wfes = rows.flatMap((r) => (r.stats.wfe == null ? [] : [r.stats.wfe])).sort((a, b) => a - b)

  return (
    <Panel
      title={`Walk-forward batch · ${first.strategy} · ${rows.length} stocks · ${first.interval}`}
      actions={actions}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            {first.sessions[0]} → {first.sessions[1]} · train {first.train} / test {first.test} sessions · min{' '}
            {first.min_trades} trades · switch margin {fmt(first.margin * 100, 0)}% · cost {first.cost_bps}{' '}
            bps
          </span>
          <span>
            Tuned:{' '}
            <span className="font-mono text-foreground">
              {Object.entries(first.axes)
                .map(([k, v]) => `${k} ${v[0]}…${v.at(-1)} (${v.length})`)
                .join(', ')}
            </span>
          </span>
          <span>created {formatDateTime(first.created)}</span>
        </div>
        <HistoryLine
          history={first.history}
          coverage={Object.fromEntries(rows.flatMap((r) => (r.coverage ? [[r.symbol, r.coverage]] : [])))}
        />

        <p className={cn('text-sm', held ? 'text-success' : 'text-muted-foreground')}>
          {held} of {rows.length} stocks held up out-of-sample (made money and beat fixed defaults)
          {idle ? `; ${idle} never found a cell that made money in-sample and never traded` : ''}. Each stock
          was tuned on its own - open one for its windows and parameter path.
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Stocks where tuning held up" value={`${held} / ${rows.length}`} />
          <Stat label="Tuned net · all stocks" value={inr(tunedNet)} className={pnlClass(tunedNet)} />
          <Stat
            label="Fixed defaults net · all stocks"
            value={inr(fixedNet)}
            className={pnlClass(fixedNet)}
          />
          <Stat label="Never traded" value={`${idle} / ${rows.length}`} />
          <Stat
            label="Median walk-forward efficiency"
            value={wfes.length ? fmt(wfes[Math.floor(wfes.length / 2)]) : '—'}
          />
        </div>

        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            The batch as one book: every stock's out-of-sample P&L summed day by day.
          </p>
          {loading && !datasets.length ? (
            <Spinner className="size-4" />
          ) : (
            <div className="h-72">
              <SeriesChart datasets={datasets} fill format={inr} />
            </div>
          )}
        </div>

        <div className="max-h-[28rem] overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Stock</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead className="text-right">Traded</TableHead>
                <TableHead className="text-right">Tuned net</TableHead>
                <TableHead className="text-right">Fixed net</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">PF tuned / fixed</TableHead>
                <TableHead className="text-right">WFE</TableHead>
                <TableHead className="text-right">Defl. Sharpe</TableHead>
                <TableHead className="text-right">Stability</TableHead>
                <TableHead>Best combination (hindsight)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r, i) => {
                const v = VERDICT_BADGE[verdicts[i]]
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
                    <TableCell className="font-medium">{r.symbol}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={v.className}>
                        {v.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.stats.traded_windows} / {r.stats.windows}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', pnlClass(r.oos.net))}>
                      {inr(r.oos.net)}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', pnlClass(r.baseline.net))}>
                      {inr(r.baseline.net)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.oos.trades}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.oos.trades ? fmt(r.oos.profit_factor) : '—'} / {fmt(r.baseline.profit_factor)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.stats.wfe == null ? '—' : fmt(r.stats.wfe)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.stats.dsr == null ? '—' : `${fmt(r.stats.dsr * 100, 0)}%`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.stats.stability == null ? '—' : `${fmt(r.stats.stability * 100, 0)}%`}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.best_cell ? (
                        <>
                          {paramsLabel(r.best_cell.params, Object.keys(r.axes))}{' '}
                          <span className={pnlClass(r.best_cell.net)}>{inr(r.best_cell.net)}</span>
                          {r.best_cell.picked ? (
                            ''
                          ) : (
                            <span className="text-muted-foreground"> · never picked</span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              <TableRow className="font-medium hover:bg-transparent">
                <TableCell colSpan={3}>All stocks</TableCell>
                <TableCell className={cn('text-right tabular-nums', pnlClass(tunedNet))}>
                  {inr(tunedNet)}
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', pnlClass(fixedNet))}>
                  {inr(fixedNet)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmt(
                    rows.reduce((n, r) => n + r.oos.trades, 0),
                    0,
                  )}
                </TableCell>
                <TableCell colSpan={5} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    </Panel>
  )
}

function AutotuneList({
  rows,
  active,
  onOpen,
  onOpenBatch,
}: {
  rows: EngineAutotuneRow[]
  active?: string
  onOpen: (id: string) => void
  onOpenBatch: (batch: string) => void
}) {
  const perBatch = new Map<string, number>()
  for (const r of rows) if (r.batch) perBatch.set(r.batch, (perBatch.get(r.batch) ?? 0) + 1)
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">No walk-forward reports yet - start one above.</p>
  return (
    <div className="max-h-80 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Stock</TableHead>
            <TableHead>Tuned</TableHead>
            <TableHead>Sessions</TableHead>
            <TableHead className="text-right">Traded</TableHead>
            <TableHead className="text-right">Tuned net</TableHead>
            <TableHead className="text-right">Fixed net</TableHead>
            <TableHead className="text-right">WFE</TableHead>
            <TableHead className="text-right">Defl. Sharpe</TableHead>
            <TableHead>Run</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.id}
              className={cn('cursor-pointer', active === r.id && 'bg-muted')}
              onClick={() => onOpen(r.id)}
            >
              <TableCell>
                <span className="font-medium">{r.symbol}</span>{' '}
                <span className="text-muted-foreground">
                  {r.strategy} · {r.interval}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {Object.keys(r.axes).join(', ')}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {r.sessions[0]} → {r.sessions[1]}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.stats.traded_windows} / {r.stats.windows}
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', pnlClass(r.oos.net))}>
                {inr(r.oos.net)}
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', pnlClass(r.baseline.net))}>
                {inr(r.baseline.net)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.stats.wfe == null ? '—' : fmt(r.stats.wfe)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.stats.dsr == null ? '—' : `${fmt(r.stats.dsr * 100, 0)}%`}
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                {r.batch && (perBatch.get(r.batch) ?? 0) > 1 && (
                  <Button size="xs" variant="outline" onClick={() => onOpenBatch(r.batch!)}>
                    {perBatch.get(r.batch)} stocks
                  </Button>
                )}
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
  const { tab, run, batch, sweep, autotune, tunebatch } = useSearch({ from: '/engine' })
  const navigate = useNavigate({ from: '/engine' })
  const queryClient = useQueryClient()
  const { data: runs = [] } = useQuery({
    queryKey: ['engineRuns'],
    queryFn: getEngineRuns,
    refetchInterval: 60_000,
  })
  const { data: sweeps = [] } = useQuery({ queryKey: ['engineSweeps'], queryFn: getEngineSweeps })
  const { data: tunes = [] } = useQuery({ queryKey: ['engineAutotunes'], queryFn: getEngineAutotunes })
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
  const openTune = (id?: string) => navigate({ search: (prev) => ({ ...prev, autotune: id }) })
  const openTuneBatch = (b?: string) => navigate({ search: (prev) => ({ ...prev, tunebatch: b }) })
  const setTab = (next: string) => navigate({ search: (prev) => ({ ...prev, tab: next as EngineTab }) })

  return (
    <div className="space-y-4">
      <h1 className="font-medium">{settings?.name}</h1>
      <Tabs value={tab ?? 'backtest'} onValueChange={setTab}>
        <TabsList>
          <TabsTab value="backtest">Backtests</TabsTab>
          <TabsTab value="autotune">
            Auto-tune
            {tunes.length > 0 && (
              <Badge variant="secondary" className="ml-1.5">
                {tunes.length}
              </Badge>
            )}
          </TabsTab>
          <TabsIndicator />
        </TabsList>

        <TabsPanel value="backtest" className="space-y-6 pt-4">
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
                The engine in <code>{settings.engine_dir}</code> isn't built yet - run <code>make</code>{' '}
                there, then reload.
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
        </TabsPanel>

        <TabsPanel value="autotune" className="space-y-6 pt-4">
          <Panel title="New walk-forward">
            {settings?.built ? (
              <AutotuneForm
                onDone={(b, ids) => {
                  queryClient.invalidateQueries({ queryKey: ['engineAutotunes'] })
                  // one stock opens its report; several open the batch, one click from each report
                  navigate({
                    search: (prev) =>
                      ids.length === 1
                        ? { ...prev, autotune: ids[0], tunebatch: undefined }
                        : { ...prev, tunebatch: b, autotune: undefined },
                  })
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Set up and build the engine first - the Backtests tab says how.
              </p>
            )}
          </Panel>
          {tunebatch && (
            <AutotuneBatchView
              key={tunebatch}
              batch={tunebatch}
              rows={tunes.filter((r) => r.batch === tunebatch)}
              onOpen={openTune}
              onClose={() => openTuneBatch(undefined)}
            />
          )}
          {autotune && <AutotuneView key={autotune} id={autotune} onClose={() => openTune(undefined)} />}
          <Panel title={`Reports (${tunes.length})`}>
            <AutotuneList rows={tunes} active={autotune} onOpen={openTune} onOpenBatch={openTuneBatch} />
          </Panel>
        </TabsPanel>
      </Tabs>
    </div>
  )
}

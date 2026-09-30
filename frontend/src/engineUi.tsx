// Pieces of the /engine UI shared by Engine.tsx, the run page (EngineRunPage.tsx) and the Jobs tab
// (EngineJobs.tsx): panels, stats, exports, and the run charts that read the engine's own reports.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CandlestickSeries, HistogramSeries, createChart, createSeriesMarkers } from 'lightweight-charts'
import type { UTCTimestamp } from 'lightweight-charts'
import { DownloadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { coverageNotes, focusRange, historyText, istTime, markerRange, tradeMarkers } from '@/lib/engine'
import type { RunTrade } from '@/lib/engine'
import { downloadCsv, downloadXlsx } from '@/lib/exportFile'
import type { SheetData } from '@/lib/exportFile'
import { fmt, inr } from '@/lib/format'
import { cn } from '@/lib/utils'
import { getIntradayBars } from '@/services/api'
import type { EngineCoverage, EngineHistory, EngineRun, EngineRunRow, EngineSkipped } from '@/services/api'

export const COLORS = { text: '#9ca3af', grid: 'rgba(148, 163, 184, 0.15)', up: '#22c55e', down: '#ef4444' }

//: How many markers (two per trade) the executions chart frames when it opens - see ExecutionsChart.
export const OPENING_MARKERS = 40

/** sessionStorage: a backtest request the Backtests form fills itself in from on its next mount -
 *  the run page's "Re-run & edit". Read once, then removed. */
export const PREFILL_KEY = 'engine.prefill'

export const pnlClass = (v: number) => (v > 0 ? 'text-success' : v < 0 ? 'text-destructive' : '')

/** The params that tell runs apart: the ones the sweep varied, or all but cost for a single run. */
export const paramText = (r: EngineRunRow) =>
  Object.entries(r.params)
    .filter(([k]) => (r.varied?.length ? r.varied.includes(k) : k !== 'cost_bps'))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')

export const runName = (r: EngineRunRow) =>
  r.source === 'backtest'
    ? `${r.label ?? r.strategy} ${paramText(r)}`
    : `${r.strategy} ${r.source} ${r.id.slice(-10)}` // live ids end in the date: <strategy>-<source>-YYYY-MM-DD

export function Panel({
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
export function ExportMenu({
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

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

export function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className={cn('text-lg font-semibold tabular-nums', className)}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

export function HistoryLine({
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

export function DailyBars({ daily }: { daily: [number, number][] }) {
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
export function ExecutionsChart({ run, focus }: { run: EngineRun; focus: RunTrade | null }) {
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


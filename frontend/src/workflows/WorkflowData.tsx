import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { LineSeries, createChart } from 'lightweight-charts'
import type { ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import DataTable from '@/components/DataTable'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { getWorkflowSeries } from '@/services/api'

// What a workflow has gathered: its collected series as a chart and a table. Whether it is still
// working - runs, failures, durations - is on the Overview tab.
//
// Route: /workflows/$workflowId/data - the series, plotted column and split are all in the
// URL, so a reload shows the same chart.

const fmtTime = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' ? new Date(v).toLocaleString('en-IN') : '—'

// Same axis/grid colours as the journal's charts (ManualOverview), so the app reads as one thing.
const CHART = { text: '#9ca3af', grid: 'rgba(148, 163, 184, 0.15)' }

// Ten hand-picked hues that stay apart on both themes, then golden-angle steps for anything past
// them - a 25-symbol watchlist still gets 25 distinguishable lines.
const PALETTE = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#14b8a6',
]
const hslHex = (h: number, s: number, l: number) => {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}
const seriesColor = (i: number) => PALETTE[i] ?? hslHex((i * 137.508) % 360, 0.65, 0.55)
const faded = (hex: string) =>
  `rgba(${Number.parseInt(hex.slice(1, 3), 16)}, ${Number.parseInt(hex.slice(3, 5), 16)}, ${Number.parseInt(hex.slice(5, 7), 16)}, 0.2)`

/** A split column has to name groups, not be one: 2..MAX_GROUPS distinct plain values. */
const MAX_GROUPS = 60
const NONE = 'none'

type Dataset = { key: string; color: string; points: { time: UTCTimestamp; value: number }[] }

/** One line per dataset on the app's own chart library (lightweight-charts, as on the journal and
 *  paper pages). The legend is the control: click to hide a line, double-click to show only it,
 *  hover to pick it out of the rest; it shows values under the crosshair, or the latest ones. */
function SeriesChart({ datasets }: { datasets: Dataset[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef(new Map<string, ISeriesApi<'Line'>>())
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [hovered, setHovered] = useState<string | null>(null)
  const [crosshair, setCrosshair] = useState<Map<string, number> | null>(null)

  useEffect(() => {
    if (!containerRef.current || !datasets.length) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: CHART.text, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: CHART.grid } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderVisible: false },
      localization: { priceFormatter: (p: number) => fmt(p) },
    })
    const map = new Map<string, ISeriesApi<'Line'>>()
    for (const d of datasets) {
      const series = chart.addSeries(LineSeries, {
        color: d.color,
        lineWidth: 2,
        // A line with one or two points is invisible without its dots.
        pointMarkersVisible: d.points.length < 40,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerRadius: 3,
      })
      series.setData(d.points)
      map.set(d.key, series)
    }
    seriesRef.current = map
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) return setCrosshair(null)
      const values = new Map<string, number>()
      for (const [key, series] of map) {
        const point = param.seriesData.get(series)
        if (point && 'value' in point) values.set(key, point.value)
      }
      setCrosshair(values)
    })
    chart.timeScale().fitContent()
    return () => {
      chart.remove()
      seriesRef.current = new Map()
    }
  }, [datasets])

  useEffect(() => {
    datasets.forEach((d) => {
      seriesRef.current.get(d.key)?.applyOptions({
        visible: !hidden.has(d.key),
        color: hovered && hovered !== d.key ? faded(d.color) : d.color,
        lineWidth: hovered === d.key ? 3 : 2,
      })
    })
  }, [datasets, hidden, hovered])

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const solo = (key: string) => setHidden(new Set(datasets.map((d) => d.key).filter((k) => k !== key)))

  return (
    <div>
      <div className="relative h-64">
        <div ref={containerRef} className="absolute inset-0" />
      </div>
      {datasets.length > 1 && (
        <div className="mt-3 flex items-start gap-2 border-t pt-3">
          <div className="flex max-h-28 flex-1 flex-wrap gap-1 overflow-y-auto">
            {datasets.map((d) => {
              const off = hidden.has(d.key)
              const value = crosshair ? crosshair.get(d.key) : d.points.at(-1)?.value
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggle(d.key)}
                  onDoubleClick={() => solo(d.key)}
                  onMouseEnter={() => !off && setHovered(d.key)}
                  onMouseLeave={() => setHovered(null)}
                  aria-pressed={!off}
                  title="Click to hide · double-click to show only this"
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-all select-none hover:bg-muted',
                    off && 'opacity-40',
                  )}
                >
                  <span className="size-2 rounded-full" style={{ background: d.color }} />
                  <span className="font-medium">{d.key}</span>
                  {value != null && <span className="text-muted-foreground tabular-nums">{fmt(value)}</span>}
                </button>
              )
            })}
          </div>
          <div className="flex shrink-0 gap-1 text-[11px]">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setHidden(new Set())}
            >
              All
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setHidden(new Set(datasets.map((d) => d.key)))}
            >
              None
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WorkflowData() {
  const navigate = useNavigate()
  const { workflowId: id } = useParams({ from: '/workflows/$workflowId/data' })
  const { series, column, by } = useSearch({ from: '/workflows/$workflowId/data' })

  const setSearch = (next: { series?: string; column?: string; by?: string }) =>
    navigate({
      to: '/workflows/$workflowId/data',
      params: { workflowId: id },
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
    })

  const { data, isLoading } = useQuery({
    queryKey: ['workflowSeries', id, series],
    queryFn: () => getWorkflowSeries(id, series),
  })

  // A stale ?column= from another series falls back to the first plottable one.
  const plotted = column && data?.numeric.includes(column) ? column : data?.numeric[0]

  // Columns that name groups - a symbol, a sector - and so can split the chart into datasets.
  const splitColumns = useMemo(() => {
    if (!data) return []
    return data.columns.filter((key) => {
      if (data.numeric.includes(key)) return false
      const values = new Set<string>()
      for (const row of data.rows) {
        const v = row[key]
        if (v !== null && typeof v === 'object') return false
        values.add(String(v ?? '—'))
        if (values.size > MAX_GROUPS) return false
      }
      return values.size >= 2
    })
  }, [data])

  const split =
    by === NONE
      ? undefined
      : by && splitColumns.includes(by)
        ? by
        : splitColumns.includes('symbol')
          ? 'symbol'
          : splitColumns[0]

  const datasets = useMemo<Dataset[]>(() => {
    if (!plotted || !data) return []
    const groups = new Map<string, Map<number, number>>()
    for (const row of data.rows) {
      const ms = new Date(String(row.collected_at)).getTime()
      const raw = row[plotted]
      const value = Number(raw)
      if (!Number.isFinite(ms) || raw === null || raw === '' || !Number.isFinite(value)) continue
      // lightweight-charts labels its axis in UTC; shifting by the local offset makes it read as
      // wall-clock time here, as PriceChart does for IST bars.
      const time = Math.floor(ms / 1000) - new Date(ms).getTimezoneOffset() * 60
      const key = split ? String(row[split] ?? '—') : plotted
      if (!groups.has(key)) groups.set(key, new Map())
      groups.get(key)?.set(time, value)
    }
    // Alphabetical, so a symbol keeps its colour from one run to the next.
    return [...groups.keys()].sort().map((key, i) => ({
      key,
      color: seriesColor(i),
      points: [...(groups.get(key) ?? [])]
        .sort((a, b) => a[0] - b[0])
        .map(([time, value]) => ({ time: time as UTCTimestamp, value })),
    }))
  }, [data, plotted, split])

  const runCount = useMemo(() => new Set(data?.rows.map((r) => r.run_id)).size, [data])

  // Columns are whatever the series actually holds - a collected row's shape is the wired tool's
  // shape, so they're derived from the data rather than declared.
  const columns = useMemo(() => {
    const cell = (value: unknown) =>
      typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '—')
    return [
      {
        id: 'collected_at',
        header: 'Collected',
        accessorKey: 'collected_at',
        cell: (c: { getValue: () => unknown }) => fmtTime(c.getValue()),
      },
      ...(data?.columns ?? []).map((key) => ({
        id: key,
        header: key,
        accessorKey: key,
        cell: (c: { getValue: () => unknown }) => cell(c.getValue()),
      })),
    ] as never
  }, [data?.columns])

  return (
    <div className="h-full overflow-y-auto p-4">
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-5" />
        </div>
      ) : !data?.series.length ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nothing collected yet. Add a <code>collect</code> node and run it — each run appends its rows here,
          keeping the last N.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select
              value={data.selected ?? undefined}
              onValueChange={(v) => setSearch({ series: v as string, column: undefined, by: undefined })}
            >
              <SelectTrigger className="w-44" aria-label="Series">
                <SelectValue placeholder="Series" />
              </SelectTrigger>
              <SelectContent>
                {data.series.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {data.numeric.length > 0 && (
              <Select value={plotted} onValueChange={(v) => setSearch({ column: v as string })}>
                <SelectTrigger className="w-44" aria-label="Plotted column">
                  <SelectValue placeholder="Plot column" />
                </SelectTrigger>
                <SelectContent>
                  {data.numeric.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {splitColumns.length > 0 && (
              <Select value={split ?? NONE} onValueChange={(v) => setSearch({ by: v as string })}>
                <SelectTrigger className="w-44" aria-label="Split lines by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>One line</SelectItem>
                  {splitColumns.map((c) => (
                    <SelectItem key={c} value={c}>
                      A line per {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="text-xs text-muted-foreground">
              {data.rows.length} rows · {runCount} run{runCount === 1 ? '' : 's'}
            </span>
          </div>

          {data.numeric.length > 0 && (
            <div className="mb-4 rounded-xl border bg-card p-3">
              {datasets.length ? (
                <>
                  <SeriesChart datasets={datasets} />
                  {runCount === 1 && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      One run so far, so each line is a single point — every run adds the next one.
                    </p>
                  )}
                </>
              ) : (
                <p className="py-10 text-center text-xs text-muted-foreground">
                  No numeric values in {plotted}.
                </p>
              )}
            </div>
          )}

          <DataTable columns={columns} data={data.rows as never} sortable emptyMessage="No rows yet." />
        </>
      )}
    </div>
  )
}

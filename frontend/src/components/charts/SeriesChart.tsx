import { useEffect, useRef, useState } from 'react'
import { LineSeries, createChart } from 'lightweight-charts'
import type { ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import type { Dataset } from './colors'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'

// One line per dataset on the app's own chart library (lightweight-charts, as on the journal and
// paper pages). Shared by a workflow's Data tab and by dashboard panels, so a line reads the same
// wherever it's drawn.
//
// The legend is the control: click to hide a line, double-click to show only it, hover to pick it
// out; it shows the values under the crosshair, or the latest ones.

// Same axis/grid colours as the journal's charts (ManualOverview), so the app reads as one thing.
const CHART = { text: '#9ca3af', grid: 'rgba(148, 163, 184, 0.15)' }

const faded = (hex: string) =>
  `rgba(${Number.parseInt(hex.slice(1, 3), 16)}, ${Number.parseInt(hex.slice(3, 5), 16)}, ${Number.parseInt(hex.slice(5, 7), 16)}, 0.2)`

export default function SeriesChart({
  datasets,
  fill = false,
  format = fmt,
  onPointClick,
}: {
  datasets: Dataset[]
  /** Fill the parent's height (a dashboard panel) instead of a fixed chart height. */
  fill?: boolean
  format?: (value: number) => string
  /** A click on the chart: the line nearest the pointer, and the time under it. */
  onPointClick?: (key: string, time: UTCTimestamp) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef(new Map<string, ISeriesApi<'Line'>>())
  const clickRef = useRef(onPointClick)
  clickRef.current = onPointClick
  const formatRef = useRef(format)
  formatRef.current = format
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
      localization: { priceFormatter: (p: number) => formatRef.current(p) },
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
    // The clicked line is the one whose value at that time sits nearest the pointer - the chart
    // reports every series' value at a time, not which line was under the cursor.
    chart.subscribeClick((param) => {
      const handler = clickRef.current
      if (!handler || !param.time || !param.point) return
      let best: { key: string; distance: number } | null = null
      for (const [key, series] of map) {
        const point = param.seriesData.get(series)
        if (!point || !('value' in point)) continue
        const y = series.priceToCoordinate(point.value)
        if (y == null) continue
        const distance = Math.abs(y - param.point.y)
        if (!best || distance < best.distance) best = { key, distance }
      }
      if (best) handler(best.key, param.time as UTCTimestamp)
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
    <div className={cn(fill && 'flex h-full min-h-0 flex-col')}>
      <div className={cn('relative', fill ? 'min-h-0 flex-1' : 'h-64')}>
        <div ref={containerRef} className={cn('absolute inset-0', onPointClick && 'cursor-pointer')} />
      </div>
      {datasets.length > 1 && (
        <div className={cn('flex items-start gap-2 border-t', fill ? 'mt-1 shrink-0 pt-1' : 'mt-3 pt-3')}>
          <div className={cn('flex flex-1 flex-wrap gap-1 overflow-y-auto', fill ? 'max-h-12' : 'max-h-28')}>
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
                  {value != null && (
                    <span className="text-muted-foreground tabular-nums">{format(value)}</span>
                  )}
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

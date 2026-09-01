import { useEffect, useMemo, useRef, useState } from 'react'
import { AreaSeries, CandlestickSeries, HistogramSeries, LineSeries, createChart } from 'lightweight-charts'
import { ChartCandlestickIcon, ChartSplineIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { compact } from '@/lib/format'
import { computeEma, INDICATOR_COLORS as EMA_COLORS } from '@/lib/indicators'
import type { UTCTimestamp } from 'lightweight-charts'
import type { ChartBar, ChartResponse } from '@/services/api'

// lightweight-charts' internal color parser only understands rgb()/hex/hsl literals, and
// getComputedStyle doesn't reliably convert our theme.css oklch() values to rgb() across
// browsers - so the chart uses its own fixed palette instead of reading CSS variables.
const COLORS = {
  up: '#22c55e',
  down: '#ef4444',
  volumeUp: 'rgba(34, 197, 94, 0.5)',
  volumeDown: 'rgba(239, 68, 68, 0.5)',
  text: '#9ca3af',
  grid: 'rgba(148, 163, 184, 0.15)',
}

// Estimated tooltip box size, used to flip it to the opposite side near an edge instead of
// clamping it in place (clamping can leave the box sitting on top of the cursor's data point).
// Height grows with each active EMA row, so it's computed per-tooltip from EMA_ROW_H.
/** The floating readout: where it sits, which bar it is over, and each EMA's value there. */
type EmaReading = { period: number; color: string; value: number }
type Tooltip = { left: number; top: number; bar: ChartBar; emas: EmaReading[] }

// The API sends plain unix seconds, which is one of the shapes lightweight-charts accepts - but
// its `Time` is branded, so a number cannot widen into it on its own.
const t = (time: number) => time as UTCTimestamp

const TOOLTIP_W = 176
const TOOLTIP_H_BASE = 158
const EMA_ROW_H = 16
const TOOLTIP_MARGIN = 14

// scraper.py pre-shifts bar times by the IST offset so the chart's (UTC-only) axis labels show
// market-local time - so format tooltip dates as UTC too, or the browser would shift it again.
function formatBarDate(time: number, intraday: boolean) {
  const date = new Date(time * 1000)
  // 'en-GB' (not 'en-IN') for a consistent day-month-year ordering regardless of viewer locale
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }
  if (intraday) {
    opts.hour = '2-digit'
    opts.minute = '2-digit'
  }
  return date.toLocaleString('en-GB', opts)
}

/** Candlestick/line price chart with a volume pane and optional EMA overlays - shared by the
 * range-picker chart (StockChart) and the full-history chart (StockDetail's max-history
 * section). `data` is {bars, interval, visibleFrom} in scraper.py's chart shape; `leftControls`
 * renders in place of the range buttons for callers that don't have a range to pick. */
export default function PriceChart({
  data,
  isLoading,
  leftControls,
  emptyMessage = 'No price data for this range.',
}: {
  data?: ChartResponse
  isLoading?: boolean
  leftControls?: React.ReactNode
  emptyMessage?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [type, setType] = useState<'line' | 'candles'>('line')
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [emaEnabled, setEmaEnabled] = useState(() => localStorage.getItem('chart.emaEnabled') === 'true')
  const [emaPeriods, setEmaPeriods] = useState<number[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('chart.emaPeriods') ?? '') ?? [20, 50]
    } catch {
      return [20, 50]
    }
  })
  const [newPeriod, setNewPeriod] = useState('')

  useEffect(() => localStorage.setItem('chart.emaEnabled', String(emaEnabled)), [emaEnabled])
  useEffect(() => localStorage.setItem('chart.emaPeriods', JSON.stringify(emaPeriods)), [emaPeriods])

  const addPeriod = () => {
    const n = parseInt(newPeriod, 10)
    if (n > 0 && !emaPeriods.includes(n)) setEmaPeriods((p) => [...p, n].sort((a, b) => a - b))
    setNewPeriod('')
  }
  const removePeriod = (n: number) => setEmaPeriods((p) => p.filter((x) => x !== n))

  // data.bars includes extra warmup bars before visibleFrom so EMAs have enough prior data to
  // cover the whole visible range - the price series/axis only show visibleBars.
  const visibleBars = useMemo(() => {
    const from = data?.visibleFrom
    return from ? data!.bars.filter((b) => b.time >= from) : (data?.bars ?? [])
  }, [data])
  const barsByTime = useMemo(() => new Map(visibleBars.map((b) => [b.time, b])), [visibleBars])

  useEffect(() => {
    const container = containerRef.current
    if (!visibleBars.length || !container) return
    setTooltip(null)

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: COLORS.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: COLORS.grid },
      },
      timeScale: { borderVisible: false, timeVisible: !!data?.interval.endsWith('m') },
      rightPriceScale: { borderVisible: false },
      localization: { priceFormatter: (p: number) => `₹${p.toFixed(2)}` },
    })

    if (type === 'candles') {
      chart
        .addSeries(CandlestickSeries, {
          upColor: COLORS.up,
          downColor: COLORS.down,
          wickUpColor: COLORS.up,
          wickDownColor: COLORS.down,
          borderVisible: false,
        })
        .setData(visibleBars.map((b) => ({ ...b, time: t(b.time) })))
    } else {
      const rising = (visibleBars.at(-1)?.close ?? 0) >= visibleBars[0].open
      const color = rising ? COLORS.up : COLORS.down
      chart
        .addSeries(AreaSeries, {
          lineColor: color,
          lineWidth: 2,
          topColor: rising ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
          bottomColor: 'rgba(0, 0, 0, 0)',
        })
        .setData(visibleBars.map((b) => ({ time: t(b.time), value: b.close })))
    }

    // Volume, TradingView-style: its own pane below the price pane, sized to ~1/4 the height.
    // priceFormat 'custom' is needed, not just 'volume' - the chart-level ₹ priceFormatter
    // above would otherwise stamp a ₹ in front of volume axis labels too.
    chart
      .addSeries(
        HistogramSeries,
        {
          priceFormat: { type: 'custom', formatter: compact, minMove: 1 },
          priceLineVisible: false,
        },
        1,
      )
      .setData(
        visibleBars.map((b) => ({
          time: t(b.time),
          value: b.volume,
          color: b.close >= b.open ? COLORS.volumeUp : COLORS.volumeDown,
        })),
      )
    chart.panes()[0].setStretchFactor(3)
    chart.panes()[1].setStretchFactor(1)

    const emaSeries = emaEnabled
      ? emaPeriods.map((period, i) => {
          const emaData = computeEma(data?.bars ?? [], period)
          const color = EMA_COLORS[i % EMA_COLORS.length]
          if (emaData.length) {
            chart
              .addSeries(LineSeries, {
                color,
                lineWidth: 1,
                crosshairMarkerVisible: false,
                lastValueVisible: false,
                priceLineVisible: false,
              })
              .setData(emaData.map((d) => ({ time: t(d.time as number), value: d.value })))
          }
          return {
            period,
            color,
            byTime: new Map(emaData.map((d) => [d.time as number, d.value])),
          }
        })
      : []

    chart.subscribeCrosshairMove((param) => {
      // Every series here is keyed by a unix second, so the crosshair's Time is one too.
      const at = param.time as number | undefined
      if (!param.point || at == null || !barsByTime.has(at)) {
        setTooltip(null)
        return
      }
      const emas = emaSeries
        .map(({ period, color, byTime }) => ({ period, color, value: byTime.get(at) }))
        .filter((e): e is EmaReading => e.value !== undefined)
      const tooltipHeight = TOOLTIP_H_BASE + emas.length * EMA_ROW_H
      const { width } = container.getBoundingClientRect()
      const flipX = param.point.x + TOOLTIP_MARGIN + TOOLTIP_W > width
      const flipY = param.point.y - TOOLTIP_MARGIN - tooltipHeight < 0
      setTooltip({
        left: flipX ? param.point.x - TOOLTIP_MARGIN - TOOLTIP_W : param.point.x + TOOLTIP_MARGIN,
        top: flipY ? param.point.y + TOOLTIP_MARGIN : param.point.y - TOOLTIP_MARGIN - tooltipHeight,
        bar: barsByTime.get(at)!,
        emas,
      })
    })

    // Not fitContent(): EMA series can carry warmup points before visibleBars[0], which would
    // zoom the chart out to include them. Pin the view to just the visible window instead.
    chart.timeScale().setVisibleRange({
      from: t(visibleBars[0].time),
      to: t(visibleBars.at(-1)!.time),
    })
    return () => chart.remove()
  }, [data, visibleBars, type, barsByTime, emaEnabled, emaPeriods])

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex gap-1">{leftControls}</div>
        <div className="flex items-center gap-1">
          <Button
            variant={emaEnabled ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setEmaEnabled((e) => !e)}
          >
            EMA
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={type === 'line' ? 'Switch to candles' : 'Switch to line'}
            onClick={() => setType((t) => (t === 'line' ? 'candles' : 'line'))}
          >
            {type === 'line' ? (
              <ChartCandlestickIcon className="size-4" />
            ) : (
              <ChartSplineIcon className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {emaEnabled && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {emaPeriods.map((period, i) => (
            <span
              key={period}
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              style={{ color: EMA_COLORS[i % EMA_COLORS.length] }}
            >
              EMA {period}
              <button
                type="button"
                aria-label={`Remove EMA ${period}`}
                onClick={() => removePeriod(period)}
                className="text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min="1"
              value={newPeriod}
              onChange={(e) => setNewPeriod(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPeriod()}
              placeholder="days"
              className="h-6 w-16 px-1.5 text-xs"
            />
            <Button variant="ghost" size="icon-sm" aria-label="Add EMA period" onClick={addPeriod}>
              <PlusIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="relative h-96">
        <div ref={containerRef} className="absolute inset-0" />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="size-4" /> Loading chart…
          </div>
        )}
        {data?.bars?.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        )}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg"
            style={{ left: tooltip.left, top: tooltip.top, width: TOOLTIP_W }}
          >
            <p className="mb-1.5 font-medium">
              {formatBarDate(tooltip.bar.time, !!data?.interval.endsWith('m'))}
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
              <span className="text-muted-foreground">Open</span>
              <span className="text-right">₹{tooltip.bar.open.toFixed(2)}</span>
              <span className="text-muted-foreground">High</span>
              <span className="text-right">₹{tooltip.bar.high.toFixed(2)}</span>
              <span className="text-muted-foreground">Low</span>
              <span className="text-right">₹{tooltip.bar.low.toFixed(2)}</span>
              <span className="text-muted-foreground">Close</span>
              <span className="text-right">₹{tooltip.bar.close.toFixed(2)}</span>
              <span className="text-muted-foreground">Volume</span>
              <span className="text-right">{compact(tooltip.bar.volume)}</span>
            </div>
            {tooltip.emas.length > 0 && (
              <div className="mt-1.5 space-y-1 border-t pt-1.5">
                {tooltip.emas.map(({ period, color, value }) => (
                  <div key={period} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5" style={{ color }}>
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
                      EMA {period}
                    </span>
                    <span className="tabular-nums" style={{ color }}>
                      ₹{value.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

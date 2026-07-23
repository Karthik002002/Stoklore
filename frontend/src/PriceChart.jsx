import { useEffect, useMemo, useRef, useState } from 'react'
import { AreaSeries, CandlestickSeries, HistogramSeries, LineSeries, createChart } from 'lightweight-charts'
import { ChartCandlestickIcon, ChartSplineIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { compact } from '@/lib/format'

const EMA_COLORS = ['#f59e0b', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6']

function computeEma(bars, period) {
  if (bars.length < period) return []
  const k = 2 / (period + 1)
  const sma = bars.slice(0, period).reduce((sum, b) => sum + b.close, 0) / period
  const out = [{ time: bars[period - 1].time, value: sma }]
  let prev = sma
  for (let i = period; i < bars.length; i++) {
    prev = bars[i].close * k + prev * (1 - k)
    out.push({ time: bars[i].time, value: prev })
  }
  return out
}

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
const TOOLTIP_W = 176
const TOOLTIP_H_BASE = 158
const EMA_ROW_H = 16
const TOOLTIP_MARGIN = 14

// scraper.py pre-shifts bar times by the IST offset so the chart's (UTC-only) axis labels show
// market-local time - so format tooltip dates as UTC too, or the browser would shift it again.
function formatBarDate(time, intraday) {
  const date = new Date(time * 1000)
  // 'en-GB' (not 'en-IN') for a consistent day-month-year ordering regardless of viewer locale
  const opts = { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }
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
}) {
  const containerRef = useRef(null)
  const [type, setType] = useState('line')
  const [tooltip, setTooltip] = useState(null)
  const [emaEnabled, setEmaEnabled] = useState(() => localStorage.getItem('chart.emaEnabled') === 'true')
  const [emaPeriods, setEmaPeriods] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('chart.emaPeriods')) ?? [20, 50]
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
  const removePeriod = (n) => setEmaPeriods((p) => p.filter((x) => x !== n))

  // data.bars includes extra warmup bars before visibleFrom so EMAs have enough prior data to
  // cover the whole visible range - the price series/axis only show visibleBars.
  const visibleBars = useMemo(
    () => (data?.visibleFrom ? data.bars.filter((b) => b.time >= data.visibleFrom) : (data?.bars ?? [])),
    [data],
  )
  const barsByTime = useMemo(() => new Map(visibleBars.map((b) => [b.time, b])), [visibleBars])

  useEffect(() => {
    if (!visibleBars.length || !containerRef.current) return
    setTooltip(null)

    const chart = createChart(containerRef.current, {
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
      timeScale: { borderVisible: false, timeVisible: data.interval.endsWith('m') },
      rightPriceScale: { borderVisible: false },
      localization: { priceFormatter: (p) => `₹${p.toFixed(2)}` },
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
        .setData(visibleBars)
    } else {
      const rising = visibleBars.at(-1).close >= visibleBars[0].open
      const color = rising ? COLORS.up : COLORS.down
      chart
        .addSeries(AreaSeries, {
          lineColor: color,
          lineWidth: 2,
          topColor: rising ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
          bottomColor: 'rgba(0, 0, 0, 0)',
        })
        .setData(visibleBars.map((b) => ({ time: b.time, value: b.close })))
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
          time: b.time,
          value: b.volume,
          color: b.close >= b.open ? COLORS.volumeUp : COLORS.volumeDown,
        })),
      )
    chart.panes()[0].setStretchFactor(3)
    chart.panes()[1].setStretchFactor(1)

    const emaSeries = emaEnabled
      ? emaPeriods.map((period, i) => {
          const emaData = computeEma(data.bars, period)
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
              .setData(emaData)
          }
          return { period, color, byTime: new Map(emaData.map((d) => [d.time, d.value])) }
        })
      : []

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !barsByTime.has(param.time)) {
        setTooltip(null)
        return
      }
      const emas = emaSeries
        .map(({ period, color, byTime }) => ({ period, color, value: byTime.get(param.time) }))
        .filter((e) => e.value !== undefined)
      const tooltipHeight = TOOLTIP_H_BASE + emas.length * EMA_ROW_H
      const { width } = containerRef.current.getBoundingClientRect()
      const flipX = param.point.x + TOOLTIP_MARGIN + TOOLTIP_W > width
      const flipY = param.point.y - TOOLTIP_MARGIN - tooltipHeight < 0
      setTooltip({
        left: flipX ? param.point.x - TOOLTIP_MARGIN - TOOLTIP_W : param.point.x + TOOLTIP_MARGIN,
        top: flipY ? param.point.y + TOOLTIP_MARGIN : param.point.y - TOOLTIP_MARGIN - tooltipHeight,
        bar: barsByTime.get(param.time),
        emas,
      })
    })

    // Not fitContent(): EMA series can carry warmup points before visibleBars[0], which would
    // zoom the chart out to include them. Pin the view to just the visible window instead.
    chart.timeScale().setVisibleRange({
      from: visibleBars[0].time,
      to: visibleBars.at(-1).time,
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
              {formatBarDate(tooltip.bar.time, data.interval.endsWith('m'))}
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

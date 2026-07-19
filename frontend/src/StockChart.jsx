import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AreaSeries, CandlestickSeries, createChart } from 'lightweight-charts'
import { ChartCandlestickIcon, ChartSplineIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { getStockChart } from '@/services/api'

const RANGES = [
  ['1d', '1D'],
  ['5d', '5D'],
  ['1mo', '1M'],
  ['6mo', '6M'],
  ['ytd', 'YTD'],
  ['1y', '1Y'],
  ['5y', '5Y'],
  ['max', 'All'],
]

// lightweight-charts' internal color parser only understands rgb()/hex/hsl literals, and
// getComputedStyle doesn't reliably convert our theme.css oklch() values to rgb() across
// browsers - so the chart uses its own fixed palette instead of reading CSS variables.
const COLORS = {
  up: '#22c55e',
  down: '#ef4444',
  text: '#9ca3af',
  grid: 'rgba(148, 163, 184, 0.15)',
}

export default function StockChart({ symbol }) {
  const containerRef = useRef(null)
  const [range, setRange] = useState('1mo')
  const [type, setType] = useState('line')

  const { data, isLoading } = useQuery({
    queryKey: ['stockChart', symbol, range],
    queryFn: () => getStockChart(symbol, range),
  })

  useEffect(() => {
    if (!data?.bars?.length || !containerRef.current) return

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
        .setData(data.bars)
    } else {
      const rising = data.bars.at(-1).close >= data.bars[0].open
      const color = rising ? COLORS.up : COLORS.down
      chart
        .addSeries(AreaSeries, {
          lineColor: color,
          lineWidth: 2,
          topColor: rising ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
          bottomColor: 'rgba(0, 0, 0, 0)',
        })
        .setData(data.bars.map((b) => ({ time: b.time, value: b.close })))
    }

    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [data, type])

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex gap-1">
          {RANGES.map(([key, label]) => (
            <Button
              key={key}
              variant={range === key ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setRange(key)}
            >
              {label}
            </Button>
          ))}
        </div>
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

      <div className="relative h-72">
        <div ref={containerRef} className="absolute inset-0" />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="size-4" /> Loading chart…
          </div>
        )}
        {data?.bars?.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No price data for this range.
          </div>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AreaSeries, createChart } from 'lightweight-charts'
import { TrendingDownIcon, TrendingUpIcon } from 'lucide-react'
import { fmt } from '@/lib/format'
import { getIndexChart, getIndices } from '@/services/api'

const LABELS = { NIFTY: 'NIFTY 50', SENSEX: 'SENSEX' }

function Sparkline({ bars, up }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!bars?.length || !containerRef.current) return
    const color = up ? '#22c55e' : '#ef4444'
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      timeScale: { visible: false },
      rightPriceScale: { visible: false },
      handleScroll: false,
      handleScale: false,
    })
    chart
      .addSeries(AreaSeries, {
        lineColor: color,
        lineWidth: 2,
        topColor: up ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
        bottomColor: 'rgba(0, 0, 0, 0)',
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      .setData(bars.map((b) => ({ time: b.time, value: b.close })))
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [bars, up])

  return <div ref={containerRef} className="h-16 w-28 shrink-0" />
}

export default function IndexCard({ name }) {
  const { data: indices } = useQuery({ queryKey: ['indices'], queryFn: getIndices, refetchInterval: 60_000 })
  const { data: chart } = useQuery({
    queryKey: ['indexChart', name],
    queryFn: () => getIndexChart(name, '1mo'),
  })

  const index = indices?.find((i) => i.name === name)
  const change = index?.changePercent
  const up = change != null && change >= 0
  const Icon = up ? TrendingUpIcon : TrendingDownIcon

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4">
      <div>
        <p className="text-xs text-muted-foreground">{LABELS[name] ?? name}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">
          {index?.price != null ? index.price.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
        </p>
        {change != null && (
          <span
            className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${up ? 'text-up' : 'text-down'}`}
          >
            <Icon className="size-3.5" />
            {up ? '+' : ''}
            {fmt(change)}%
          </span>
        )}
      </div>
      <Sparkline bars={chart?.bars} up={up} />
    </div>
  )
}

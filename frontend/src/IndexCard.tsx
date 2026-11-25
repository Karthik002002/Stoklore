import { useEffect, useRef } from 'react'
import { useChartColors } from '@/design-system'
import { useQuery } from '@tanstack/react-query'
import { AreaSeries, createChart } from 'lightweight-charts'
import { TrendingDownIcon, TrendingUpIcon } from 'lucide-react'
import type { Bar } from '@/lib/types'
import { fmt } from '@/lib/format'
import { getIndexChart, getIndices } from '@/services/api'

const LABELS: Record<string, string> = { NIFTY: 'NIFTY 50', SENSEX: 'SENSEX' }

function Sparkline({ bars, up }: { bars?: Bar[]; up: boolean }) {
  const COLORS = useChartColors()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!bars?.length || !containerRef.current) return
    const color = up ? COLORS.up : COLORS.down
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
        topColor: COLORS.alpha(color, 0.2),
        bottomColor: 'rgba(0, 0, 0, 0)',
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      // Same as ReplayChart: the API sends a timestamp or a business day, both of which the
      // library accepts, but its `Time` is branded and a plain number cannot widen into it.
      .setData(bars.map((b) => ({ time: b.time, value: b.close })) as never)
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [bars, up, COLORS])

  return <div ref={containerRef} className="h-16 w-28 shrink-0" />
}

export default function IndexCard({ name }: { name: string }) {
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
    <div className="rounded-md border border-border bg-card flex items-center justify-between gap-4 p-3">
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

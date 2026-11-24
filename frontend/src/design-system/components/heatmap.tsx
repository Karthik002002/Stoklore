import { useLayoutEffect, useRef, useState } from 'react'
import { squarify } from '@/components/charts/squarify'
import { cn } from '@/lib/utils'
import { heat, monthGrid } from './marketMath'

const compactInr = (v: number) => {
  const a = Math.abs(v)
  const s = a >= 1e5 ? `${(a / 1e5).toFixed(1)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(0)
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s}`
}

const cellColor = (v: number | null, maxAbs: number) =>
  v == null || v === 0
    ? undefined
    : `color-mix(in oklab, var(--${v > 0 ? 'up' : 'down'}) ${Math.round(12 + heat(v, maxAbs) * 58)}%, var(--panel-head))`

/** Monthly P&L heatmap: Monday-first, each day tinted by its P&L, a weekly total column and the
 *  month total. `values` is { "YYYY-MM-DD": rupees }. */
function PnlCalendar({
  month,
  values,
  onDayClick,
  className,
}: {
  month: string
  values: Record<string, number>
  onDayClick?: (date: string) => void
  className?: string
}) {
  const weeks = monthGrid(month, values)
  const inMonth = weeks.flatMap((w) => w.cells).filter((c) => c.value != null)
  const maxAbs = Math.max(0, ...inMonth.map((c) => Math.abs(c.value!)))
  const total = weeks.reduce((a, w) => a + w.total, 0)
  const green = inMonth.filter((c) => c.value! > 0).length
  const red = inMonth.filter((c) => c.value! < 0).length
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  })
  return (
    <div data-slot="pnl-calendar" className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between text-2xs">
        <span className="font-semibold">{label}</span>
        <span className="text-muted-foreground">
          <span className="text-up">{green}</span> green · <span className="text-down">{red}</span> red ·{' '}
          <span className={cn('tabular', total >= 0 ? 'text-up' : 'text-down')}>₹{compactInr(total)}</span>
        </span>
      </div>
      <div className="grid grid-cols-[repeat(7,1fr)_minmax(44px,auto)] gap-0.5 text-[10px]">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S', 'Week'].map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed header
          <span key={i} className="pb-0.5 text-center text-muted-foreground uppercase">
            {d}
          </span>
        ))}
        {weeks.map((w) => (
          <div key={w.cells[0].date} className="contents">
            {w.cells.map((c) => (
              <button
                key={c.date}
                type="button"
                disabled={!c.inMonth || !onDayClick}
                onClick={() => onDayClick?.(c.date)}
                title={c.value != null ? `${c.date}: ₹${c.value.toLocaleString('en-IN')}` : c.date}
                style={{ background: cellColor(c.value, maxAbs) }}
                className={cn(
                  'flex h-9 flex-col justify-between rounded-xs px-1 py-0.5 text-left outline-none enabled:hover:ring-1 enabled:hover:ring-foreground/40 focus-visible:ring-2 focus-visible:ring-ring',
                  !c.inMonth && 'opacity-30',
                  c.value == null && 'bg-panel-head',
                )}
              >
                <span className="text-muted-foreground">{c.day}</span>
                {c.value != null && (
                  <span className="tabular self-end text-foreground">{compactInr(c.value)}</span>
                )}
              </button>
            ))}
            <span
              className={cn(
                'tabular flex items-center justify-end rounded-xs border border-border px-1',
                w.traded ? (w.total >= 0 ? 'text-up' : 'text-down') : 'text-muted-foreground',
              )}
            >
              {w.traded ? compactInr(w.total) : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

type TreemapItem = { label: string; size: number; change: number; sub?: string }

/** Sector / stock heatmap: tile area by `size` (market cap, weight), colour by `change` (%).
 *  Laid out with the app's squarify against the measured box, so tiles stay square-ish. */
function Treemap({
  items,
  height = 240,
  onTileClick,
  className,
}: {
  items: TreemapItem[]
  height?: number
  onTileClick?: (item: TreemapItem) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  const sorted = [...items].sort((a, b) => b.size - a.size)
  const tiles = width ? squarify(sorted, (i) => i.size, width, height) : []
  const maxAbs = Math.max(0.5, ...items.map((i) => Math.abs(i.change)))
  return (
    <div
      ref={ref}
      data-slot="treemap"
      className={cn('relative w-full overflow-hidden', className)}
      style={{ height }}
    >
      {tiles.map((t) => {
        const small = t.w < 64 || t.h < 34
        return (
          <button
            key={t.item.label}
            type="button"
            onClick={() => onTileClick?.(t.item)}
            title={`${t.item.label}${t.item.sub ? ` · ${t.item.sub}` : ''}: ${t.item.change > 0 ? '+' : ''}${t.item.change.toFixed(2)}%`}
            style={{
              left: t.x,
              top: t.y,
              width: t.w,
              height: t.h,
              background: cellColor(t.item.change, maxAbs) ?? 'var(--panel-head)',
            }}
            className="absolute flex flex-col justify-between overflow-hidden border border-card p-1 text-left outline-none hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span className={cn('truncate font-semibold', small ? 'text-[9px]' : 'text-2xs')}>
              {t.item.label}
            </span>
            {!small && (
              <span className="tabular self-end text-xs">
                {t.item.change > 0 ? '+' : ''}
                {t.item.change.toFixed(2)}%
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** The −/0/+ scale that goes under a heatmap. */
function HeatLegend({
  low = 'Loss',
  high = 'Profit',
  className,
}: {
  low?: string
  high?: string
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1.5 text-[10px] text-muted-foreground', className)}>
      {low}
      <span className="h-1.5 w-20 rounded-xs bg-linear-to-r from-down via-panel-head to-up" />
      {high}
    </div>
  )
}

export { PnlCalendar, Treemap, HeatLegend }

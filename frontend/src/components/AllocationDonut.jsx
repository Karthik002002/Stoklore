import { Group } from '@visx/group'
import { Pie } from '@visx/shape'
import { localPoint } from '@visx/event'
import { defaultStyles, TooltipWithBounds, useTooltip } from '@visx/tooltip'
import { inr } from '@/lib/format'

const CHART_COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5']
const DONUT_SIZE = 112
const DONUT_RADIUS = DONUT_SIZE / 2
const MAX_SLICES = 5

const color = (i) => `var(--${CHART_COLORS[i % CHART_COLORS.length]})`
const pct = (value, total) => (total > 0 ? Math.round((value / total) * 1000) / 10 : 0)

/**
 * Donut + legend for "where the money sits". Slices are `{ label, value }`; anything past the
 * fifth is folded into "Other" so the legend stays readable rather than turning into a list of
 * one-percent slivers - the point of this chart is concentration, and twenty equal slices and
 * five equal slices look identical at this size anyway.
 *
 * Zero/negative values are dropped: a pie can't draw them, and silently rendering a 0% wedge is
 * worse than omitting the row.
 */
export default function AllocationDonut({ title, slices, note }) {
  const { tooltipData, tooltipLeft, tooltipTop, tooltipOpen, showTooltip, hideTooltip } = useTooltip()

  const sorted = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value)
  const other = sorted.slice(MAX_SLICES).reduce((sum, s) => sum + s.value, 0)
  const shown = other > 0 ? [...sorted.slice(0, MAX_SLICES), { label: 'Other', value: other }] : sorted
  const total = sorted.reduce((sum, s) => sum + s.value, 0)

  return (
    <div className="relative rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {total <= 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing allocated yet.</p>
      ) : (
        <div className="flex items-center gap-6">
          <svg width={DONUT_SIZE} height={DONUT_SIZE} className="shrink-0">
            <Group top={DONUT_RADIUS} left={DONUT_RADIUS}>
              <Pie
                data={shown}
                pieValue={(d) => d.value}
                outerRadius={DONUT_RADIUS}
                innerRadius={DONUT_RADIUS - 20}
                padAngle={0.01}
              >
                {(pie) =>
                  pie.arcs.map((arc, i) => (
                    <path
                      key={arc.data.label}
                      d={pie.path(arc)}
                      fill={color(i)}
                      onMouseMove={(e) => {
                        const point = localPoint(e) ?? { x: 0, y: 0 }
                        showTooltip({ tooltipData: arc.data, tooltipLeft: point.x, tooltipTop: point.y })
                      }}
                      onMouseLeave={hideTooltip}
                    />
                  ))
                }
              </Pie>
            </Group>
          </svg>
          <div className="min-w-0 flex-1 space-y-1.5">
            {shown.map((s, i) => (
              <div key={s.label} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 truncate">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color(i) }} />
                  {s.label}
                </span>
                <span className="tabular-nums text-muted-foreground">{pct(s.value, total)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          left={tooltipLeft}
          top={tooltipTop}
          style={{ ...defaultStyles, background: 'var(--foreground)', color: 'var(--background)' }}
        >
          {tooltipData.label}: {inr(tooltipData.value)} ({pct(tooltipData.value, total)}%)
        </TooltipWithBounds>
      )}
    </div>
  )
}

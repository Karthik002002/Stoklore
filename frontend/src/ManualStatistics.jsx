import { useMemo, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmt, inr } from '@/lib/format'
import {
  calendarHeatmap,
  closedTrades,
  comparePoints,
  cumulativeByDay,
  DIMENSIONS,
  DISTRIBUTION_BASES,
  distribution,
  METRICS,
  overallStats,
  seriesFor,
  shiftCalendarAnchor,
  TRADE_AXES,
  TREND_BASES,
  trendSeries,
  whenYouTrade,
} from '@/lib/tradeStats'

const PERIODS = { week: { label: 'Week' }, month: { label: 'Month' } }
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const UP = '#22c55e'
const DOWN = '#ef4444'
const MAX_ROWS = 15

const formatValue = (v, format) => {
  if (v == null || v === '') return '—'
  switch (format) {
    case 'inr':
      return inr(v)
    case 'pct':
      return `${fmt(v, 1)}%`
    case 'num':
      return fmt(v, 0)
    case 'num2':
      return fmt(v, 2)
    case 'x':
      return `${fmt(v, 2)}×`
    case 'r':
      return `${fmt(v, 2)}R`
    default:
      return String(v)
  }
}

function Picker({ value, onChange, options, width = 'w-40' }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={width}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(options).map(([key, o]) => (
          <SelectItem key={key} value={key}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Panel({ title, hint, controls, children, className = '' }) {
  return (
    <div className={`rounded-xl border bg-card p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {controls && <div className="flex items-center gap-2">{controls}</div>}
      </div>
      {children}
    </div>
  )
}

const Empty = ({ children = 'No closed trades yet.' }) => (
  <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>
)

// --- Metric vs dimension: the one chart behind "PnL vs X", "Win-rate vs X", "R:R vs X", ---------
// --- "hit ratio vs X", best/worst symbols and most-traded in the reference. ---------------------

function BarRows({ rows, format }) {
  const shown = rows.slice(0, MAX_ROWS)
  const maxAbs = Math.max(...shown.map((r) => Math.abs(r.value ?? 0)), 0.01)
  return (
    <div className="space-y-2.5">
      {shown.map((r) => (
        <div key={r.label} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate font-medium">{r.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {r.count} trade{r.count === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${(r.value ?? 0) >= 0 ? 'bg-up' : 'bg-down'}`}
                style={{ width: `${(Math.abs(r.value ?? 0) / maxAbs) * 100}%` }}
              />
            </div>
            <span
              className={`w-24 shrink-0 text-right text-xs tabular-nums ${
                r.value == null ? 'text-muted-foreground' : r.value >= 0 ? 'text-up' : 'text-down'
              }`}
            >
              {formatValue(r.value, format)}
            </span>
          </div>
        </div>
      ))}
      {rows.length > MAX_ROWS && (
        <p className="pt-1 text-xs text-muted-foreground">+{rows.length - MAX_ROWS} more not shown</p>
      )}
    </div>
  )
}

function MetricByDimension({ trades }) {
  const [metric, setMetric] = useState('netPnl')
  const [dimension, setDimension] = useState('symbol')
  const rows = useMemo(() => seriesFor(trades, dimension, metric), [trades, dimension, metric])

  return (
    <Panel
      title={`${METRICS[metric].label} by ${DIMENSIONS[dimension].label.toLowerCase()}`}
      hint="Ranked best to worst, unless the dimension has a natural order."
      controls={
        <>
          <Picker value={metric} onChange={setMetric} options={METRICS} width="w-44" />
          <Picker value={dimension} onChange={setDimension} options={DIMENSIONS} />
        </>
      }
    >
      {rows.length === 0 ? <Empty /> : <BarRows rows={rows} format={METRICS[metric].format} />}
    </Panel>
  )
}

// --- Win/loss mix + activity vs P&L ------------------------------------------------------------

function WinLossMix({ trades }) {
  const [dimension, setDimension] = useState('dayOfWeek')
  const rows = useMemo(() => seriesFor(trades, dimension, 'count'), [trades, dimension])

  return (
    <Panel
      title="Win / loss mix"
      hint="Share of winners vs losers in each bucket."
      controls={<Picker value={dimension} onChange={setDimension} options={DIMENSIONS} />}
    >
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-2.5">
          {rows.slice(0, MAX_ROWS).map((r) => {
            const total = r.wins + r.losses || 1
            return (
              <div key={r.label} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{r.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {r.wins}W / {r.losses}L
                  </span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                  <div className="bg-up" style={{ width: `${(r.wins / total) * 100}%` }} />
                  <div className="bg-down" style={{ width: `${(r.losses / total) * 100}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

function ActivityVsPnl({ trades }) {
  const [dimension, setDimension] = useState('hour')
  const rows = useMemo(() => seriesFor(trades, dimension, 'count'), [trades, dimension])
  const maxCount = Math.max(...rows.map((r) => r.count), 1)

  return (
    <Panel
      title="Activity vs P&L"
      hint="How often you trade a bucket against what it actually pays - the two disagree more often than not."
      controls={<Picker value={dimension} onChange={setDimension} options={DIMENSIONS} />}
    >
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-2.5">
          {rows.slice(0, MAX_ROWS).map((r) => (
            <div key={r.label} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 truncate font-medium">{r.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${(r.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {r.count}
              </span>
              <span
                className={`w-24 shrink-0 text-right text-xs tabular-nums ${r.netPnl >= 0 ? 'text-up' : 'text-down'}`}
              >
                {inr(r.netPnl)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

// --- Distribution of gains and losses ----------------------------------------------------------

function DistributionPanel({ trades }) {
  const [basis, setBasis] = useState('pnl')
  const bins = useMemo(() => distribution(trades, basis), [trades, basis])
  const maxCount = Math.max(...bins.map((b) => b.count), 1)
  const format = DISTRIBUTION_BASES[basis].format

  return (
    <Panel
      title="Distribution of gains and losses"
      hint="Bin edges are pinned to zero, so small winners never share a bar with small losers."
      controls={<Picker value={basis} onChange={setBasis} options={DISTRIBUTION_BASES} width="w-36" />}
    >
      {bins.length === 0 ? (
        <Empty>Nothing to bucket yet.</Empty>
      ) : (
        <div className="flex h-44 items-end gap-1">
          {bins.map((b) => (
            <div key={b.from} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">{b.count || ''}</span>
              <div
                className={`w-full rounded-t ${b.from < 0 ? 'bg-down' : 'bg-up'}`}
                style={{ height: `${(b.count / maxCount) * 100}%`, minHeight: b.count ? '2px' : '0' }}
                title={`${formatValue(b.from, format)} to ${formatValue(b.to, format)}: ${b.count} trades`}
              />
              <span className="w-full truncate text-center text-[9px] text-muted-foreground">
                {formatValue(b.from, format)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

// --- Line chart (cumulative metrics + trend analysis) -------------------------------------------
// Plain SVG rather than lightweight-charts: these x-axes are trade numbers and sparse day
// indexes, not the continuous time scale that library is built around (it rejects duplicate
// timestamps, which several trades closed on one day would produce).

function LineChart({ series, format }) {
  const all = series.flatMap((s) => s.values.filter((v) => v != null))
  if (all.length < 2) return <Empty>Not enough closed trades to plot yet.</Empty>

  const max = Math.max(...all)
  const min = Math.min(...all)
  const span = max - min || 1
  const length = Math.max(...series.map((s) => s.values.length))
  const x = (i) => (i / Math.max(length - 1, 1)) * 100
  const y = (v) => 100 - ((v - min) / span) * 100
  const zeroY = min < 0 && max > 0 ? y(0) : null

  return (
    <div className="relative h-44">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full">
        {zeroY != null && (
          <line
            x1="0"
            y1={zeroY}
            x2="100"
            y2={zeroY}
            stroke="currentColor"
            strokeWidth="1"
            className="text-muted-foreground/40"
            vectorEffect="non-scaling-stroke"
            strokeDasharray="3 3"
          />
        )}
        {series.map((s) => (
          <polyline
            key={s.label}
            points={s.values
              .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
              .filter(Boolean)
              .join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={s.dashed ? 1.5 : 2}
            strokeDasharray={s.dashed ? '4 3' : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <span className="absolute top-0 right-0 text-[10px] tabular-nums text-muted-foreground">
        {formatValue(max, format)}
      </span>
      <span className="absolute right-0 bottom-0 text-[10px] tabular-nums text-muted-foreground">
        {formatValue(min, format)}
      </span>
    </div>
  )
}

function CumulativePanel({ trades }) {
  const [metric, setMetric] = useState('profitFactor')
  const points = useMemo(() => cumulativeByDay(trades, metric), [trades, metric])

  return (
    <Panel
      title="Cumulative performance per day"
      hint="Every trade closed up to that day, not the day on its own - shows whether the edge holds as the sample grows."
      controls={<Picker value={metric} onChange={setMetric} options={METRICS} width="w-44" />}
      className="lg:col-span-2"
    >
      <LineChart
        series={[{ label: 'cumulative', values: points.map((p) => p.value), color: UP }]}
        format={METRICS[metric].format}
      />
      <p className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{points[0]?.label}</span>
        <span>{points.at(-1)?.label}</span>
      </p>
    </Panel>
  )
}

function TrendPanel({ trades }) {
  const [basis, setBasis] = useState('cumulativePnl')
  const { points, movingAverage } = useMemo(() => trendSeries(trades, basis), [trades, basis])

  return (
    <Panel
      title="Trend analysis"
      hint="Per-trade values in trade order, with a 10-trade moving average (dashed)."
      controls={<Picker value={basis} onChange={setBasis} options={TREND_BASES} width="w-44" />}
      className="lg:col-span-2"
    >
      <LineChart
        series={[
          { label: 'per trade', values: points.map((p) => p.value), color: UP },
          { label: 'moving avg', values: movingAverage.map((p) => p.value), color: '#9ca3af', dashed: true },
        ]}
        format={TREND_BASES[basis].format}
      />
      <p className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>Trade 1</span>
        <span>Trade {points.length}</span>
      </p>
    </Panel>
  )
}

// --- When you trade: weekday x hour ------------------------------------------------------------

function WhenYouTrade({ trades }) {
  const [shade, setShade] = useState('count')
  const grid = useMemo(() => whenYouTrade(trades), [trades])
  const cells = grid.days.flatMap((d) => grid.hours.map((h) => grid.cellFor(d, h))).filter(Boolean)
  const maxCount = Math.max(...cells.map((c) => c.count), 1)
  const maxPnl = Math.max(...cells.map((c) => Math.abs(c.netPnl)), 1)

  return (
    <Panel
      title="When you trade"
      hint="Weekday against hour of entry."
      controls={
        <Picker
          value={shade}
          onChange={setShade}
          options={{ count: { label: 'By activity' }, pnl: { label: 'By net P&L' } }}
          width="w-36"
        />
      }
      className="lg:col-span-2"
    >
      {cells.length === 0 ? (
        <Empty />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th />
                {grid.hours.map((h) => (
                  <th key={h} className="pb-1 font-normal text-muted-foreground tabular-nums">
                    {String(h).padStart(2, '0')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.days.map((day) => (
                <tr key={day}>
                  <td className="pr-2 text-right text-muted-foreground">{day.slice(0, 3)}</td>
                  {grid.hours.map((hour) => {
                    const cell = grid.cellFor(day, hour)
                    const intensity = !cell
                      ? 0
                      : shade === 'count'
                        ? cell.count / maxCount
                        : Math.abs(cell.netPnl) / maxPnl
                    const color = !cell ? null : shade === 'count' ? UP : cell.netPnl >= 0 ? UP : DOWN
                    return (
                      <td
                        key={hour}
                        className="h-7 rounded text-center tabular-nums"
                        style={{
                          // Floor of 0.15 alpha so a bucket with a single trade still reads as
                          // "you traded here", instead of fading into an empty cell.
                          backgroundColor: cell
                            ? `${color}${Math.round((0.15 + intensity * 0.65) * 255)
                                .toString(16)
                                .padStart(2, '0')}`
                            : undefined,
                        }}
                        title={
                          cell ? `${day} ${hour}:00 — ${cell.count} trades, ${inr(cell.netPnl)}` : undefined
                        }
                      >
                        {cell?.count ?? ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

// --- Compare: any per-trade stat against any other ----------------------------------------------

function ComparePanel({ trades }) {
  const [xKey, setXKey] = useState('entryPrice')
  const [yKey, setYKey] = useState('pnl')
  const points = useMemo(() => comparePoints(trades, xKey, yKey), [trades, xKey, yKey])

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const xMin = Math.min(...xs)
  const xSpan = Math.max(...xs) - xMin || 1
  const yMin = Math.min(...ys)
  const ySpan = Math.max(...ys) - yMin || 1

  return (
    <Panel
      title="Compare"
      hint="Each dot is one closed trade; green won, red lost."
      controls={
        <>
          <Picker value={xKey} onChange={setXKey} options={TRADE_AXES} width="w-36" />
          <Picker value={yKey} onChange={setYKey} options={TRADE_AXES} width="w-36" />
        </>
      }
      className="lg:col-span-2"
    >
      {points.length === 0 ? (
        <Empty>Nothing to compare on those two axes yet.</Empty>
      ) : (
        <div className="relative h-56">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full">
            {yMin < 0 && (
              <line
                x1="0"
                y1={100 - ((0 - yMin) / ySpan) * 100}
                x2="100"
                y2={100 - ((0 - yMin) / ySpan) * 100}
                stroke="currentColor"
                className="text-muted-foreground/40"
                strokeWidth="1"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {points.map((p, i) => (
              <circle
                key={`${p.symbol}-${i}`}
                cx={((p.x - xMin) / xSpan) * 100}
                cy={100 - ((p.y - yMin) / ySpan) * 100}
                r="3"
                fill={p.win ? UP : DOWN}
                fillOpacity="0.65"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <span className="absolute top-0 left-0 text-[10px] text-muted-foreground">
            {TRADE_AXES[yKey].label} {formatValue(Math.max(...ys), TRADE_AXES[yKey].format)}
          </span>
          <span className="absolute right-0 bottom-0 text-[10px] text-muted-foreground">
            {TRADE_AXES[xKey].label} {formatValue(Math.max(...xs), TRADE_AXES[xKey].format)}
          </span>
        </div>
      )}
    </Panel>
  )
}

// --- Calendar heatmap: any two metrics, per day, week or month view -----------------------------

function CalendarHeatmap({ trades }) {
  const [period, setPeriod] = useState('month')
  const [metricA, setMetricA] = useState('netPnl')
  const [metricB, setMetricB] = useState('count')
  const [anchor, setAnchor] = useState(() => new Date().toISOString().slice(0, 10))

  const heat = useMemo(
    () => calendarHeatmap(trades, { period, anchor, metricA, metricB }),
    [trades, period, anchor, metricA, metricB],
  )
  const page = (direction) => setAnchor(shiftCalendarAnchor(anchor, period, direction))

  const maxAbsA = Math.max(...heat.cells.map((c) => Math.abs(c.a ?? 0)), 0.01)
  const leadingBlanks = heat.cells.length ? WEEKDAY_ORDER.indexOf(heat.cells[0].dayOfWeek) : 0

  return (
    <Panel
      title="Calendar heatmap"
      hint={`Shade is ${heat.metricA.label.toLowerCase()}, the number is ${heat.metricB.label.toLowerCase()}.`}
      controls={
        <>
          <Picker value={period} onChange={setPeriod} options={PERIODS} width="w-24" />
          <Picker value={metricA} onChange={setMetricA} options={METRICS} width="w-40" />
          <Picker value={metricB} onChange={setMetricB} options={METRICS} width="w-40" />
        </>
      }
      className="lg:col-span-2"
    >
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" size="icon-sm" aria-label="Previous period" onClick={() => page(-1)}>
          <ChevronLeftIcon className="size-4" />
        </Button>
        <p className="text-sm font-medium">{heat.label}</p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next period"
          disabled={!heat.canGoForward}
          onClick={() => page(1)}
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="pb-1 text-center text-[10px] text-muted-foreground">
            {d}
          </div>
        ))}
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {heat.cells.map((c) => {
          const intensity = Math.min(Math.abs(c.a ?? 0) / maxAbsA, 1)
          const up = (c.a ?? 0) >= 0
          return (
            <div
              key={c.date}
              title={`${c.date} — ${heat.metricA.label}: ${formatValue(c.a, heat.metricA.format)}, ${heat.metricB.label}: ${formatValue(c.b, heat.metricB.format)}`}
              className={`flex h-12 flex-col items-center justify-center rounded text-xs ${c.future ? 'opacity-30' : ''}`}
              style={{
                backgroundColor: c.count
                  ? `${up ? UP : DOWN}${Math.round((0.15 + intensity * 0.65) * 255)
                      .toString(16)
                      .padStart(2, '0')}`
                  : undefined,
              }}
            >
              <span className="tabular-nums">{Number(c.date.slice(-2))}</span>
              {c.count > 0 && (
                <span className="text-[9px] tabular-nums text-muted-foreground">
                  {formatValue(c.b, heat.metricB.format)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// --- Overall statistics: the searchable single-number panel --------------------------------------

function OverallStatistics({ trades }) {
  const [query, setQuery] = useState('')
  const sections = useMemo(() => overallStats(trades), [trades])
  const q = query.trim().toLowerCase()
  const filtered = sections
    .map((s) => ({ ...s, stats: q ? s.stats.filter((st) => st.label.toLowerCase().includes(q)) : s.stats }))
    .filter((s) => s.stats.length > 0)

  return (
    <Panel
      title="Overall statistics"
      controls={
        <div className="relative w-56">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search statistics…"
            className="h-7 pl-7 text-xs"
          />
        </div>
      }
      className="lg:col-span-2"
    >
      {filtered.length === 0 ? (
        <Empty>No statistic matches "{query}".</Empty>
      ) : (
        <div className="space-y-2">
          {filtered.map((section) => (
            // <details> rather than a state-driven accordion - the browser already does this.
            <details key={section.group} open className="rounded-lg border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{section.group}</summary>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 px-3 pt-1 pb-3 sm:grid-cols-2 lg:grid-cols-3">
                {section.stats.map((stat) => (
                  <div key={stat.label} className="flex items-baseline justify-between gap-2 border-b py-1">
                    <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                    <dd
                      className={`text-sm font-medium tabular-nums ${
                        stat.format === 'inr' && typeof stat.value === 'number'
                          ? stat.value >= 0
                            ? 'text-up'
                            : 'text-down'
                          : ''
                      }`}
                    >
                      {formatValue(stat.value, stat.format)}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </div>
      )}
    </Panel>
  )
}

export default function ManualStatistics({ trades }) {
  const closed = useMemo(() => closedTrades(trades), [trades])

  if (!trades?.length) {
    return (
      <div className="rounded-xl border bg-card">
        <Empty>Log a trade to see statistics.</Empty>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <OverallStatistics trades={trades} />
      <MetricByDimension trades={closed} />
      <DistributionPanel trades={closed} />
      <WinLossMix trades={closed} />
      <ActivityVsPnl trades={closed} />
      <CumulativePanel trades={closed} />
      <TrendPanel trades={closed} />
      <WhenYouTrade trades={closed} />
      <ComparePanel trades={closed} />
      <CalendarHeatmap trades={trades} />
    </div>
  )
}

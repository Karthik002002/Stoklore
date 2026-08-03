import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AreaSeries, HistogramSeries, createChart } from 'lightweight-charts'
import { ChevronLeftIcon, ChevronRightIcon, Trash2Icon, WalletIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmt, formatDate, inr } from '@/lib/format'
import {
  dayOfWeek,
  expectedR,
  expectedRBucket,
  isLikelyRevenge,
  lossExceededStop,
  lossStreaks,
  NSE_SESSIONS,
  recoveryFactor,
  riskStatus,
  sessionFor,
  sortinoRatio,
  sqnRating,
  systemQualityNumber,
  tradePnl,
  underwaterSeries,
  winStreaks,
} from '@/lib/manualTrades'
import {
  ACHIEVABLE_WIN_RATE,
  breakevenWinRate,
  compoundingDivergence,
  drawdownProbabilities,
  expectancyGrid,
  expectancyR,
  GRID_WIN_RATES,
  riskPaths,
  streakSurvival,
  SWEET_SPOT,
} from '@/lib/tradeMath'
import {
  createBalanceAdjustment,
  deleteBalanceAdjustment,
  getBalanceAdjustments,
  getManualBacktestSettings,
  getTradeAccounts,
} from '@/services/api'
import { GoalsSummary } from './ManualGoals'

const COLORS = { up: '#22c55e', down: '#ef4444', text: '#9ca3af', grid: 'rgba(148, 163, 184, 0.15)' }
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const SESSION_ORDER = [...NSE_SESSIONS.map((s) => s.name), 'After hours']
const R_BUCKET_ORDER = ['-3+', '-2', '-1', '0', '1', '2', '3+']

function StatCard({ label, value, valueClassName, sub }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className={`text-xl font-semibold tabular-nums ${valueClassName ?? ''}`}>{value}</p>
      <p className="mt-1 text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function MiniChart({ data, kind }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!data.length || !containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: COLORS.text, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: COLORS.grid } },
      timeScale: { borderVisible: false },
      rightPriceScale: { borderVisible: false },
      localization: { priceFormatter: (p) => inr(p) },
    })
    if (kind === 'histogram') {
      chart
        .addSeries(HistogramSeries, { priceLineVisible: false })
        .setData(
          data.map((d) => ({ time: d.time, value: d.value, color: d.value >= 0 ? COLORS.up : COLORS.down })),
        )
    } else {
      const rising = data.at(-1).value >= data[0].value
      const color = rising ? COLORS.up : COLORS.down
      chart
        .addSeries(AreaSeries, {
          lineColor: color,
          lineWidth: 2,
          topColor: rising ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
          bottomColor: 'rgba(0, 0, 0, 0)',
        })
        .setData(data)
    }
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [data, kind])

  return (
    <div className="relative h-56">
      <div ref={containerRef} className="absolute inset-0" />
      {data.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          No closed trades yet.
        </div>
      )}
    </div>
  )
}

const currentMonth = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
const monthOf = (dayStr) => {
  const [y, m] = dayStr.split('-').map(Number)
  return new Date(y, m - 1, 1)
}

function CalendarHeatmap({ dailyByDay, latestDay }) {
  const [cursor, setCursor] = useState(() => (latestDay ? monthOf(latestDay) : currentMonth()))
  // Trades load async, so `latestDay` is often still null on first render (defaulting to the
  // current month above) - once it arrives, jump to it once so the calendar doesn't open on an
  // empty current month while all the data sits in some other month. Guarded so it never fights
  // the Today/prev/next buttons after that first jump.
  const autoJumped = useRef(false)
  useEffect(() => {
    if (!autoJumped.current && latestDay) {
      setCursor(monthOf(latestDay))
      autoJumped.current = true
    }
  }, [latestDay])
  const today = new Date()

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const dayKey = (day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const isToday = (day) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear()

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
        >
          Today
        </Button>
        <h3 className="text-sm font-semibold">
          {cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </h3>
        <div className="flex gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Previous month"
            onClick={() => setCursor(new Date(year, month - 1, 1))}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Next month"
            onClick={() => setCursor(new Date(year, month + 1, 1))}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day == null) return <div key={`empty-${i}`} />
          const entry = dailyByDay.get(dayKey(day))
          const up = entry && entry.pnl >= 0
          return (
            <div
              key={day}
              className={`flex min-h-14 flex-col items-start justify-between rounded-lg p-1.5 text-xs ${
                entry ? (up ? 'bg-success/10' : 'bg-destructive/10') : 'bg-muted/30'
              } ${isToday(day) ? 'ring-1 ring-primary' : ''}`}
            >
              <span className="text-muted-foreground">{day}</span>
              {entry && (
                <span className={`self-end font-medium tabular-nums ${up ? 'text-up' : 'text-down'}`}>
                  {inr(entry.pnl)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Groups closed trades by an arbitrary key (setup / day-of-week / session) and reduces each
// group to avg P&L + win rate - the one shape every "which of these is actually working" chart
// in this file needs (see docs/manual-backtesting-improvement-plan.md #1 and #5).
function computeBreakdownRows(trades, keyFn) {
  const groups = new Map()
  trades.forEach((t) => {
    const key = keyFn(t) || 'Untagged'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  })
  return [...groups.entries()].map(([label, group]) => {
    const groupPnls = group.map(tradePnl)
    const avgPnl = Math.round((groupPnls.reduce((s, p) => s + p, 0) / group.length) * 100) / 100
    const winRate = Math.round((groupPnls.filter((p) => p > 0).length / group.length) * 1000) / 10
    return { label, count: group.length, metricValue: avgPnl, winRate }
  })
}

function sortByOrder(rows, order) {
  return [...rows].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
}

function BreakdownCard({ title, rows }) {
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.metricValue)), 0.01)
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-3 text-sm font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No closed trades yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.label} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{r.label}</span>
                <span className="text-xs text-muted-foreground">
                  {r.count} trade{r.count === 1 ? '' : 's'} · {r.winRate}% WR
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${r.metricValue >= 0 ? 'bg-up' : 'bg-down'}`}
                    style={{ width: `${(Math.abs(r.metricValue) / maxAbs) * 100}%` }}
                  />
                </div>
                <span
                  className={`w-20 shrink-0 text-right text-xs tabular-nums ${r.metricValue >= 0 ? 'text-up' : 'text-down'}`}
                >
                  {inr(r.metricValue)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RDistributionCard({ rows }) {
  const maxCount = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-3 text-sm font-medium">R-multiple distribution</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Set an "Ideal risk ₹" when logging a trade to see this.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.bucket} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-xs font-medium tabular-nums">{r.bucket}R</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                <div
                  className={`h-full ${r.bucket.startsWith('-') ? 'bg-down' : 'bg-up'}`}
                  style={{ width: `${(r.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {r.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Concentration: where losses actually bleed from, and how much of the profit rides on a --
// --- handful of outlier winners - both matter more than a plain avg-P&L-per-group breakdown ---

// Groups trades (losers-only, or winners-only) by an arbitrary key and reduces each group to its
// share of the group's total ₹ - the "which setup/symbol/session actually drives this" view, as
// opposed to BreakdownCard's avg-P&L-per-group (which mixes winners and losers together).
function computeConcentration(trades, keyFn) {
  const total = trades.reduce((s, t) => s + Math.abs(tradePnl(t)), 0)
  const groups = new Map()
  trades.forEach((t) => {
    const key = keyFn(t) || 'Untagged'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  })
  return [...groups.entries()]
    .map(([label, group]) => {
      const amount = Math.round(group.reduce((s, t) => s + Math.abs(tradePnl(t)), 0) * 100) / 100
      return {
        label,
        count: group.length,
        amount,
        pctOfTotal: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
      }
    })
    .sort((a, b) => b.amount - a.amount)
}

// Tags aren't mutually exclusive (a trade can carry several), so this flattens across every
// losing trade's tag list rather than grouping by one key per trade.
function computeTagLossFrequency(losingTrades) {
  const totalLoss = losingTrades.reduce((s, t) => s + Math.abs(tradePnl(t)), 0)
  const byTag = new Map()
  losingTrades.forEach((t) => {
    const lossAbs = Math.abs(tradePnl(t))
    ;(t.tags ?? []).forEach((tag) => {
      const entry = byTag.get(tag) ?? { count: 0, amount: 0 }
      entry.count += 1
      entry.amount += lossAbs
      byTag.set(tag, entry)
    })
  })
  return [...byTag.entries()]
    .map(([label, { count, amount }]) => ({
      label,
      count,
      amount: Math.round(amount * 100) / 100,
      pctOfTotal: totalLoss > 0 ? Math.round((amount / totalLoss) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
}

function ConcentrationList({ rows, tone }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No trades yet.</p>
  const maxAmount = Math.max(...rows.map((r) => r.amount), 0.01)
  const barClass = tone === 'up' ? 'bg-up' : 'bg-down'
  const textClass = tone === 'up' ? 'text-up' : 'text-down'
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{r.label}</span>
            <span className="text-xs text-muted-foreground">
              {r.count} trade{r.count === 1 ? '' : 's'} · {r.pctOfTotal}% of{' '}
              {tone === 'up' ? 'profit' : 'loss'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${barClass}`}
                style={{ width: `${(r.amount / maxAmount) * 100}%` }}
              />
            </div>
            <span className={`w-20 shrink-0 text-right text-xs tabular-nums ${textClass}`}>
              {inr(r.amount)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

const CONCENTRATION_DIMENSIONS = {
  setup: { label: 'Setup', keyFn: (t) => t.setup },
  symbol: { label: 'Symbol', keyFn: (t) => t.symbol },
  session: { label: 'Session', keyFn: sessionFor },
  day: { label: 'Day of week', keyFn: dayOfWeek },
  emotion: { label: 'Emotion', keyFn: (t) => t.emotion },
}

function ConcentrationCard({ title, trades, tone }) {
  const [dimension, setDimension] = useState('setup')
  const rows = useMemo(
    () => computeConcentration(trades, CONCENTRATION_DIMENSIONS[dimension].keyFn).slice(0, 8),
    [trades, dimension],
  )
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        <Select value={dimension} onValueChange={setDimension}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CONCENTRATION_DIMENSIONS).map(([key, d]) => (
              <SelectItem key={key} value={key}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ConcentrationList rows={rows} tone={tone} />
    </div>
  )
}

function TagLossCard({ losingTrades }) {
  const rows = useMemo(() => computeTagLossFrequency(losingTrades), [losingTrades])
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-3 text-sm font-medium">Most common tags in losing trades</p>
      <ConcentrationList rows={rows} tone="down" />
    </div>
  )
}

// --- R-multiple spread by setup: min/median/max, not just an average - a setup that's "good on
// average" but wildly inconsistent looks very different from one that's reliably okay. ----------
function computeRSpreadBySetup(riskTrades) {
  const groups = new Map()
  riskTrades.forEach((t) => {
    const r = expectedR(t)
    if (r == null) return
    const key = t.setup || 'Untagged'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  })
  return [...groups.entries()]
    .map(([label, rs]) => {
      const sorted = [...rs].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      const median =
        sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100
      return { label, count: rs.length, min: sorted[0], median, max: sorted.at(-1) }
    })
    .sort((a, b) => b.median - a.median)
}

function RSpreadCard({ rows }) {
  const clamp = (r) => Math.max(-3, Math.min(3, r))
  const pos = (r) => ((clamp(r) + 3) / 6) * 100
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-3 text-sm font-medium">R-multiple spread by setup</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Set an "Ideal risk ₹" to see this.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.label} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{r.label}</span>
                <span className="text-xs text-muted-foreground">
                  {r.count} trade{r.count === 1 ? '' : 's'} · median {r.median}R
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-muted">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                <div
                  className="absolute inset-y-0 rounded-full bg-primary/30"
                  style={{ left: `${pos(r.min)}%`, width: `${Math.max(pos(r.max) - pos(r.min), 1)}%` }}
                />
                <div
                  className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
                  style={{ left: `${pos(r.median)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Monthly P&L grid: a year x month tearsheet-style table, complementing the daily calendar --
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function MonthlyReturnsGrid({ monthlyByMonth }) {
  const years = [...new Set([...monthlyByMonth.keys()].map((m) => m.slice(0, 4)))].sort()
  if (years.length === 0) return <p className="text-sm text-muted-foreground">No closed trades yet.</p>
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-[3rem_repeat(12,1fr)_4.5rem] gap-1 text-xs">
        <div />
        {MONTH_LABELS.map((m) => (
          <div key={m} className="text-center text-muted-foreground">
            {m}
          </div>
        ))}
        <div className="text-center text-muted-foreground">Total</div>
        {years.map((year) => {
          let yearTotal = 0
          const cells = MONTH_LABELS.map((_, i) => {
            const key = `${year}-${String(i + 1).padStart(2, '0')}`
            const pnl = monthlyByMonth.get(key)
            if (pnl != null) yearTotal += pnl
            return (
              <div
                key={key}
                className={`rounded p-1.5 text-center tabular-nums ${
                  pnl == null
                    ? 'bg-muted/30 text-muted-foreground'
                    : pnl >= 0
                      ? 'bg-success/10 text-up'
                      : 'bg-destructive/10 text-down'
                }`}
              >
                {pnl == null ? '—' : inr(pnl)}
              </div>
            )
          })
          return (
            <Fragment key={year}>
              <div className="flex items-center font-medium">{year}</div>
              {cells}
              <div
                className={`flex items-center justify-center font-medium tabular-nums ${
                  yearTotal >= 0 ? 'text-up' : 'text-down'
                }`}
              >
                {inr(yearTotal)}
              </div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

// --- Risk & expectancy modelling -------------------------------------------------------------
// These six views are forward-looking (what your numbers *imply*), not more reductions of trades
// already taken - the math lives in lib/tradeMath.js. They're drawn as inline SVG rather than
// through MiniChart/lightweight-charts on purpose: every axis here is a trade count or an R
// multiple, and lightweight-charts' x-axis is a date scale, so feeding it trade indices means
// fighting it for no gain.

const PLOT = { w: 420, h: 200, padL: 34, padR: 8, padT: 10, padB: 22 }

// One small multi-series line plot. `bands` shade an x-range (the losing streak, the sweet spot),
// `markers` drop a labeled dot (where the user's own numbers actually sit).
function Plot({ series, bands = [], markers = [], xTicks, yTicks, formatY = (v) => v, footer }) {
  const all = series.flatMap((s) => s.points)
  if (all.length === 0) return <p className="text-sm text-muted-foreground">Not enough data yet.</p>

  const xs = all.map((p) => p.x)
  const ys = all.map((p) => p.value)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys, ...(yTicks ?? []))
  const y1 = Math.max(...ys, ...(yTicks ?? []))
  const sx = (x) => PLOT.padL + ((x - x0) / (x1 - x0 || 1)) * (PLOT.w - PLOT.padL - PLOT.padR)
  const sy = (y) => PLOT.h - PLOT.padB - ((y - y0) / (y1 - y0 || 1)) * (PLOT.h - PLOT.padT - PLOT.padB)

  return (
    <div>
      <svg viewBox={`0 0 ${PLOT.w} ${PLOT.h}`} className="h-52 w-full" role="img">
        {bands.map((b) => (
          <rect
            key={`${b.from}-${b.to}`}
            x={sx(b.from)}
            y={PLOT.padT}
            width={Math.max(sx(b.to) - sx(b.from), 1)}
            height={PLOT.h - PLOT.padT - PLOT.padB}
            fill={b.color}
          />
        ))}
        {(yTicks ?? []).map((t) => (
          <g key={t}>
            <line
              x1={PLOT.padL}
              x2={PLOT.w - PLOT.padR}
              y1={sy(t)}
              y2={sy(t)}
              stroke={COLORS.grid}
              strokeDasharray={t === 0 || t === 100 ? '3 3' : undefined}
            />
            <text x={4} y={sy(t) + 3} fontSize="8" fill={COLORS.text}>
              {formatY(t)}
            </text>
          </g>
        ))}
        {(xTicks ?? []).map((t) => (
          <text key={t} x={sx(t)} y={PLOT.h - 6} fontSize="8" fill={COLORS.text} textAnchor="middle">
            {t}
          </text>
        ))}
        {series.map((s) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth="1.75"
            strokeDasharray={s.dashed ? '5 3' : undefined}
            points={s.points.map((p) => `${sx(p.x)},${sy(p.value)}`).join(' ')}
          />
        ))}
        {markers.map((m) => (
          <g key={m.label}>
            <circle cx={sx(m.x)} cy={sy(m.value)} r="3.5" fill={m.color} />
            <text
              x={sx(m.x)}
              y={sy(m.value) - 6}
              fontSize="8"
              fill={m.color}
              textAnchor="middle"
              fontWeight="600"
            >
              {m.label}
            </text>
          </g>
        ))}
      </svg>
      {footer}
    </div>
  )
}

function Legend({ items }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

function ModelCard({ title, hint, children }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-0.5 mb-2 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  )
}

// `1` Expectancy heatmap - win rate x payoff, shaded by expectancy in R, with the user's own
// cell ringed. CSS grid, same approach as MonthlyReturnsGrid, no charting library involved.
function ExpectancyGridCard({ winRate, payoff }) {
  const rows = useMemo(() => expectancyGrid(), [])
  const maxAbs = 4
  const userCol = GRID_WIN_RATES.reduce(
    (best, w, i) => (Math.abs(w - winRate) < Math.abs(GRID_WIN_RATES[best] - winRate) ? i : best),
    0,
  )
  return (
    <ModelCard
      title="Expectancy by win rate × payoff"
      hint="Expectancy in R per trade. Anything at or below 0 loses money no matter how it feels — your own numbers are ringed."
    >
      <div className="overflow-x-auto">
        <div className="min-w-[380px]">
          <div className="grid grid-cols-[2.5rem_repeat(8,1fr)] gap-0.5 text-[10px]">
            <div />
            {GRID_WIN_RATES.map((w) => (
              <div key={w} className="text-center text-muted-foreground">
                {Math.round(w * 100)}%
              </div>
            ))}
            {[...rows].reverse().map((row) => {
              const isUserRow =
                Math.abs(row.payoff - payoff) === Math.min(...rows.map((r) => Math.abs(r.payoff - payoff)))
              return (
                <Fragment key={row.payoff}>
                  <div className="flex items-center justify-end pr-1 text-muted-foreground">
                    {row.payoff}R
                  </div>
                  {row.cells.map((c, i) => (
                    <div
                      key={c.winRate}
                      title={`${Math.round(c.winRate * 100)}% win rate at ${row.payoff}R → ${c.value}R per trade`}
                      className={`rounded py-1.5 text-center tabular-nums ${
                        isUserRow && i === userCol ? 'ring-2 ring-primary ring-offset-1 ring-offset-card' : ''
                      }`}
                      style={{
                        background:
                          c.value >= 0
                            ? `color-mix(in srgb, var(--color-up) ${Math.min((c.value / maxAbs) * 100, 90)}%, transparent)`
                            : `color-mix(in srgb, var(--color-down) ${Math.min((Math.abs(c.value) / 1) * 60, 90)}%, transparent)`,
                      }}
                    >
                      {c.value > 0 ? '+' : ''}
                      {c.value}
                    </div>
                  ))}
                </Fragment>
              )
            })}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        At {Math.round(payoff * 100) / 100}R you need to win more than{' '}
        <span className="font-medium text-foreground">
          {Math.round(breakevenWinRate(payoff) * 1000) / 10}%
        </span>{' '}
        just to break even.
      </p>
    </ModelCard>
  )
}

// `2` Worst case, run forward: your own longest losing streak happening again from here.
function StreakSurvivalCard({ winRate, payoff, riskPct, streakLen }) {
  const sim = useMemo(
    () => streakSurvival({ winRate, payoff, riskPct, streakLen, trades: 75 }),
    [winRate, payoff, riskPct, streakLen],
  )
  return (
    <ModelCard
      title="Surviving your longest losing streak"
      hint={`${streakLen} losses back to back at ${riskPct}% risk, then trading on at your own expectancy.`}
    >
      <Plot
        series={[{ label: 'Account', points: sim.points, color: COLORS.text }]}
        bands={[
          { from: 0, to: streakLen, color: 'rgba(239, 68, 68, 0.12)' },
          { from: streakLen, to: 75, color: 'rgba(34, 197, 94, 0.10)' },
        ]}
        xTicks={[0, 15, 30, 45, 60, 75]}
        yTicks={[Math.floor(sim.trough / 10) * 10, 100, Math.ceil(sim.points.at(-1).value / 10) * 10]}
        formatY={(v) => `${v}%`}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Bottoms out at <span className="font-medium text-down">{Math.round(sim.trough * 10) / 10}%</span> of
        the account.{' '}
        {sim.recoveredAt
          ? `Back to breakeven ${sim.recoveredAt - streakLen} trades after the streak ends.`
          : 'At this expectancy it never gets back to breakeven — the edge, not the streak, is the problem.'}
      </p>
    </ModelCard>
  )
}

// `3` One trade sequence, three position sizes.
const RISK_LEVELS = [0.5, 1, 2]
const RISK_COLORS = ['#22c55e', '#3b82f6', '#ef4444']

function RiskPathsCard({ winRate, payoff }) {
  const paths = useMemo(
    () => riskPaths({ winRate, payoff, riskPcts: RISK_LEVELS, trades: 100 }),
    [winRate, payoff],
  )
  return (
    <ModelCard
      title="Same trades, different position size"
      hint="One simulated sequence at your win rate and payoff, sized three ways — only the risk per trade differs."
    >
      <Plot
        series={paths.map((p, i) => ({
          label: `${p.riskPct}%`,
          points: p.points,
          color: RISK_COLORS[i],
          dashed: i === 1,
        }))}
        xTicks={[0, 20, 40, 60, 80, 100]}
        yTicks={[0, 100, 200, 300]}
        formatY={(v) => `${v}%`}
      />
      <Legend items={RISK_LEVELS.map((r, i) => ({ label: `${r}% risk`, color: RISK_COLORS[i] }))} />
    </ModelCard>
  )
}

// `4` Bigger targets get hit less often - an empirical rule of thumb, with the user's point on it.
function AchievableWinRateCard({ winRate, payoff }) {
  const points = ACHIEVABLE_WIN_RATE.map((p) => ({ x: p.payoff, value: p.winRate }))
  const breakeven = ACHIEVABLE_WIN_RATE.map((p) => ({
    x: p.payoff,
    value: Math.round(breakevenWinRate(p.payoff) * 1000) / 10,
  }))
  return (
    <ModelCard
      title="Achievable win rate vs target size"
      hint="Rule of thumb, not a computed fit: the further the target, the less often it's reached. Below the dashed line the payoff can't pay for the losers."
    >
      <Plot
        series={[
          { label: 'Typically achievable', points, color: COLORS.text },
          { label: 'Breakeven', points: breakeven, color: COLORS.down, dashed: true },
        ]}
        bands={[{ from: SWEET_SPOT.from, to: SWEET_SPOT.to, color: 'rgba(34, 197, 94, 0.12)' }]}
        markers={[
          {
            label: `you: ${Math.round(payoff * 10) / 10}R, ${Math.round(winRate * 1000) / 10}%`,
            x: Math.min(Math.max(payoff, 1), 10),
            value: Math.round(winRate * 1000) / 10,
            color: '#3b82f6',
          },
        ]}
        xTicks={[1, 2, 3, 4, 5, 6, 8, 10]}
        yTicks={[0, 20, 40, 60, 80]}
        formatY={(v) => `${v}%`}
      />
      <Legend
        items={[
          { label: 'Typically achievable', color: COLORS.text },
          { label: 'Breakeven win rate', color: COLORS.down },
          { label: 'Sweet spot (3R–6R)', color: 'rgba(34, 197, 94, 0.5)' },
        ]}
      />
    </ModelCard>
  )
}

// `5` The same percentage, won or lost repeatedly, does not cancel out.
function CompoundingCard({ gainPct, lossPct }) {
  const { gains, losses } = useMemo(
    () => compoundingDivergence({ gainPct, lossPct, trades: 100 }),
    [gainPct, lossPct],
  )
  return (
    <ModelCard
      title="Why drawdowns cost more than they look"
      hint={`Your average win (${Math.round(gainPct * 100) / 100}%) and average loss (${Math.round(lossPct * 100) / 100}%) of the account, compounded 100 times each.`}
    >
      <Plot
        series={[
          { label: 'Winning', points: gains, color: COLORS.up },
          { label: 'Losing', points: losses, color: COLORS.down },
        ]}
        xTicks={[0, 20, 40, 60, 80, 100]}
        yTicks={[-60, -30, 0, 30, 60]}
        formatY={(v) => `${v}%`}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Losses compound toward −100% but never past it; gains have no ceiling. That asymmetry is why
        protecting the downside beats chasing the upside.
      </p>
    </ModelCard>
  )
}

// `6` Risk of a 50% drawdown by position size - Monte Carlo, see tradeMath.js for why not a formula.
const DD_RISK_LEVELS = [0.5, 1, 2, 5]

function DrawdownRiskCard({ winRate, payoff }) {
  const rows = useMemo(
    () => drawdownProbabilities({ winRate, payoff, riskPcts: DD_RISK_LEVELS }),
    [winRate, payoff],
  )
  return (
    <ModelCard
      title="Chance of a 50% drawdown"
      hint="2,000 simulated runs of 500 trades each, at your win rate and payoff. A 50% drawdown needs a 100% gain to undo."
    >
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.riskPct} className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs font-medium tabular-nums">{r.riskPct}%</span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
              <div
                className={`h-full ${r.probability >= 50 ? 'bg-down' : r.probability >= 15 ? 'bg-amber-500' : 'bg-up'}`}
                style={{ width: `${Math.max(r.probability, 1)}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {r.probability}%
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Risk per trade → probability of ruin-level drawdown.
      </p>
    </ModelCard>
  )
}

function BalanceAdjusterDialog({ open, onOpenChange, adjustments, accountId }) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [type, setType] = useState('add')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState('')

  useEffect(() => {
    if (open) setDate(new Date().toISOString().slice(0, 10))
  }, [open])

  const create = useMutation({
    mutationFn: () =>
      createBalanceAdjustment({
        amount: Number(amount),
        type,
        reason: reason.trim() || null,
        adjusted_at: date ? new Date(date).toISOString() : null,
        account_id: accountId ?? null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['balanceAdjustments'] })
      toast.success('Balance adjustment added')
      setAmount('')
      setReason('')
    },
    onError: (e) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: deleteBalanceAdjustment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['balanceAdjustments'] }),
    onError: (e) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Balance adjustments</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="Amount ₹"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={type === 'add' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setType('add')}
            >
              Deposit / correction (+)
            </Button>
            <Button
              size="sm"
              variant={type === 'subtract' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setType('subtract')}
            >
              Withdrawal / fee (−)
            </Button>
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
          <Button
            className="w-full"
            disabled={!amount || Number(amount) <= 0 || create.isPending}
            onClick={() => create.mutate()}
          >
            Add adjustment
          </Button>

          {adjustments.length > 0 && (
            <div className="max-h-48 space-y-1.5 overflow-y-auto border-t pt-3">
              {adjustments.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <span>
                    <span className={a.type === 'add' ? 'text-up' : 'text-down'}>
                      {a.type === 'add' ? '+' : '−'}
                      {inr(a.amount)}
                    </span>{' '}
                    <span className="text-muted-foreground">
                      {a.reason || '—'} · {formatDate(a.adjusted_at)}
                    </span>
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete adjustment"
                    onClick={() => remove.mutate(a.id)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function ManualOverview({ trades, accountId }) {
  const [adjusterOpen, setAdjusterOpen] = useState(false)
  const { data: backtestSettings } = useQuery({
    queryKey: ['manualBacktestSettings'],
    queryFn: getManualBacktestSettings,
  })
  const { data: allAdjustments = [] } = useQuery({
    queryKey: ['balanceAdjustments'],
    queryFn: getBalanceAdjustments,
  })
  const { data: accounts = [] } = useQuery({ queryKey: ['tradeAccounts'], queryFn: getTradeAccounts })
  const tolerancePct = backtestSettings?.risk_deviation_tolerance_pct ?? 10

  // With an account selected the balance curve starts from that account's own wallet and only
  // counts its deposits/withdrawals; across all accounts it falls back to the global opening
  // balance in Settings > Backtesting, which is what this curve meant before accounts existed.
  const account = accounts.find((a) => a.id === accountId) ?? null
  const adjustments = useMemo(
    () => (accountId == null ? allAdjustments : allAdjustments.filter((a) => a.account_id === accountId)),
    [allAdjustments, accountId],
  )
  const openingBalance = account ? account.opening_balance : (backtestSettings?.opening_balance ?? 0)

  const closed = useMemo(() => trades.filter((t) => t.exit_price != null), [trades])

  const pnls = useMemo(() => closed.map(tradePnl), [closed])
  const totalPnl = Math.round(pnls.reduce((s, p) => s + p, 0) * 100) / 100
  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const winRate = closed.length ? Math.round((wins.length / closed.length) * 1000) / 10 : 0
  const grossProfit = wins.reduce((s, p) => s + p, 0)
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0))
  const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 1000) / 1000 : null
  const avgPnl = closed.length ? Math.round((totalPnl / closed.length) * 100) / 100 : 0
  const avgLoss = losses.length ? Math.round((grossLoss / losses.length) * 100) / 100 : 0

  // --- Loss analysis: streaks, stop discipline, revenge-trade heuristic ----------------------
  const losingTrades = useMemo(() => closed.filter((t) => tradePnl(t) < 0), [closed])
  // `closed` comes from `trades` (API returns newest-first) - reverse gives chronological order,
  // which lossStreaks/isLikelyRevenge both need.
  const closedAsc = useMemo(() => [...closed].reverse(), [closed])
  const streaks = useMemo(() => lossStreaks(closedAsc), [closedAsc])

  const lossesWithStop = useMemo(
    () => losingTrades.filter((t) => lossExceededStop(t) != null),
    [losingTrades],
  )
  const stopBreachCount = lossesWithStop.filter((t) => lossExceededStop(t)).length

  const revengeTrades = useMemo(
    () => closedAsc.filter((t, i) => isLikelyRevenge(t, closedAsc[i - 1], tolerancePct)),
    [closedAsc, tolerancePct],
  )
  const revengeLoss = Math.abs(revengeTrades.reduce((s, t) => s + Math.min(tradePnl(t), 0), 0))
  const revengeLossPct = grossLoss > 0 ? Math.round((revengeLoss / grossLoss) * 1000) / 10 : 0

  // Keyed by traded_at's date (the journal has one date per trade, not separate entry/exit
  // timestamps) - every daily aggregation below buckets off that same day.
  const dailyByDay = useMemo(() => {
    const byDay = new Map()
    closed.forEach((t, i) => {
      const day = t.traded_at.slice(0, 10)
      const pnl = pnls[i]
      const entry = byDay.get(day) ?? { pnl: 0, wins: 0, losses: 0 }
      entry.pnl += pnl
      if (pnl > 0) entry.wins += 1
      else if (pnl < 0) entry.losses += 1
      byDay.set(day, entry)
    })
    return byDay
  }, [closed, pnls])

  const sortedDays = useMemo(
    () => [...dailyByDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    [dailyByDay],
  )

  // ponytail: lightweight-charts' HistogramSeries only plots one value per day, so wins/losses
  // render as a single net (wins - losses) bar rather than true side-by-side grouped bars like
  // the reference screenshot. Swap to a grouped-bar-capable chart if the distinction matters.
  const winLossData = sortedDays.map(([day, e]) => ({ time: day, value: e.wins - e.losses }))
  const dailyPnlData = sortedDays.map(([day, e]) => ({ time: day, value: Math.round(e.pnl * 100) / 100 }))
  let cumulative = 0
  const totalPnlData = sortedDays.map(([day, e]) => {
    cumulative += e.pnl
    return { time: day, value: Math.round(cumulative * 100) / 100 }
  })

  // --- Risk discipline: planned (ideal_risk_amount) vs actual risk - see lib/manualTrades.js ---
  const riskTrades = useMemo(() => closed.filter((t) => t.ideal_risk_amount != null), [closed])
  const riskCounts = useMemo(() => {
    const counts = { good: 0, over: 0, under: 0 }
    riskTrades.forEach((t) => {
      const status = riskStatus(t, tolerancePct)
      if (status) counts[status] += 1
    })
    return counts
  }, [riskTrades, tolerancePct])
  const avgExpectedR = riskTrades.length
    ? Math.round((riskTrades.reduce((s, t) => s + (expectedR(t) ?? 0), 0) / riskTrades.length) * 100) / 100
    : null

  // Payoff asymmetry: are losers bigger (in R) than winners on average - "cutting winners short,
  // letting losers run" shows up here as |avgLosingR| > avgWinningR.
  const riskRs = riskTrades.map(expectedR).filter((r) => r != null)
  const winningRs = riskRs.filter((r) => r > 0)
  const losingRs = riskRs.filter((r) => r < 0)
  const avgWinningR = winningRs.length
    ? Math.round((winningRs.reduce((s, r) => s + r, 0) / winningRs.length) * 100) / 100
    : null
  const avgLosingR = losingRs.length
    ? Math.round((losingRs.reduce((s, r) => s + r, 0) / losingRs.length) * 100) / 100
    : null

  // --- Profit & edge: is the edge real, or a couple of outliers carrying the average ----------
  const winningTrades = useMemo(() => closed.filter((t) => tradePnl(t) > 0), [closed])
  const winStreak = useMemo(() => winStreaks(closedAsc), [closedAsc])

  const sqn = systemQualityNumber(riskRs)
  const sqnLabel = sqnRating(sqn)
  const sortino = sortinoRatio(riskRs)

  // Underwater curve from the running peak of cumulative closed-trade P&L (independent of manual
  // balance adjustments, unlike balanceEquityData below) - see manualTrades.js's underwaterSeries.
  const underwater = useMemo(() => {
    let cumulative = 0
    const values = sortedDays.map(([, e]) => {
      cumulative += e.pnl
      return Math.round(cumulative * 100) / 100
    })
    return underwaterSeries(values)
  }, [sortedDays])
  const underwaterChartData = useMemo(
    () => sortedDays.map(([day], i) => ({ time: day, value: underwater.series[i] })),
    [sortedDays, underwater],
  )
  const recovery = recoveryFactor(totalPnl, underwater.maxDrawdown)

  const top3Profit = [...winningTrades]
    .sort((a, b) => tradePnl(b) - tradePnl(a))
    .slice(0, 3)
    .reduce((s, t) => s + tradePnl(t), 0)
  const top3ProfitPct = grossProfit > 0 ? Math.round((top3Profit / grossProfit) * 1000) / 10 : 0

  const bestDayPnl = sortedDays.length ? Math.max(...sortedDays.map(([, e]) => e.pnl)) : 0
  const bestDayProfitPct = totalPnl > 0 ? Math.round((bestDayPnl / totalPnl) * 1000) / 10 : 0
  const profitableDaysPct = sortedDays.length
    ? Math.round((sortedDays.filter(([, e]) => e.pnl > 0).length / sortedDays.length) * 100)
    : null

  const bestTrade = closed.length
    ? closed.reduce((best, t) => (tradePnl(t) > tradePnl(best) ? t : best))
    : null
  const worstTrade = closed.length
    ? closed.reduce((worst, t) => (tradePnl(t) < tradePnl(worst) ? t : worst))
    : null

  const rSpreadRows = useMemo(() => computeRSpreadBySetup(riskTrades), [riskTrades])

  const monthlyByMonth = useMemo(() => {
    const byMonth = new Map()
    closed.forEach((t, i) => {
      const month = t.traded_at.slice(0, 7)
      byMonth.set(month, (byMonth.get(month) ?? 0) + pnls[i])
    })
    return byMonth
  }, [closed, pnls])

  // --- R-multiple distribution histogram ----------------------------------------------------
  const rDistRows = useMemo(() => {
    const counts = {}
    riskTrades.forEach((t) => {
      const bucket = expectedRBucket(t)
      if (bucket) counts[bucket] = (counts[bucket] ?? 0) + 1
    })
    return R_BUCKET_ORDER.filter((b) => counts[b]).map((bucket) => ({ bucket, count: counts[bucket] }))
  }, [riskTrades])

  // --- Setup / day-of-week / session breakdowns ---------------------------------------------
  const setupRows = useMemo(
    () => computeBreakdownRows(closed, (t) => t.setup).sort((a, b) => b.metricValue - a.metricValue),
    [closed],
  )
  const dayRows = useMemo(() => sortByOrder(computeBreakdownRows(closed, dayOfWeek), DAY_ORDER), [closed])
  const sessionRows = useMemo(
    () => sortByOrder(computeBreakdownRows(closed, sessionFor), SESSION_ORDER),
    [closed],
  )

  // --- Equity curves: cumulative Expected-R (risk-tracked trades only) and account balance ---
  const expectedREquityData = useMemo(() => {
    const byDay = new Map()
    riskTrades.forEach((t) => {
      const day = t.traded_at.slice(0, 10)
      byDay.set(day, (byDay.get(day) ?? 0) + (expectedR(t) ?? 0))
    })
    let running = 0
    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, r]) => {
        running += r
        return { time: day, value: Math.round(running * 100) / 100 }
      })
  }, [riskTrades])

  // --- Inputs for the forward-looking models (lib/tradeMath.js) -------------------------------
  // Everything below is derived from what the user actually did, with clamps so one degenerate
  // trade can't produce a nonsense curve. Payoff prefers R multiples (which account for the
  // planned risk) and falls back to the plain ₹ ratio when no trade carries an "Ideal risk ₹".
  const model = useMemo(() => {
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
    const avgWin = wins.length ? grossProfit / wins.length : 0
    const avgLossAbs = losses.length ? grossLoss / losses.length : 0

    const payoffFromR = avgWinningR != null && avgLosingR ? avgWinningR / Math.abs(avgLosingR) : null
    const payoffFromCash = avgLossAbs > 0 ? avgWin / avgLossAbs : null
    const payoff = clamp(payoffFromR ?? payoffFromCash ?? 2, 0.2, 10)

    // Risk per trade as a % of the account: the planned risk if it's being logged, otherwise what
    // an average loss actually costs.
    const plannedRisk = riskTrades.length
      ? riskTrades.reduce((s, t) => s + t.ideal_risk_amount, 0) / riskTrades.length
      : null
    const base = openingBalance > 0 ? openingBalance : null
    const riskPct = base ? clamp(((plannedRisk ?? avgLossAbs) / base) * 100, 0.1, 10) : 1

    return {
      winRate: clamp(winRate / 100, 0.01, 0.99),
      payoff: Math.round(payoff * 100) / 100,
      riskPct: Math.round(riskPct * 100) / 100,
      // A trader with no losing streak yet still needs to see what one would do - 5 is a floor,
      // not a claim about their history.
      streakLen: Math.max(streaks.longest, 5),
      gainPct: base ? clamp((avgWin / base) * 100, 0.01, 20) : 1,
      lossPct: base ? clamp((avgLossAbs / base) * 100, 0.01, 20) : 1,
    }
  }, [
    winRate,
    wins.length,
    losses.length,
    grossProfit,
    grossLoss,
    avgWinningR,
    avgLosingR,
    riskTrades,
    openingBalance,
    streaks.longest,
  ])

  const balanceEquityData = useMemo(() => {
    const byDay = new Map(sortedDays.map(([day, e]) => [day, e.pnl]))
    adjustments.forEach((a) => {
      const day = a.adjusted_at.slice(0, 10)
      const delta = a.type === 'add' ? a.amount : -a.amount
      byDay.set(day, (byDay.get(day) ?? 0) + delta)
    })
    let balance = openingBalance
    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, delta]) => {
        balance += delta
        return { time: day, value: Math.round(balance * 100) / 100 }
      })
  }, [sortedDays, adjustments, openingBalance])

  return (
    <div className="space-y-4">
      {/* Renders nothing until goals exist, so this stays out of the way for anyone not using
          them (see the Goals tab). */}
      <GoalsSummary trades={trades} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total PnL (closed)"
          value={inr(totalPnl)}
          valueClassName={totalPnl >= 0 ? 'text-up' : 'text-down'}
        />
        <StatCard label="Win rate" value={`${winRate}%`} />
        <StatCard label="Profit factor" value={profitFactor == null ? '—' : fmt(profitFactor, 3)} />
        <StatCard
          label="Avg PnL / trade"
          value={inr(avgPnl)}
          valueClassName={avgPnl >= 0 ? 'text-up' : 'text-down'}
        />
      </div>

      {riskTrades.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Trades w/ planned risk" value={riskTrades.length} />
          <StatCard
            label="Avg Expected R"
            value={`${avgExpectedR}R`}
            valueClassName={avgExpectedR >= 0 ? 'text-up' : 'text-down'}
          />
          <StatCard
            label="Good risk sizing"
            value={`${Math.round((riskCounts.good / riskTrades.length) * 100)}%`}
          />
          <StatCard label="Over / under-risked" value={`${riskCounts.over} / ${riskCounts.under}`} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Set an "Ideal risk ₹" when logging a trade to unlock risk-discipline metrics (Expected R, good vs.
          over/under-risked sizing).
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-2 text-sm font-medium">Daily Wins/Losses</p>
          <MiniChart data={winLossData} kind="histogram" />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-2 text-sm font-medium">Total PnL</p>
          <MiniChart data={totalPnlData} kind="area" />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-2 text-sm font-medium">Daily PnL</p>
          <MiniChart data={dailyPnlData} kind="histogram" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-2 text-sm font-medium">Expected-R Equity Curve</p>
          <MiniChart data={expectedREquityData} kind="area" />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Account Balance</p>
            <Button size="sm" variant="outline" onClick={() => setAdjusterOpen(true)}>
              <WalletIcon className="size-3.5" />
              Adjust
            </Button>
          </div>
          <MiniChart data={balanceEquityData} kind="area" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RDistributionCard rows={rDistRows} />
        <BreakdownCard title="Avg P&L by setup" rows={setupRows} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownCard title="Avg P&L by day of week" rows={dayRows} />
        <BreakdownCard title="Avg P&L by session" rows={sessionRows} />
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div>
          <h3 className="text-sm font-semibold">Profit & edge</h3>
          <p className="text-xs text-muted-foreground">
            Is the edge real, or a couple of outlier trades carrying the average? Risk-adjusted and
            concentration metrics, not just win rate.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="SQN" value={sqn == null ? '—' : fmt(sqn, 2)} sub={sqnLabel ?? undefined} />
          <StatCard label="Sortino (R-based)" value={sortino == null ? '—' : fmt(sortino, 2)} />
          <StatCard label="Recovery factor" value={recovery == null ? '—' : fmt(recovery, 2)} />
          <StatCard label="Max drawdown" value={inr(underwater.maxDrawdown)} valueClassName="text-down" />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Longest winning streak" value={winStreak.longest} />
          <StatCard label="Top-3 trades % of profit" value={grossProfit > 0 ? `${top3ProfitPct}%` : '—'} />
          <StatCard label="Best day % of total profit" value={totalPnl > 0 ? `${bestDayProfitPct}%` : '—'} />
          <StatCard
            label="Profitable days"
            value={profitableDaysPct == null ? '—' : `${profitableDaysPct}%`}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Best trade"
            value={bestTrade ? inr(tradePnl(bestTrade)) : '—'}
            valueClassName="text-up"
            sub={bestTrade ? `${bestTrade.symbol} · ${formatDate(bestTrade.traded_at)}` : undefined}
          />
          <StatCard
            label="Worst trade"
            value={worstTrade ? inr(tradePnl(worstTrade)) : '—'}
            valueClassName="text-down"
            sub={worstTrade ? `${worstTrade.symbol} · ${formatDate(worstTrade.traded_at)}` : undefined}
          />
        </div>

        <div className="rounded-xl border bg-card p-4">
          <p className="mb-2 text-sm font-medium">Underwater (drawdown from peak)</p>
          <MiniChart data={underwaterChartData} kind="histogram" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ConcentrationCard title="Profit concentration" trades={winningTrades} tone="up" />
          <RSpreadCard rows={rSpreadRows} />
        </div>

        <div className="rounded-xl border bg-card p-4">
          <p className="mb-3 text-sm font-medium">Monthly P&L</p>
          <MonthlyReturnsGrid monthlyByMonth={monthlyByMonth} />
        </div>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div>
          <h3 className="text-sm font-semibold">Loss analysis</h3>
          <p className="text-xs text-muted-foreground">
            Where losses actually concentrate - fixing what's here does more for the bottom line than chasing
            more winners.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Losing trades" value={losingTrades.length} />
          <StatCard label="Avg loss" value={inr(avgLoss)} valueClassName="text-down" />
          <StatCard label="Longest losing streak" value={streaks.longest} />
          <StatCard
            label="Current streak"
            value={streaks.current}
            valueClassName={streaks.current > 0 ? 'text-down' : ''}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Stop not honored"
            value={lossesWithStop.length ? `${stopBreachCount}/${lossesWithStop.length}` : '—'}
          />
          <StatCard label="Likely revenge trades" value={revengeTrades.length} />
          <StatCard
            label="Loss from revenge trades"
            value={grossLoss > 0 ? `${revengeLossPct}%` : '—'}
            valueClassName="text-down"
          />
          <StatCard
            label="Avg losing R / winning R"
            value={avgLosingR != null && avgWinningR != null ? `${avgLosingR}R / ${avgWinningR}R` : '—'}
            valueClassName={
              avgLosingR != null && avgWinningR != null && Math.abs(avgLosingR) > avgWinningR
                ? 'text-down'
                : ''
            }
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ConcentrationCard title="Loss concentration" trades={losingTrades} tone="down" />
          <TagLossCard losingTrades={losingTrades} />
        </div>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div>
          <h3 className="text-sm font-semibold">Risk &amp; expectancy</h3>
          <p className="text-xs text-muted-foreground">
            The only forward-looking section here — everything above measures trades you already took, these
            ask what your numbers imply about the ones you haven't. Driven by your actual win rate ({winRate}
            %), payoff ({model.payoff}R) and risk per trade ({model.riskPct}%).
          </p>
        </div>

        {closed.length < 5 ? (
          <p className="text-sm text-muted-foreground">
            Needs at least 5 closed trades — below that the win rate and payoff are too noisy to model
            anything useful from.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Expectancy / trade"
                value={`${Math.round(expectancyR(model.winRate, model.payoff) * 100) / 100}R`}
                valueClassName={expectancyR(model.winRate, model.payoff) >= 0 ? 'text-up' : 'text-down'}
              />
              <StatCard
                label="Breakeven win rate"
                value={`${Math.round(breakevenWinRate(model.payoff) * 1000) / 10}%`}
                sub={`you: ${winRate}%`}
              />
              <StatCard label="Payoff ratio" value={`${model.payoff}R`} />
              <StatCard label="Risk / trade" value={`${model.riskPct}%`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <ExpectancyGridCard winRate={model.winRate} payoff={model.payoff} />
              <StreakSurvivalCard
                winRate={model.winRate}
                payoff={model.payoff}
                riskPct={model.riskPct}
                streakLen={model.streakLen}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <RiskPathsCard winRate={model.winRate} payoff={model.payoff} />
              <AchievableWinRateCard winRate={model.winRate} payoff={model.payoff} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <CompoundingCard gainPct={model.gainPct} lossPct={model.lossPct} />
              <DrawdownRiskCard winRate={model.winRate} payoff={model.payoff} />
            </div>
          </>
        )}
      </div>

      <CalendarHeatmap dailyByDay={dailyByDay} latestDay={sortedDays.at(-1)?.[0] ?? null} />

      <BalanceAdjusterDialog
        open={adjusterOpen}
        onOpenChange={setAdjusterOpen}
        adjustments={adjustments}
        accountId={accountId}
      />
    </div>
  )
}

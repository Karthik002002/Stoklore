import { useEffect, useMemo, useRef, useState } from 'react'
import { AreaSeries, HistogramSeries, createChart } from 'lightweight-charts'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmt, inr } from '@/lib/format'
import { tradePnl } from '@/lib/manualTrades'

const COLORS = { up: '#22c55e', down: '#ef4444', text: '#9ca3af', grid: 'rgba(148, 163, 184, 0.15)' }
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function StatCard({ label, value, valueClassName }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className={`text-xl font-semibold tabular-nums ${valueClassName ?? ''}`}>{value}</p>
      <p className="mt-1 text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
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

export default function ManualOverview({ trades }) {
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

  return (
    <div className="space-y-4">
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

      <CalendarHeatmap dailyByDay={dailyByDay} latestDay={sortedDays.at(-1)?.[0] ?? null} />
    </div>
  )
}

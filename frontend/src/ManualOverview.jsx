import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AreaSeries, HistogramSeries, createChart } from 'lightweight-charts'
import { ChevronLeftIcon, ChevronRightIcon, Trash2Icon, WalletIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { fmt, formatDate, inr } from '@/lib/format'
import {
  dayOfWeek,
  expectedR,
  expectedRBucket,
  NSE_SESSIONS,
  riskStatus,
  sessionFor,
  tradePnl,
} from '@/lib/manualTrades'
import {
  createBalanceAdjustment,
  deleteBalanceAdjustment,
  getBalanceAdjustments,
  getManualBacktestSettings,
} from '@/services/api'

const COLORS = { up: '#22c55e', down: '#ef4444', text: '#9ca3af', grid: 'rgba(148, 163, 184, 0.15)' }
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const SESSION_ORDER = [...NSE_SESSIONS.map((s) => s.name), 'After hours']
const R_BUCKET_ORDER = ['-3+', '-2', '-1', '0', '1', '2', '3+']

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

function BalanceAdjusterDialog({ open, onOpenChange, adjustments }) {
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

export default function ManualOverview({ trades }) {
  const [adjusterOpen, setAdjusterOpen] = useState(false)
  const { data: backtestSettings } = useQuery({
    queryKey: ['manualBacktestSettings'],
    queryFn: getManualBacktestSettings,
  })
  const { data: adjustments = [] } = useQuery({
    queryKey: ['balanceAdjustments'],
    queryFn: getBalanceAdjustments,
  })
  const tolerancePct = backtestSettings?.risk_deviation_tolerance_pct ?? 10
  const openingBalance = backtestSettings?.opening_balance ?? 0

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

      <CalendarHeatmap dailyByDay={dailyByDay} latestDay={sortedDays.at(-1)?.[0] ?? null} />

      <BalanceAdjusterDialog open={adjusterOpen} onOpenChange={setAdjusterOpen} adjustments={adjustments} />
    </div>
  )
}

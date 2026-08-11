import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AreaSeries, createChart } from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import AllocationDonut from '@/components/AllocationDonut'
import { inr } from '@/lib/format'
import { tradePnl, underwaterSeries } from '@/lib/manualTrades'
import { getBalanceAdjustments } from '@/services/api'

const COLORS = { up: '#22c55e', down: '#ef4444', text: '#9ca3af', grid: 'rgba(148, 163, 184, 0.15)' }

function Metric({ label, value, valueClassName, sub }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className={`text-xl font-semibold tabular-nums ${valueClassName ?? ''}`}>{value}</p>
      <p className="mt-1 text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

// The equity curve. Same lightweight-charts area series the journal's Overview uses - this is a
// real date-indexed series, so unlike the Statistics tab's hand-rolled SVGs it fits the library.
function EquityCurve({ data }) {
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
    const rising = data.at(-1).value >= data[0].value
    chart
      .addSeries(AreaSeries, {
        lineColor: rising ? COLORS.up : COLORS.down,
        lineWidth: 2,
        topColor: rising ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
        bottomColor: 'rgba(0, 0, 0, 0)',
      })
      .setData(data)
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [data])

  return (
    <div className="relative h-64">
      <div ref={containerRef} className="absolute inset-0" />
      {data.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          No closed paper trades yet.
        </div>
      )}
    </div>
  )
}

export default function PaperOverview({ account, trades, positions }) {
  const { data: allAdjustments = [] } = useQuery({
    queryKey: ['balanceAdjustments'],
    queryFn: getBalanceAdjustments,
  })

  const closed = useMemo(() => trades.filter((t) => t.exit_price != null), [trades])
  const openPositions = positions.filter((p) => p.status === 'open')

  const stats = useMemo(() => {
    const pnls = closed.map(tradePnl)
    const realized = Math.round(pnls.reduce((s, p) => s + p, 0) * 100) / 100
    const wins = pnls.filter((p) => p > 0).length
    // Deliberately counted against every closed trade, including scratches - a "win rate" that
    // quietly drops neutral trades from the denominator flatters itself.
    const winRate = closed.length ? Math.round((wins / closed.length) * 1000) / 10 : 0

    // Day-by-day cumulative realized P&L, which is what both the curve and the drawdown read.
    const byDay = new Map()
    closed.forEach((t, i) => {
      const day = t.traded_at.slice(0, 10)
      byDay.set(day, (byDay.get(day) ?? 0) + pnls[i])
    })
    const days = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1))

    const opening = account?.opening_balance ?? 0
    const adjustments = allAdjustments
      .filter((a) => a.account_id === account?.id)
      .reduce((s, a) => s + (a.type === 'add' ? a.amount : -a.amount), 0)

    let running = opening + adjustments
    const curve = days.map(([day, pnl]) => {
      running += pnl
      return { time: day, value: Math.round(running * 100) / 100 }
    })

    let cumulative = 0
    const { maxDrawdown } = underwaterSeries(
      days.map(([, pnl]) => {
        cumulative += pnl
        return Math.round(cumulative * 100) / 100
      }),
    )

    // Unrealized moves with every price tick, so it's computed from the live positions rather
    // than stored anywhere.
    const unrealized = Math.round(openPositions.reduce((s, p) => s + (p.pnl ?? 0), 0) * 100) / 100
    // Cash committed to open positions is not available to trade with.
    const deployed = openPositions.reduce((s, p) => s + p.entry_price * p.quantity, 0)
    const cash = Math.round((opening + adjustments + realized - deployed) * 100) / 100

    return {
      realized,
      unrealized,
      winRate,
      cash,
      maxDrawdown,
      curve,
      // Net portfolio value: settled cash, plus what the open positions are worth right now.
      netValue: Math.round((cash + openPositions.reduce((s, p) => s + (p.value ?? 0), 0)) * 100) / 100,
      closedCount: closed.length,
    }
  }, [closed, openPositions, account, allAdjustments])

  // Both donuts read *deployed capital* (entry price × qty), not current market value: the
  // question they answer is "where did I put the money", and marking to market would make a
  // position look like a bigger bet simply because it went up. Cash is a slice of the capital
  // chart for the same reason - being 60% in cash is an allocation decision, not an absence of one.
  const allocation = useMemo(() => {
    const bySector = new Map()
    const byStock = openPositions.map((p) => {
      const cost = p.entry_price * p.quantity
      const sector = p.sector || 'Unclassified'
      bySector.set(sector, (bySector.get(sector) ?? 0) + cost)
      return { label: p.symbol, value: cost }
    })
    return {
      sectors: [...bySector].map(([label, value]) => ({ label, value })),
      stocks: [...byStock, { label: 'Cash', value: Math.max(stats.cash, 0) }],
    }
  }, [openPositions, stats.cash])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Metric
          label="Net portfolio value"
          value={inr(stats.netValue)}
          sub={`opening ${inr(account?.opening_balance ?? 0)}`}
        />
        <Metric
          label="Unrealized P&L"
          value={inr(stats.unrealized)}
          valueClassName={stats.unrealized >= 0 ? 'text-up' : 'text-down'}
          sub={`${openPositions.length} open position${openPositions.length === 1 ? '' : 's'}`}
        />
        <Metric
          label="Realized P&L"
          value={inr(stats.realized)}
          valueClassName={stats.realized >= 0 ? 'text-up' : 'text-down'}
          sub={`${stats.closedCount} closed`}
        />
        <Metric label="Win rate" value={`${stats.winRate}%`} sub="of all closed trades" />
        <Metric label="Available cash" value={inr(stats.cash)} sub="settled, not deployed" />
        <Metric
          label="Max drawdown"
          value={inr(stats.maxDrawdown)}
          valueClassName="text-down"
          sub="peak-to-trough, realized"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <AllocationDonut
          title="Sector allocation"
          slices={allocation.sectors}
          note="open positions, at cost"
        />
        <AllocationDonut title="Capital allocation" slices={allocation.stocks} note="incl. uninvested cash" />
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-sm font-medium">Equity curve</p>
          <p className="text-xs text-muted-foreground">
            Realized only — open positions move it when they close.
          </p>
        </div>
        <EquityCurve data={stats.curve} />
      </div>

      {stats.closedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          Closed paper trades are journalled like any other trade (tagged <code>paper</code>), so the
          Backtesting tab's Statistics and Goals views work on them too — filter by this account there for the
          deeper breakdowns.
        </p>
      )}
    </div>
  )
}

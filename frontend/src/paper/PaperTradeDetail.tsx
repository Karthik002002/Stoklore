// One finished paper trade, on the bars it happened on.
//
// The sibling of PaperPositionChart (/paper/$symbol), which does the same for a position that is
// still open. The split is deliberate: an open position is something you can still act on - drag
// the stop, close it - and that page is built around those controls. A closed trade is a record,
// so this page has no buttons that change anything. It answers "what did I actually do, and what
// did the market do around it".
//
// Closed paper trades are ordinary journal rows tagged 'paper', so this reads the same
// getManualTrades() list every other paper screen does rather than a trade-specific endpoint.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { fmt, formatDateTime, inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import { expectedR, RESULT_META, tradePnl, tradeReturnPct, tradeRR } from '@/lib/manualTrades'
import { accountFor, accountsById, tradeCosts, tradeNetPnl } from '@/lib/tradeCosts'
import { excursionReading } from '@/lib/tradeContext'
import ReplayChart from '@/features/bar-replay/ReplayChart'
import { useBarReplayStore } from '@/features/bar-replay/store'
import type { ChartMarker } from '@/features/bar-replay/ReplayChart'
import type { ReplayBar, ReplayOrder } from '@/features/bar-replay/store'
import type { DailyBar, Trade } from '@/lib/types'
import { getManualTrades, getPriceHistory, getTradeAccounts } from '@/services/api'

// How much of the fetched history to show, as trading sessions EITHER SIDE of the trade - the
// range is centred on what happened rather than counted back from today, which is what makes a
// trade from last March readable at all. 'All' is every bar that was fetched.
//
// Not a data range: the bars are fetched once (see `days` below) and sliced here, so switching
// ranges is instant and never refetches.
const RANGES: [label: string, sessionsEitherSide: number][] = [
  ['1M', 11],
  ['3M', 33],
  ['6M', 66],
  ['1Y', 125],
  ['ALL', Number.POSITIVE_INFINITY],
]

// Enough context around the trade to see what it walked into, and what it left behind: 60 sessions
// either side of the holding period, floored at a year so a same-week trade still gets a chart
// worth looking at.
const PADDING_DAYS = 60
const MIN_DAYS = 365

const daysSince = (iso: string | null | undefined) =>
  iso ? Math.ceil((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0

/** ReplayBar, not DailyBar: on a daily timeframe the chart's `time` IS the calendar day, which is
 *  the same mapping BarReplay's own daily branch does. */
const withTime = (bars: DailyBar[]): ReplayBar[] => bars.map((b) => ({ ...b, time: b.date }))

/** The trade as an order the chart can draw: entry, and the plan's stop and target as one-leg
 *  ladders. Status 'open' because that is what makes ReplayChart draw the levels at all - nothing
 *  here is editable, since the page passes no handlers. */
const asOrder = (trade: Trade): ReplayOrder => ({
  id: String(trade.id),
  direction: trade.direction,
  entryPrice: trade.entry_price,
  quantity: trade.quantity,
  status: 'open',
  stopLosses: trade.stop_loss == null ? [] : [{ id: 'stop', price: trade.stop_loss, qty: trade.quantity }],
  targets: trade.target == null ? [] : [{ id: 'target', price: trade.target, qty: trade.quantity }],
})

const ENTRY_COLOR = '#3b82f6'
const EXIT_COLOR = '#a855f7'

/** What an order cannot say: WHEN each end happened. Arrows on the entry and exit bars, the way a
 *  charting package marks a fill - the direction of the arrow is the side, and the label carries
 *  the size and the price so the exit needs no line of its own.
 *
 *  The bar a trade landed on is the first one at or after its date: a trade dated on a holiday or
 *  a weekend has no bar of its own. */
const tradeMarkers = (trade: Trade, bars: ReplayBar[]): ChartMarker[] => {
  const barOn = (iso: string | null | undefined) => {
    if (!iso) return null
    const day = iso.slice(0, 10)
    return bars.find((b) => b.date.slice(0, 10) >= day) ?? null
  }
  const long = trade.direction === 'long'
  const out: ChartMarker[] = []

  const entryBar = barOn(trade.entried_at ?? trade.traded_at)
  if (entryBar) {
    out.push({
      time: entryBar.time,
      // Entry below the bar and exit above it, so a same-day round trip does not stack two
      // labels on one candle.
      position: 'belowBar',
      shape: long ? 'arrowUp' : 'arrowDown',
      color: ENTRY_COLOR,
      text: `${long ? 'Buy' : 'Sell'} ${trade.quantity} @ ${inr(trade.entry_price)}`,
    })
  }

  const exitBar = barOn(trade.exited_at)
  if (exitBar && trade.exit_price != null) {
    out.push({
      time: exitBar.time,
      position: 'aboveBar',
      shape: long ? 'arrowDown' : 'arrowUp',
      color: EXIT_COLOR,
      text: `${long ? 'Sell' : 'Buy'} ${trade.quantity} @ ${inr(trade.exit_price)}`,
    })
  }
  return out
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'up' | 'down'
}) {
  return (
    <div>
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={`text-sm font-semibold tabular-nums ${
          tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  )
}

export default function PaperTradeDetail() {
  const { tradeId } = useParams({ from: '/paper/trade/$tradeId' })
  const { account } = useSearch({ from: '/paper/trade/$tradeId' })

  const { data: trades = [], isPending } = useQuery({
    queryKey: ['manualTrades'],
    queryFn: getManualTrades,
  })
  const { data: accounts = [] } = useQuery({
    queryKey: ['tradeAccounts'],
    queryFn: () => getTradeAccounts(),
  })

  const trade = trades.find((t) => String(t.id) === tradeId) ?? null
  usePageTitle(trade ? `${trade.symbol} · paper trade` : 'Paper trade')

  // Asked for by symbol and window, so the same fetch is shared with any other trade in the same
  // stock rather than being keyed to this one trade.
  const days = trade ? Math.max(MIN_DAYS, daysSince(trade.entried_at ?? trade.traded_at) + PADDING_DAYS) : 0
  const { data: history = [], isPending: barsPending } = useQuery({
    queryKey: ['priceHistory', trade?.symbol, days],
    queryFn: () => getPriceHistory(trade?.symbol ?? '', days),
    enabled: !!trade,
  })

  const byId = useMemo(() => accountsById(accounts), [accounts])
  const [range, setRange] = useState('6M')
  // The same chart the open-position page draws, with the same indicators and settings - a trade
  // should not look like a different instrument once it is closed.
  const indicators = useBarReplayStore((st) => st.indicators)
  const chartSettings = useBarReplayStore((st) => st.settings)

  // The window actually drawn: the trade's own bars, plus the selected padding either side.
  const visible = useMemo((): ReplayBar[] => {
    const sessions = RANGES.find(([label]) => label === range)?.[1] ?? 66
    if (!Number.isFinite(sessions) || !trade) return withTime(history)
    const day = (iso: string | null | undefined) => (iso ?? '').slice(0, 10)
    const from = day(trade.entried_at ?? trade.traded_at)
    const to = day(trade.exited_at) || from
    const first = history.findIndex((b) => b.date.slice(0, 10) >= from)
    // A trade whose bars are missing from the fetched window has nothing to centre on - show
    // everything rather than an empty slice.
    if (first < 0) return withTime(history)
    let last = history.findIndex((b) => b.date.slice(0, 10) >= to)
    if (last < 0) last = history.length - 1
    return withTime(
      history.slice(Math.max(0, first - sessions), Math.min(history.length, last + sessions + 1)),
    )
  }, [history, range, trade])

  if (isPending) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Spinner className="size-4" /> Loading trade…
      </div>
    )
  }

  if (!trade) {
    return (
      <div className="space-y-3 py-24 text-center">
        <p className="text-sm text-muted-foreground">That trade is no longer in the journal.</p>
        <Button
          size="sm"
          variant="outline"
          render={<Link to="/paper" search={{ view: 'trades', account }} />}
        >
          Back to trades
        </Button>
      </div>
    )
  }

  const pnl = tradePnl(trade)
  const ret = tradeReturnPct(trade)
  const r = expectedR(trade)
  const rr = tradeRR(trade)
  const costs = tradeCosts(trade, accountFor(trade, byId))
  const net = tradeNetPnl(trade, accountFor(trade, byId))
  const excursion = excursionReading(trade)
  const meta = trade.result ? RESULT_META[trade.result] : null
  const held =
    trade.entried_at && trade.exited_at
      ? Math.max(
          0,
          Math.round(
            (new Date(trade.exited_at).getTime() - new Date(trade.entried_at).getTime()) / 86_400_000,
          ),
        )
      : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          nativeButton={false}
          aria-label="Back to trades"
          render={<Link to="/paper" search={{ view: 'trades', account }} />}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <h1 className="text-lg font-semibold">{trade.symbol}</h1>
        <span className="text-xs text-muted-foreground capitalize">
          {trade.direction} · {trade.quantity} qty
        </span>
        {meta && <Badge variant={meta.badgeVariant}>{meta.label}</Badge>}
        {trade.setup && <Badge variant="outline">{trade.setup}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatDateTime(trade.entried_at ?? trade.traded_at)}
          {trade.exited_at && ` → ${formatDateTime(trade.exited_at)}`}
        </span>
        <div className="flex items-center gap-1">
          {RANGES.map(([label]) => (
            <Button
              key={label}
              size="sm"
              variant={range === label ? 'secondary' : 'ghost'}
              className="h-7 font-mono text-[11px]"
              onClick={() => setRange(label)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-3 sm:grid-cols-4 lg:grid-cols-7">
        <Metric label="Entry" value={inr(trade.entry_price)} />
        <Metric label="Exit" value={inr(trade.exit_price)} />
        <Metric
          label="Realised"
          value={inr(pnl)}
          sub={ret == null ? undefined : `${ret >= 0 ? '+' : ''}${fmt(ret, 2)}%`}
          tone={pnl == null ? undefined : pnl >= 0 ? 'up' : 'down'}
        />
        {/* Only where the account actually charges something - an all-zero cost card on a
            zero-cost account is a column of noise. */}
        <Metric
          label={costs && costs.total > 0 ? 'Net' : 'Net (no costs set)'}
          value={inr(net)}
          sub={costs && costs.total > 0 ? `${inr(costs.total)} costs` : undefined}
          tone={net == null ? undefined : net >= 0 ? 'up' : 'down'}
        />
        <Metric
          label="R multiple"
          value={r == null ? '—' : `${fmt(r, 2)}R`}
          sub={rr == null ? 'no stop logged' : `${fmt(rr, 2)}R planned`}
          tone={r == null ? undefined : r >= 0 ? 'up' : 'down'}
        />
        <Metric label="Stop / target" value={`${inr(trade.stop_loss)} / ${inr(trade.target)}`} />
        <Metric
          label="Held"
          value={held == null ? '—' : held === 0 ? 'Same day' : `${held}d`}
          sub={trade.emotion ?? undefined}
        />
      </div>

      {/* A DEFINITE height, not flex-1 inside a min-height column: `h-full` on the canvas box
          resolves to nothing unless its ancestors have a real height, which is how this ended up
          as a 40px strip. Sized off the viewport instead, with the rest of the page scrolling
          under it. */}
      {/* `relative` and `overflow-hidden` are load-bearing, not styling: ReplayChart's root is
          `absolute inset-0`, so without a positioned ancestor to fill it lays itself out against
          the page and covers everything above it. Same wrapper the position page uses. */}
      <div className="relative h-[calc(100vh-21rem)] min-h-[24rem] overflow-hidden rounded-xl border bg-card">
        {barsPending ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Loading {trade.symbol} history…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
            No synced price history covering this trade — run a price sync for {trade.symbol}.
          </div>
        ) : (
          <ReplayChart
            bars={visible}
            indicators={indicators}
            orders={[asOrder(trade)]}
            markers={tradeMarkers(trade, visible)}
            settings={chartSettings}
            // A finished trade is a record: the levels are drawn, and none of them can be moved,
            // removed or resized from here.
            readOnly
            // Changing the window tears the chart down rather than updating it, the same way the
            // position page's range buttons do.
            resetKey={`${trade.id}-${range}`}
          />
        )}
      </div>

      {/* Only ever filled in by a Bar Replay trade, which records the excursion as it runs - a
          hand-logged trade has no snapshot, and the section stays out of the way rather than
          showing a row of dashes. */}
      {excursion && (
        <div className="rounded-xl border bg-card p-3">
          <p className="mb-2 text-sm font-medium">While it was open</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              label="Heat taken (MAE)"
              value={excursion.maeR == null ? '—' : `${fmt(excursion.maeR, 2)}R`}
              sub={excursion.maePct == null ? undefined : `${fmt(excursion.maePct, 2)}%`}
              tone="down"
            />
            <Metric
              label="Best it reached (MFE)"
              value={excursion.mfeR == null ? '—' : `${fmt(excursion.mfeR, 2)}R`}
              sub={excursion.mfePct == null ? undefined : `${fmt(excursion.mfePct, 2)}%`}
              tone="up"
            />
            <Metric
              label="You kept"
              value={excursion.capturedR == null ? '—' : `${fmt(excursion.capturedR, 2)}R`}
              sub={
                excursion.leftOnTableR == null
                  ? undefined
                  : `${fmt(excursion.leftOnTableR, 2)}R left on the table`
              }
            />
            <Metric label="Bars held" value={excursion.bars ?? '—'} />
          </div>
          {excursion.stopTooWide && (
            <p className="mt-2 text-xs text-muted-foreground">
              This one never took much heat — the stop was wider than it needed to be.
            </p>
          )}
        </div>
      )}

      {(trade.notes || trade.tags.length > 0 || trade.image_url) && (
        <div className="rounded-xl border bg-card p-3">
          {trade.tags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {trade.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          {trade.notes && <p className="text-sm whitespace-pre-wrap">{trade.notes}</p>}
          {trade.image_url && (
            <img src={trade.image_url} alt="" className="mt-3 max-h-96 rounded-lg border object-contain" />
          )}
        </div>
      )}
    </div>
  )
}

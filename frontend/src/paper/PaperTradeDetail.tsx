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
import { ArrowLeftIcon, ChevronDownIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { ChartControls } from '@/features/bar-replay/ChartControls'
import { fmt, formatDateTime, inr } from '@/lib/format'
import { useChartAlerts } from '@/lib/useChartAlerts'
import { usePageTitle } from '@/lib/usePageTitle'
import { expectedR, RESULT_META, tradePnl, tradeReturnPct, tradeRR } from '@/lib/manualTrades'
import { accountFor, accountsById, tradeCosts, tradeNetPnl } from '@/lib/tradeCosts'
import { excursionReading } from '@/lib/tradeContext'
import ReplayChart from '@/features/bar-replay/ReplayChart'
import { useBarReplayStore } from '@/features/bar-replay/store'
import { BUY_COLOR, SELL_COLOR } from '@/lib/entryMarker'
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

/** What an order cannot say: WHEN each end happened. Arrows on the entry and exit bars, the way a
 *  charting package marks a fill: a bare arrow, green for the buy and red for the sell, pointing
 *  the way the trade went. No text - over the candles it only got in the way, and the size and
 *  prices are in the panel.
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
      color: long ? BUY_COLOR : SELL_COLOR,
      size: 1.6,
    })
  }

  const exitBar = barOn(trade.exited_at)
  if (exitBar && trade.exit_price != null) {
    out.push({
      time: exitBar.time,
      position: 'aboveBar',
      shape: long ? 'arrowDown' : 'arrowUp',
      color: long ? SELL_COLOR : BUY_COLOR,
      size: 1.6,
    })
  }
  return out
}

/** One line of the trade panel: label left, value right - the same data-window rows the open
 *  position's panel uses (paper/PaperPositionChart), so the two pages read alike. */
function Row({
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
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn('text-right tabular-nums', tone === 'up' && 'text-up', tone === 'down' && 'text-down')}
      >
        {value}
        {sub && <span className="ml-1.5 text-muted-foreground">{sub}</span>}
      </dd>
    </div>
  )
}

const toneOf = (v: number | null | undefined) =>
  (v == null ? undefined : v >= 0 ? 'up' : 'down') as 'up' | 'down' | undefined

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
  // the trade is a record, but an alert on its stock is about the market from now on
  const chartAlerts = useChartAlerts(trade?.symbol)

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
  // The trade panel sits on the candles; collapsed, it's one line.
  const [panelOpen, setPanelOpen] = useState(true)
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

  const signed = (v: number | null | undefined, digits = 2) =>
    v == null ? undefined : `${v >= 0 ? '+' : ''}${fmt(v, digits)}%`

  // On the chart, not above it - the same corner panel the open position shows. Collapsed it keeps
  // the one line that matters: side, size @ entry, and what it made.
  const panel = (
    <div className="w-72 rounded-md border bg-background/85 text-xs shadow-lg backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setPanelOpen((o) => !o)}
        aria-expanded={panelOpen}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
            trade.direction === 'long' ? 'bg-up/15 text-up' : 'bg-down/15 text-down',
          )}
        >
          {trade.direction}
        </span>
        <span className="tabular-nums">
          {trade.quantity} @ {inr(trade.entry_price)}
        </span>
        <span
          className={cn(
            'ml-auto font-medium tabular-nums',
            pnl != null && (pnl >= 0 ? 'text-up' : 'text-down'),
          )}
        >
          {pnl == null ? '—' : inr(pnl)}
        </span>
        <ChevronDownIcon
          className={cn('size-3.5 text-muted-foreground transition-transform', !panelOpen && '-rotate-90')}
        />
      </button>
      {panelOpen && (
        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto border-t px-2.5 py-2">
          <dl className="space-y-1">
            <Row label="Exit" value={inr(trade.exit_price)} sub={signed(ret)} tone={toneOf(ret)} />
            <Row label="Realised" value={inr(pnl)} tone={toneOf(pnl)} />
            {/* Only where the account actually charges something */}
            {costs && costs.total > 0 && (
              <Row label="Net" value={inr(net)} sub={`${inr(costs.total)} costs`} tone={toneOf(net)} />
            )}
            <Row
              label="Stop loss"
              value={trade.stop_loss == null ? '—' : inr(trade.stop_loss)}
              sub={trade.stop_loss == null ? 'none logged' : undefined}
            />
            <Row
              label="Target"
              value={trade.target == null ? '—' : inr(trade.target)}
              sub={trade.target == null ? 'none set' : undefined}
            />
            <Row
              label="R multiple"
              value={r == null ? '—' : `${fmt(r, 2)}R`}
              sub={rr == null ? undefined : `${fmt(rr, 2)}R planned`}
              tone={toneOf(r)}
            />
            <Row
              label="Held"
              value={held == null ? '—' : held === 0 ? 'Same day' : `${held}d`}
              sub={trade.emotion ?? undefined}
            />
          </dl>

          {/* Only ever filled in by a Bar Replay trade, which records the excursion as it runs. */}
          {excursion && (
            <dl className="mt-2 space-y-1 border-t pt-2">
              <Row
                label="Heat (MAE)"
                value={excursion.maeR == null ? '—' : `${fmt(excursion.maeR, 2)}R`}
                sub={excursion.maePct == null ? undefined : `${fmt(excursion.maePct, 2)}%`}
                tone="down"
              />
              <Row
                label="Best (MFE)"
                value={excursion.mfeR == null ? '—' : `${fmt(excursion.mfeR, 2)}R`}
                sub={excursion.mfePct == null ? undefined : `${fmt(excursion.mfePct, 2)}%`}
                tone="up"
              />
              <Row
                label="Kept"
                value={excursion.capturedR == null ? '—' : `${fmt(excursion.capturedR, 2)}R`}
                sub={excursion.leftOnTableR == null ? undefined : `${fmt(excursion.leftOnTableR, 2)}R left`}
              />
              <Row label="Bars held" value={excursion.bars ?? '—'} />
              {excursion.stopTooWide && (
                <p className="text-[11px] text-muted-foreground">
                  Never took much heat - the stop was wider than it needed to be.
                </p>
              )}
            </dl>
          )}

          {(trade.tags.length > 0 || trade.setup) && (
            <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
              {trade.setup && <Badge variant="secondary">{trade.setup}</Badge>}
              {trade.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          {trade.notes && <p className="mt-2 border-t pt-2 whitespace-pre-wrap">{trade.notes}</p>}
          {trade.image_url && (
            <a href={trade.image_url} target="_blank" rel="noreferrer" className="mt-2 block border-t pt-2">
              <img
                src={trade.image_url}
                alt="Trade screenshot"
                className="max-h-40 w-full rounded border object-contain"
              />
            </a>
          )}
        </div>
      )}
    </div>
  )

  return (
    // The whole viewport beside the nav rail, like the open position's page: a thin symbol bar on
    // top and the chart under it, nothing else competing for height.
    <div className="fixed inset-y-0 right-0 left-[var(--sidebar-w,3.5rem)] z-40 flex flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <Button
          size="icon-sm"
          variant="ghost"
          nativeButton={false}
          aria-label="Back to trades"
          render={<Link to="/paper" search={{ view: 'trades', account }} />}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <h1 className="text-sm font-semibold">{trade.symbol}</h1>
        <span className="text-xs whitespace-nowrap text-muted-foreground capitalize">
          {trade.direction} · {trade.quantity} qty · paper
        </span>
        {meta && <Badge variant={meta.badgeVariant}>{meta.label}</Badge>}
        <span className="ml-auto hidden truncate text-xs text-muted-foreground tabular-nums lg:inline">
          {formatDateTime(trade.entried_at ?? trade.traded_at)}
          {trade.exited_at && ` → ${formatDateTime(trade.exited_at)}`}
        </span>
        <div className="flex items-center gap-1 border-l pl-2">
          <ChartControls />
        </div>
        <div className="flex items-center border-l pl-2">
          <Select value={range} onValueChange={(v) => setRange(v as string)}>
            <SelectTrigger
              size="sm"
              className="h-7 w-20 font-mono text-xs"
              title="Bars either side of the trade"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {RANGES.map(([label]) => (
                <SelectItem key={label} value={label} className="font-mono text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ReplayChart is absolutely positioned inside its parent, so it needs a sized relative box. */}
      <div className="relative min-h-0 flex-1">
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
            {...chartAlerts}
            bars={visible}
            indicators={indicators}
            orders={[asOrder(trade)]}
            // Arrows on the entry and exit bars: the side, the size and the fill price.
            markers={tradeMarkers(trade, visible)}
            settings={chartSettings}
            topLeft={panel}
            // A finished trade is a record: the levels are drawn, and none of them can be moved,
            // removed or resized from here.
            readOnly
            // Changing the window tears the chart down rather than updating it.
            resetKey={`${trade.id}-${range}`}
          />
        )}
      </div>
    </div>
  )
}

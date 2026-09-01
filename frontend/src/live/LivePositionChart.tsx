import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { fmt, inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import ReplayChart from '@/features/bar-replay/ReplayChart'
import { useBarReplayStore } from '@/features/bar-replay/store'
import type { ReplayBar, ReplayLeg, ReplayOrder } from '@/features/bar-replay/store'
import type { LiveModifyRequest, LiveOrder, LivePosition } from '@/services/api'
import {
  cancelLiveOrder,
  closeLivePosition,
  getLiveOrders,
  getLivePositions,
  getStockChart,
  modifyLiveOrder,
} from '@/services/api'

// The paper version of this page (paper/PaperPositionChart.jsx) drives the same Bar Replay chart
// against a simulated position. This one drives it against a real one, and the difference is where
// the levels live: a paper stop is a row in this app's database, a live stop is a leg of a Super
// Order sitting at Dhan. Dragging the line here sends a modify to the broker - there is no local
// copy to update, and if the modify is refused the line snaps back on the next poll, which is the
// honest outcome.

const RANGES = ['1mo', '6mo', 'ytd', '1y']

/** The live position plus its broker-side exits, in the shape the replay chart already draws.
 *  Ids are the broker's order ids, so a dragged line knows which leg to modify. */
const asOrder = (position: LivePosition, legs: LiveOrder[]): ReplayOrder => {
  const long = position.net_qty > 0
  // A leg the broker reports without a price of its own is left off rather than drawn at zero:
  // an invented line is one the user would try to drag.
  const levels = (name: LiveOrder['leg']): ReplayLeg[] =>
    legs
      .filter((l) => l.leg === name)
      .map((l) => ({
        id: l.order_id,
        price: (name === 'STOP_LOSS_LEG' ? (l.trigger_price ?? l.price) : l.price) ?? 0,
        qty: l.quantity ?? 0,
      }))
      .filter((l) => l.price > 0)
  return {
    id: position.security_id,
    direction: long ? 'long' : 'short',
    entryPrice: (long ? position.buy_avg : position.sell_avg) ?? 0,
    quantity: Math.abs(position.net_qty),
    status: 'open',
    stopLosses: levels('STOP_LOSS_LEG'),
    targets: levels('TARGET_LEG'),
  }
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

export default function LivePositionChart() {
  const { symbol } = useParams({ from: '/live/$symbol' })
  const queryClient = useQueryClient()
  const [range, setRange] = useState('6mo')
  const indicators = useBarReplayStore((st) => st.indicators)
  const chartSettings = useBarReplayStore((st) => st.settings)
  usePageTitle(`${symbol} · Live position`)

  const { data: positions = [], isPending } = useQuery({
    queryKey: ['livePositions'],
    queryFn: getLivePositions,
    refetchInterval: 10_000,
  })
  const { data: orders = [] } = useQuery({
    queryKey: ['liveOrders'],
    queryFn: () => getLiveOrders(),
    refetchInterval: 10_000,
  })
  const { data: chart, isPending: chartPending } = useQuery({
    queryKey: ['stockChart', symbol, range],
    queryFn: () => getStockChart(symbol, range),
  })
  // The chart endpoint sends a unix `time` and no `date`. ReplayChart only reads `date` for bars
  // whose time is a string (see its `stamp`), so these never reach that branch - hence the cast
  // rather than inventing a date field the API does not send.
  const bars = (chart?.bars ?? []) as unknown as ReplayBar[]

  const position = useMemo(
    () => positions.find((p) => p.symbol === symbol && p.net_qty) ?? null,
    [positions, symbol],
  )
  // Only legs still working belong on the chart: a stop that already filled is history, and drawing
  // it as a line you could drag would offer an edit the broker will refuse.
  const legs = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.symbol === symbol &&
          o.parent_order_id &&
          ['TRANSIT', 'PENDING', 'PART_TRADED'].includes(o.status),
      ),
    [orders, symbol],
  )
  const entryOrder = useMemo(
    () => orders.find((o) => o.symbol === symbol && (!o.leg || o.leg === 'ENTRY_LEG')),
    [orders, symbol],
  )

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['livePositions'] })
    queryClient.invalidateQueries({ queryKey: ['liveOrders'] })
  }
  const modify = useMutation({
    mutationFn: ({ orderId, payload }: { orderId: string; payload: LiveModifyRequest }) =>
      modifyLiveOrder(orderId, payload),
    onSuccess: () => {
      refresh()
      toast.success('Sent to the broker')
    },
    onError: (e) => toast.error(e.message),
  })
  const cancel = useMutation({
    mutationFn: ({ orderId, leg }: { orderId: string; leg?: string | null }) => cancelLiveOrder(orderId, leg),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })
  const close = useMutation({
    mutationFn: () => closeLivePosition(position!.security_id),
    onSuccess: () => {
      refresh()
      toast.success('Exit order sent')
    },
    onError: (e) => toast.error(e.message),
  })

  const legFor = (legId: string) => legs.find((l) => l.order_id === legId)
  const price2 = (p: number) => Math.round(p * 100) / 100

  // ReplayChart's own handlers, pointed at the broker. `field` is the chart's vocabulary
  // (stopLoss/target); the leg name is Dhan's.
  const adjustOrder = (_id: string, field: 'entry' | 'stopLoss' | 'target', price: number, legId: string) => {
    const leg = legFor(legId)
    if (!leg?.parent_order_id) return
    modify.mutate({
      orderId: leg.parent_order_id,
      payload:
        field === 'stopLoss'
          ? { leg: 'STOP_LOSS_LEG', stop_price: price2(price) }
          : { leg: 'TARGET_LEG', target_price: price2(price) },
    })
  }
  const removeLevel = (_id: string, _field: 'stopLoss' | 'target', legId: string) => {
    const leg = legFor(legId)
    if (!leg?.parent_order_id) return
    // Dhan will not let a cancelled leg be added back, so this is one-way and worth saying so.
    if (!window.confirm('Cancel this leg at the broker? It cannot be re-attached to this order.')) return
    cancel.mutate({ orderId: leg.parent_order_id, leg: leg.leg })
  }
  const moveToBreakeven = () => {
    const stop = legs.find((l) => l.leg === 'STOP_LOSS_LEG')
    const entry = position && position.net_qty > 0 ? position.buy_avg : position?.sell_avg
    if (!stop?.parent_order_id || !entry) return
    modify.mutate({
      orderId: stop.parent_order_id,
      payload: { leg: 'STOP_LOSS_LEG', stop_price: price2(entry) },
    })
  }

  const entry = position ? (position.net_qty > 0 ? position.buy_avg : position.sell_avg) : null
  const pctFrom = (price: number | null | undefined) =>
    entry && price != null ? ((price - entry) / entry) * 100 : null
  const signed = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v, 2)}%`)
  const stopLeg = legs.find((l) => l.leg === 'STOP_LOSS_LEG')
  const targetLeg = legs.find((l) => l.leg === 'TARGET_LEG')

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            nativeButton={false}
            aria-label="Back to live trading"
            render={<Link to="/live" />}
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <h1 className="text-lg font-semibold">{symbol}</h1>
          {position && (
            <span className="text-xs text-muted-foreground">
              {position.net_qty > 0 ? 'long' : 'short'} · {Math.abs(position.net_qty)} qty ·{' '}
              {position.product}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {position && (
            <Button size="sm" variant="outline" onClick={() => close.mutate()} disabled={close.isPending}>
              Close at market
            </Button>
          )}
          {RANGES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? 'secondary' : 'ghost'}
              className="h-7 font-mono text-[11px] uppercase"
              onClick={() => setRange(r)}
            >
              {r}
            </Button>
          ))}
        </div>
      </div>

      {position && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Average" value={inr(entry)} />
          <Metric
            label="Last"
            value={position.current_price == null ? '—' : inr(position.current_price)}
            sub={position.current_price == null ? undefined : signed(pctFrom(position.current_price))}
          />
          <Metric
            label="Unrealised"
            value={position.mark_pnl == null ? '—' : inr(position.mark_pnl)}
            tone={position.mark_pnl == null ? undefined : position.mark_pnl >= 0 ? 'up' : 'down'}
          />
          <Metric label="Realised" value={inr(position.realised ?? 0)} />
          <Metric
            label="Stop (at broker)"
            value={stopLeg ? inr(stopLeg.trigger_price ?? stopLeg.price) : '—'}
            sub={stopLeg ? signed(pctFrom(stopLeg.trigger_price ?? stopLeg.price)) : 'unprotected'}
          />
          <Metric
            label="Target (at broker)"
            value={targetLeg ? inr(targetLeg.price) : '—'}
            sub={targetLeg ? signed(pctFrom(targetLeg.price)) : 'none set'}
          />
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
        {chartPending || isPending ? (
          <p className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Loading {symbol}…
          </p>
        ) : bars.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No price history for {symbol}.
          </p>
        ) : (
          <ReplayChart
            bars={bars}
            indicators={indicators}
            orders={position ? [asOrder(position, legs)] : []}
            resetKey={`${symbol}-${range}`}
            settings={chartSettings}
            onAdjustOrder={adjustOrder}
            onRemoveLevel={removeLevel}
            onMoveToBreakeven={moveToBreakeven}
            onRequestClose={() => close.mutate()}
            onCancelPending={() => entryOrder && cancel.mutate({ orderId: entryOrder.order_id, leg: null })}
            // A Super Order carries one stop and one target, both sized to the entry. Adding a
            // second level or resizing a leg is a different order, not an edit - so these say so
            // rather than being left off, which would leave the chart's menu items silently dead.
            onPlaceLevel={() =>
              toast.info(
                'A broker-side order holds one stop and one target — modify the existing line, or send a new order to scale out.',
              )
            }
            onAdjustLegQty={() =>
              toast.info(
                'Leg quantity is set by the entry. To take part of the position off, send an opposite order for that quantity.',
              )
            }
          />
        )}
      </div>

      {!position && !isPending && (
        <p className="text-xs text-muted-foreground">
          No open position in {symbol} at the broker — the chart is showing price only.
        </p>
      )}
    </div>
  )
}

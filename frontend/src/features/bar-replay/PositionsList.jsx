import { useState } from 'react'
import { XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { inr } from '@/lib/format'
import { tradePnl } from '@/lib/manualTrades'
import { riskReward } from './orderEngine'

const FIELD_FOR_KIND = { stopLoss: 'stopLosses', target: 'targets' }
const LABEL_FOR_KIND = { stopLoss: 'SL', target: 'T' }

function legsFor(order, kind) {
  return order[FIELD_FOR_KIND[kind]] ?? []
}

// One line per leg (stop-loss OR target - a laddered exit on either side can have several,
// each covering part of the quantity - see orderEngine.js/store.js) plus a remove button, since
// legs are a list that can grow or shrink, not a single optional field.
function LegList({ order, kind, onRemoveLevel }) {
  const legs = legsFor(order, kind)
  if (legs.length === 0) return null
  const label = LABEL_FOR_KIND[kind]
  return (
    <div className="space-y-0.5">
      {legs.map((leg, i) => (
        <div key={leg.id} className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {label}
            {legs.length > 1 ? ` ${i + 1}` : ''} {leg.qty} @ {inr(leg.price)}
          </span>
          <button
            type="button"
            aria-label={`Remove ${kind === 'stopLoss' ? 'stop loss' : 'target'} ${i + 1}`}
            onClick={() => onRemoveLevel(order.id, kind, leg.id)}
          >
            <XIcon className="size-3 hover:text-foreground" />
          </button>
        </div>
      ))}
    </div>
  )
}

function OrderRow({
  order,
  lastBar,
  onRequestClose,
  onRequestPartialClose,
  onMoveToBreakeven,
  onCancelPending,
  onRemoveLevel,
}) {
  const slLegs = legsFor(order, 'stopLoss')
  const targetLegs = legsFor(order, 'target')
  // Partial-close input is opt-in - a "Close half" row would clutter the common "close it all"
  // case, so it's revealed under a "Partial" toggle. Default half the position (a scale-out is
  // the usual partial), user can overwrite before hitting Close.
  const [partialOpen, setPartialOpen] = useState(false)
  const [partialQty, setPartialQty] = useState(() => Math.max(1, Math.floor(order.quantity / 2)))

  if (order.status === 'pending') {
    return (
      <div className="space-y-1 rounded-lg border border-dashed border-amber-500/60 bg-amber-500/5 p-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="capitalize">
            {order.direction} limit {order.quantity} @ {inr(order.entryPrice)}
          </span>
          <Badge variant="outline" className="border-amber-500/70 text-amber-700">
            Pending
          </Badge>
        </div>
        {(slLegs.length > 0 || targetLegs.length > 0) && (
          <p className="text-xs text-muted-foreground">
            {[
              ...slLegs.map((l) => `SL ${l.qty}@${inr(l.price)}`),
              ...targetLegs.map((l) => `T ${l.qty}@${inr(l.price)}`),
            ].join(' · ')}
          </p>
        )}
        {/* Cancelling a pending never traded - no journal, no P&L, no result dialog. Distinct
            action from Close (which is for filled positions and goes through CloseTradeDialog). */}
        <Button variant="outline" size="sm" className="w-full" onClick={() => onCancelPending(order.id)}>
          Cancel
        </Button>
      </div>
    )
  }

  const pnl = tradePnl({
    direction: order.direction,
    entry_price: order.entryPrice,
    exit_price: lastBar.close,
    quantity: order.quantity,
  })
  return (
    <div className="space-y-1 rounded-lg border p-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium capitalize">
          {order.direction} {order.quantity} @ {inr(order.entryPrice)}
        </span>
        <span className={`font-semibold tabular-nums ${pnl >= 0 ? 'text-up' : 'text-down'}`}>{inr(pnl)}</span>
      </div>
      <LegList order={order} kind="stopLoss" onRemoveLevel={onRemoveLevel} />
      <LegList order={order} kind="target" onRemoveLevel={onRemoveLevel} />
      <p className="text-xs text-muted-foreground">
        Right-click the chart to add levels · drag a level to adjust it{order.trailing ? ' · trailing' : ''}
      </p>
      {slLegs.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onMoveToBreakeven(order.id)}
          disabled={slLegs.every((l) => l.price === order.entryPrice)}
        >
          Move stop to breakeven
        </Button>
      )}
      {partialOpen ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min="1"
            max={order.quantity}
            value={partialQty}
            onChange={(e) => setPartialQty(Number(e.target.value))}
            className="w-20"
          />
          <span className="text-xs text-muted-foreground">of {order.quantity}</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={!(partialQty > 0 && partialQty <= order.quantity)}
            onClick={() => onRequestPartialClose(order, partialQty)}
          >
            Close {partialQty}
          </Button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="flex-1" onClick={() => setPartialOpen(true)}>
            Partial…
          </Button>
          <Button variant="destructive" size="sm" className="flex-1" onClick={onRequestClose}>
            Close all
          </Button>
        </div>
      )}
    </div>
  )
}

// Portfolio rollup line at the top of the list - the numbers a trader watches while positions
// are running. Deliberately excludes pending orders' hypothetical risk (they haven't traded yet
// and might never fill), and counts open positions' risk against their remaining unprotected
// quantity too (a stop on 50 of 100 shares is only 50 shares of risk).
function PortfolioSummary({ orders, lastBar }) {
  const openOrders = orders.filter((o) => o.status === 'open')
  if (openOrders.length === 0) return null
  const unrealized = openOrders.reduce(
    (s, o) =>
      s +
      tradePnl({
        direction: o.direction,
        entry_price: o.entryPrice,
        exit_price: lastBar.close,
        quantity: o.quantity,
      }),
    0,
  )
  const totalRisk = openOrders.reduce(
    (s, o) =>
      s +
      (riskReward({ direction: o.direction, entryPrice: o.entryPrice, stopLosses: o.stopLosses }).risk ?? 0),
    0,
  )
  const totalExposure = openOrders.reduce((s, o) => s + o.entryPrice * o.quantity, 0)

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-2.5 py-1.5 text-xs">
      <span>
        <span className="text-muted-foreground">P&amp;L </span>
        <span className={`font-semibold tabular-nums ${unrealized >= 0 ? 'text-up' : 'text-down'}`}>
          {inr(unrealized)}
        </span>
      </span>
      <span>
        <span className="text-muted-foreground">Risk </span>
        <span className="tabular-nums text-down">{totalRisk > 0 ? inr(totalRisk) : '—'}</span>
      </span>
      <span className="ml-auto">
        <span className="text-muted-foreground">Exposure </span>
        <span className="tabular-nums">{inr(totalExposure)}</span>
      </span>
    </div>
  )
}

// Just the open/pending positions, rendered inside BottomBar's "Positions" popover. Market price
// and the Buy/Sell buttons live in the bar itself; this list only shows what's running plus its
// per-position actions.
export default function PositionsList({
  orders,
  lastBar,
  onRequestClose,
  onRequestPartialClose,
  onMoveToBreakeven,
  onCancelPending,
  onRemoveLevel,
}) {
  if (orders.length === 0) return <p className="text-sm text-muted-foreground">No open positions.</p>
  return (
    <div className="space-y-2">
      <PortfolioSummary orders={orders} lastBar={lastBar} />
      {orders.map((order) => (
        <OrderRow
          key={order.id}
          order={order}
          lastBar={lastBar}
          onRequestClose={() => onRequestClose(order)}
          onRequestPartialClose={onRequestPartialClose}
          onMoveToBreakeven={onMoveToBreakeven}
          onCancelPending={onCancelPending}
          onRemoveLevel={onRemoveLevel}
        />
      ))}
    </div>
  )
}

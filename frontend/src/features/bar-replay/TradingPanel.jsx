// import { TrendingDownIcon, TrendingUpIcon } from 'lucide-react' // Draw long/short tool - disabled for now
import { XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { inr } from '@/lib/format'
import { tradePnl } from '@/lib/manualTrades'

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

function OrderRow({ order, lastBar, onRequestClose, addLevelMode, onArmAddLevel, onRemoveLevel }) {
  const slLegs = legsFor(order, 'stopLoss')
  const targetLegs = legsFor(order, 'target')
  const canAdd = (kind) => legsFor(order, kind).reduce((s, l) => s + l.qty, 0) < order.quantity
  const isArmed = (kind) => addLevelMode?.orderId === order.id && addLevelMode.kind === kind

  if (order.status === 'pending') {
    return (
      <div className="space-y-1 rounded-lg border border-dashed p-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="capitalize">
            {order.direction} limit {order.quantity} @ {inr(order.entryPrice)}
          </span>
          <Badge variant="outline">Pending</Badge>
        </div>
        {(slLegs.length > 0 || targetLegs.length > 0) && (
          <p className="text-xs text-muted-foreground">
            {[
              ...slLegs.map((l) => `SL ${l.qty}@${inr(l.price)}`),
              ...targetLegs.map((l) => `T ${l.qty}@${inr(l.price)}`),
            ].join(' · ')}
          </p>
        )}
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
      <p className="text-xs text-muted-foreground">Drag a level's line on the chart to adjust it.</p>
      <div className="flex gap-2">
        {canAdd('stopLoss') && (
          <Button
            variant={isArmed('stopLoss') ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => onArmAddLevel(order.id, 'stopLoss')}
          >
            {isArmed('stopLoss') ? 'Click the chart…' : slLegs.length > 0 ? 'Add stop loss' : 'Set stop loss'}
          </Button>
        )}
        {canAdd('target') && (
          <Button
            variant={isArmed('target') ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => onArmAddLevel(order.id, 'target')}
          >
            {isArmed('target') ? 'Click the chart…' : targetLegs.length > 0 ? 'Add target' : 'Set target'}
          </Button>
        )}
      </div>
      <Button variant="destructive" size="sm" className="w-full" onClick={onRequestClose}>
        Close
      </Button>
    </div>
  )
}

export default function TradingPanel({
  orders,
  lastBar,
  onOpenTicket,
  onRequestClose,
  addLevelMode,
  onArmAddLevel,
  onRemoveLevel,
  // drawMode,
  // onToggleDraw,
}) {
  return (
    <div className="space-y-2">
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open positions.</p>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              lastBar={lastBar}
              onRequestClose={() => onRequestClose(order)}
              addLevelMode={addLevelMode}
              onArmAddLevel={onArmAddLevel}
              onRemoveLevel={onRemoveLevel}
            />
          ))}
        </div>
      )}
      <div className="space-y-2 border-t pt-2">
        <p className="text-sm font-medium">Market @ {lastBar ? inr(lastBar.close) : '—'}</p>
        {/* Draw long/short tool - disabled for now, kept for later.
        <div className="flex gap-2">
          <Button
            variant={drawMode === 'long' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            disabled={!lastBar}
            onClick={() => onToggleDraw('long')}
          >
            <TrendingUpIcon className="size-3.5" /> Draw long
          </Button>
          <Button
            variant={drawMode === 'short' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            disabled={!lastBar}
            onClick={() => onToggleDraw('short')}
          >
            <TrendingDownIcon className="size-3.5" /> Draw short
          </Button>
        </div>
        {drawMode && (
          <p className="text-xs text-muted-foreground">
            Drag on the chart to size the target/stop zone - Esc to cancel.
          </p>
        )}
        */}
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-up text-white hover:bg-up/90"
            disabled={!lastBar}
            onClick={() => onOpenTicket('long')}
          >
            Buy <span className="ml-1 text-xs opacity-70">B</span>
          </Button>
          <Button
            className="flex-1 bg-down text-white hover:bg-down/90"
            disabled={!lastBar}
            onClick={() => onOpenTicket('short')}
          >
            Sell <span className="ml-1 text-xs opacity-70">S</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

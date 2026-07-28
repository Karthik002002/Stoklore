// import { TrendingDownIcon, TrendingUpIcon } from 'lucide-react' // Draw long/short tool - disabled for now
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { inr } from '@/lib/format'
import { tradePnl } from '@/lib/manualTrades'

// A fresh SL/target starts this far from entry (in the safe direction) - close enough to see
// immediately on the chart, far enough that the very next bar isn't likely to already cross it.
const DEFAULT_LEVEL_OFFSET_PCT = 0.02

function OrderRow({ order, lastBar, onRequestClose, onAdjustOrder }) {
  if (order.status === 'pending') {
    return (
      <div className="space-y-1 rounded-lg border border-dashed p-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="capitalize">
            {order.direction} limit {order.quantity} @ {inr(order.entryPrice)}
          </span>
          <Badge variant="outline">Pending</Badge>
        </div>
        {(order.stopLoss != null || order.target != null) && (
          <p className="text-xs text-muted-foreground">
            {order.stopLoss != null ? `SL ${inr(order.stopLoss)}` : ''}
            {order.stopLoss != null && order.target != null ? ' · ' : ''}
            {order.target != null ? `Target ${inr(order.target)}` : ''}
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
      {(order.stopLoss != null || order.target != null) && (
        <p className="text-xs text-muted-foreground">
          {order.stopLoss != null ? `SL ${inr(order.stopLoss)}` : ''}
          {order.stopLoss != null && order.target != null ? ' · ' : ''}
          {order.target != null ? `Target ${inr(order.target)}` : ''}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Drag the SL/Target lines on the chart to adjust.</p>
      {(order.stopLoss == null || order.target == null) && (
        <div className="flex gap-2">
          {order.stopLoss == null && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                const sign = order.direction === 'long' ? -1 : 1
                onAdjustOrder(order.id, 'stopLoss', order.entryPrice * (1 + sign * DEFAULT_LEVEL_OFFSET_PCT))
              }}
            >
              Set stop loss
            </Button>
          )}
          {order.target == null && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                const sign = order.direction === 'long' ? 1 : -1
                onAdjustOrder(order.id, 'target', order.entryPrice * (1 + sign * DEFAULT_LEVEL_OFFSET_PCT))
              }}
            >
              Set target
            </Button>
          )}
        </div>
      )}
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
  onAdjustOrder,
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
              onAdjustOrder={onAdjustOrder}
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

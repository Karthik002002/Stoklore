import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { inr } from '@/lib/format'
import { tradePnl } from '@/lib/manualTrades'

function OrderRow({ order, lastBar, onRequestClose }) {
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
      <Button variant="destructive" size="sm" className="w-full" onClick={onRequestClose}>
        Close
      </Button>
    </div>
  )
}

export default function TradingPanel({ orders, lastBar, onOpenTicket, onRequestClose }) {
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
            />
          ))}
        </div>
      )}
      <div className="space-y-2 border-t pt-2">
        <p className="text-sm font-medium">Market @ {lastBar ? inr(lastBar.close) : '—'}</p>
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

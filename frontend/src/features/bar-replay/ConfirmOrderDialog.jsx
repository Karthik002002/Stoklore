import { AlertTriangleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { inr } from '@/lib/format'

// The last thing between a badly-sized position and the log. Shown for BOTH ways in - the Shift+B/S
// market shortcuts and the order ticket's own submit - because the shortcut is the one that used to
// take the trade before you could read anything.
//
// It appears only when something is actually wrong (see orderEngine.orderWarnings); a position
// inside your own rules is placed with no dialog at all, which is what keeps this one meaningful
// rather than a reflex to dismiss.
//
// Confirming is still allowed. Bar Replay records what you actually did, and every cap in this app
// is advisory - the point is that an oversized entry becomes a decision instead of an accident.
export default function ConfirmOrderDialog({ pending, onConfirm, onCancel }) {
  if (!pending) return null
  const { order, warnings } = pending
  const value = order.quantity * order.entryPrice
  const isLong = order.direction === 'long'

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 text-amber-500" />
            Check this position
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <span className={isLong ? 'font-semibold text-up' : 'font-semibold text-down'}>
              {isLong ? 'Buy' : 'Sell'}
            </span>{' '}
            {order.quantity} at {inr(order.entryPrice)} —{' '}
            <span className="font-semibold tabular-nums">{inr(value)}</span>
            {order.type === 'limit' && <span className="text-muted-foreground"> (limit, resting)</span>}
          </div>

          <ul className="space-y-1.5">
            {warnings.map((w) => (
              <li key={w} className="flex gap-2 text-sm text-amber-600 dark:text-amber-400">
                <span aria-hidden="true">•</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={onConfirm}>
              Place anyway
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

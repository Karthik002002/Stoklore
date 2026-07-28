// Pure order-matching logic for Bar Replay - no React/chart dependency, so it's unit-testable
// on its own (see orderEngine.test.js).

// A bar's [low, high] range "touching" a price is how both a resting limit order and a
// stop-loss/target get triggered - no intrabar tick data exists to know exactly when within the
// bar it happened, only that it did.
export const crosses = (bar, price) => price != null && bar.low <= price && bar.high >= price

// Called once per newly-revealed bar during replay. Pending limit orders that the bar's range
// touches become filled (status -> 'open') at their limit price. Open positions whose stop-loss
// or target the bar's range touches are queued for closing - NOT removed from `orders` yet,
// closing only actually happens once the close dialog is confirmed, so dismissing it without
// saving never silently loses a trade. If a bar touches both stop-loss and target (a wide bar),
// stop-loss wins - a conservative assumption since which happened first intrabar is unknowable.
export function processBarForOrders(orders, bar, barIndex) {
  let changed = false
  const nextOrders = orders.map((order) => {
    if (order.status === 'pending' && crosses(bar, order.entryPrice)) {
      changed = true
      return { ...order, status: 'open', entryBarIndex: barIndex }
    }
    return order
  })
  const triggeredCloses = []
  for (const order of nextOrders) {
    if (order.status !== 'open') continue
    const slHit = crosses(bar, order.stopLoss)
    const targetHit = !slHit && crosses(bar, order.target)
    if (slHit || targetHit) {
      triggeredCloses.push({
        order,
        exitPrice: slHit ? order.stopLoss : order.target,
        reason: slHit ? 'stop_loss' : 'target',
      })
    }
  }
  return { nextOrders, triggeredCloses, changed }
}

export const CLOSE_REASON_LABEL = {
  stop_loss: 'Auto-closed - stop loss hit',
  target: 'Auto-closed - target hit',
}

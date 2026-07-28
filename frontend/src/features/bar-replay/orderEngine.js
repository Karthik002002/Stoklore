// Pure order-matching logic for Bar Replay - no React/chart dependency, so it's unit-testable
// on its own (see orderEngine.test.js).

// A bar's [low, high] range "touching" a price is how a resting limit order gets triggered - no
// intrabar tick data exists to know exactly when within the bar it happened, only that it did.
export const crosses = (bar, price) => price != null && bar.low <= price && bar.high >= price

// A stop-loss/target can also get skipped straight over by a gap (an overnight/weekend move, or
// just a volatile bar) - the bar's whole range lands on the far side of the level without ever
// trading at it. `side` is which side of the level counts as "through": 'below' means the whole
// bar is under the level (bar.high < price), 'above' means the whole bar is over it
// (bar.low > price). Returns the fill price - the level itself if actually touched, or the bar's
// open (the first price that traded that bar) if it gapped clean past - or null if neither.
function levelHit(bar, price, side) {
  if (price == null) return null
  if (crosses(bar, price)) return price
  const gapped = side === 'below' ? bar.high < price : bar.low > price
  return gapped ? bar.open : null
}

// Called once per newly-revealed bar during replay. Pending limit orders that the bar's range
// touches become filled (status -> 'open') at their limit price. Open positions whose stop-loss
// or target the bar touches - or gaps straight through, see levelHit above - are queued for
// closing - NOT removed from `orders` yet, closing only actually happens once the close dialog
// is confirmed, so dismissing it without saving never silently loses a trade. If a bar hits both
// stop-loss and target (a wide bar, or a gap past both), stop-loss wins - a conservative
// assumption since which happened first intrabar is unknowable.
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
    const isLong = order.direction === 'long'
    const slExit = levelHit(bar, order.stopLoss, isLong ? 'below' : 'above')
    const targetExit = slExit == null ? levelHit(bar, order.target, isLong ? 'above' : 'below') : null
    if (slExit != null || targetExit != null) {
      triggeredCloses.push({
        order,
        exitPrice: slExit ?? targetExit,
        reason: slExit != null ? 'stop_loss' : 'target',
      })
    }
  }
  return { nextOrders, triggeredCloses, changed }
}

export const CLOSE_REASON_LABEL = {
  stop_loss: 'Auto-closed - stop loss hit',
  target: 'Auto-closed - target hit',
}

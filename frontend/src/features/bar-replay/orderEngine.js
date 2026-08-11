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

// Orders a position's legs (stop-loss OR target - both are ladders, see store.js) from nearest
// to farthest from entry, by plain distance - for a long, stop-loss legs sit below entry (so
// nearest = highest price) and target legs sit above it (so nearest = lowest price), and it's
// mirrored for a short; sorting by |price - entry| gets the right order for both without needing
// to special-case direction per side. Legs are checked in this order purely so triggeredCloses
// lists them nearest-first; each leg is still tested independently below, so a bar that only
// reaches partway through a ladder (e.g. touches a tight stop but never reaches a wider one) only
// triggers the ones it actually reached.
function orderLegsByProximity(legs, entryPrice) {
  return [...legs].sort((a, b) => Math.abs(a.price - entryPrice) - Math.abs(b.price - entryPrice))
}

// Called once per newly-revealed bar during replay. Pending limit orders that the bar's range
// touches become filled (status -> 'open') at their limit price. Open positions whose stop-loss
// or target leg(s) the bar touches - or gaps straight through, see levelHit above - are queued
// for closing via `triggeredCloses` - NOT removed from `orders` yet, closing only actually
// happens once the close dialog is confirmed, so dismissing it without saving never silently
// loses a trade (or, for one leg of a ladder, never silently shrinks the position).
//
// A position can carry several stop-loss legs AND several target legs (see store.js's
// `stopLosses`/`targets`), each covering part of the quantity - a "laddered" exit, e.g. take
// profit on half the position at a near target and let the rest run to a farther one, or exit
// half at a tight stop and the rest at a wider one. Each leg that's hit gets its OWN entry in
// `triggeredCloses` (carrying that leg's own price/qty) rather than one combined close for the
// whole order, since a partial hit only closes part of the position and leaves the rest open
// with whatever legs weren't reached. If any stop-loss leg is hit, target legs are not also
// checked for this order in the same bar - which happened first intrabar is unknowable, so
// stop-loss (even just one leg of it) conservatively wins, same as the single-stop-loss case
// always did.
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
    let slHit = false
    for (const leg of orderLegsByProximity(order.stopLosses ?? [], order.entryPrice)) {
      const exitPrice = levelHit(bar, leg.price, isLong ? 'below' : 'above')
      if (exitPrice != null) {
        slHit = true
        triggeredCloses.push({ order, exitPrice, reason: 'stop_loss', leg })
      }
    }
    if (slHit) continue
    for (const leg of orderLegsByProximity(order.targets ?? [], order.entryPrice)) {
      const exitPrice = levelHit(bar, leg.price, isLong ? 'above' : 'below')
      if (exitPrice != null) {
        triggeredCloses.push({ order, exitPrice, reason: 'target', leg })
      }
    }
  }
  return { nextOrders, triggeredCloses, changed }
}

// Blended risk and reward across every exit leg, in rupees, plus their ratio.
//
// Blended, not "the first stop vs the first target": both sides are ladders, and each leg only
// covers part of the position (see store.js). Weighting each leg by its own quantity is the only
// reading that survives a laddered exit - taking leg one alone would report the R:R of a trade
// the user isn't actually placing.
//
// Quantity left uncovered simply isn't counted, matching how an order with no stop at all has no
// risk figure to show rather than a fake zero. A leg on the wrong side of entry contributes 0
// instead of negative risk - the caller validates and blocks those separately, and a negative
// here would silently cancel out a good leg.
//
// Shared by the order ticket (before placing) and the on-chart pill (after), so the two can never
// quote different numbers for the same position.
export function riskReward({ direction, entryPrice, stopLosses, targets }) {
  const isLong = direction === 'long'
  const sum = (legs, forEachLeg) =>
    (legs ?? []).reduce((total, leg) => {
      if (leg?.price == null || leg?.qty == null) return total
      return total + Math.max(forEachLeg(leg.price), 0) * leg.qty
    }, 0)

  const risk = sum(stopLosses, (price) => (isLong ? entryPrice - price : price - entryPrice))
  const reward = sum(targets, (price) => (isLong ? price - entryPrice : entryPrice - price))
  return {
    risk: risk > 0 ? risk : null,
    reward: reward > 0 ? reward : null,
    rr: risk > 0 && reward > 0 ? reward / risk : null,
  }
}

export const CLOSE_REASON_LABEL = {
  stop_loss: 'Auto-closed - stop loss hit',
  target: 'Auto-closed - target hit',
}

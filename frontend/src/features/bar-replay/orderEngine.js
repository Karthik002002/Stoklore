// Pure order-matching logic for Bar Replay - no React/chart dependency, so it's unit-testable
// on its own (see orderEngine.test.js).

// Relative path (not the '@/' alias): this module is imported by node-run self-checks
// (orderEngine.test.js) which don't resolve Vite aliases.
import { computeAtr } from '../../lib/indicators.js'

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

// Which side (stop-loss vs target) intrabar direction says probably hit first when the same bar
// touches both. Green bar (close > open) drifted up: target likely reached before stop, so
// target wins for a long (mirrored for a short). Red bar: SL wins. A doji (close === open) falls
// back to the conservative "SL wins" so the trader isn't credited a target they can't prove hit.
function firstReasonHint(bar, direction) {
  if (bar.close > bar.open) return direction === 'long' ? 'target' : 'stop_loss'
  if (bar.close < bar.open) return direction === 'long' ? 'stop_loss' : 'target'
  return 'stop_loss'
}

// Every SL leg the bar hits, in the shape that goes into triggeredCloses. Split out from the
// main loop so the intrabar heuristic (SL-first vs target-first, see firstReasonHint) can pick
// which side is evaluated first without duplicating the leg-iteration logic.
function stopLossHits(order, bar) {
  const hits = []
  const isLong = order.direction === 'long'
  for (const leg of orderLegsByProximity(order.stopLosses ?? [], order.entryPrice)) {
    const exitPrice = levelHit(bar, leg.price, isLong ? 'below' : 'above')
    if (exitPrice != null) hits.push({ order, exitPrice, reason: 'stop_loss', leg })
  }
  return hits
}
function targetHits(order, bar) {
  const hits = []
  const isLong = order.direction === 'long'
  for (const leg of orderLegsByProximity(order.targets ?? [], order.entryPrice)) {
    const exitPrice = levelHit(bar, leg.price, isLong ? 'above' : 'below')
    if (exitPrice != null) hits.push({ order, exitPrice, reason: 'target', leg })
  }
  return hits
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
// with whatever legs weren't reached.
//
// When the same bar touches BOTH sides, `firstReasonHint` uses the bar's direction (close vs.
// open) as an intrabar hint: a clearly green bar most likely reached the target before the stop
// on a long, and vice versa. A doji falls back to the conservative "stop-loss wins" - never
// credit a target you can't prove hit.
//
// Freshly-filled limits (this bar is the fill bar) are NOT also checked for SL/target the same
// bar - a broker arms exits from the next bar, and pretending both a fill and an intrabar stop
// happened would be doubly speculative about ordering.
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
    if (order.entryBarIndex === barIndex) continue // freshly filled - exits arm next bar
    const sls = stopLossHits(order, bar)
    const targets = targetHits(order, bar)
    if (sls.length && targets.length) {
      // Both sides hit in one bar - pick which side actually gets logged by bar direction.
      // Whichever side wins collapses everything on the other to "didn't happen" - the trade is
      // out of the market from that side's leg onward.
      if (firstReasonHint(bar, order.direction) === 'target') triggeredCloses.push(...targets)
      else triggeredCloses.push(...sls)
    } else {
      triggeredCloses.push(...sls, ...targets)
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

// Resize one exit leg's quantity (the on-chart pill's editable qty). Both ladders slice up the
// SAME position, so the legs on one side can never sum past `order.quantity` - an edit that would
// over-cover is rejected whole rather than clamped, so the number that ends up on the pill is
// always the number the user actually typed. Pure: returns `{ order }` or `{ error }`.
export function setLegQty(order, kind, legId, qty) {
  const field = kind === 'stopLoss' ? 'stopLosses' : 'targets'
  const legs = order?.[field] ?? []
  if (!legs.some((l) => l.id === legId)) return { error: 'No such leg' }
  if (!Number.isInteger(qty) || qty < 1) return { error: 'Quantity must be a whole number, at least 1' }
  const total = legs.reduce((sum, l) => sum + (l.id === legId ? qty : l.qty), 0)
  if (total > order.quantity) return { error: `Total ${total} would exceed the position's ${order.quantity}` }
  return { order: { ...order, [field]: legs.map((l) => (l.id === legId ? { ...l, qty } : l)) } }
}

// Position-sizing back-solve: "risk N% of account to this stop → how many shares?" The rule
// most books teach, and the only one that keeps risk constant across instruments. Nearest SL
// leg (tightest stop = worst-case per-share loss) sets the divisor, so a ladder still gets a
// safe total qty; the user then splits it across legs however they like.
//
// Returns null (not 0) for any missing input, so callers can distinguish "not enough info to
// size" from "sized to zero shares". Rounds DOWN - a fractional share doesn't exist here.
export function sizeByRisk({ balance, riskPct, entryPrice, stopLosses, direction }) {
  if (!(balance > 0) || !(riskPct > 0) || !(entryPrice > 0)) return null
  const isLong = direction === 'long'
  const legPrices = (stopLosses ?? [])
    .map((l) => l?.price)
    .filter((p) => p != null && (isLong ? p < entryPrice : p > entryPrice))
  if (legPrices.length === 0) return null
  const nearest = isLong ? Math.max(...legPrices) : Math.min(...legPrices)
  const perShareRisk = Math.abs(entryPrice - nearest)
  if (!(perShareRisk > 0)) return null
  const cashRisk = balance * (riskPct / 100)
  return Math.max(1, Math.floor(cashRisk / perShareRisk))
}

// Move every stop-loss leg to breakeven (entry price) - the standard "risk-free" adjustment
// once a trade is comfortably in profit. Pure: returns a new order. No-op if the position has
// no stops at all (nothing to move); the caller can decide whether to seed one instead.
export function withStopsAtBreakeven(order) {
  if (!order?.stopLosses?.length) return order
  return {
    ...order,
    stopLosses: order.stopLosses.map((leg) => ({ ...leg, price: order.entryPrice })),
  }
}

// Trailing stop ratchet. Each order carries an optional `trailing: { atrPeriod, atrMult }` -
// on every bar we recompute a "chandelier" style trail (highest high since entry minus k*ATR
// for a long, mirrored for a short) and raise (never lower) each SL leg's price to it. Bars
// before the order's entryBarIndex are excluded from the highest-high scan so an old high
// doesn't pin the stop above entry the moment the order fills.
//
// ATR is the current bar's Wilder-smoothed ATR; the caller passes the visible bars slice up to
// and including the current bar, and this reads it once. Runs on every bar step, but only
// mutates when the ratchet actually moves - the caller's `changed` flag suppresses no-op writes.
export function trailStops(orders, bars) {
  if (!bars?.length) return { orders, changed: false }
  let changed = false
  const nextOrders = orders.map((order) => {
    const trail = order.trailing
    if (!trail || order.status !== 'open' || !(order.stopLosses?.length > 0)) return order
    const startIdx = order.entryBarIndex ?? 0
    const scanBars = bars.slice(startIdx)
    if (scanBars.length === 0) return order
    const atrSeries = computeAtr(bars, trail.atrPeriod ?? 14)
    const atr = atrSeries[atrSeries.length - 1]?.value
    if (!(atr > 0)) return order
    const isLong = order.direction === 'long'
    const extreme = isLong
      ? Math.max(...scanBars.map((b) => b.high))
      : Math.min(...scanBars.map((b) => b.low))
    const trailedPrice = isLong ? extreme - trail.atrMult * atr : extreme + trail.atrMult * atr
    const nextLegs = order.stopLosses.map((leg) => {
      const raised = isLong ? Math.max(leg.price, trailedPrice) : Math.min(leg.price, trailedPrice)
      if (raised === leg.price) return leg
      changed = true
      return { ...leg, price: Math.round(raised * 100) / 100 }
    })
    return changed ? { ...order, stopLosses: nextLegs } : order
  })
  return { orders: nextOrders, changed }
}

export const CLOSE_REASON_LABEL = {
  stop_loss: 'Auto-closed - stop loss hit',
  target: 'Auto-closed - target hit',
}

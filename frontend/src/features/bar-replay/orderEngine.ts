// Pure order-matching logic for Bar Replay - no React/chart dependency, so it's unit-testable
// on its own (see orderEngine.test.js).

// Relative path (not the '@/' alias): this module is imported by node-run self-checks
// (orderEngine.test.js) which don't resolve Vite aliases.
import { computeAtr } from '../../lib/indicators.ts'
import { capWarnings } from '../../lib/tradeAccounts.ts'
import type { Bar } from '../../lib/types.ts'
import type { TradeAccount } from '../../lib/types.ts'
import type { ChartSettings, ReplayLeg, ReplayOrder } from './store.ts'

/** What the matcher actually reads off a bar: the four prices, plus the date it stamps a fill
 *  with. Deliberately narrower than Bar - matching has no use for a chart timestamp, and asking
 *  for one would make every caller (and every test fixture) invent it. */
type MatchBar = Pick<Bar, 'open' | 'high' | 'low' | 'close'> & { date?: string }

/** A leg as the pure calculations see it: only the numbers they use, all optional - riskReward
 *  and sizeByRisk explicitly skip a half-filled leg rather than counting it as zero risk, and the
 *  sizing path reads the price alone. The id matters to the chart and the editors, not to
 *  arithmetic. */
type LegAmounts = { price?: number | null; qty?: number | null }

/** One exit that a bar triggered: which order, at what price, and which leg did it. */
export type TriggeredClose = {
  order: ReplayOrder
  exitPrice: number
  reason: 'stop_loss' | 'target'
  leg: ReplayLeg
}

// A bar's [low, high] range "touching" a price is how a resting limit order gets triggered - no
// intrabar tick data exists to know exactly when within the bar it happened, only that it did.
export const crosses = (bar: MatchBar, price: number | null | undefined) =>
  price != null && bar.low <= price && bar.high >= price

// A stop-loss/target can also get skipped straight over by a gap (an overnight/weekend move, or
// just a volatile bar) - the bar's whole range lands on the far side of the level without ever
// trading at it. `side` is which side of the level counts as "through": 'below' means the whole
// bar is under the level (bar.high < price), 'above' means the whole bar is over it
// (bar.low > price). Returns the fill price - the level itself if actually touched, or the bar's
// open (the first price that traded that bar) if it gapped clean past - or null if neither.
function levelHit(bar: MatchBar, price: number | null | undefined, side: 'below' | 'above') {
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
function orderLegsByProximity(legs: ReplayLeg[], entryPrice: number) {
  return [...legs].sort((a, b) => Math.abs(a.price - entryPrice) - Math.abs(b.price - entryPrice))
}

// Which side (stop-loss vs target) intrabar direction says probably hit first when the same bar
// touches both. Green bar (close > open) drifted up: target likely reached before stop, so
// target wins for a long (mirrored for a short). Red bar: SL wins. A doji (close === open) falls
// back to the conservative "SL wins" so the trader isn't credited a target they can't prove hit.
function firstReasonHint(bar: MatchBar, direction: 'long' | 'short') {
  if (bar.close > bar.open) return direction === 'long' ? 'target' : 'stop_loss'
  if (bar.close < bar.open) return direction === 'long' ? 'stop_loss' : 'target'
  return 'stop_loss'
}

// Every SL leg the bar hits, in the shape that goes into triggeredCloses. Split out from the
// main loop so the intrabar heuristic (SL-first vs target-first, see firstReasonHint) can pick
// which side is evaluated first without duplicating the leg-iteration logic.
function stopLossHits(order: ReplayOrder, bar: MatchBar): TriggeredClose[] {
  const hits = []
  const isLong = order.direction === 'long'
  for (const leg of orderLegsByProximity(order.stopLosses ?? [], order.entryPrice)) {
    const exitPrice = levelHit(bar, leg.price, isLong ? 'below' : 'above')
    if (exitPrice != null) hits.push({ order, exitPrice, reason: 'stop_loss' as const, leg })
  }
  return hits
}
function targetHits(order: ReplayOrder, bar: MatchBar): TriggeredClose[] {
  const hits = []
  const isLong = order.direction === 'long'
  for (const leg of orderLegsByProximity(order.targets ?? [], order.entryPrice)) {
    const exitPrice = levelHit(bar, leg.price, isLong ? 'above' : 'below')
    if (exitPrice != null) hits.push({ order, exitPrice, reason: 'target' as const, leg })
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
export function processBarForOrders(orders: ReplayOrder[], bar: MatchBar, barIndex: number) {
  let changed = false
  const nextOrders = orders.map((order) => {
    if (order.status === 'pending' && crosses(bar, order.entryPrice)) {
      changed = true
      // entryDate alongside entryBarIndex: the index is only valid against the exact bars array
      // it was filled on, and that array grows at the front when more history is collected. The
      // date is what the trade is journaled with, so it is captured here, at the fill.
      return { ...order, status: 'open' as const, entryBarIndex: barIndex, entryDate: bar.date }
    }
    return order
  })
  const triggeredCloses: TriggeredClose[] = []
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
export function riskReward({
  direction,
  entryPrice,
  stopLosses,
  targets,
}: Pick<ReplayOrder, 'direction' | 'entryPrice'> & {
  stopLosses?: LegAmounts[]
  targets?: LegAmounts[]
}) {
  const isLong = direction === 'long'
  const sum = (legs: LegAmounts[] | undefined, forEachLeg: (price: number) => number) =>
    (legs ?? []).reduce((total, leg) => {
      if (leg?.price == null || leg?.qty == null) return total
      return total + Math.max(forEachLeg(leg.price), 0) * leg.qty
    }, 0)

  const risk = sum(stopLosses, (price: number) => (isLong ? entryPrice - price : price - entryPrice))
  const reward = sum(targets, (price: number) => (isLong ? price - entryPrice : entryPrice - price))
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
export function setLegQty(
  order: ReplayOrder,
  kind: 'stopLoss' | 'target',
  legId: string,
  qty: number,
): { order?: ReplayOrder; error?: string } {
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
export function sizeByRisk({
  balance,
  riskPct,
  entryPrice,
  stopLosses,
  direction,
}: {
  balance: number | null | undefined
  riskPct: number
  entryPrice: number
  stopLosses?: LegAmounts[]
  direction: 'long' | 'short'
}) {
  if (!(balance != null && balance > 0) || !(riskPct > 0) || !(entryPrice > 0)) return null
  const isLong = direction === 'long'
  const legPrices = (stopLosses ?? [])
    .map((l) => l?.price)
    .filter((p): p is number => p != null && (isLong ? p < entryPrice : p > entryPrice))
  if (legPrices.length === 0) return null
  const nearest = isLong ? Math.max(...legPrices) : Math.min(...legPrices)
  const perShareRisk = Math.abs(entryPrice - nearest)
  if (!(perShareRisk > 0)) return null
  const cashRisk = balance * (riskPct / 100)
  return Math.max(1, Math.floor(cashRisk / perShareRisk))
}

// The quantity an order starts at, from the user's sizing preference (Settings > Preferences).
// Every place that opens a position - the order ticket, the one-key market shortcuts - asks this
// rather than reading settings.defaultQty itself, so changing the preference changes all of them.
//
// 'pctCapital' spends that % of the account's live balance at `price`, rounded DOWN: a fractional
// share doesn't exist, and rounding up would over-spend the budget the user set. Falls back to the
// fixed quantity whenever the percentage can't be turned into shares - no account selected (balance
// is null), an empty account, or no price yet - because refusing to size at all would just leave
// the field blank with no explanation.
export function preferredQuantity(
  { sizeMode, defaultQty, capitalPct }: Pick<ChartSettings, 'sizeMode' | 'defaultQty' | 'capitalPct'>,
  balance: number | null | undefined,
  price: number | null | undefined,
) {
  const fallback = Math.max(1, Math.floor(defaultQty) || 1)
  if (sizeMode !== 'pctCapital') return fallback
  if (!(balance != null && balance > 0) || !(price != null && price > 0) || !(capitalPct > 0)) return fallback
  return Math.max(1, Math.floor((balance * (capitalPct / 100)) / price))
}

// How far past the sizing preference's budget a position may land before it is worth stopping the
// user for. A share is indivisible: 10% of Rs 10,000 at Rs 1,100 a share can only be 11% or
// nothing, and confirming that is noise. Asking for 10% and getting 50% is not.
// ponytail: one flat tolerance, tune it if it nags.
export const OVERSIZE_TOLERANCE = 1.25

/** Advisory warnings about what a position actually COSTS, versus what was asked for.
 *
 *  preferredQuantity floors to whole shares and then floors at 1 - it has to, a position of 0.2
 *  shares does not exist. On a small account in an expensive stock that minimum is the entire
 *  sizing rule overridden in silence: 10% of Rs 10,000 at Rs 5,000 a share is 0.2 shares, becomes
 *  1, and fills at 50% of the account. The number was never wrong, it was just unreachable, and
 *  nothing said so.
 *
 *  Rupee amounts are rounded whole and formatted here rather than through lib/format's inr(), the
 *  same way capWarnings does - these strings are read as sentences, not as table cells.
 *  Advisory only: returns [] when there is nothing to say, and never blocks anything.
 */
export function sizeWarnings({
  quantity,
  price,
  balance,
  settings,
}: {
  quantity: number
  price: number
  balance: number | null | undefined
  settings?: Partial<ChartSettings> | null
}) {
  const out: string[] = []
  const value = quantity * price
  if (!(value > 0) || !(balance != null && balance > 0)) return out

  const pct = (value / balance) * 100
  if (value > balance) {
    out.push(
      `${quantity} x Rs ${Math.round(price)} costs Rs ${Math.round(value)} - more than the account's whole balance of Rs ${Math.round(balance)}.`,
    )
  }

  const { sizeMode, capitalPct } = settings ?? {}
  if (
    sizeMode === 'pctCapital' &&
    capitalPct != null &&
    capitalPct > 0 &&
    value > balance * (capitalPct / 100) * OVERSIZE_TOLERANCE
  ) {
    out.push(
      `This position is ${pct.toFixed(1)}% of the account - your sizing preference asks for ${capitalPct}%.` +
        (quantity === 1 ? ' One share already costs more than that budget, so no smaller size exists.' : ''),
    )
  }
  return out
}

/** Everything worth stopping for before a position is opened: what it costs against the sizing
 *  preference (above) and against the account's own caps (capWarnings, shared with the trade form
 *  so the journal and the replay judge a position by the same rules).
 *
 *  One function so the ticket's inline warning block and the confirmation gate can never disagree
 *  about what counts as a problem. Still advisory - Bar Replay records what you actually did. */
export function orderWarnings({
  quantity,
  price,
  balance,
  settings,
  account,
  openCount = 0,
}: {
  quantity: number
  price: number
  balance: number | null | undefined
  settings?: Partial<ChartSettings> | null
  account?: TradeAccount | null
  openCount?: number
}) {
  return [
    ...sizeWarnings({ quantity, price, balance, settings }),
    ...capWarnings(account, { positionValue: quantity * price, openCount, balance }),
  ]
}

// Move every stop-loss leg to breakeven (entry price) - the standard "risk-free" adjustment
// once a trade is comfortably in profit. Pure: returns a new order. No-op if the position has
// no stops at all (nothing to move); the caller can decide whether to seed one instead.
export function withStopsAtBreakeven(order: ReplayOrder) {
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
export function trailStops(orders: ReplayOrder[], bars: Bar[]) {
  if (!bars?.length) return { orders, changed: false }
  let changed = false
  const nextOrders = orders.map((order) => {
    const trail = order.trailing
    if (!trail || order.status !== 'open' || !order.stopLosses?.length) return order
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

export const CLOSE_REASON_LABEL: Record<string, string> = {
  stop_loss: 'Auto-closed - stop loss hit',
  target: 'Auto-closed - target hit',
}

// What a trade costs to get into and out of, and the net P&L that leaves.
//
// Costs live on the ACCOUNT (Settings > Trade accounts), never on the trade, and nothing derived
// from them is stored - the same rule P&L, R:R and return% already follow. Change a rate and every
// trade under that account re-prices, including last month's.
//
// Every component is charged PER SIDE, because that's how they're actually paid: you slip on the
// way in and again on the way out, and the broker bills both. An open trade has only been charged
// the entry side; the exit side lands when it closes.
//
// Pure and dependency-free (relative import only) so tradeCosts.selfcheck.mjs runs under plain
// `node`, same as tradeStats.js and tradeAccounts.js.
import { tradePnl } from './manualTrades.ts'
import type { Trade, TradeAccount } from './types.ts'

/** The cost fields of an account. An account row that predates them (or a plain object in a
 *  self-check) is missing all five, which reads as free trading rather than NaN. */
type CostRates = Partial<
  Pick<
    TradeAccount,
    'slippage_value' | 'slippage_type' | 'brokerage_flat' | 'brokerage_pct' | 'other_charges_pct'
  >
>

type Side = { slippage: number; brokerage: number; charges: number; total: number }

/** A trade, as far as pricing is concerned: what was paid, for how many, and what it closed at. */
type CostedTrade = Pick<Trade, 'entry_price' | 'quantity' | 'direction'> & Partial<Pick<Trade, 'exit_price'>>

export const SLIPPAGE_TYPES = {
  per_share: '₹ / share',
  bps: 'bps of fill',
}

// An account row missing the cost columns (created before they existed, or a plain object in a
// test) reads as free trading rather than NaN.
export const NO_COSTS: Required<CostRates> = {
  slippage_value: 0,
  slippage_type: 'per_share',
  brokerage_flat: 0,
  brokerage_pct: 0,
  other_charges_pct: 0,
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const round2 = (v: number) => Math.round(v * 100) / 100

/** Cost of one side (entry or exit) at `price` for `qty` shares. Returns the three components
 *  separately - the breakdown is what makes a cost figure arguable rather than magic. */
export function sideCost(account: CostRates | null | undefined, price: number, qty: number): Side {
  const a = { ...NO_COSTS, ...(account ?? {}) }
  const shares = num(qty)
  const turnover = num(price) * shares
  const slippage =
    a.slippage_type === 'bps' ? (turnover * num(a.slippage_value)) / 10000 : num(a.slippage_value) * shares
  const brokerage = num(a.brokerage_flat) + (turnover * num(a.brokerage_pct)) / 100
  const charges = (turnover * num(a.other_charges_pct)) / 100
  return { slippage, brokerage, charges, total: slippage + brokerage + charges }
}

/** Total cost of a trade: entry side always, exit side only once it's closed.
 *  Returns null when there's no account to price it against - "unknown", not "free". */
export function tradeCosts(trade: CostedTrade | null | undefined, account: CostRates | null | undefined) {
  if (!account || !trade) return null
  const entry = sideCost(account, trade.entry_price, trade.quantity)
  const exit = trade.exit_price == null ? null : sideCost(account, trade.exit_price, trade.quantity)
  const add = (key: keyof Side) => entry[key] + (exit?.[key] ?? 0)
  return {
    slippage: round2(add('slippage')),
    brokerage: round2(add('brokerage')),
    charges: round2(add('charges')),
    total: round2(add('total')),
    // Both sides charged, or only the entry - a half-priced cost on an open position is not the
    // same claim as a finished one, and the UI says so.
    roundTrip: exit != null,
  }
}

/** Gross P&L minus every cost of the round trip. Null while the trade is open (there is no
 *  realised P&L yet) or when no account prices it. */
export function tradeNetPnl(trade: CostedTrade, account: CostRates | null | undefined) {
  const gross = tradePnl(trade)
  if (gross == null) return null
  const costs = tradeCosts(trade, account)
  if (costs == null) return gross
  return round2(gross - costs.total)
}

/** Net return %, measured the same way tradeReturnPct measures gross: against the capital the
 *  position tied up (entry price x quantity), so it stays comparable across position sizes. */
export function tradeNetReturnPct(trade: CostedTrade, account: CostRates | null | undefined) {
  const net = tradeNetPnl(trade, account)
  const invested = num(trade?.entry_price) * num(trade?.quantity)
  if (net == null || !invested) return null
  return Math.round((net / invested) * 10000) / 100
}

/** Costs for a hypothetical round trip, for the "what will this cost me" preview in account
 *  settings and the order tickets - no trade needed, just a price and a size. */
export function roundTripCost(account: CostRates | null | undefined, price: number, qty: number) {
  const entry = sideCost(account, price, qty)
  const exit = sideCost(account, price, qty)
  return {
    slippage: round2(entry.slippage + exit.slippage),
    brokerage: round2(entry.brokerage + exit.brokerage),
    charges: round2(entry.charges + exit.charges),
    total: round2(entry.total + exit.total),
  }
}

/** True once an account charges anything at all - lets every caller skip the net column entirely
 *  rather than showing a column of numbers identical to the gross one next to it. */
export function accountHasCosts(account: CostRates | null | undefined) {
  if (!account) return false
  return (
    num(account.slippage_value) > 0 ||
    num(account.brokerage_flat) > 0 ||
    num(account.brokerage_pct) > 0 ||
    num(account.other_charges_pct) > 0
  )
}

/** Index accounts by id, so per-trade lookups don't scan the list for every row of a long table. */
export function accountsById<T extends { id: number }>(accounts: T[] | null | undefined) {
  return new Map((accounts ?? []).map((a) => [a.id, a]))
}

/** The account a trade belongs to, or null for an unassigned one (which therefore has no costs -
 *  there is no rate card to price it with). */
export function accountFor<T>(
  trade: Pick<Trade, 'account_id'> | null | undefined,
  byId: Map<number, T> | null | undefined,
) {
  return trade?.account_id == null ? null : (byId?.get(trade.account_id) ?? null)
}

// Trade-account helpers: wallet balance, and the two advisory position caps.
//
// Pure and dependency-free (relative import only) so tradeAccounts.selfcheck.mjs runs it under
// plain `node`, same as tradeStats.js.
import { tradePnl } from './manualTrades.js'
import { tradeNetPnl } from './tradeCosts.js'

export const tradesForAccount = (trades, accountId) =>
  accountId == null ? (trades ?? []) : (trades ?? []).filter((t) => t.account_id === accountId)

/** Live wallet balance: opening balance + deposits/withdrawals + realized P&L of closed trades.
 *  The server computes this same figure once per trade (db.account_balance_at) and freezes it onto
 *  the row as account_balance_at_trade - this one is the running "where is it now" number.
 *
 *  Realized P&L here is NET of the account's trading costs. A balance is the money actually in the
 *  wallet, and slippage/brokerage/charges left it - showing gross here would be the one number in
 *  the app that's wrong on purpose. (Every other surface shows gross and net side by side; a
 *  balance has no room for two answers.) An account with no costs configured is unaffected. */
export function accountBalance(account, trades, adjustments) {
  if (!account) return null
  const realized = (trades ?? []).reduce((sum, t) => sum + (tradeNetPnl(t, account) ?? 0), 0)
  const moved = (adjustments ?? []).reduce((sum, a) => sum + (a.type === 'add' ? a.amount : -a.amount), 0)
  return Math.round((account.opening_balance + moved + realized) * 100) / 100
}

/** The max position size resolved to rupees. A 'percentage' cap is meaningless without a balance
 *  to take a percentage of, so it returns null rather than 0 when the balance isn't known yet. */
export function positionSizeCap(account, balance) {
  if (!account?.max_position_size) return null
  if (account.max_position_size_type !== 'percentage') return account.max_position_size
  if (balance == null) return null
  return Math.round(balance * (account.max_position_size / 100) * 100) / 100
}

/** Return% measured against the account's wallet at the time of the trade, rather than against the
 *  position's own cost - "what did this trade do to the account" instead of "to the position".
 *  Null unless the trade is closed and carries a snapshot (i.e. it was logged under an account). */
export function accountReturnPct(t) {
  const pnl = tradePnl(t)
  if (pnl == null || !t.account_balance_at_trade) return null
  return Math.round((pnl / t.account_balance_at_trade) * 10000) / 100
}

/** Advisory only - the journal records what actually happened, so a breach is a warning on the
 *  form, never a rejected trade. `openCount` is how many positions are already open on the account.
 *  Returns [] when the account sets no caps. */
export function capWarnings(account, { positionValue, openCount, balance }) {
  if (!account) return []
  const warnings = []
  const cap = positionSizeCap(account, balance)
  if (cap != null && positionValue > cap) {
    const how =
      account.max_position_size_type === 'percentage'
        ? `${account.max_position_size}% of ₹${balance}`
        : 'the account limit'
    warnings.push(`Position size ₹${Math.round(positionValue)} is over ${how} (₹${Math.round(cap)}).`)
  }
  if (account.max_position_count != null && openCount >= account.max_position_count) {
    warnings.push(
      `${openCount} position${openCount === 1 ? '' : 's'} already open - the account's limit is ${account.max_position_count}.`,
    )
  }
  return warnings
}

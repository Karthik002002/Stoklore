// What a real position costs, as a share of the wallet - and what is worth saying about it before
// the order goes.
//
// The same job orderEngine's sizeWarnings does for Bar Replay, against a different set of numbers:
// there the account is this app's own ledger and the sizing preference is a chart setting, here
// the balance is Dhan's and the caps are the live-trading settings. Split out rather than shared
// because the two have no field in common beyond quantity x price.
//
// Advisory only. The backend's guardrails (app/core/dhan_orders.py's `guardrail_errors`) are what
// actually refuse an order; this is the echo of them on screen while the size is still being
// typed, so a refusal is never the first time the user hears about it. Where the two overlap - the
// per-order rupee cap - the wording is deliberately the same.
//
// Pure, no React: `node frontend/src/lib/liveSizing.selfcheck.ts`.

export type LiveCaps = {
  /** Rupees. A position worth more than this is refused by the backend. */
  max_order_value?: number | null
  /** Percent of the wallet. Advisory: it warns, it never blocks. */
  max_position_pct?: number | null
}

export type SizeReading = {
  /** quantity x price, or null when either is missing. */
  value: number | null
  /** Share of the wallet this position would take, or null with no balance to measure against. */
  pctOfWallet: number | null
  /** Human-readable, worst first. Empty when there is nothing to say. */
  warnings: string[]
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/**
 * @param quantity shares
 * @param price    the limit price, or the last traded price for a market order
 * @param balance  deployable cash from the broker; null when it isn't known yet
 */
export function positionSize(
  quantity: number,
  price: number | null | undefined,
  balance: number | null | undefined,
  caps: LiveCaps = {},
): SizeReading {
  const value = quantity > 0 && price ? quantity * price : null
  // Only measure against a real balance. Zero would divide into an infinite percentage, and a
  // missing one is "not known yet", not "empty account".
  const pctOfWallet = value != null && balance != null && balance > 0 ? (value / balance) * 100 : null
  const warnings: string[] = []
  if (value == null) return { value, pctOfWallet, warnings }

  // Worst first: an order the account cannot pay for is a different class of problem from one that
  // is merely large.
  if (balance != null && balance > 0 && value > balance) {
    warnings.push(
      `${quantity} × ${rupees(price as number)} costs ${rupees(value)} — more than the ${rupees(balance)} available.`,
    )
  }

  const cap = caps.max_order_value
  if (cap && value > cap) {
    // Same sentence the backend refuses with, so the warning and the refusal read as one thing.
    warnings.push(`${rupees(value)} is over the ${rupees(cap)} per-order cap.`)
  }

  const pctCap = caps.max_position_pct
  if (pctCap && pctOfWallet != null && pctOfWallet > pctCap) {
    warnings.push(`${pctOfWallet.toFixed(1)}% of the wallet in one position — your limit is ${pctCap}%.`)
  }
  return { value, pctOfWallet, warnings }
}

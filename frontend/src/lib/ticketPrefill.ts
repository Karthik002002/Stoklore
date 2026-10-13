import { create } from 'zustand'

// A chart asking the order ticket beside it to get an order ready: right-click → "Buy limit here"
// fills the ticket's side, type and price, and the ticket puts the cursor in Quantity. The chart
// never sends an order itself - the size is the trader's to type, and a live order still goes
// through its confirmation.

export type TicketPrefill = {
  symbol: string
  direction: 'long' | 'short'
  /** Limit price; null = a market order. */
  price: number | null
  /** Bumped per request, so asking for the same order twice still re-applies it. */
  at: number
}

/** A price on the NSE cash tick (₹0.05), as the string an input holds. */
export const toTick = (price: number) => (Math.round(price * 20) / 20).toFixed(2)

export const useTicketPrefill = create<{ prefill: TicketPrefill | null }>(() => ({ prefill: null }))

export const prefillTicket = (p: Omit<TicketPrefill, 'at'>) =>
  useTicketPrefill.setState({ prefill: { ...p, at: Date.now() } })

/** Called by the ticket that applied it, so a ticket mounted later never replays an old request. */
export const consumePrefill = () => useTicketPrefill.setState({ prefill: null })

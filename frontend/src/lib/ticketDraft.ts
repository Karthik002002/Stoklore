import { create } from 'zustand'

// The order being typed into a ticket, mirrored onto the chart beside it - and edits made on that
// chart sent back. The ticket owns the order: it publishes what it holds (`publishDraft`), the chart
// draws it as a not-yet-placed order and turns a drag or a right-click into an `editDraft` request,
// and the ticket applies the request to its own fields. Nothing is placed from the chart; the
// ticket's button (and a live order's confirmation) still decides.

export type DraftLeg = { id: string; price: number }
export type TicketDraft = {
  symbol: string
  direction: 'long' | 'short'
  /** The limit price, or the last price for a market order. */
  entry: number
  limit: boolean
  quantity: number
  stops: DraftLeg[]
  targets: DraftLeg[]
}
export type DraftEdit =
  | { kind: 'entry'; price: number }
  | { kind: 'leg'; side: 'stop' | 'target'; id: string; price: number }
  | { kind: 'addLeg'; side: 'stop' | 'target'; price: number }
  | { kind: 'removeLeg'; side: 'stop' | 'target'; id: string }
  | { kind: 'legQty'; side: 'stop' | 'target'; id: string; qty: number }
  | { kind: 'clear' }

/** The id the chart gives a draft, so its handlers can tell it from a real position. */
export const DRAFT_ID = '__draft__'

export const useTicketDraft = create<{
  draft: TicketDraft | null
  edit: (DraftEdit & { at: number }) | null
}>(() => ({ draft: null, edit: null }))

export const publishDraft = (draft: TicketDraft | null) => useTicketDraft.setState({ draft })
export const editDraft = (edit: DraftEdit) => useTicketDraft.setState({ edit: { ...edit, at: Date.now() } })
export const consumeEdit = () => useTicketDraft.setState({ edit: null })

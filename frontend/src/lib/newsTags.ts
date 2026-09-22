// Laya classifier tags on a news row (app/core/classifier.py tag_news). Null until the background
// tagger reaches the row, or always when the classifier is off in Settings.
export type NewsTags = {
  event: string
  event_confidence: number
  /** Expected point on none(0) / minor / moderate / major(3). */
  materiality: number
  /** Probability the story could move the share price significantly. */
  price_sensitive: number
}

export const EVENT_LABEL: Record<string, string> = {
  earnings: 'Earnings',
  order_win: 'Order win',
  corporate_action: 'Corporate action',
  deal: 'Deal',
  management: 'Management',
  regulatory: 'Regulatory',
  operations: 'Operations',
  rating: 'Rating',
  market: 'Market',
  other: 'Other',
}

const MATERIALITY_LABEL = ['Routine', 'Minor', 'Moderate', 'Major']

export const materialityLabel = (tags: NewsTags) =>
  MATERIALITY_LABEL[Math.min(3, Math.max(0, Math.round(tags.materiality)))]

/** The "worth reading" filter: rated moderate or major, or likely to move the price. */
export const isMaterial = (tags: NewsTags | null | undefined) =>
  !!tags && (tags.materiality >= 2 || tags.price_sensitive >= 0.5)

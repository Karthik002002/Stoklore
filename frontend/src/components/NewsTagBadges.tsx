import { Badge } from '@/components/ui/badge'
import { EVENT_LABEL, isMaterial, materialityLabel, type NewsTags } from '@/lib/newsTags'

/** The event type, plus a "material" marker when the story is rated moderate/major or likely to
 *  move the price. Exact numbers on hover - they're calibrated probabilities, worth seeing. */
export default function NewsTagBadges({ tags }: { tags: NewsTags | null | undefined }) {
  if (!tags) return null
  const title =
    `Laya: ${EVENT_LABEL[tags.event] ?? tags.event} (${Math.round(tags.event_confidence * 100)}% confident) · ` +
    `materiality ${tags.materiality.toFixed(1)}/3 (${materialityLabel(tags).toLowerCase()}) · ` +
    `could move the price: ${Math.round(tags.price_sensitive * 100)}%`
  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={title}>
      <Badge variant="outline" className="font-normal">
        {EVENT_LABEL[tags.event] ?? tags.event}
      </Badge>
      {isMaterial(tags) && (
        <Badge variant="secondary" className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
          {materialityLabel(tags)}
        </Badge>
      )}
    </span>
  )
}

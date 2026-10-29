import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Delivery %: the latest day, toned against the stock's own 20-day average - well above it is
 *  holders buying, well below a day of churn. Hover for the average. */
export default function DelivCell({ pct, avg }: { pct: number | null; avg: number | null }) {
  const diff = pct != null && avg != null ? pct - avg : null
  return (
    <td
      className={cn(
        'px-2 py-1 text-right tabular-nums',
        diff != null && (diff >= 15 ? 'text-up' : diff <= -15 ? 'text-down' : ''),
      )}
      title={avg == null ? 'Delivery % today' : `Delivery % today vs its 20-day average of ${fmt(avg, 1)}%`}
    >
      {pct == null ? '—' : fmt(pct, 0)}
    </td>
  )
}

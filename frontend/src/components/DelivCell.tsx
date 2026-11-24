import { Delivery } from '@/design-system'

/** Delivery % as a table cell: the latest day, toned against the stock's own 20-day average (well
 *  above it is holders buying, well below a day of churn). The value is the design system's
 *  Delivery; this only puts it in a <td> for the hand-written screener tables. */
export default function DelivCell({ pct, avg }: { pct: number | null; avg: number | null }) {
  return (
    <td className="px-2 py-1 text-right">
      <Delivery pct={pct} avg={avg} />
    </td>
  )
}

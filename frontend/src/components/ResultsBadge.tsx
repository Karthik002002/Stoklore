import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { daysUntil, nextResults } from '@/lib/bookRisk'
import { ResultsBadge as DsResultsBadge } from '@/design-system'
import { getResultsCalendar } from '@/services/api'

/** Each symbol's next results date from NSE's board-meeting calendar (two weeks or so ahead). */
export function useNextResults() {
  const { data } = useQuery({
    queryKey: ['resultsCalendar'],
    queryFn: getResultsCalendar,
    staleTime: 3_600_000,
  })
  return useMemo(() => nextResults(data?.results ?? []), [data])
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

/** "Results in 3d" beside a position: holding a swing trade through results is a gap you can't stop
 *  out of. Amber within a week, red within two days, nothing when none is scheduled. The look is
 *  the design system's ResultsBadge; this wrapper only finds the date. */
export default function ResultsBadge({ symbol, className }: { symbol: string; className?: string }) {
  const date = useNextResults().get(symbol)
  if (!date) return null
  return (
    <DsResultsBadge
      days={daysUntil(date)}
      className={className}
      title={`Results board meeting on ${fmtDay(date)} - a position held through it can gap past its stop`}
    />
  )
}

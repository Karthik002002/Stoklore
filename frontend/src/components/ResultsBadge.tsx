import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClockIcon } from 'lucide-react'
import { daysUntil, nextResults } from '@/lib/bookRisk'
import { cn } from '@/lib/utils'
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
 *  out of. Amber within a week, red within two days, nothing when none is scheduled. */
export default function ResultsBadge({ symbol, className }: { symbol: string; className?: string }) {
  const date = useNextResults().get(symbol)
  if (!date) return null
  const days = daysUntil(date)
  if (days > 14) return null
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`
  return (
    <span
      title={`Results board meeting on ${fmtDay(date)} - a position held through it can gap past its stop`}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap',
        days <= 2
          ? 'border-down/50 bg-down/10 text-down'
          : days <= 7
            ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400'
            : 'text-muted-foreground',
        className,
      )}
    >
      <CalendarClockIcon className="size-3" />
      Results {when}
    </span>
  )
}

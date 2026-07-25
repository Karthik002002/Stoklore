import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangleIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getActivitySummary } from '@/services/api'

const MILESTONES = [7, 30, 100]

function tierMessage(daysMissed, bestStreak) {
  if (daysMissed <= 0) return null
  if (daysMissed === 1) {
    return {
      tone: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
      text: `You skipped yesterday. Log a trade, run an analysis, or review your watchlist today - your best streak so far is ${bestStreak} day${bestStreak === 1 ? '' : 's'}.`,
    }
  }
  if (daysMissed === 2) {
    return {
      tone: 'border-orange-500/50 bg-orange-500/10 text-orange-800 dark:text-orange-300',
      text: "Two days missed in a row. Whatever streak you had is already gone - the longer this goes, the more you're giving up.",
    }
  }
  return {
    tone: 'border-destructive/50 bg-destructive/10 text-destructive',
    text: `${daysMissed} days missed in a row. You said you wanted consistency - this isn't it. Do something today, right now.`,
  }
}

// Global, always-mounted (App.jsx) - never blocks the app, just escalates in tone the longer a
// gap runs. Dismissal is per page-load only (no persistence), consistent with "banners only,
// never blocks": annoying enough to notice, never enough to get in the way.
export default function GuiltBanner() {
  const { data: summary } = useQuery({
    queryKey: ['activitySummary'],
    queryFn: getActivitySummary,
    staleTime: 60_000,
  })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!summary) return
    const lastCelebrated = Number(localStorage.getItem('lastCelebratedStreak') ?? 0)
    const hit = MILESTONES.filter((m) => summary.current_streak >= m && lastCelebrated < m).pop()
    if (hit) {
      toast.success(`${hit}-day streak`, { description: 'Consistency is compounding - keep it up.' })
      localStorage.setItem('lastCelebratedStreak', String(hit))
    }
  }, [summary])

  if (!summary || dismissed) return null
  const tier = tierMessage(summary.days_missed_in_a_row, summary.best_streak)
  if (!tier) return null

  return (
    <div
      className={`mb-6 flex items-start gap-2.5 rounded-xl  border px-4 py-2.5 text-sm ${tier.tone}`}
      style={{ alignItems: 'center' }}
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1">{tier.text}</p>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss"
        className="shrink-0 hover:bg-transparent"
        onClick={() => setDismissed(true)}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  )
}

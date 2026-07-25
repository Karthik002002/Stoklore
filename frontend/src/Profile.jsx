import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserRoundIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import UsageCommitGraph from '@/components/UsageCommitGraph'
import { formatDuration } from '@/lib/format'
import { getActivitySummary } from '@/services/api'

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      {sub}
    </div>
  )
}

// Profile is a single instance mounted once in App - same "dispatch a window event, distant
// component reacts" pattern ChatWidget's tagInChat uses, so anything (the command palette) can
// open it without threading a callback down through App's whole tree.
const OPEN_EVENT = 'profile:open'

export function openProfile() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

// Self-contained trigger + dialog, same pattern as Settings.jsx - mounted directly in App.jsx's
// icon stack. The trigger carries its own "days behind" badge so the debt is visible without
// opening anything, reading the same shared ['activitySummary'] query GuiltBanner uses.
export default function Profile() {
  const { data: summary } = useQuery({ queryKey: ['activitySummary'], queryFn: getActivitySummary })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  const daysBehind = summary?.days_missed_in_a_row ?? 0
  const goalSeconds = (summary?.daily_goal_minutes ?? 15) * 60
  const todaySeconds = summary?.avg_seconds_today ?? 0
  const goalPct = goalSeconds > 0 ? Math.min(100, Math.round((todaySeconds / goalSeconds) * 100)) : 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Profile" className="relative" />}
      >
        <UserRoundIcon className="size-4" />
        {daysBehind > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-medium text-destructive-foreground">
            {daysBehind > 9 ? '9+' : daysBehind}
          </span>
        )}
      </DialogTrigger>
      <DialogContent className="flex h-[80%] w-[70%] !max-w-[70%] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Profile</DialogTitle>
          <DialogDescription>
            Your consistency and usage over time - tracked locally, never shared.
          </DialogDescription>
        </DialogHeader>
        {!summary ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Current streak" value={`${summary.current_streak}d`} />
              <StatCard label="Best streak" value={`${summary.best_streak}d`} />
              <StatCard
                label={`Today (goal ${summary.daily_goal_minutes}m)`}
                value={formatDuration(summary.avg_seconds_today)}
                sub={
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${goalPct}%` }} />
                  </div>
                }
              />
              <StatCard label="7-day average / day" value={formatDuration(summary.avg_seconds_7d)} />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Today</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant={summary.today_breakdown.traded ? 'success' : 'outline'}>Traded</Badge>
                <Badge variant={summary.today_breakdown.analyzed ? 'success' : 'outline'}>Analyzed</Badge>
                <Badge variant={summary.today_breakdown.reviewed ? 'success' : 'outline'}>Reviewed</Badge>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Usage over the last year</p>
              <UsageCommitGraph days={summary.days} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

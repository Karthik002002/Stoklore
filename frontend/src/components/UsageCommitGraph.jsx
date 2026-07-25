import { formatDate, formatDuration } from '@/lib/format'

// Fixed intensity buckets by seconds spent that day - same idea as GitHub's contribution graph,
// just keyed to time-on-app instead of commit count.
function intensityClass(seconds) {
  if (seconds <= 0) return 'bg-muted/40'
  if (seconds < 900) return 'bg-success/25' // <15m
  if (seconds < 1800) return 'bg-success/45' // 15-30m
  if (seconds < 3600) return 'bg-success/70' // 30-60m
  return 'bg-success' // 60m+
}

// GitHub-style weeks-x-days grid: `days` is the ascending {date, seconds_active} list from
// GET /api/activity/summary. Columns are calendar weeks (Sun-Sat), padded so the first real day
// lands in its correct weekday row - same hand-rolled-grid technique as ManualOverview's month
// calendar, just a different shape.
export default function UsageCommitGraph({ days }) {
  if (days.length === 0) return null

  const startWeekday = new Date(days[0].date).getDay()
  const padded = [...Array(startWeekday).fill(null), ...days]
  const weeks = []
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7))

  return (
    <div className="space-y-2">
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {weeks.map((week, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {week.map((day, j) =>
              day ? (
                <div
                  key={day.date}
                  title={`${formatDate(day.date)} — ${formatDuration(day.seconds_active)}`}
                  className={`size-2.5 rounded-[2px] ${intensityClass(day.seconds_active)}`}
                />
              ) : (
                <div key={j} className="size-2.5" />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Less
        <span className="size-2.5 rounded-[2px] bg-muted/40" />
        <span className="size-2.5 rounded-[2px] bg-success/25" />
        <span className="size-2.5 rounded-[2px] bg-success/45" />
        <span className="size-2.5 rounded-[2px] bg-success/70" />
        <span className="size-2.5 rounded-[2px] bg-success" />
        More
      </div>
    </div>
  )
}

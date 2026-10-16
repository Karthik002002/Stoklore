import { cn } from '@/lib/utils'

/** RS as a coloured pill: 80+ green, 50-79 neutral, under 50 red. */
export default function RsPill({ rs }: { rs: number | null | undefined }) {
  if (rs == null) return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={cn(
        'inline-block min-w-7 rounded px-1 text-center font-semibold tabular-nums',
        rs >= 80 ? 'bg-up/15 text-up' : rs >= 50 ? 'bg-muted text-foreground' : 'bg-down/10 text-down',
      )}
      title="RS rating: the share of NSE stocks this one's 3/6/9/12-month performance beats (latest quarter weighted double)"
    >
      {rs}
    </span>
  )
}

import { useEffect, useId, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { IconCalendarEvent, IconShieldExclamation } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Progress } from './display'

// Market display pieces. All presentational: data comes in as props, so the app's own hooks
// (useSurveillance, useNextResults, quotes) stay in the app and these stay storybook-able.

const INR = (v: number, d = 2) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '')
const toneOf = (v: number | null | undefined) =>
  v == null || v === 0 ? 'text-muted-foreground' : v > 0 ? 'text-up' : 'text-down'

/** A signed change: "+3.40%" / "−₹1,250". `pill` tints the background. Zero / null stay muted. */
function Change({
  value,
  unit = '%',
  digits = 2,
  variant = 'text',
  className,
}: {
  value: number | null | undefined
  unit?: '%' | '₹' | 'R' | ''
  digits?: number
  variant?: 'text' | 'pill'
  className?: string
}) {
  if (value == null) return <span className={cn('tabular text-muted-foreground', className)}>—</span>
  const body =
    unit === '₹'
      ? `${sign(value)}₹${INR(Math.abs(value), digits)}`
      : `${sign(value)}${INR(Math.abs(value), digits)}${unit}`
  return (
    <span
      data-slot="change"
      className={cn(
        'tabular whitespace-nowrap',
        toneOf(value),
        variant === 'pill' && 'inline-block rounded-xs px-1',
        variant === 'pill' && (value > 0 ? 'bg-up-subtle' : value < 0 ? 'bg-down-subtle' : 'bg-muted'),
        className,
      )}
    >
      {body}
    </span>
  )
}

/** Last price that flashes green/red for a moment when it ticks up/down. */
function TickPrice({
  value,
  digits = 2,
  className,
}: {
  value: number | null | undefined
  digits?: number
  className?: string
}) {
  const prev = useRef(value)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  useEffect(() => {
    if (value != null && prev.current != null && value !== prev.current) {
      setFlash(value > prev.current ? 'up' : 'down')
      const id = setTimeout(() => setFlash(null), 600)
      prev.current = value
      return () => clearTimeout(id)
    }
    prev.current = value
  }, [value])
  return (
    <span
      data-slot="tick-price"
      className={cn(
        'tabular rounded-xs px-0.5 transition-colors duration-500',
        flash === 'up' && 'bg-up-subtle text-up duration-0',
        flash === 'down' && 'bg-down-subtle text-down duration-0',
        className,
      )}
    >
      {value == null ? '—' : INR(value, digits)}
    </span>
  )
}

/** "986.25 +32.45 (+3.40%)" - the quote line of a header. */
function Quote({
  ltp,
  change,
  pct,
  size = 'default',
  className,
}: {
  ltp: number
  change: number
  pct: number
  size?: 'default' | 'lg'
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-baseline gap-2', className)}>
      <TickPrice value={ltp} className={size === 'lg' ? 'text-xl' : 'text-[13px]'} />
      <span className={cn('tabular', toneOf(change))}>
        {sign(change)}
        {INR(Math.abs(change))} ({sign(pct)}
        {Math.abs(pct).toFixed(2)}%)
      </span>
    </span>
  )
}

/** Same API as components/RsPill.tsx: 80+ green, 50-79 neutral, under 50 red. */
function RsPill({ rs, className }: { rs: number | null | undefined; className?: string }) {
  if (rs == null) return <span className="text-muted-foreground">—</span>
  return (
    <span
      title="RS rating: the share of NSE stocks this one's 3/6/9/12-month performance beats (latest quarter weighted double)"
      className={cn(
        'tabular inline-block min-w-6.5 rounded-xs px-1 text-center font-semibold',
        rs >= 80
          ? 'bg-up-subtle text-up'
          : rs >= 50
            ? 'bg-muted text-foreground'
            : 'bg-down-subtle text-down',
        className,
      )}
    >
      {rs}
    </span>
  )
}

/** Delivery % (same rule as components/DelivCell.tsx: toned when 15+ points off its 20-day
 *  average), with an optional bar. A span, not a <td>, so it fits any layout. */
function Delivery({
  pct,
  avg,
  bar = false,
  className,
}: {
  pct: number | null
  avg?: number | null
  bar?: boolean
  className?: string
}) {
  const diff = pct != null && avg != null ? pct - avg : null
  const tone = diff != null && (diff >= 15 ? 'text-up' : diff <= -15 ? 'text-down' : '')
  return (
    <span
      className={cn('inline-flex items-center justify-end gap-1.5', className)}
      title={
        avg == null ? 'Delivery % today' : `Delivery % today vs its 20-day average of ${avg.toFixed(1)}%`
      }
    >
      {bar && pct != null && (
        <span className="relative h-0.75 w-10 bg-muted">
          <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
          {avg != null && (
            <span
              className="absolute -inset-y-0.5 w-px bg-muted-foreground"
              style={{ left: `${Math.min(100, avg)}%` }}
            />
          )}
        </span>
      )}
      <span className={cn('tabular', tone)}>{pct == null ? '—' : `${pct.toFixed(0)}%`}</span>
    </span>
  )
}

/** "Results in 3d": amber within a week, red within two days, nothing past two weeks. The app
 *  wrapper passes `days` from useNextResults. */
function ResultsBadge({
  days,
  title,
  className,
}: {
  days: number | null | undefined
  title?: string
  className?: string
}) {
  if (days == null || days > 14 || days < 0) return null
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`
  return (
    <span
      className={cn(
        'inline-flex h-4.5 items-center gap-1 rounded-xs px-1.5 text-[10.5px] font-medium whitespace-nowrap',
        days <= 2
          ? 'bg-down-subtle text-down'
          : days <= 7
            ? 'bg-warning-subtle text-warning'
            : 'bg-muted text-muted-foreground',
        className,
      )}
      title={title ?? "Holding through results is a gap you can't stop out of"}
    >
      <IconCalendarEvent className="size-3" />
      Results {when}
    </span>
  )
}

/** "ST-ASM Stage II": NSE surveillance. The app wrapper passes label/details from useSurveillance. */
function SurveillanceBadge({
  label,
  details,
  className,
}: {
  label: string | null | undefined
  details?: string
  className?: string
}) {
  if (!label) return null
  return (
    <span
      title={`${details ? `${details}\n\n` : ''}NSE surveillance: higher margins, a tighter price band or trade-for-trade settlement while it lasts.`}
      className={cn(
        'inline-flex h-4.5 items-center gap-1 rounded-xs border border-down/40 bg-down-subtle px-1.5 text-[10.5px] font-medium whitespace-nowrap text-down',
        className,
      )}
    >
      <IconShieldExclamation className="size-3" />
      {label}
    </span>
  )
}

/** Inline SVG line, optional area fill and baseline. Tone defaults to the sign of last - first. */
function Sparkline({
  points,
  tone,
  area = false,
  baseline,
  className,
  strokeWidth = 1.5,
}: {
  points: number[]
  tone?: 'up' | 'down' | 'accent' | 'muted'
  area?: boolean
  baseline?: number
  className?: string
  strokeWidth?: number
}) {
  const id = useId()
  if (points.length < 2) return <svg className={cn('h-5 w-20', className)} aria-hidden />
  const lo = Math.min(...points, baseline ?? Number.POSITIVE_INFINITY)
  const hi = Math.max(...points, baseline ?? Number.NEGATIVE_INFINITY)
  const span = hi - lo || 1
  const x = (i: number) => (i / (points.length - 1)) * 100
  const y = (v: number) => 30 - ((v - lo) / span) * 28 - 1
  const line = points.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const t = tone ?? (points.at(-1)! >= points[0] ? 'up' : 'down')
  const color = `var(--${t === 'muted' ? 'muted-foreground' : t})`
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn('h-5 w-20', className)} aria-hidden>
      {area && (
        <>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity=".3" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,30 ${line} 100,30`} fill={`url(#${id})`} />
        </>
      )}
      {baseline != null && (
        <line
          x1="0"
          x2="100"
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="var(--muted-foreground)"
          strokeDasharray="2 2"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          opacity=".5"
        />
      )}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** 52-week (or any) range: low · marker · high, with "−7.4% from high". */
function RangeBar({
  low,
  high,
  value,
  label = '52W',
  className,
}: {
  low: number
  high: number
  value: number
  label?: string
  className?: string
}) {
  const pos = Math.min(100, Math.max(0, ((value - low) / (high - low || 1)) * 100))
  const fromHigh = ((value - high) / high) * 100
  return (
    <div className={cn('flex items-center gap-2 text-2xs', className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{INR(low)}</span>
      <div className="relative h-0.75 flex-1 bg-muted">
        <span className="absolute inset-0 bg-linear-to-r from-down/50 to-up/50" />
        <span
          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
          style={{ left: `${pos}%` }}
        />
      </div>
      <span className="tabular">{INR(high)}</span>
      <span className={cn('tabular w-20 text-right', fromHigh >= -2 ? 'text-up' : 'text-muted-foreground')}>
        {fromHigh >= -0.05 ? 'at high' : `${fromHigh.toFixed(1)}% from high`}
      </span>
    </div>
  )
}

/** Index tile: name, level, change, sparkline (IndexCard, the home ticker cards). */
function IndexCard({
  name,
  value,
  pct,
  points,
  className,
}: {
  name: string
  value: number
  pct: number
  points?: number[]
  className?: string
}) {
  return (
    <div
      data-slot="index-card"
      className={cn(
        'flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-card px-2.5 py-2',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-label text-muted-foreground uppercase">{name}</span>
        <Change value={pct} className="text-2xs" />
      </div>
      <span className="tabular text-[15px] font-medium">{INR(value)}</span>
      {points && <Sparkline points={points} area className="mt-1 h-7 w-full" />}
    </div>
  )
}

type TickerItem = { label: string; value: number; pct: number }

/** The top-bar strip of indices. `scroll` loops it like a tape (renders the list twice and slides one copy's width). */
function TickerStrip({
  items,
  scroll = false,
  className,
}: {
  items: TickerItem[]
  scroll?: boolean
  className?: string
}) {
  const row = (hidden?: boolean) => (
    <div className="flex shrink-0 items-center" aria-hidden={hidden}>
      {items.map((i) => (
        <span
          key={i.label}
          className="inline-flex items-baseline gap-1.5 border-r border-border px-3 text-2xs whitespace-nowrap"
        >
          <span className="text-muted-foreground">{i.label}</span>
          <span className="tabular text-foreground">{INR(i.value)}</span>
          <Change value={i.pct} />
        </span>
      ))}
    </div>
  )
  return (
    <div
      data-slot="ticker"
      className={cn('relative flex overflow-hidden', scroll && 'mask-x-from-95%', className)}
    >
      <div
        className={cn(
          'flex',
          scroll && 'animate-[ds-ticker_40s_linear_infinite] hover:[animation-play-state:paused]',
        )}
      >
        {row()}
        {scroll && row(true)}
      </div>
    </div>
  )
}

/** One watchlist line: symbol (+ sub line), LTP, change; a thin bar under it scaled to the move. */
function WatchlistRow({
  symbol,
  sub,
  ltp,
  pct,
  selected,
  trailing,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'children'> & {
  symbol: string
  sub?: ReactNode
  ltp: number
  pct: number
  selected?: boolean
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      data-slot="watchlist-row"
      aria-current={selected || undefined}
      className={cn(
        'relative grid min-h-(--row-h) w-full grid-cols-[1fr_auto_60px] items-center gap-2 border-b border-border/60 px-2 py-0.5 text-left outline-none hover:bg-muted focus-visible:bg-muted',
        selected && 'bg-selection shadow-[inset_2px_0_var(--accent)]',
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 truncate font-semibold">
          {symbol}
          {trailing}
        </span>
        {sub && <span className="truncate text-2xs text-muted-foreground">{sub}</span>}
      </span>
      <TickPrice value={ltp} className="text-right" />
      <Change value={pct} className="text-right" />
      <span
        className={cn('absolute bottom-0 left-0 h-px opacity-70', pct >= 0 ? 'bg-up' : 'bg-down')}
        style={{ width: `${Math.min(100, Math.abs(pct) * 20)}%` }}
      />
    </button>
  )
}

/** A labelled gauge against a cap: "Open risk ₹9,820 / ₹15,000". Amber past `limit` (drawn as a
 *  marker), red past `max`. */
function Meter({
  label,
  value,
  max,
  limit,
  format = (v) => `₹${INR(v, 0)}`,
  className,
}: {
  label: ReactNode
  value: number
  max: number
  limit?: number
  format?: (v: number) => string
  className?: string
}) {
  const pct = (value / max) * 100
  const limitPct = limit != null ? (limit / max) * 100 : undefined
  const tone = pct >= 100 ? 'down' : limitPct != null && pct >= limitPct ? 'warning' : 'accent'
  return (
    <div data-slot="meter" className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-2 text-2xs">
        <span>{label}</span>
        <span className="tabular text-muted-foreground">
          <span
            className={cn(
              tone === 'down' ? 'text-down' : tone === 'warning' ? 'text-warning' : 'text-foreground',
            )}
          >
            {format(value)}
          </span>{' '}
          / {format(max)}
        </span>
      </div>
      <Progress value={Math.min(100, pct)} tone={tone} limit={limitPct} />
    </div>
  )
}

export {
  Change,
  TickPrice,
  Quote,
  RsPill,
  Delivery,
  ResultsBadge,
  SurveillanceBadge,
  Sparkline,
  RangeBar,
  IndexCard,
  TickerStrip,
  WatchlistRow,
  Meter,
}

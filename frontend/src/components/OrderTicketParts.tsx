// The pieces both order tickets are built from - the live Dhan one (live/LiveOrderTicket.tsx) and
// the paper one (paper/PaperTrades.tsx OrderPanel) - so the two read as one design: a segmented
// toggle, a labelled field with something on the right of its label, a price input that shows its
// distance from entry, and the summary footer that stays in view at the bottom of a scrolling panel.
import { AlertTriangleIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { fmt, inr } from '@/lib/format'
import { cn } from '@/lib/utils'

export const num = (s: string) => (s.trim() === '' ? null : Number(s))

export function Seg<T extends string>({
  value,
  options,
  onChange,
  tone,
  size = 'sm',
}: {
  value: T
  options: { value: T; label: string; hint?: string }[]
  onChange: (v: T) => void
  tone?: (v: T) => string
  size?: 'sm' | 'lg'
}) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.hint}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-md font-medium transition-colors',
            size === 'lg' ? 'h-9 text-sm' : 'h-7 text-xs',
            value === o.value
              ? (tone?.(o.value) ?? 'bg-background text-foreground shadow-sm')
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function F({
  label,
  aside,
  children,
  className,
}: {
  label: string
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1 text-xs', className)}>
      <span className="flex items-center justify-between text-muted-foreground">
        {label}
        {aside}
      </span>
      {children}
    </label>
  )
}

/** A price input with its distance from the entry beside the label, signed the way the trade sees
 *  it: a long's stop reads negative, its target positive. */
export function PriceField({
  label,
  value,
  onChange,
  reference,
  tone,
  placeholder,
  className,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  reference?: number | null
  tone?: 'up' | 'down'
  placeholder?: string
  className?: string
}) {
  const p = num(value)
  const pct = p && reference ? ((p - reference) / reference) * 100 : null
  return (
    <F
      label={label}
      className={className}
      aside={
        pct != null && (
          <span
            className={cn('tabular-nums', tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : '')}
          >
            {pct >= 0 ? '+' : ''}
            {fmt(pct, 2)}%
          </span>
        )
      }
    >
      <Input
        type="number"
        step="0.05"
        inputMode="decimal"
        value={value}
        placeholder={placeholder ?? '₹'}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 tabular-nums"
      />
    </F>
  )
}

/** The bottom of a ticket: "qty x price — value · % of cash", risk / reward / R, warnings, then the
 *  action. Sticky, so it stays in view while the fields above scroll; it takes the ticket's own
 *  background (bg-[inherit]) so what scrolls under it is hidden. */
export function TicketFooter({
  quantity,
  price,
  priceNote,
  value,
  pct,
  pctLabel = 'of wallet',
  risk,
  reward,
  riskNote,
  rr,
  warnings = [],
  children,
}: {
  quantity: number
  price: number | null
  priceNote?: string
  value: number | null
  pct: number | null
  pctLabel?: string
  risk: number | null
  reward: number | null
  /** Beside the risk figure, e.g. "1.2% of wallet". */
  riskNote?: string
  /** R:R when it isn't reward / risk - a laddered exit's weighted R. */
  rr?: number | null
  warnings?: string[]
  children: React.ReactNode
}) {
  return (
    <div className="sticky bottom-0 -mx-1 mt-auto space-y-2 bg-[inherit] px-1 pt-2">
      <div className="flex items-baseline justify-between gap-2 border-t pt-2 text-xs">
        <span className="text-muted-foreground">
          {quantity > 0 && price ? (
            <>
              {quantity} × {inr(price)}
              {priceNote && ` (${priceNote})`}
            </>
          ) : (
            'Est. value'
          )}
        </span>
        <span className="text-right tabular-nums">
          <span className="font-semibold">{value == null ? '—' : inr(value)}</span>
          {pct != null && (
            <span className={cn('ml-1.5', pct > 100 ? 'text-down' : 'text-muted-foreground')}>
              {fmt(pct, 1)}% {pctLabel}
            </span>
          )}
        </span>
      </div>
      {risk != null && (
        <div className="flex justify-between text-xs tabular-nums">
          <span className="text-down">
            risk {inr(risk)}
            {riskNote && <span className="text-muted-foreground"> · {riskNote}</span>}
          </span>
          {reward != null && <span className="text-up">reward {inr(reward)}</span>}
          {reward != null && risk > 0 && <span className="font-medium">{fmt(rr ?? reward / risk, 2)}R</span>}
        </div>
      )}
      {warnings.map((w) => (
        <p key={w} className="flex gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
          {w}
        </p>
      ))}
      {children}
    </div>
  )
}

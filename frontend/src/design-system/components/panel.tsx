import type { ComponentProps, ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Panel: the terminal's basic surface - hairline box, a header strip with an uppercase title and
// actions, a body, an optional footer. New; most pages hand-roll this today.

function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="panel"
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card text-card-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** Header strip. Children: PanelTitle, then anything (tabs, a select, buttons); use <span className="flex-1" /> to push actions right. */
function PanelHeader({ className, ...props }: ComponentProps<'header'>) {
  return (
    <header
      data-slot="panel-header"
      className={cn(
        'flex min-h-7.5 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-panel-head px-2',
        className,
      )}
      {...props}
    />
  )
}

function PanelTitle({ className, hint, children, ...props }: ComponentProps<'h3'> & { hint?: ReactNode }) {
  return (
    <h3
      data-slot="panel-title"
      className={cn(
        'flex items-baseline gap-2 text-label font-semibold text-muted-foreground uppercase',
        className,
      )}
      {...props}
    >
      {children}
      {hint && <span className="text-2xs font-normal tracking-normal normal-case">{hint}</span>}
    </h3>
  )
}

function PanelBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="panel-body" className={cn('min-h-0 flex-1 p-2', className)} {...props} />
}

/** A labelled divider inside a panel ("WHAT HAPPENED"). */
function PanelSection({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-section"
      className={cn(
        'border-y border-border bg-panel-head px-2 py-1 text-label text-muted-foreground uppercase first:border-t-0',
        className,
      )}
      {...props}
    />
  )
}

function PanelFooter({ className, ...props }: ComponentProps<'footer'>) {
  return (
    <footer
      data-slot="panel-footer"
      className={cn(
        'flex min-h-8 shrink-0 items-center gap-2 border-t border-border bg-panel-head px-2',
        className,
      )}
      {...props}
    />
  )
}

// Card: same parts and props as components/ui/card.tsx, drawn as a panel so existing pages keep
// working and look consistent after migration.
function Card({
  className,
  size = 'default',
  ...props
}: ComponentProps<'div'> & { size?: 'default' | 'sm' }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-md border border-border bg-card py-(--card-spacing) text-xs text-card-foreground [--card-spacing:--spacing(3)] data-[size=sm]:[--card-spacing:--spacing(2)] has-data-[slot=card-footer]:pb-0',
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'grid auto-rows-min items-start gap-0.5 px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-(--card-spacing)',
        className,
      )}
      {...props}
    />
  )
}

const CardTitle = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-title"
    className={cn('text-[13px] font-semibold group-data-[size=sm]/card:text-xs', className)}
    {...props}
  />
)
const CardDescription = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="card-description" className={cn('text-2xs text-muted-foreground', className)} {...props} />
)
const CardAction = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-action"
    className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
    {...props}
  />
)
const CardContent = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="card-content" className={cn('px-(--card-spacing)', className)} {...props} />
)
const CardFooter = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-footer"
    className={cn(
      'flex items-center border-t border-border bg-panel-head px-(--card-spacing) py-2',
      className,
    )}
    {...props}
  />
)

// Stats: a strip of label / value / delta cells (journal stats, backtest metrics, holdings summary).
type Tone = 'up' | 'down' | 'warning' | 'muted'
const TONE: Record<Tone, string> = {
  up: 'text-up',
  down: 'text-down',
  warning: 'text-warning',
  muted: 'text-muted-foreground',
}

/** Equal cells with hairline dividers; wraps on narrow screens. `bordered` boxes it (outside a panel). */
function StatStrip({ className, bordered, ...props }: ComponentProps<'div'> & { bordered?: boolean }) {
  return (
    <div
      data-slot="stat-strip"
      className={cn(
        'grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] overflow-hidden',
        bordered && 'rounded-md border border-border bg-card',
        '[&>*]:-mr-px [&>*]:-mb-px [&>*]:border-r [&>*]:border-b [&>*]:border-border',
        className,
      )}
      {...props}
    />
  )
}

type StatProps = Omit<ComponentProps<'div'>, 'children'> & {
  label: ReactNode
  value: ReactNode
  /** Colors the value. */
  tone?: Tone
  /** Small change line under the value: "+12.4% vs last FY". */
  delta?: ReactNode
  deltaTone?: Tone
  hint?: ReactNode
  size?: 'default' | 'lg'
  icon?: ComponentType<{ className?: string }>
}

function Stat({
  label,
  value,
  tone,
  delta,
  deltaTone,
  hint,
  size = 'default',
  icon: Icon,
  className,
  ...props
}: StatProps) {
  return (
    <div data-slot="stat" className={cn('flex min-w-0 flex-col gap-0.5 px-2.5 py-2', className)} {...props}>
      <span className="flex items-center gap-1 text-label text-muted-foreground uppercase">
        {Icon && <Icon className="size-3" />}
        {label}
      </span>
      <span
        className={cn(
          'tabular truncate font-medium',
          size === 'lg' ? 'text-xl' : 'text-[15px]',
          tone && TONE[tone],
        )}
      >
        {value}
      </span>
      {delta && (
        <span className={cn('tabular text-2xs', deltaTone ? TONE[deltaTone] : 'text-muted-foreground')}>
          {delta}
        </span>
      )}
      {hint && <span className="truncate text-2xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

// EmptyState: nothing to show yet - icon, a line of why, and what to do about it.
function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  bordered,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  icon?: ComponentType<{ className?: string }>
  title: ReactNode
  description?: ReactNode
  bordered?: boolean
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center',
        bordered && 'rounded-md border border-dashed border-input',
        className,
      )}
      {...props}
    >
      {Icon && (
        <div className="mb-1 grid size-9 place-items-center rounded-md border border-border bg-panel-head text-muted-foreground">
          <Icon className="size-4.5" />
        </div>
      )}
      <div className="text-[13px] font-semibold">{title}</div>
      {description && <p className="max-w-xs text-2xs text-muted-foreground">{description}</p>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-1.5">{children}</div>}
    </div>
  )
}

export {
  Panel,
  PanelHeader,
  PanelTitle,
  PanelBody,
  PanelSection,
  PanelFooter,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  StatStrip,
  Stat,
  EmptyState,
}

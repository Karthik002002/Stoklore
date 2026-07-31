import { cn } from '@/lib/utils'

// Shared chrome for the dashboard's terminal panels (StocksList): a thin accent bar + uppercase
// monospace title, optional right-aligned actions, and a bordered body. `accent` is a text-color
// class so each panel can carry its own hue the way a Bloomberg-style layout does - it's applied
// to both the leading bar and the title, nothing else.
export default function TerminalPanel({ title, accent = 'text-primary', actions, className, children }) {
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-md border bg-card/40', className)}>
      <div className="flex shrink-0 items-center gap-1.5 border-b bg-muted/30 px-2 py-1.5">
        <span className={cn('leading-none', accent)}>▍</span>
        <span className={cn('font-mono text-[11px] font-semibold tracking-widest uppercase', accent)}>
          {title}
        </span>
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}

// Dense monospace row used inside panels - a label on the left, a value (usually numeric, so
// tabular-nums) on the right. The one shape most of the dashboard's metric lists need.
export function TerminalRow({ label, value, valueClassName, className }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-b border-border/40 px-2 py-1 font-mono text-xs last:border-0',
        className,
      )}
    >
      <span className="truncate text-muted-foreground">{label}</span>
      <span className={cn('shrink-0 tabular-nums', valueClassName)}>{value}</span>
    </div>
  )
}

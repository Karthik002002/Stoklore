import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// Collapsible card that floats over the full-bleed chart instead of taking up document flow.
// Each panel cluster gets its own small absolutely-positioned wrapper (not one full-viewport
// pointer-events-none overlay) so there's no ambiguity about hit-testing against the chart's own
// canvas layers underneath - a panel only ever occupies its own bounding box.
export default function FloatingPanel({ title, icon: Icon, defaultOpen = true, className, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cn('rounded-xl border bg-card/95 shadow-lg backdrop-blur-sm', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium"
      >
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
        <span className="flex-1 text-left">{title}</span>
        <ChevronDownIcon
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && <div className="space-y-2 border-t p-3">{children}</div>}
    </div>
  )
}

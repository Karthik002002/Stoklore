import type { ComponentProps } from 'react'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cn } from '@/lib/utils'

// Same parts as components/ui/tabs.tsx. TabsList gains `variant`:
//   segment (default) - bordered segmented control, for switching a panel's view
//   line              - underline tabs, for page sections and panel headers (Positions | Orders)
// and `size` for the tiny toggles that sit inside panel headers.
function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2 data-[orientation=vertical]:flex-row', className)}
      {...props}
    />
  )
}

type TabsListProps = ComponentProps<typeof TabsPrimitive.List> & {
  variant?: 'segment' | 'line'
  size?: 'default' | 'sm'
}

function TabsList({ className, variant = 'segment', size = 'default', ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      data-size={size}
      className={cn(
        'group/tabs relative inline-flex w-fit items-stretch text-muted-foreground',
        variant === 'segment' && 'overflow-hidden rounded-md border border-border',
        variant === 'line' && 'gap-1 border-b border-border',
        'data-[orientation=vertical]:flex-col',
        className,
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        'relative inline-flex items-center justify-center gap-1.5 px-2.5 font-medium whitespace-nowrap outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-disabled:pointer-events-none data-disabled:opacity-40',
        "[&_svg:not([class*='size-'])]:size-3.5",
        // size
        'h-6 text-xs group-data-[size=sm]/tabs:h-5 group-data-[size=sm]/tabs:px-1.5 group-data-[size=sm]/tabs:text-label',
        // segment
        'group-data-[variant=segment]/tabs:border-r group-data-[variant=segment]/tabs:border-border group-data-[variant=segment]/tabs:last:border-r-0 group-data-[variant=segment]/tabs:hover:bg-muted',
        'group-data-[variant=segment]/tabs:data-active:bg-muted group-data-[variant=segment]/tabs:data-active:text-foreground group-data-[variant=segment]/tabs:data-active:shadow-[inset_0_-2px_var(--accent)]',
        // line
        'group-data-[variant=line]/tabs:-mb-px group-data-[variant=line]/tabs:h-7.5 group-data-[variant=line]/tabs:px-2 group-data-[variant=line]/tabs:data-active:text-foreground group-data-[variant=line]/tabs:data-active:shadow-[inset_0_-2px_var(--accent)]',
        className,
      )}
      {...props}
    />
  )
}

/** Kept for API compatibility; the active state is drawn on the tab itself, so this is optional. */
function TabsIndicator({ className, ...props }: ComponentProps<typeof TabsPrimitive.Indicator>) {
  return <TabsPrimitive.Indicator data-slot="tabs-indicator" className={cn('hidden', className)} {...props} />
}

function TabsPanel({ className, ...props }: ComponentProps<typeof TabsPrimitive.Panel>) {
  return <TabsPrimitive.Panel data-slot="tabs-panel" className={cn('outline-none', className)} {...props} />
}

/** Small count beside a tab label: "Positions 4". */
function TabsCount({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'rounded-xs bg-muted px-1 font-mono text-[10px] text-muted-foreground tabular-nums',
        className,
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel, TabsCount }

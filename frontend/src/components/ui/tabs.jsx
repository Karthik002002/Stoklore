import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'

import { cn } from '@/lib/utils'

function Tabs({ className, ...props }) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-3', className)} {...props} />
}

function TabsList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'relative inline-flex h-8 items-center gap-1 rounded-lg bg-muted p-0.5 text-muted-foreground',
        'data-[orientation=vertical]:h-auto data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch',
        className,
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        'relative z-10 inline-flex h-full items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none select-none data-selected:text-foreground',
        'data-[orientation=vertical]:h-9 data-[orientation=vertical]:w-full data-[orientation=vertical]:justify-start',
        className,
      )}
      {...props}
    />
  )
}

function TabsIndicator({ className, ...props }) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        'absolute top-0.5 left-0 h-[calc(100%-4px)] w-(--active-tab-width) translate-x-(--active-tab-left) rounded-md bg-background shadow-sm transition-all duration-200 ring-1 ring-foreground/10',
        'data-[orientation=vertical]:top-0 data-[orientation=vertical]:left-0.5 data-[orientation=vertical]:h-(--active-tab-height) data-[orientation=vertical]:w-[calc(100%-4px)] data-[orientation=vertical]:translate-x-0 data-[orientation=vertical]:translate-y-(--active-tab-top)',
        className,
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }) {
  return <TabsPrimitive.Panel data-slot="tabs-panel" className={cn('outline-none', className)} {...props} />
}

export { Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel }

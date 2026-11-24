import type { ComponentProps } from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from '@/lib/utils'

// Pulled forward from Phase 3 because the theme selector needs it; Phase 3 adds its stories.
type PopoverContentProps = ComponentProps<typeof PopoverPrimitive.Popup> &
  Pick<ComponentProps<typeof PopoverPrimitive.Positioner>, 'side' | 'align' | 'sideOffset' | 'alignOffset'>

const Popover = (props: ComponentProps<typeof PopoverPrimitive.Root>) => <PopoverPrimitive.Root data-slot="popover" {...props} />

const PopoverTrigger = (props: ComponentProps<typeof PopoverPrimitive.Trigger>) => (
  <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
)

function PopoverContent({ className, side = 'bottom', sideOffset = 4, align = 'center', alignOffset = 0, ...props }: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset} className="isolate z-50">
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'w-64 origin-(--transform-origin) rounded-md border border-input bg-popover p-2 text-xs text-popover-foreground outline-none',
            'duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }

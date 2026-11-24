import type { ComponentProps } from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from '@/lib/utils'
import { popupSurface } from './control'

type PopoverContentProps = ComponentProps<typeof PopoverPrimitive.Popup> &
  Pick<ComponentProps<typeof PopoverPrimitive.Positioner>, 'side' | 'align' | 'sideOffset' | 'alignOffset'>

const Popover = (props: ComponentProps<typeof PopoverPrimitive.Root>) => (
  <PopoverPrimitive.Root data-slot="popover" {...props} />
)

const PopoverTrigger = (props: ComponentProps<typeof PopoverPrimitive.Trigger>) => (
  <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
)

function PopoverContent({
  className,
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(popupSurface, 'w-64 p-2', className)}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

/** Optional title row inside a popover. */
const PopoverHeader = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="popover-header"
    className={cn('mb-1.5 flex items-center justify-between gap-2 font-semibold', className)}
    {...props}
  />
)

const PopoverClose = (props: ComponentProps<typeof PopoverPrimitive.Close>) => (
  <PopoverPrimitive.Close data-slot="popover-close" {...props} />
)

export { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverClose }

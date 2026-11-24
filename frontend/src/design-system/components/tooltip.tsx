import type { ComponentProps } from 'react'
import { PreviewCard as PreviewCardPrimitive } from '@base-ui/react/preview-card'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '@/lib/utils'
import { popupSurface } from './control'

type Placement<T> = T & {
  side?: 'top' | 'bottom' | 'left' | 'right' | 'inline-start' | 'inline-end'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  alignOffset?: number
}

// Tooltip: same parts as components/ui/tooltip.tsx. Inverted chip (primary on primary-foreground)
// so it reads over any panel; a <Kbd> inside shows the shortcut.
const TooltipProvider = ({ delay = 150, ...props }: ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
)
const Tooltip = (props: ComponentProps<typeof TooltipPrimitive.Root>) => (
  <TooltipPrimitive.Root data-slot="tooltip" {...props} />
)
const TooltipTrigger = (props: ComponentProps<typeof TooltipPrimitive.Trigger>) => (
  <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
)

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 5,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: Placement<ComponentProps<typeof TooltipPrimitive.Popup>>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-sm bg-primary px-2 py-1 text-2xs text-primary-foreground',
            '**:data-[slot=kbd]:border-primary-foreground/30 **:data-[slot=kbd]:text-primary-foreground/80',
            'duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

// HoverCard: same parts as components/ui/hover-card.tsx (SectorHoverCard, stock previews).
const HoverCard = (props: ComponentProps<typeof PreviewCardPrimitive.Root>) => (
  <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />
)
const HoverCardTrigger = (props: ComponentProps<typeof PreviewCardPrimitive.Trigger>) => (
  <PreviewCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
)

function HoverCardContent({
  className,
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  alignOffset = 4,
  ...props
}: Placement<ComponentProps<typeof PreviewCardPrimitive.Popup>>) {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(popupSurface, 'w-64 p-2', className)}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
}

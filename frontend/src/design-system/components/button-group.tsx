import type { ComponentProps } from 'react'
import { mergeProps } from '@base-ui/react/merge-props'
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group'
import { useRender } from '@base-ui/react/use-render'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Separator } from './display'

// ButtonGroup: same API as components/ui/button-group.tsx - joins buttons, inputs and selects
// into one bar ("Run backtest" + chevron, a ₹ input + unit select).
const buttonGroupVariants = cva(
  'flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-10 has-[>[data-slot=button-group]]:gap-1.5 [&>input]:flex-1',
  {
    variants: {
      orientation: {
        horizontal:
          '*:data-slot:rounded-r-none [&>[data-slot]:not(:has(~[data-slot]))]:rounded-r-md! [&>[data-slot]~[data-slot]]:rounded-l-none [&>[data-slot]~[data-slot]]:-ml-px',
        vertical:
          'flex-col *:data-slot:rounded-b-none [&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-md! [&>[data-slot]~[data-slot]]:rounded-t-none [&>[data-slot]~[data-slot]]:-mt-px',
      },
    },
    defaultVariants: { orientation: 'horizontal' },
  },
)

function ButtonGroup({
  className,
  orientation,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  )
}

function ButtonGroupText({ className, render, ...props }: useRender.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps(
      {
        className: cn(
          'flex items-center gap-1.5 rounded-md border border-input bg-muted px-2 text-2xs text-muted-foreground',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'button-group-text' },
  })
}

function ButtonGroupSeparator({
  className,
  orientation = 'vertical',
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn('relative self-stretch bg-input', className)}
      {...props}
    />
  )
}

// ToggleGroup: a single choice from a few (1D / 1W / 1M, LMT / MKT / SL, % / ₹). Real toggle
// semantics (aria-pressed, roving focus) instead of buttons faking it. New - not in components/ui.
function ToggleGroup({
  className,
  size = 'default',
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive> & { size?: 'default' | 'sm' }) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-size={size}
      className={cn(
        'group/toggle inline-flex w-fit overflow-hidden rounded-md border border-border',
        className,
      )}
      {...props}
    />
  )
}

function Toggle({ className, ...props }: ComponentProps<typeof TogglePrimitive>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(
        'inline-flex items-center justify-center gap-1 border-r border-border px-2 font-medium text-muted-foreground outline-none select-none last:border-r-0 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-disabled:opacity-40',
        'h-6 text-xs group-data-[size=sm]/toggle:h-5 group-data-[size=sm]/toggle:px-1.5 group-data-[size=sm]/toggle:text-2xs',
        'data-pressed:bg-muted data-pressed:text-foreground data-pressed:shadow-[inset_0_-2px_var(--accent)]',
        "[&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  )
}

export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants, ToggleGroup, Toggle }

import type { ComponentProps } from 'react'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { IconCheck, IconMinus } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

const focus = 'outline-none focus-visible:ring-2 focus-visible:ring-ring'

function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        focus,
        'peer grid size-3.5 shrink-0 place-items-center rounded-xs border border-input bg-panel-head transition-colors',
        'data-checked:border-accent data-checked:bg-accent data-checked:text-accent-foreground data-indeterminate:border-accent data-indeterminate:bg-accent data-indeterminate:text-accent-foreground',
        'aria-invalid:border-down data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="grid place-items-center data-unchecked:hidden"
        render={(p, state) => (
          <span {...p}>
            {state.indeterminate ? (
              <IconMinus className="size-2.5" stroke={3} />
            ) : (
              <IconCheck className="size-2.5" stroke={3} />
            )}
          </span>
        )}
      />
    </CheckboxPrimitive.Root>
  )
}

function Switch({
  className,
  size = 'default',
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root> & { size?: 'default' | 'sm' }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        focus,
        'group/switch relative inline-flex shrink-0 items-center rounded-full bg-input transition-colors data-checked:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-50',
        'data-[size=default]:h-3.5 data-[size=default]:w-6.5 data-[size=sm]:h-3 data-[size=sm]:w-5.5',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block translate-x-0.5 rounded-full bg-foreground transition-transform data-checked:bg-accent-foreground',
          'group-data-[size=default]/switch:size-2.5 group-data-[size=default]/switch:data-checked:translate-x-3.5',
          'group-data-[size=sm]/switch:size-2 group-data-[size=sm]/switch:data-checked:translate-x-3',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive>) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn('flex flex-wrap gap-3', className)}
      {...props}
    />
  )
}

function Radio({ className, ...props }: ComponentProps<typeof RadioPrimitive.Root>) {
  return (
    <RadioPrimitive.Root
      data-slot="radio"
      className={cn(
        focus,
        'grid size-3.5 shrink-0 place-items-center rounded-full border border-input bg-panel-head transition-colors data-checked:border-accent data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator className="size-1.5 rounded-full bg-accent data-unchecked:hidden" />
    </RadioPrimitive.Root>
  )
}

export { Checkbox, Switch, RadioGroup, Radio }

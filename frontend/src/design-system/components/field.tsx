import type { ComponentProps } from 'react'
import { Field as FieldPrimitive } from '@base-ui/react/field'
import { cn } from '@/lib/utils'

// Label + control + help/error, with the aria wiring (label-for, describedby, invalid) done by
// Base UI. New - the app currently hand-rolls <label> + <p>.
function Field({ className, ...props }: ComponentProps<typeof FieldPrimitive.Root>) {
  return <FieldPrimitive.Root data-slot="field" className={cn('flex flex-col gap-1', className)} {...props} />
}

function FieldLabel({ className, ...props }: ComponentProps<typeof FieldPrimitive.Label>) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn(
        'text-label text-muted-foreground uppercase select-none data-disabled:opacity-50 data-invalid:text-down',
        className,
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: ComponentProps<typeof FieldPrimitive.Description>) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn('text-2xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function FieldError({ className, ...props }: ComponentProps<typeof FieldPrimitive.Error>) {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      className={cn('text-2xs text-down', className)}
      {...props}
    />
  )
}

/** Plain label for a control outside a Field (a checkbox row, a toolbar). */
function Label({ className, ...props }: ComponentProps<'label'>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: the caller nests or htmlFor's the control
  return (
    <label
      data-slot="label"
      className={cn(
        'inline-flex items-center gap-1.5 text-xs select-none has-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Field, FieldLabel, FieldDescription, FieldError, Label }

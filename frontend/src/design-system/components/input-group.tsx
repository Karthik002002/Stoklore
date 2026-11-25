import type { ComponentProps } from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Input, Textarea } from './input'

// Same parts and props as components/ui/input-group.tsx: ₹ prefixes, "% of equity" suffixes,
// search icons, inline buttons.
function InputGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="group"
      data-slot="input-group"
      className={cn(
        'group/input-group relative flex h-(--control-h) w-full min-w-0 items-center rounded-md border border-input bg-panel-head transition-colors',
        'has-[[data-slot=input-group-control]:focus-visible]:border-accent has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-ring',
        'has-[[aria-invalid=true]]:border-down has-disabled:opacity-50',
        'has-[>textarea]:h-auto has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col',
        className,
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-1.5 text-2xs text-muted-foreground select-none [&>svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      align: {
        'inline-start': 'order-first pl-2 has-[>button]:ml-[-0.2rem]',
        'inline-end': 'order-last pr-2 has-[>button]:mr-[-0.2rem]',
        'block-start': 'order-first w-full justify-start px-2 pt-1.5',
        'block-end': 'order-last w-full justify-start px-2 pb-1.5',
      },
    },
    defaultVariants: { align: 'inline-start' },
  },
)

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if (e.target instanceof Element && e.target.closest('button')) return
        e.currentTarget.parentElement?.querySelector<HTMLElement>('input,textarea')?.focus()
      }}
      {...props}
    />
  )
}

function InputGroupButton({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'icon-xs',
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button type={type} variant={variant} size={size} className={cn('rounded-sm', className)} {...props} />
  )
}

function InputGroupText({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-2xs text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  )
}

const bare = 'flex-1 rounded-none border-0 bg-transparent ring-0 focus-visible:ring-0 aria-invalid:ring-0'

function InputGroupInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input data-slot="input-group-control" className={cn(bare, 'h-full', className)} {...props} />
}

function InputGroupTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return (
    <Textarea data-slot="input-group-control" className={cn(bare, 'resize-none', className)} {...props} />
  )
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea }

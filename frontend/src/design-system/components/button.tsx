import type { ComponentProps } from 'react'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Same variant names as components/ui/button.tsx so migration is an import-path swap; buy/sell
// are new. Heights come from --control-h, so the density setting resizes every button.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent font-medium whitespace-nowrap select-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-down [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        secondary: 'border-border bg-muted text-foreground hover:bg-muted-hover',
        outline: 'border-input bg-transparent text-foreground hover:bg-muted',
        ghost:
          'text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
        destructive: 'border-down/40 text-down hover:bg-down-subtle',
        link: 'h-auto px-0.5 text-accent underline-offset-4 hover:underline',
        buy: 'bg-up font-semibold text-up-foreground hover:brightness-110',
        sell: 'bg-down font-semibold text-down-foreground hover:brightness-110',
      },
      size: {
        xs: 'h-5.5 px-1.5 text-2xs',
        sm: 'h-6 px-2 text-xs',
        default: 'h-(--control-h) px-2.5 text-xs',
        lg: 'h-8 px-3.5 text-[13px]',
        icon: 'size-(--control-h)',
        'icon-xs': 'size-5.5',
        'icon-sm': 'size-6',
        'icon-lg': 'size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

type ButtonProps = ComponentProps<typeof ButtonPrimitive> & VariantProps<typeof buttonVariants>

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant ?? 'default'}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
export type { ButtonProps }

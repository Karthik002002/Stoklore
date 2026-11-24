import type { ComponentProps } from 'react'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Same variants as components/ui/badge.tsx (success/destructive now tinted, not solid blocks),
// plus warning and accent. `dot` adds a leading status dot (LIVE, PAPER, DRAFT).
const badgeVariants = cva(
  'inline-flex h-4.5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-xs border border-transparent px-1.5 text-[10.5px] font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-2.5!',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'border-border bg-muted text-foreground',
        success: 'bg-up-subtle text-up',
        warning: 'bg-warning-subtle text-warning',
        destructive: 'bg-down-subtle text-down',
        accent: 'bg-accent-subtle text-accent',
        outline: 'border-border text-muted-foreground',
        ghost: 'text-muted-foreground hover:bg-muted',
        link: 'text-accent underline-offset-4 hover:underline',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

type BadgeProps = useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { dot?: boolean }

const DOT: Record<string, string> = {
  success: 'bg-up shadow-[0_0_6px_var(--up)]',
  warning: 'bg-warning',
  destructive: 'bg-down',
  accent: 'bg-accent',
}

function Badge({ className, variant = 'default', dot, render, children, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps(
      {
        className: cn(
          badgeVariants({ variant }),
          dot && 'border-border bg-transparent font-mono tracking-wide text-foreground uppercase',
          className,
        ),
        children: (
          <>
            {dot && <span className={cn('size-1.5 rounded-full bg-muted-foreground', DOT[variant ?? ''])} />}
            {children}
          </>
        ),
      },
      props,
    ),
    render,
    state: { slot: 'badge', variant },
  })
}

/** Keyboard key: ⌘K, G S, ↵. */
function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-grid h-4 min-w-4 place-items-center rounded-xs border border-border px-1 font-mono text-[9.5px] text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** Several keys pressed together or in sequence. */
function KbdGroup({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="kbd-group" className={cn('inline-flex items-center gap-0.5', className)} {...props} />
  )
}

export { Badge, badgeVariants, Kbd, KbdGroup }
export type { BadgeProps }

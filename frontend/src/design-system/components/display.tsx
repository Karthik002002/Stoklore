import type { ComponentProps } from 'react'
import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import { cn } from '@/lib/utils'

function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch',
        className,
      )}
      {...props}
    />
  )
}

/** Same name as components/ui/spinner.tsx; a CSS ring instead of an icon so it takes the token color. */
function Spinner({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      role="status"
      aria-label="Loading"
      data-slot="spinner"
      className={cn(
        'inline-block size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current/25 border-t-current text-accent',
        className,
      )}
      {...props}
    />
  )
}

function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="skeleton" className={cn('animate-pulse rounded-xs bg-muted', className)} {...props} />
  )
}

const TONE = { accent: 'bg-accent', up: 'bg-up', down: 'bg-down', warning: 'bg-warning' }

type ProgressProps = ComponentProps<typeof ProgressPrimitive.Root> & {
  tone?: keyof typeof TONE
  /** Marker at a limit (e.g. 80% of the risk cap), as a 0-100 percentage. */
  limit?: number
  size?: 'default' | 'sm'
}

/** Goal progress, risk caps, delivery % bars. `value={null}` is indeterminate. */
function Progress({ className, tone = 'accent', limit, size = 'default', ...props }: ProgressProps) {
  return (
    <ProgressPrimitive.Root data-slot="progress" className={cn('relative w-full', className)} {...props}>
      <ProgressPrimitive.Track
        className={cn('overflow-hidden rounded-xs bg-muted', size === 'sm' ? 'h-0.75' : 'h-1.5')}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            'h-full transition-all duration-300 data-indeterminate:w-1/3 data-indeterminate:animate-pulse',
            TONE[tone],
          )}
        />
      </ProgressPrimitive.Track>
      {limit != null && (
        <span
          aria-hidden
          className="absolute -top-0.75 -bottom-0.75 w-px bg-muted-foreground"
          style={{ left: `${limit}%` }}
        />
      )}
    </ProgressPrimitive.Root>
  )
}

function Avatar({
  className,
  size = 'default',
  ...props
}: ComponentProps<typeof AvatarPrimitive.Root> & { size?: 'default' | 'sm' | 'lg' }) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-md border border-border bg-muted align-middle select-none',
        size === 'sm' && 'size-5 text-[10px]',
        size === 'default' && 'size-6 text-[11px]',
        size === 'lg' && 'size-8 text-xs',
        className,
      )}
      {...props}
    />
  )
}

const AvatarImage = ({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Image>) => (
  <AvatarPrimitive.Image
    data-slot="avatar-image"
    className={cn('size-full object-cover', className)}
    {...props}
  />
)

const AvatarFallback = ({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Fallback>) => (
  <AvatarPrimitive.Fallback
    data-slot="avatar-fallback"
    className={cn('flex size-full items-center justify-center font-semibold', className)}
    {...props}
  />
)

export { Separator, Spinner, Skeleton, Progress, Avatar, AvatarImage, AvatarFallback }
export type { ProgressProps }

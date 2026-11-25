import type { ComponentProps } from 'react'
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from './button'

// Same parts and props as components/ui/alert-dialog.tsx (size, Media, Action, Cancel).
// Confirmations for destructive things: delete a trade, exit all, kill an engine run.

const AlertDialog = (props: ComponentProps<typeof AlertDialogPrimitive.Root>) => (
  <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
)
const AlertDialogTrigger = (props: ComponentProps<typeof AlertDialogPrimitive.Trigger>) => (
  <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
)
const AlertDialogPortal = (props: ComponentProps<typeof AlertDialogPrimitive.Portal>) => (
  <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
)

const AlertDialogOverlay = ({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Backdrop>) => (
  <AlertDialogPrimitive.Backdrop
    data-slot="alert-dialog-overlay"
    className={cn(
      'fixed inset-0 isolate z-50 bg-black/55 duration-100 supports-backdrop-filter:backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
      className,
    )}
    {...props}
  />
)

function AlertDialogContent({
  className,
  size = 'default',
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Popup> & { size?: 'default' | 'sm' }) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          'group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-input bg-popover text-xs text-popover-foreground outline-none',
          'data-[size=default]:sm:max-w-sm data-[size=sm]:sm:max-w-xs',
          'duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0',
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

const AlertDialogHeader = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="alert-dialog-header"
    className={cn(
      'grid grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-1 p-3 *:not-data-[slot=alert-dialog-media]:col-start-2',
      className,
    )}
    {...props}
  />
)

const AlertDialogFooter = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="alert-dialog-footer"
    className={cn(
      'flex flex-col-reverse gap-1.5 border-t border-border bg-panel-head px-3 py-2 sm:flex-row sm:justify-end group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2',
      className,
    )}
    {...props}
  />
)

/** Icon tile on the left of the title - usually a warning glyph tinted with text-down / text-warning. */
const AlertDialogMedia = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="alert-dialog-media"
    className={cn(
      "row-span-2 grid size-7 place-items-center rounded-md bg-muted *:[svg:not([class*='size-'])]:size-4",
      className,
    )}
    {...props}
  />
)

const AlertDialogTitle = ({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title
    data-slot="alert-dialog-title"
    className={cn('text-[14px] font-semibold', className)}
    {...props}
  />
)

const AlertDialogDescription = ({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description
    data-slot="alert-dialog-description"
    className={cn('text-2xs leading-relaxed text-muted-foreground', className)}
    {...props}
  />
)

const AlertDialogAction = ({ size = 'sm', ...props }: ComponentProps<typeof Button>) => (
  <Button data-slot="alert-dialog-action" size={size} {...props} />
)

const AlertDialogCancel = ({
  className,
  variant = 'outline',
  size = 'sm',
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Close> & VariantProps<typeof buttonVariants>) => (
  <AlertDialogPrimitive.Close
    data-slot="alert-dialog-cancel"
    className={cn(className)}
    render={<Button variant={variant} size={size} />}
    {...props}
  />
)

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}

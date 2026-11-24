import type { ComponentProps } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { IconX } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

// Same parts and props as components/ui/dialog.tsx (showCloseButton, blurBackground, footer
// showCloseButton). New: `size` on DialogContent and DialogBody for a scrolling middle.

const Dialog = (props: ComponentProps<typeof DialogPrimitive.Root>) => (
  <DialogPrimitive.Root data-slot="dialog" {...props} />
)
const DialogTrigger = (props: ComponentProps<typeof DialogPrimitive.Trigger>) => (
  <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
)
const DialogPortal = (props: ComponentProps<typeof DialogPrimitive.Portal>) => (
  <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
)
const DialogClose = (props: ComponentProps<typeof DialogPrimitive.Close>) => (
  <DialogPrimitive.Close data-slot="dialog-close" {...props} />
)

function DialogOverlay({
  className,
  blur = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Backdrop> & { blur?: boolean }) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/55 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        blur && 'supports-backdrop-filter:backdrop-blur-[2px]',
        className,
      )}
      {...props}
    />
  )
}

const SIZE = { sm: 'sm:max-w-sm', default: 'sm:max-w-md', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }

type DialogContentProps = ComponentProps<typeof DialogPrimitive.Popup> & {
  showCloseButton?: boolean
  blurBackground?: boolean
  size?: keyof typeof SIZE
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  blurBackground = true,
  size = 'default',
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay blur={blurBackground} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md border border-input bg-popover text-xs text-popover-foreground outline-none',
          'duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0',
          SIZE[size],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            render={<Button variant="ghost" size="icon-xs" className="absolute top-1.5 right-1.5" />}
          >
            <IconX />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

/** Header strip, like a panel header. Put DialogTitle + DialogDescription inside. */
const DialogHeader = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="dialog-header"
    className={cn('flex flex-col gap-0.5 border-b border-border bg-panel-head px-3 py-2 pr-9', className)}
    {...props}
  />
)

/** Scrolls when the content is taller than the screen; header and footer stay put. */
const DialogBody = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="dialog-body" className={cn('flex-1 overflow-y-auto p-3', className)} {...props} />
)

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: ComponentProps<'div'> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-1.5 border-t border-border bg-panel-head px-3 py-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" size="sm" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  )
}

const DialogTitle = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    data-slot="dialog-title"
    className={cn('text-[13px] font-semibold', className)}
    {...props}
  />
)

const DialogDescription = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    data-slot="dialog-description"
    className={cn('text-2xs text-muted-foreground', className)}
    {...props}
  />
)

// Sheet: a dialog docked to an edge (HomeCustomizeSheet, DrillDrawer, mobile nav). New.
const SIDE = {
  right:
    'inset-y-0 right-0 h-full w-[min(380px,100%)] border-l data-open:slide-in-from-right data-closed:slide-out-to-right',
  left: 'inset-y-0 left-0 h-full w-[min(380px,100%)] border-r data-open:slide-in-from-left data-closed:slide-out-to-left',
  bottom:
    'inset-x-0 bottom-0 max-h-[80dvh] w-full border-t data-open:slide-in-from-bottom data-closed:slide-out-to-bottom',
  top: 'inset-x-0 top-0 max-h-[80dvh] w-full border-b data-open:slide-in-from-top data-closed:slide-out-to-top',
}

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Popup> & { side?: keyof typeof SIDE; showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden border-input bg-popover text-xs text-popover-foreground outline-none duration-200 data-open:animate-in data-closed:animate-out',
          SIDE[side],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            render={<Button variant="ghost" size="icon-xs" className="absolute top-1.5 right-1.5" />}
          >
            <IconX />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Dialog as Sheet,
  DialogTrigger as SheetTrigger,
  DialogClose as SheetClose,
  SheetContent,
  DialogHeader as SheetHeader,
  DialogBody as SheetBody,
  DialogFooter as SheetFooter,
  DialogTitle as SheetTitle,
  DialogDescription as SheetDescription,
}

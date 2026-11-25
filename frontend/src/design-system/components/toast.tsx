import type { ComponentProps } from 'react'
import { Toaster as Sonner, toast } from 'sonner'
import { IconAlertTriangle, IconCheck, IconInfoCircle, IconX } from '@tabler/icons-react'
import { useTheme } from '../theme/store'
import { Spinner } from './display'

// The app already calls sonner's toast() from ~60 files, so those calls stay as they are: this
// only replaces the <Toaster> in App.tsx with one painted from the tokens. Status shows as a colored
// left edge + icon instead of sonner's richColors fills.
function Toaster({ position = 'bottom-right', ...props }: ComponentProps<typeof Sonner>) {
  const { resolved } = useTheme()
  return (
    <Sonner
      theme={resolved.preset.mode}
      position={position}
      gap={6}
      icons={{
        success: <IconCheck className="size-3.5 text-up" />,
        error: <IconX className="size-3.5 text-down" />,
        warning: <IconAlertTriangle className="size-3.5 text-warning" />,
        info: <IconInfoCircle className="size-3.5 text-accent" />,
        loading: <Spinner className="size-3.5" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'group/toast flex w-(--width) items-start gap-2 rounded-md border border-input border-l-2 border-l-muted-foreground bg-popover p-2.5 font-sans text-xs text-popover-foreground data-[type=success]:border-l-up data-[type=error]:border-l-down data-[type=warning]:border-l-warning data-[type=info]:border-l-accent',
          icon: 'mt-px shrink-0',
          content: 'flex min-w-0 flex-1 flex-col gap-0.5',
          title: 'font-semibold',
          description: 'text-2xs text-muted-foreground',
          actionButton:
            'h-5.5 shrink-0 rounded-md bg-primary px-1.5 text-2xs font-medium text-primary-foreground',
          cancelButton: 'h-5.5 shrink-0 rounded-md border border-input px-1.5 text-2xs',
          closeButton:
            'absolute top-1 right-1 grid size-4 place-items-center rounded-xs text-muted-foreground hover:bg-muted hover:text-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }

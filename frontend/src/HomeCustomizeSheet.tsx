import { LayoutDashboardIcon, MoveIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { HOME_PANELS, useHomeLayout } from '@/lib/homeLayout'
import { cn } from '@/lib/utils'

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-4 w-7 shrink-0 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-3 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-3.5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

/** The home page's customise sheet, sliding in from the right: show or hide each panel, switch the
 *  grid into drag/resize mode, or go back to the default layout. Everything applies as it's changed
 *  and is kept in this browser (lib/homeLayout.ts). */
export default function HomeCustomizeSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { hidden, editing, setHidden, setEditing, reset } = useHomeLayout()
  const shown = HOME_PANELS.length - hidden.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // A sheet, not a centred dialog: pinned to the right edge, full height.
        className="top-0 right-0 bottom-0 left-auto flex h-full w-full max-w-sm translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-sm data-open:slide-in-from-right"
      >
        <div className="border-b p-4">
          <DialogTitle className="flex items-center gap-2">
            <LayoutDashboardIcon className="size-4" /> Customize home
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            {shown} of {HOME_PANELS.length} panels shown. Saved in this browser.
          </DialogDescription>
        </div>

        <div className="border-b p-4">
          <label className="flex items-start gap-3">
            <Switch checked={editing} onChange={setEditing} label="Edit layout" />
            <span className="text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <MoveIcon className="size-3.5" /> Edit layout
              </span>
              <span className="block text-xs text-muted-foreground">
                Drag a panel by its top bar, resize it from the bottom-right corner. Turn off when done.
              </span>
            </span>
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <p className="px-2 pt-1 pb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Panels
          </p>
          {HOME_PANELS.map((p) => {
            const on = !hidden.includes(p.id)
            return (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
              >
                <Switch checked={on} onChange={(v) => setHidden(p.id, !v)} label={`Show ${p.label}`} />
                <span className={cn('min-w-0 flex-1', !on && 'opacity-60')}>
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.layout ? p.hint : `${p.hint} · full-width strip`}
                  </span>
                </span>
              </label>
            )
          })}
        </div>

        <div className="flex gap-2 border-t p-4">
          <Button variant="outline" className="flex-1" onClick={reset}>
            <RotateCcwIcon className="size-3.5" /> Reset to default
          </Button>
          <Button className="flex-1" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { LayoutDashboardIcon, MoveIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { HOME_PANELS, useHomeLayout } from '@/lib/homeLayout'
import { cn } from '@/lib/utils'

/** An on/off switch. Explicit size, padding and knob offsets - a <button> brings its own padding,
 *  and an absolutely placed knob with no `left` lands wherever that padding leaves it. On, the track
 *  takes the primary colour and the knob the colour drawn on primary, so it reads in both themes. */
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
      onClick={(e) => {
        e.preventDefault() // inside a <label>: don't let it click us a second time
        onChange(!checked)
      }}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border p-0 transition-colors',
        checked ? 'border-primary bg-primary' : 'border-input bg-muted',
      )}
    >
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 left-0.5 size-3.5 -translate-y-1/2 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-4 bg-primary-foreground' : 'translate-x-0 bg-foreground/70',
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
          <label
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors',
              editing ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/50',
            )}
          >
            <span className="min-w-0 flex-1 text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <MoveIcon className="size-3.5" /> Edit layout
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Drag a panel by its top bar, resize it from the bottom-right corner.
              </span>
            </span>
            <Switch checked={editing} onChange={setEditing} label="Edit layout" />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <p className="px-2 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Panels
          </p>
          {HOME_PANELS.map((p) => {
            const on = !hidden.includes(p.id)
            return (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50"
              >
                <span className={cn('min-w-0 flex-1 transition-opacity', !on && 'opacity-50')}>
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {p.label}
                    {!p.layout && (
                      <span
                        className="rounded border px-1 text-[10px] font-normal text-muted-foreground"
                        title="A full-width strip outside the grid - it can be shown or hidden, not moved"
                      >
                        strip
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{p.hint}</span>
                </span>
                <Switch checked={on} onChange={(v) => setHidden(p.id, !v)} label={`Show ${p.label}`} />
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

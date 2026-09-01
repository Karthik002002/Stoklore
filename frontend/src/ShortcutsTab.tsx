import { useState } from 'react'
import { RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  SHORTCUT_SCOPES,
  SHORTCUTS,
  bindingFor,
  conflictingIds,
  defaultFor,
  formatShortcut,
  keyFromEvent,
  useShortcutStore,
} from '@/lib/shortcuts'

// Settings › Shortcuts. Every rebindable key in the app, read from one registry (lib/shortcuts.js)
// rather than a list maintained here - a shortcut added to the registry shows up in this tab and in
// its own tooltip without touching either.
//
// Capture-by-pressing rather than a text field: a binding is a key combination, and typing
// "shift+b" into a box is a spelling test nobody should have to pass.

function KeyCapture({ id, binding, conflicting }: { id: string; binding: string; conflicting?: boolean }) {
  const setBinding = useShortcutStore((s) => s.setBinding)
  const [capturing, setCapturing] = useState(false)

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Escape leaves the binding alone (the way out of a capture you started by accident); Backspace
    // and Delete turn the shortcut off, which is a real setting and not the same as "unset".
    if (event.key === 'Escape') {
      event.preventDefault()
      setCapturing(false)
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      setBinding(id, '')
      setCapturing(false)
      return
    }
    const key = keyFromEvent(event)
    // Null while only modifiers are down - keep listening instead of recording "shift".
    if (!key) return
    event.preventDefault()
    setBinding(id, key)
    setCapturing(false)
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={capturing ? 'default' : 'outline'}
      className={`w-40 justify-center font-mono ${conflicting && !capturing ? 'border-destructive text-destructive' : ''}`}
      onClick={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onKeyDown={capturing ? onKeyDown : undefined}
    >
      {capturing ? 'Press a key…' : formatShortcut(binding)}
    </Button>
  )
}

export default function ShortcutsTab() {
  const bindings = useShortcutStore((s) => s.bindings)
  const resetBinding = useShortcutStore((s) => s.resetBinding)
  const resetAll = useShortcutStore((s) => s.resetAll)
  const clashing = conflictingIds(bindings)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Click a key, press the combination you want. <span className="font-medium">Backspace</span> turns a
          shortcut off, <span className="font-medium">Esc</span> cancels. Saved in this browser only — they
          don't follow the account to another machine.
        </p>
        <Button size="sm" variant="ghost" className="shrink-0" onClick={resetAll}>
          <RotateCcwIcon className="size-3.5" /> Reset all
        </Button>
      </div>

      {clashing.size > 0 && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/[0.06] p-2.5 text-xs text-destructive">
          Two actions share a key — only one of them will fire. The clashing rows are marked below.
        </p>
      )}

      {SHORTCUT_SCOPES.map((scope) => (
        <div key={scope}>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {scope}
          </p>
          <div className="rounded-xl border">
            {SHORTCUTS.filter((s) => s.scope === scope).map((shortcut) => {
              const binding = bindingFor(bindings, shortcut.id)
              const changed = binding !== defaultFor(shortcut.id)
              return (
                <div
                  key={shortcut.id}
                  className="flex items-center justify-between gap-3 border-b p-2.5 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{shortcut.label}</p>
                    {changed && (
                      <p className="text-xs text-muted-foreground">
                        Default: {formatShortcut(defaultFor(shortcut.id))}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <KeyCapture id={shortcut.id} binding={binding} conflicting={clashing.has(shortcut.id)} />
                    {/* Only when it differs - a reset button on an untouched row is a button that
                        does nothing, on every row. */}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Reset ${shortcut.label}`}
                      className={changed ? '' : 'invisible'}
                      onClick={() => resetBinding(shortcut.id)}
                    >
                      <RotateCcwIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

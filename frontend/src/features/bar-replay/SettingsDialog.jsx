import { useEffect, useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

function ColorField({ label, value, onChange }) {
  return (
    <label className="flex items-center justify-between text-sm">
      {label}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-12 cursor-pointer rounded border bg-transparent p-0.5"
      />
    </label>
  )
}

// Bar Replay's chart/trading settings - candle colors, default order quantity, RSI reference
// levels (see store.js). Edits a local draft and only calls onSave on Ok, so Cancel (or
// closing without saving) discards whatever was changed - same convention as the order ticket.
export default function SettingsDialog({ open, onOpenChange, settings, onSave }) {
  const [draft, setDraft] = useState(settings)

  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }))
  const setLevel = (i, value) =>
    setDraft((d) => ({ ...d, rsiLevels: d.rsiLevels.map((l, li) => (li === i ? value : l)) }))
  const addLevel = () => setDraft((d) => ({ ...d, rsiLevels: [...d.rsiLevels, 50] }))
  const removeLevel = (i) => setDraft((d) => ({ ...d, rsiLevels: d.rsiLevels.filter((_, li) => li !== i) }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-5 overflow-y-auto">
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Candles</p>
            <ColorField label="Body up" value={draft.bodyUpColor} onChange={set('bodyUpColor')} />
            <ColorField label="Body down" value={draft.bodyDownColor} onChange={set('bodyDownColor')} />
            <ColorField label="Wick up" value={draft.wickUpColor} onChange={set('wickUpColor')} />
            <ColorField label="Wick down" value={draft.wickDownColor} onChange={set('wickDownColor')} />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.borderVisible}
                onChange={(e) => set('borderVisible')(e.target.checked)}
              />
              Borders
            </label>
            {draft.borderVisible && (
              <>
                <ColorField label="Border up" value={draft.borderUpColor} onChange={set('borderUpColor')} />
                <ColorField
                  label="Border down"
                  value={draft.borderDownColor}
                  onChange={set('borderDownColor')}
                />
              </>
            )}
          </div>

          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Trading</p>
            <label className="flex items-center justify-between text-sm">
              Default order quantity
              <Input
                type="number"
                min="1"
                value={draft.defaultQty}
                onChange={(e) => set('defaultQty')(Number(e.target.value) || 1)}
                className="w-20"
              />
            </label>
          </div>

          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">RSI levels</p>
            {draft.rsiLevels.map((level, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={level}
                  onChange={(e) => setLevel(i, Number(e.target.value) || 0)}
                  className="w-20"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove level ${level}`}
                  onClick={() => removeLevel(i)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addLevel}>
              <PlusIcon className="size-3.5" /> Add level
            </Button>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(draft)
              onOpenChange(false)
            }}
          >
            Ok
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

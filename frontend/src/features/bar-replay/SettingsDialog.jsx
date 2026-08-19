import { useEffect, useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { inr } from '@/lib/format'
import { preferredQuantity } from './orderEngine'

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

// Order sizing preference. One choice - a fixed share count, or a % of the selected account's
// balance - applied wherever a position is opened (order ticket, the market-order shortcuts).
// The live preview under the % option is the whole point of showing it here: "10% of capital"
// means nothing until you see it is 143 shares.
function SizingFields({ draft, set, balance, price }) {
  const byPct = draft.sizeMode === 'pctCapital'
  const preview = byPct && balance > 0 && price > 0 ? preferredQuantity(draft, balance, price) : null

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Order sizing</p>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="sizeMode" checked={!byPct} onChange={() => set('sizeMode')('qty')} />
          Fixed quantity
          <Input
            type="number"
            min="1"
            value={draft.defaultQty}
            onChange={(e) => set('defaultQty')(Number(e.target.value) || 1)}
            onFocus={() => set('sizeMode')('qty')}
            className="ml-auto w-24"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="sizeMode"
            checked={byPct}
            onChange={() => set('sizeMode')('pctCapital')}
          />
          % of available capital
          <div className="ml-auto flex items-center gap-1">
            <Input
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value={draft.capitalPct}
              onChange={(e) => set('capitalPct')(Number(e.target.value) || 0)}
              onFocus={() => set('sizeMode')('pctCapital')}
              className="w-24"
            />
            <span className="text-muted-foreground">%</span>
          </div>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {byPct
          ? preview != null
            ? `${inr(balance)} x ${draft.capitalPct}% at ${inr(price)} = ${preview} share${preview === 1 ? '' : 's'} (rounded down).`
            : 'Needs a selected account with a balance and a running replay to size. Falls back to the fixed quantity until then.'
          : `Every new order starts at ${draft.defaultQty} share${draft.defaultQty === 1 ? '' : 's'}.`}
      </p>
      <p className="text-xs text-muted-foreground">
        Applies to the Buy/Sell ticket and to the Shift+B / Shift+S market-order shortcuts.
      </p>
    </div>
  )
}

// Bar Replay's chart/trading settings - candle colors, RSI reference levels, and the order-sizing
// preference (see store.js). Edits a local draft and only calls onSave on Ok, so Cancel (or
// closing without saving) discards whatever was changed - same convention as the order ticket.
//
// `balance` and `price` are only here to preview what the sizing preference actually works out to
// right now; both are null-safe (no account selected, replay not started).
export default function SettingsDialog({ open, onOpenChange, settings, onSave, balance, price }) {
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
        <Tabs defaultValue="chart">
          <TabsList>
            <TabsTab value="chart">Chart</TabsTab>
            <TabsTab value="preferences">Preferences</TabsTab>
            <TabsIndicator />
          </TabsList>

          <TabsPanel value="chart" className="max-h-[65vh] space-y-5 overflow-y-auto">
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
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                RSI levels
              </p>
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
          </TabsPanel>

          <TabsPanel value="preferences" className="max-h-[65vh] space-y-5 overflow-y-auto">
            <SizingFields draft={draft} set={set} balance={balance} price={price} />
          </TabsPanel>
        </Tabs>

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

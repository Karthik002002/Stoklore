import type { ChartSettings } from './store'
import { useEffect, useRef, useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { inr } from '@/lib/format'
import { preferredQuantity } from './orderEngine'

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
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

/** A colour that may be left on the theme's default (null) - shows the default until picked. */
function OptionalColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string
  value: string | null
  fallback: string
  onChange: (value: string | null) => void
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      {label}
      <div className="flex items-center gap-1">
        {value != null ? (
          <Button variant="ghost" size="sm" className="h-7 px-1.5 text-xs" onClick={() => onChange(null)}>
            Reset
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">theme</span>
        )}
        <input
          type="color"
          value={value ?? fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-12 cursor-pointer rounded border bg-transparent p-0.5"
        />
      </div>
    </div>
  )
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

// Order sizing preference. One choice - a fixed share count, or a % of the selected account's
// balance - applied wherever a position is opened (order ticket, the market-order shortcuts).
// The live preview under the % option is the whole point of showing it here: "10% of capital"
// means nothing until you see it is 143 shares.
function SizingFields({
  draft,
  set,
  balance,
  price,
}: {
  draft: ChartSettings
  /** Curried by key: `set('defaultQty')(5)`. */
  set: <K extends keyof ChartSettings>(key: K) => (value: ChartSettings[K]) => void
  balance?: number | null
  price?: number | null
}) {
  const byPct = draft.sizeMode === 'pctCapital'
  const preview =
    byPct && (balance ?? 0) > 0 && (price ?? 0) > 0 ? preferredQuantity(draft, balance, price) : null

  return (
    <div className="space-y-3 rounded-lg border p-3">
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

// Bar Replay's chart/trading settings - candles, canvas, oscillator levels, and the order-sizing
// preference (see store.js). Every edit goes to onSave as it's made, so the chart behind the dialog
// previews it; Ok keeps it, and Cancel (or closing any other way) hands back the settings the
// dialog opened with.
//
// `balance` and `price` are only here to preview what the sizing preference actually works out to
// right now; both are null-safe (no account selected, replay not started).
export default function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSave,
  balance,
  price,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: ChartSettings
  onSave: (settings: ChartSettings) => void
  balance?: number | null
  price?: number | null
}) {
  const [draft, setDraft] = useState(settings)
  const savedRef = useRef(settings)

  // Snapshot on open only - `settings` changes under us while previewing, and re-reading it would
  // make the preview the thing Cancel reverts to.
  useEffect(() => {
    if (!open) return
    savedRef.current = settings
    setDraft(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => {
    if (open && draft !== savedRef.current) onSave(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])
  const close = (keep: boolean) => {
    if (!keep) onSave(savedRef.current)
    onOpenChange(false)
  }

  const set =
    <K extends keyof ChartSettings>(key: K) =>
    (value: ChartSettings[K]) =>
      setDraft((d) => ({ ...d, [key]: value }))
  const setLevel = (i: number, value: number) =>
    setDraft((d) => ({ ...d, rsiLevels: d.rsiLevels.map((l, li) => (li === i ? value : l)) }))
  const addLevel = () => setDraft((d) => ({ ...d, rsiLevels: [...d.rsiLevels, 50] }))
  const removeLevel = (i: number) =>
    setDraft((d) => ({ ...d, rsiLevels: d.rsiLevels.filter((_, li) => li !== i) }))

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close(false))}>
      <DialogContent className="w-[95vw] max-w-5xl sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="chart">
          <TabsList>
            <TabsTab value="chart">Chart</TabsTab>
            <TabsTab value="preferences">Preferences</TabsTab>
            <TabsIndicator />
          </TabsList>

          <TabsPanel value="chart" className="grid h-[min(34rem,70vh)] content-start items-start gap-3 overflow-y-auto pt-3 md:grid-cols-3">
            <div className="space-y-2 rounded-lg border p-3">
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

            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Canvas</p>
              <OptionalColorField label="Background" value={draft.background} fallback="#0a0a0a" onChange={set('background')} />
              <OptionalColorField label="Grid" value={draft.gridColor} fallback="#334155" onChange={set('gridColor')} />
              <OptionalColorField label="Axis text" value={draft.textColor} fallback="#9ca3af" onChange={set('textColor')} />
              <CheckField label="Horizontal grid lines" checked={draft.horzGridVisible} onChange={set('horzGridVisible')} />
              <CheckField label="Vertical grid lines" checked={draft.vertGridVisible} onChange={set('vertGridVisible')} />
              <CheckField label="Volume" checked={draft.volumeVisible} onChange={set('volumeVisible')} />
              <CheckField label="Last price line" checked={draft.lastPriceLine} onChange={set('lastPriceLine')} />
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Oscillator levels
              </p>
              <ColorField label="Upper level" value={draft.levelUpperColor} onChange={set('levelUpperColor')} />
              <ColorField label="Lower level" value={draft.levelLowerColor} onChange={set('levelLowerColor')} />
              <CheckField label="Fill between levels" checked={draft.levelBandVisible} onChange={set('levelBandVisible')} />
              {draft.levelBandVisible && (
                <ColorField label="Fill" value={draft.levelBandColor} onChange={set('levelBandColor')} />
              )}
              <p className="pt-1 text-xs text-muted-foreground">
                RSI levels (other oscillators: click the indicator's chip to set its own)
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

          <TabsPanel value="preferences" className="grid h-[min(34rem,70vh)] content-start items-start gap-3 overflow-y-auto pt-3 md:grid-cols-2">
            <SizingFields draft={draft} set={set} balance={balance} price={price} />
            <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!!draft.blind}
                onChange={(e) => set('blind')(e.target.checked)}
              />
              <span>
                <span className="font-medium">Blind replay</span>
                <span className="block text-xs text-muted-foreground">
                  Hides dates (axis, legend, jump field, messages) and the symbol name, so you can't match the
                  chart to what you remember happening next. Pair it with Random bar. The price level can
                  still hint at the era.
                </span>
              </span>
            </label>
          </TabsPanel>
        </Tabs>

        <div className="mt-4 flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(draft)
              close(true)
            }}
          >
            Ok
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

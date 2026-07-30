import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { inr } from '@/lib/format'

const numeric = (v) => (v === '' || v == null ? null : Number(v))

// One row per level of a ladder (stop-loss or target - both work the same way, see
// orderEngine.js/store.js): a price and how much of the position it covers, with a remove button
// once there's more than one row.
function LevelRows({ rows, onUpdate, onRemove }) {
  return rows.map((row, i) => (
    <div key={row.id} className="flex items-center gap-1.5">
      <Input
        type="number"
        step="0.01"
        value={row.price}
        onChange={(e) => onUpdate(row.id, { price: e.target.value })}
        placeholder={rows.length > 1 ? `Level ${i + 1} price ₹` : 'Price ₹'}
        className="flex-1"
      />
      <Input
        type="number"
        min="1"
        value={row.qty}
        onChange={(e) => onUpdate(row.id, { qty: e.target.value })}
        placeholder="Qty"
        className="w-20"
      />
      {rows.length > 1 && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove level ${i + 1}`}
          onClick={() => onRemove(row.id)}
        >
          <XIcon className="size-3.5" />
        </Button>
      )}
    </div>
  ))
}

// Order ticket - Market fills immediately at the current bar's close; Limit sits pending until
// a future bar's range touches the given entry price (see orderEngine.js). Take-profit and
// stop-loss are both optional ladders - one or more price+qty legs, each covering part of the
// position (see orderEngine.js/store.js) - with a live blended Risk/Reward readout, mirroring
// TradingView's order panel.
export default function OrderTicketDialog({ draft, onChange, onCancel, onSubmit, symbol, lastBar }) {
  if (!draft) return null
  const marketPrice = lastBar?.close ?? 0
  const isLimit = draft.orderType === 'limit'
  const entry = isLimit ? (numeric(draft.entryPrice) ?? marketPrice) : marketPrice
  const qty = Number(draft.qty) || 0
  const isLong = draft.direction === 'long'

  // --- Stop loss ladder --------------------------------------------------------------------
  const addSlLevel = () =>
    onChange({ stopLosses: [...draft.stopLosses, { id: crypto.randomUUID(), price: '', qty: '' }] })
  const removeSlLevel = (id) => onChange({ stopLosses: draft.stopLosses.filter((r) => r.id !== id) })
  const updateSlLevel = (id, patch) =>
    onChange({ stopLosses: draft.stopLosses.map((r) => (r.id === id ? { ...r, ...patch } : r)) })

  const slRows = draft.slEnabled ? draft.stopLosses : []
  // Legs with both fields filled in - what actually feeds the risk math below. A row mid-edit
  // (only price or only qty typed so far) just doesn't count yet rather than erroring immediately.
  const slLegs = slRows
    .map((r) => ({ price: numeric(r.price), qty: numeric(r.qty) }))
    .filter((r) => r.price != null && r.qty != null)
  const slAllocatedQty = slLegs.reduce((s, r) => s + r.qty, 0)
  const slQtyError =
    slAllocatedQty > qty ? `Stop-loss quantities (${slAllocatedQty}) exceed order size (${qty})` : null
  const slSideError = slLegs.some((r) => (isLong ? entry - r.price : r.price - entry) <= 0)
    ? `Every level must be ${isLong ? 'below' : 'above'} entry price`
    : null
  const slError = slQtyError ?? slSideError

  // Blended risk across every leg (weighted by how much quantity it covers) - unprotected
  // quantity (rows left blank, or qty not yet fully allocated) simply isn't counted, same as
  // today's "no stop loss set at all" having no risk figure to show.
  const totalRisk = slLegs.reduce(
    (s, r) => s + Math.max(isLong ? entry - r.price : r.price - entry, 0) * r.qty,
    0,
  )
  const risk = draft.slEnabled && slLegs.length > 0 ? totalRisk : null
  const riskPct = risk != null && entry && qty ? (risk / (entry * qty)) * 100 : null

  // --- Take profit ladder (same shape as stop loss, mirrored on the reward side) ------------
  const addTargetLevel = () =>
    onChange({ targets: [...draft.targets, { id: crypto.randomUUID(), price: '', qty: '' }] })
  const removeTargetLevel = (id) => onChange({ targets: draft.targets.filter((r) => r.id !== id) })
  const updateTargetLevel = (id, patch) =>
    onChange({ targets: draft.targets.map((r) => (r.id === id ? { ...r, ...patch } : r)) })

  const targetRows = draft.targetEnabled ? draft.targets : []
  const targetLegs = targetRows
    .map((r) => ({ price: numeric(r.price), qty: numeric(r.qty) }))
    .filter((r) => r.price != null && r.qty != null)
  const targetAllocatedQty = targetLegs.reduce((s, r) => s + r.qty, 0)
  const targetQtyError =
    targetAllocatedQty > qty
      ? `Take-profit quantities (${targetAllocatedQty}) exceed order size (${qty})`
      : null
  const targetSideError = targetLegs.some((r) => (isLong ? r.price - entry : entry - r.price) <= 0)
    ? `Every level must be ${isLong ? 'above' : 'below'} entry price`
    : null
  const targetError = targetQtyError ?? targetSideError

  const totalReward = targetLegs.reduce(
    (s, r) => s + Math.max(isLong ? r.price - entry : entry - r.price, 0) * r.qty,
    0,
  )
  const reward = draft.targetEnabled && targetLegs.length > 0 ? totalReward : null
  const rewardPct = reward != null && entry && qty ? (reward / (entry * qty)) * 100 : null

  const rr = risk > 0 && reward > 0 ? reward / risk : null
  const valid = qty > 0 && (!isLimit || numeric(draft.entryPrice) != null) && !targetError && !slError

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-sm" blurBackground={false}>
        <DialogHeader>
          <DialogTitle className="capitalize">
            {draft.direction === 'long' ? 'Buy' : 'Sell'} {symbol}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={draft.orderType === 'market' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => onChange({ orderType: 'market' })}
            >
              Market
            </Button>
            <Button
              size="sm"
              variant={isLimit ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => onChange({ orderType: 'limit' })}
            >
              Limit
            </Button>
          </div>

          {isLimit ? (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Entry price ₹</label>
              <Input
                type="number"
                step="0.01"
                value={draft.entryPrice}
                onChange={(e) => onChange({ entryPrice: e.target.value })}
                placeholder={`Market is ${inr(marketPrice)}`}
              />
              <p className="text-xs text-muted-foreground">
                Fills once price reaches this level - not placed yet.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">Market price</span>
              <span className="font-semibold tabular-nums">{inr(entry)}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Shares</label>
            <Input
              type="number"
              min="1"
              value={draft.qty}
              onChange={(e) => onChange({ qty: e.target.value })}
            />
          </div>

          <div className="space-y-1.5 rounded-lg border p-2.5">
            <label className="flex items-center justify-between text-sm font-medium">
              Take profit
              <input
                type="checkbox"
                checked={draft.targetEnabled}
                onChange={(e) => {
                  const checked = e.target.checked
                  onChange({
                    targetEnabled: checked,
                    // Enabling for the first time seeds one row covering the whole position -
                    // same as a plain single target. "Add level" below splits it further.
                    targets:
                      checked && draft.targets.length === 0
                        ? [{ id: crypto.randomUUID(), price: '', qty: draft.qty }]
                        : draft.targets,
                  })
                }}
              />
            </label>
            {draft.targetEnabled && (
              <>
                <LevelRows rows={draft.targets} onUpdate={updateTargetLevel} onRemove={removeTargetLevel} />
                <Button type="button" size="sm" variant="ghost" className="w-full" onClick={addTargetLevel}>
                  <PlusIcon className="size-3.5" /> Add level
                </Button>
                {targetError ? (
                  <p className="text-xs text-down">{targetError}</p>
                ) : (
                  rewardPct != null && (
                    <p className="text-xs text-up">
                      +{rewardPct.toFixed(2)}%{draft.targets.length > 1 ? ' blended' : ''}
                    </p>
                  )
                )}
              </>
            )}
          </div>

          <div className="space-y-1.5 rounded-lg border p-2.5">
            <label className="flex items-center justify-between text-sm font-medium">
              Stop loss
              <input
                type="checkbox"
                checked={draft.slEnabled}
                onChange={(e) => {
                  const checked = e.target.checked
                  onChange({
                    slEnabled: checked,
                    // Enabling for the first time seeds one row covering the whole position -
                    // same as a plain single stop loss. "Add level" below splits it further.
                    stopLosses:
                      checked && draft.stopLosses.length === 0
                        ? [{ id: crypto.randomUUID(), price: '', qty: draft.qty }]
                        : draft.stopLosses,
                  })
                }}
              />
            </label>
            {draft.slEnabled && (
              <>
                <LevelRows rows={draft.stopLosses} onUpdate={updateSlLevel} onRemove={removeSlLevel} />
                <Button type="button" size="sm" variant="ghost" className="w-full" onClick={addSlLevel}>
                  <PlusIcon className="size-3.5" /> Add level
                </Button>
                {slError ? (
                  <p className="text-xs text-down">{slError}</p>
                ) : (
                  riskPct != null && (
                    <p className="text-xs text-down">
                      -{riskPct.toFixed(2)}%{draft.stopLosses.length > 1 ? ' blended' : ''}
                    </p>
                  )
                )}
              </>
            )}
          </div>

          <div className="space-y-1 rounded-lg border p-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Risk / Reward</span>
              <span className="font-semibold tabular-nums">{rr != null ? rr.toFixed(2) : '—'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Risk</span>
              <span className="text-down tabular-nums">
                {risk != null && !slError ? `${inr(risk)} (${riskPct.toFixed(2)}%)` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Reward</span>
              <span className="text-up tabular-nums">
                {reward != null && !targetError ? `${inr(reward)} (${rewardPct.toFixed(2)}%)` : '—'}
              </span>
            </div>
          </div>

          <Button
            className={`w-full text-white ${draft.direction === 'long' ? 'bg-up hover:bg-up/90' : 'bg-down hover:bg-down/90'}`}
            disabled={!valid}
            onClick={onSubmit}
          >
            {draft.direction === 'long' ? 'Buy' : 'Sell'} {qty || 0} {symbol} @ {inr(entry)}{' '}
            {isLimit ? 'Limit' : 'Market'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

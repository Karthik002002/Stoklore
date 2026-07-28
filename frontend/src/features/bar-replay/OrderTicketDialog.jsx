import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { inr } from '@/lib/format'

const numeric = (v) => (v === '' || v == null ? null : Number(v))

// Order ticket - Market fills immediately at the current bar's close; Limit sits pending until
// a future bar's range touches the given entry price (see orderEngine.js). Optional
// take-profit/stop-loss with a live Risk/Reward readout, mirroring TradingView's order panel.
export default function OrderTicketDialog({ draft, onChange, onCancel, onSubmit, symbol, lastBar }) {
  if (!draft) return null
  const marketPrice = lastBar?.close ?? 0
  const isLimit = draft.orderType === 'limit'
  const entry = isLimit ? (numeric(draft.entryPrice) ?? marketPrice) : marketPrice
  const qty = Number(draft.qty) || 0
  const slPrice = draft.slEnabled ? numeric(draft.sl) : null
  const targetPrice = draft.targetEnabled ? numeric(draft.target) : null

  const isLong = draft.direction === 'long'
  // Signed (not Math.abs'd) moves - a target/stop on the wrong side of entry comes out negative
  // here instead of silently showing as a positive-looking reward/risk.
  const rewardMove = targetPrice != null ? (isLong ? targetPrice - entry : entry - targetPrice) : null
  const riskMove = slPrice != null ? (isLong ? entry - slPrice : slPrice - entry) : null
  const reward = rewardMove != null ? rewardMove * qty : null
  const risk = riskMove != null ? riskMove * qty : null
  const rewardPct = rewardMove != null && entry ? (rewardMove / entry) * 100 : null
  const riskPct = riskMove != null && entry ? (riskMove / entry) * 100 : null
  const rr = risk > 0 && reward > 0 ? reward / risk : null
  const targetError =
    rewardMove != null && rewardMove <= 0 ? `Target must be ${isLong ? 'above' : 'below'} entry price` : null
  const slError =
    riskMove != null && riskMove <= 0 ? `Stop loss must be ${isLong ? 'below' : 'above'} entry price` : null
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
                onChange={(e) => onChange({ targetEnabled: e.target.checked })}
              />
            </label>
            {draft.targetEnabled && (
              <>
                <Input
                  type="number"
                  step="0.01"
                  value={draft.target}
                  onChange={(e) => onChange({ target: e.target.value })}
                  placeholder="Price ₹"
                />
                {targetError ? (
                  <p className="text-xs text-down">{targetError}</p>
                ) : (
                  rewardPct != null && (
                    <p className={`text-xs ${rewardPct >= 0 ? 'text-up' : 'text-down'}`}>
                      {rewardPct >= 0 ? '+' : ''}
                      {rewardPct.toFixed(2)}%
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
                onChange={(e) => onChange({ slEnabled: e.target.checked })}
              />
            </label>
            {draft.slEnabled && (
              <>
                <Input
                  type="number"
                  step="0.01"
                  value={draft.sl}
                  onChange={(e) => onChange({ sl: e.target.value })}
                  placeholder="Price ₹"
                />
                {slError ? (
                  <p className="text-xs text-down">{slError}</p>
                ) : (
                  riskPct != null && <p className="text-xs text-down">-{riskPct.toFixed(2)}%</p>
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

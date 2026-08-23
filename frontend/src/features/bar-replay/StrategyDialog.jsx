import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { inr } from '@/lib/format'
import { positionSizeCap } from '@/lib/tradeAccounts'
import { accountHasCosts, roundTripCost } from '@/lib/tradeCosts'

// The rules you set for this account, on demand, mid-replay. Bar Replay is where discipline
// actually gets tested - the whole point of the exercise is taking the setup you said you would
// take - so the rules have to be one keystroke away rather than a tab away in Settings.
//
// Read-only by design: editing here would mean changing the rules in the middle of the trade you
// are about to judge yourself on, which is the exact habit this is meant to interrupt. The dialog
// links nowhere either; it closes and you are back on the bar you were on.
//
// Everything shown comes from the account row already fetched for the balance calculation - no
// query of its own.

const PREVIEW_QTY = 100

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-1.5 last:border-0">
      <span className="text-xs tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="text-right text-sm tabular-nums">{children}</span>
    </div>
  )
}

export default function StrategyDialog({ open, onOpenChange, account, balance, price }) {
  const cap = account ? positionSizeCap(account, balance) : null
  // Priced off the bar on screen, not a made-up number: "₹47 a round trip" lands differently when
  // it is this symbol at this price for a size you would actually take.
  const costs = account && accountHasCosts(account) ? roundTripCost(account, price ?? 0, PREVIEW_QTY) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {account ? account.name : 'No account selected'}
            {account?.strategy && <Badge variant="secondary">{account.strategy}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {!account ? (
          <p className="text-sm text-muted-foreground">
            This replay isn't filed under an account, so there are no rules to show. Pick one in Setup (
            <kbd className="rounded border px-1 font-mono text-xs">/</kbd>) to trade it against a real wallet
            and its strategy.
          </p>
        ) : (
          <div className="space-y-4">
            {account.strategy_explanation ? (
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-sm whitespace-pre-wrap">{account.strategy_explanation}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No strategy explanation written for this account yet — Settings › Trade accounts.
              </p>
            )}

            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Rules
              </p>
              <Row label="Balance">{inr(balance)}</Row>
              <Row label="Max position size">
                {account.max_position_size == null ? (
                  <span className="text-muted-foreground">No cap</span>
                ) : account.max_position_size_type === 'percentage' ? (
                  <>
                    {account.max_position_size}% of balance
                    {cap != null && <span className="ml-1 text-muted-foreground">· {inr(cap)}</span>}
                  </>
                ) : (
                  inr(account.max_position_size)
                )}
              </Row>
              <Row label="Max open positions">
                {account.max_position_count ?? <span className="text-muted-foreground">No cap</span>}
              </Row>
              <Row label="Loss streak reminder">
                {account.loss_streak_alert ? (
                  `After ${account.loss_streak_alert} losses in a row`
                ) : (
                  <span className="text-muted-foreground">Off</span>
                )}
              </Row>
              <Row label="Volume spike">
                {account.vol_spike_multiple}× avg, {account.vol_spike_lookback} bars before entry
              </Row>
              <Row label="Round trip cost">
                {costs ? (
                  <>
                    {inr(costs.total)}
                    <span className="ml-1 text-muted-foreground">
                      · {PREVIEW_QTY} sh at {inr(price ?? 0)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">No costs configured</span>
                )}
              </Row>
            </div>

            {/* Caps are advisory everywhere else in the app - they warn, they never block - so this
                says the same thing rather than implying the replay will stop you. */}
            <p className="text-xs text-muted-foreground">
              Caps are advisory: the order ticket warns, it never refuses the trade.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

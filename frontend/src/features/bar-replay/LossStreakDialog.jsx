import { FlameIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { inr } from '@/lib/format'

// The interruption after a losing run, once the account's own threshold is hit (Settings > Trade
// accounts, "Remind me after N losses in a row"). It comes up AFTER the close dialog, so the trade
// is already journaled and the streak on screen includes it.
//
// It asks rather than instructs. What to do about a losing run is a matter of strategy - stop for
// the day, halve the size, go back to the rules - and this app does not know which is right for
// yours; the one thing it can usefully do is make sure the run gets noticed before the next entry,
// which is exactly when nobody notices it.
//
// No "don't show again": that is the setting, and it lives on the account where it can be reasoned
// about between sessions instead of dismissed mid-tilt.
export default function LossStreakDialog({ streak, account, lost, onClose }) {
  if (!streak) return null

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlameIcon className="size-4 text-destructive" />
            {streak} losses in a row
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {account?.name ? `${account.name} is` : "You're"} on a {streak}-trade losing run
            {lost != null && lost > 0 ? ` — ${inr(lost)} across them` : ''}. You asked to be told at{' '}
            {account?.loss_streak_alert}.
          </p>

          {/* The account's own words, if it has any. Re-reading the plan you wrote calmly is the
              cheapest available intervention, and it beats anything this dialog could invent. */}
          {account?.strategy_explanation ? (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="mb-1 text-xs tracking-wide text-muted-foreground uppercase">
                What this account trades
              </p>
              <p className="whitespace-pre-wrap">{account.strategy_explanation}</p>
            </div>
          ) : (
            <p className="text-muted-foreground">
              Worth asking: is the setup still there, or are you taking trades because the last one lost?
            </p>
          )}

          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              Got it
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

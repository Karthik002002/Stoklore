import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SelectField, TagField, TextAreaField } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { inr } from '@/lib/format'
import { autoResult, EMOTIONS, NEUTRAL_PNL_BAND, tradePnl } from '@/lib/manualTrades'
import { tradeCosts, tradeNetPnl } from '@/lib/tradeCosts'
import { closeTradeSchema } from '@/lib/schemas'
import { createManualTrade, getTradeAccounts, uploadManualTradeImage } from '@/services/api'
import { CLOSE_REASON_LABEL } from './orderEngine'

const RESULT_OPTIONS = [
  { value: 'profit', label: 'Profit' },
  { value: 'loss', label: 'Loss' },
  { value: 'neutral', label: 'Neutral' },
]
const EMOTION_OPTIONS = EMOTIONS.map((e) => ({ value: e, label: e }))

export default function CloseTradeDialog({
  open,
  onOpenChange,
  symbol,
  order,
  exitPrice,
  reason,
  leg,
  partialQty,
  chartImage,
  accountId,
  entryDate,
  exitDate,
  onClosed,
}) {
  const form = useForm({
    resolver: zodResolver(closeTradeSchema),
    defaultValues: { result: null, emotion: null, tags: [], notes: '' },
  })

  // For a MANUAL close (no leg attached, no auto-trigger reason) the user can shrink the
  // quantity to close just a slice - the remainder stays open. Auto-triggered leg closes have a
  // fixed qty (the leg's own), and any user edit there would misreport what actually happened.
  // Seeded from the partialQty the caller pre-suggested (via "Close 50" in PositionsList) or
  // from the order's full remaining qty for a plain "Close all" click.
  const isManual = reason === 'manual' && !leg
  const [manualQty, setManualQty] = useState(partialQty ?? order?.quantity ?? 0)
  useEffect(() => {
    if (open) setManualQty(partialQty ?? order?.quantity ?? 0)
  }, [open, partialQty, order?.quantity])

  // A laddered stop-loss/target leg only closes its own slice of the position, not the order's
  // full quantity - falls back to the order's (remaining) quantity for a plain full/manual close,
  // or the user's manual override when it's a partial.
  const quantity = leg?.qty ?? (isManual ? manualQty : order?.quantity)
  // Report whichever level actually triggered THIS close as its journaled price - a leg is
  // attached for both stop-loss and target hits now, so it must be gated by `reason`, not just
  // "is there a leg", or a target hit would get misreported as its stop-loss price and vice
  // versa. Falls back to the position's first remaining level on that side for a manual close
  // (no reason to attribute to either) - informational only, same as before laddering existed.
  const stopLossPrice = reason === 'stop_loss' ? leg?.price : (order?.stopLosses?.[0]?.price ?? null)
  const targetPrice = reason === 'target' ? leg?.price : (order?.targets?.[0]?.price ?? null)

  const closingTrade = order
    ? {
        direction: order.direction,
        entry_price: order.entryPrice,
        exit_price: exitPrice,
        quantity,
      }
    : null
  const pnl = closingTrade ? tradePnl(closingTrade) : null
  // What this close costs under the account it will be journaled to - shown before you confirm,
  // because "profit" and "profit after costs" are not always the same verdict on a small winner.
  const { data: accounts = [] } = useQuery({
    queryKey: ['tradeAccounts'],
    queryFn: () => getTradeAccounts(),
  })
  const account = accounts.find((a) => a.id === accountId) ?? null
  const costs = closingTrade ? tradeCosts(closingTrade, account) : null
  const net = closingTrade ? tradeNetPnl(closingTrade, account) : null

  // `quantity` matters here: autoResult multiplies by it to get ₹ P&L, and the neutral band is in
  // rupees. Omitting it (as this dialog used to) makes tradePnl return NaN, which classified
  // every single replay trade as "neutral" regardless of how it actually went.
  const computedResult = order
    ? autoResult({
        direction: order.direction,
        quantity,
        entry_price: order.entryPrice,
        exit_price: exitPrice,
      })
    : null

  // Seed the Result field with what the P&L says the moment the dialog opens. The user can still
  // override it before saving; nothing recomputes underneath them afterwards.
  useEffect(() => {
    if (open) form.reset({ result: computedResult, emotion: null, tags: [], notes: '' })
  }, [open, computedResult, form])

  const save = useMutation({
    mutationFn: async (values) => {
      const { id } = await createManualTrade({
        symbol,
        direction: order.direction,
        quantity,
        entry_price: order.entryPrice,
        exit_price: exitPrice,
        stop_loss: stopLossPrice,
        target: targetPrice,
        is_open: false,
        result: values.result,
        emotion: values.emotion || null,
        tags: [...values.tags, 'replay'],
        notes: values.notes || null,
        // The replay bar's date is simulated history, not when this trade was actually journaled -
        // logging it under the real wall-clock time keeps the journal's dates meaningful (e.g. for
        // the overview's calendar) regardless of which historical period was being replayed.
        traded_at: new Date().toISOString(),
        // ...which is exactly why the replayed dates have to be sent separately. The backend reads
        // the bars around `market_at` (not `traded_at`) for the entry-context snapshot, so without
        // these a trade replayed from 2022 would be scored against today's chart.
        market_at: entryDate ?? null,
        exited_at: exitDate ?? null,
        image_filename: null,
        account_id: accountId ?? null,
      })
      // The chart snapshot (see BarReplay's captureScreenshot) is taken at close time, before
      // this dialog even opens - same upload-after-create flow as the manual trade form's own
      // screenshot upload, just from a captured Blob instead of a user-picked file.
      if (chartImage) await uploadManualTradeImage(id, chartImage)
    },
    onSuccess: () => {
      toast.success('Trade logged')
      onClosed()
    },
    onError: (e) => toast.error(e.message),
  })

  if (!order) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="capitalize">
            Close {symbol} {order.direction}
            {leg && quantity < order.quantity && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground normal-case">
                (partial: {quantity}/{order.quantity} shares)
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-3">
          {reason && reason !== 'manual' && (
            <p className="text-xs font-medium text-muted-foreground">{CLOSE_REASON_LABEL[reason]}</p>
          )}
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3 text-sm">
            <span>
              {quantity} @ {inr(order.entryPrice)} → {inr(exitPrice)}
            </span>
            <span className="text-right">
              <span
                className={`font-semibold tabular-nums ${
                  computedResult === 'neutral' ? '' : pnl >= 0 ? 'text-up' : 'text-down'
                }`}
              >
                {inr(pnl)}
              </span>
              {costs?.total > 0 && (
                <span className="block text-[11px] text-muted-foreground tabular-nums">
                  {inr(net)} net · {inr(costs.total)} costs
                </span>
              )}
            </span>
          </div>

          <SelectField
            form={form}
            name="result"
            label="Result"
            options={RESULT_OPTIONS}
            placeholder="—"
            hint={`Set from P&L — within ±${inr(NEUTRAL_PNL_BAND)} of flat counts as neutral. Override if you disagree.`}
          />

          <SelectField
            form={form}
            name="emotion"
            label="Emotion"
            options={EMOTION_OPTIONS}
            placeholder="How did it feel?"
          />

          <TagField form={form} name="tags" label="Tags" />

          <TextAreaField
            form={form}
            name="notes"
            label="Notes"
            rows={3}
            placeholder="What happened, what would you do differently…"
          />

          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending && <Spinner className="size-4" />}
            Log trade
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

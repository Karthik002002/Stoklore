import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import TagInput from '@/components/TagInput'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { inr } from '@/lib/format'
import { autoResult, EMOTIONS, tradePnl } from '@/lib/manualTrades'
import { createManualTrade, uploadManualTradeImage } from '@/services/api'
import { CLOSE_REASON_LABEL } from './orderEngine'

export default function CloseTradeDialog({
  open,
  onOpenChange,
  symbol,
  order,
  exitPrice,
  reason,
  leg,
  chartImage,
  onClosed,
}) {
  const [result, setResult] = useState(null)
  const [resultManual, setResultManual] = useState(false)
  const [emotion, setEmotion] = useState('')
  const [tags, setTags] = useState([])
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (open) {
      setResult(null)
      setResultManual(false)
      setEmotion('')
      setTags([])
      setNotes('')
    }
  }, [open])

  // A laddered stop-loss/target leg only closes its own slice of the position, not the order's
  // full quantity - falls back to the order's (remaining) quantity for a plain full/manual close.
  const quantity = leg?.qty ?? order?.quantity
  // Report whichever level actually triggered THIS close as its journaled price - a leg is
  // attached for both stop-loss and target hits now, so it must be gated by `reason`, not just
  // "is there a leg", or a target hit would get misreported as its stop-loss price and vice
  // versa. Falls back to the position's first remaining level on that side for a manual close
  // (no reason to attribute to either) - informational only, same as before laddering existed.
  const stopLossPrice = reason === 'stop_loss' ? leg?.price : (order?.stopLosses?.[0]?.price ?? null)
  const targetPrice = reason === 'target' ? leg?.price : (order?.targets?.[0]?.price ?? null)
  const computedResult = order
    ? autoResult({ direction: order.direction, entry_price: order.entryPrice, exit_price: exitPrice })
    : null
  const effectiveResult = resultManual ? result : computedResult
  const pnl = order
    ? tradePnl({
        direction: order.direction,
        entry_price: order.entryPrice,
        exit_price: exitPrice,
        quantity,
      })
    : null

  const save = useMutation({
    mutationFn: async () => {
      const { id } = await createManualTrade({
        symbol,
        direction: order.direction,
        quantity,
        entry_price: order.entryPrice,
        exit_price: exitPrice,
        stop_loss: stopLossPrice,
        target: targetPrice,
        is_open: false,
        result: effectiveResult,
        emotion: emotion || null,
        tags: [...tags, 'replay'],
        notes: notes || null,
        // The replay bar's date is simulated history, not when this trade was actually journaled -
        // logging it under the real wall-clock time keeps the journal's dates meaningful (e.g. for
        // the overview's calendar) regardless of which historical period was being replayed.
        traded_at: new Date().toISOString(),
        image_filename: null,
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
        <div className="space-y-3">
          {reason && reason !== 'manual' && (
            <p className="text-xs font-medium text-muted-foreground">{CLOSE_REASON_LABEL[reason]}</p>
          )}
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3 text-sm">
            <span>
              {quantity} @ {inr(order.entryPrice)} → {inr(exitPrice)}
            </span>
            <span className={`font-semibold tabular-nums ${pnl >= 0 ? 'text-up' : 'text-down'}`}>
              {inr(pnl)}
            </span>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Result</label>
            <Select
              value={effectiveResult ?? ''}
              onValueChange={(v) => {
                setResult(v)
                setResultManual(true)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="profit">Profit</SelectItem>
                <SelectItem value="loss">Loss</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Emotion</label>
            <Select value={emotion} onValueChange={setEmotion}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="How did it feel?" />
              </SelectTrigger>
              <SelectContent>
                {EMOTIONS.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Tags</label>
            <TagInput value={tags} onChange={setTags} />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What happened, what would you do differently…"
            />
          </div>

          <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner className="size-4" />}
            Log trade
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellIcon, BellRingIcon, TrashIcon } from 'lucide-react'
import { toast } from 'sonner'
import SymbolCombobox from '@/components/SymbolCombobox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { inr, timeAgo } from '@/lib/format'
import { acknowledgeAlerts, createAlert, deleteAlert, getAlerts } from '@/services/api'

// One panel, two lists, because they are two different questions: "what am I waiting for" (armed
// levels) and "what happened" (the feed - fills, rejections, closed positions, and the levels that
// have since fired). Merging them would bury a live rejection under a week of triggered alerts.
export default function AlertsPanel() {
  const queryClient = useQueryClient()
  const [symbol, setSymbol] = useState('')
  const [condition, setCondition] = useState('above')
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')

  // Polled, not pushed: the alert sweep runs server-side every few seconds (app/core/live.py), so
  // the browser only has to notice. A websocket for a list this short would be more moving parts
  // than the thing it delivers.
  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => getAlerts(),
    refetchInterval: 10_000,
  })

  const armed = alerts.filter((a) => a.active && a.kind === 'price')
  const feed = alerts.filter((a) => a.triggered_at)
  const unread = feed.filter((a) => !a.acknowledged_at).length

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['alerts'] })
  const add = useMutation({
    mutationFn: createAlert,
    onSuccess: (data) => {
      refresh()
      setPrice('')
      setNote('')
      // An alert that is already true is a legitimate thing to set ("tell me while it is above
      // 100"), and it will fire on the next sweep - which is surprising unless it's said out loud.
      toast[data.already_true ? 'warning' : 'success'](
        data.already_true
          ? `Set — but ${symbol} is already there (${inr(data.current_price)}), so it fires immediately`
          : `Watching ${symbol}`,
      )
    },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({ mutationFn: deleteAlert, onSuccess: refresh })
  const ack = useMutation({ mutationFn: () => acknowledgeAlerts(), onSuccess: refresh })

  const submit = (e) => {
    e.preventDefault()
    if (!symbol || !Number(price)) return
    add.mutate({ symbol, condition, price: Number(price), note: note || null })
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          {unread > 0 ? <BellRingIcon className="size-4 text-primary" /> : <BellIcon className="size-4" />}
          Alerts
          {unread > 0 && <Badge variant="default">{unread}</Badge>}
        </h2>
        {unread > 0 && (
          <Button size="sm" variant="ghost" onClick={() => ack.mutate()}>
            Mark read
          </Button>
        )}
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-center gap-1.5">
        <SymbolCombobox value={symbol} onChange={setSymbol} className="w-40" />
        <Select value={condition} onValueChange={setCondition}>
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="above">Rises to</SelectItem>
            <SelectItem value="below">Falls to</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          step="0.05"
          placeholder="Price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="h-8 w-28"
        />
        <Input
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-8 w-44"
        />
        <Button size="sm" type="submit" disabled={!symbol || !Number(price) || add.isPending}>
          Watch
        </Button>
      </form>

      {armed.length > 0 && (
        <ul className="space-y-1">
          {armed.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs">
              <span className="font-medium">{a.symbol}</span>
              <span className="text-muted-foreground">
                {a.condition === 'above' ? '≥' : '≤'} {inr(a.price)}
              </span>
              {a.recurring && <Badge variant="outline">repeats</Badge>}
              {a.note && <span className="truncate text-muted-foreground">{a.note}</span>}
              <Button
                size="icon-sm"
                variant="ghost"
                className="ml-auto text-muted-foreground"
                aria-label="Delete alert"
                onClick={() => remove.mutate(a.id)}
              >
                <TrashIcon className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="max-h-64 space-y-1 overflow-y-auto">
        {feed.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nothing yet. Fills, rejections and triggered levels land here.
          </p>
        ) : (
          feed.map((a) => (
            <div
              key={a.id}
              className={`rounded-lg px-2 py-1 text-xs ${a.acknowledged_at ? 'text-muted-foreground' : 'bg-muted/50'}`}
            >
              <span className={a.kind === 'order' ? 'font-medium' : ''}>{a.message}</span>
              <span className="ml-1.5 text-[11px] text-muted-foreground">{timeAgo(a.triggered_at)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

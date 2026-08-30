import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangleIcon, OctagonXIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import AlertsPanel from '@/live/AlertsPanel'
import SymbolCombobox from '@/components/SymbolCombobox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import {
  cancelLiveOrder,
  closeLivePosition,
  getLiveOrders,
  getLivePositions,
  getLiveStatus,
  livePanic,
  placeLiveOrder,
  recoverLiveOrder,
  resumeLive,
  syncLive,
  updateLiveSettings,
} from '@/services/api'

// Real orders, real money. The paper equivalent of this page (paper/PaperTrading.jsx) simulates
// everything; nothing here does. What the table shows is Dhan's own order and position books,
// mirrored by app/core/live.py - if this screen and the broker's app disagree, the broker is right.
//
// Three things on this page exist only because it is real:
//  - the state banner, which says out loud whether an order can even be sent right now;
//  - the kill switch, which halts for the day and cancels what's working (it does NOT liquidate);
//  - the unconfirmed list, for an order whose send timed out - resolved by asking the broker what
//    happened, never by sending it again.

const OPEN_STATUSES = ['TRANSIT', 'PENDING', 'PART_TRADED']

const statusTone = (status) =>
  status === 'TRADED'
    ? 'success'
    : status === 'REJECTED'
      ? 'destructive'
      : OPEN_STATUSES.includes(status)
        ? 'default'
        : 'outline'

/** The one-line answer to "can I trade right now", and the button that takes it away. */
function StateBar({ status, onPanic, onResume, onToggle, busy }) {
  const settings = status?.settings ?? {}
  const runtime = status?.runtime ?? {}
  const blocked = !status?.configured || !settings.enabled || runtime.halted

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 ${
        blocked ? 'border-dashed' : 'border-primary/40 bg-primary/5'
      }`}
    >
      <Badge variant={blocked ? 'outline' : 'success'}>{blocked ? 'Not trading' : 'Live'}</Badge>
      {status?.sandbox && <Badge variant="secondary">Sandbox</Badge>}
      {!status?.configured && (
        <span className="text-xs text-muted-foreground">
          No Dhan credentials —{' '}
          <Link to="/settings" className="underline">
            add them in Settings
          </Link>
        </span>
      )}
      {runtime.halted && (
        <span className="flex items-center gap-1 text-xs text-destructive">
          <AlertTriangleIcon className="size-3.5" />
          Halted today: {runtime.halt_reason}
        </span>
      )}
      <span className="text-xs text-muted-foreground tabular-nums">
        {runtime.orders_today ?? 0}/{settings.max_orders_per_day} orders · realised{' '}
        {inr(runtime.realised_today ?? 0)} · cap {inr(settings.max_order_value)}/order · stop{' '}
        {inr(settings.daily_loss_limit)}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        {runtime.halted ? (
          <Button size="sm" variant="outline" onClick={onResume} disabled={busy}>
            Resume today
          </Button>
        ) : (
          <Button size="sm" variant="destructive" onClick={onPanic} disabled={busy}>
            <OctagonXIcon className="size-4" />
            Kill switch
          </Button>
        )}
        <Button
          size="sm"
          variant={settings.enabled ? 'secondary' : 'default'}
          onClick={() => onToggle(!settings.enabled)}
          disabled={busy || !status?.configured}
        >
          {settings.enabled ? 'Switch off' : 'Switch on'}
        </Button>
      </div>
    </div>
  )
}

/** Order entry. Everything it can check locally it checks here; the backend checks all of it again
 *  and is the one that decides - this only saves a round trip and shows the sizing as you type. */
function Ticket({ onPlace, busy, disabled }) {
  const [symbol, setSymbol] = useState('')
  const [direction, setDirection] = useState('long')
  const [quantity, setQuantity] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')

  const qty = Number(quantity)
  const reference = Number(limitPrice) || null
  const notional = qty && reference ? qty * reference : null

  const submit = (e) => {
    e.preventDefault()
    if (!symbol || !(qty > 0)) return
    onPlace({
      symbol,
      direction,
      quantity: Math.trunc(qty),
      limit_price: reference,
      reference_price: reference,
      stop_price: Number(stop) || null,
      target_price: Number(target) || null,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border bg-card p-3">
      <h2 className="text-sm font-medium">New order</h2>
      <div className="flex flex-wrap items-center gap-1.5">
        <SymbolCombobox value={symbol} onChange={setSymbol} className="w-40" />
        <Select value={direction} onValueChange={setDirection}>
          <SelectTrigger size="sm" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="long">Buy</SelectItem>
            <SelectItem value="short">Sell</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          min="1"
          step="1"
          placeholder="Qty"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="h-8 w-24"
        />
        <Input
          type="number"
          step="0.05"
          placeholder="Limit (blank = market)"
          value={limitPrice}
          onChange={(e) => setLimitPrice(e.target.value)}
          className="h-8 w-44"
        />
        <Input
          type="number"
          step="0.05"
          placeholder="Stop"
          value={stop}
          onChange={(e) => setStop(e.target.value)}
          className="h-8 w-28"
        />
        <Input
          type="number"
          step="0.05"
          placeholder="Target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="h-8 w-28"
        />
        <Button size="sm" type="submit" disabled={disabled || busy || !symbol || !(qty > 0)}>
          {busy && <Spinner className="size-4" />}
          Send
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {notional ? `${inr(notional)} of exposure. ` : ''}
        {stop || target
          ? 'Stop and target go to the broker with the entry (Super Order), so they outlive this app being closed.'
          : 'No stop set — the position will have no protection at the broker.'}
      </p>
    </form>
  )
}

export default function LiveTrading() {
  usePageTitle('Live trading')
  const queryClient = useQueryClient()

  const { data: status, isPending } = useQuery({
    queryKey: ['liveStatus'],
    queryFn: getLiveStatus,
    refetchInterval: 10_000,
  })
  const { data: positions = [] } = useQuery({
    queryKey: ['livePositions'],
    queryFn: getLivePositions,
    refetchInterval: 10_000,
  })
  const { data: orders = [] } = useQuery({
    queryKey: ['liveOrders'],
    queryFn: () => getLiveOrders(),
    refetchInterval: 10_000,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['liveStatus'] })
    queryClient.invalidateQueries({ queryKey: ['livePositions'] })
    queryClient.invalidateQueries({ queryKey: ['liveOrders'] })
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
  }
  // Every action on this page does the same three things on success - refetch all three books,
  // say so, and surface a refusal as the toast rather than a silent no-op. A named hook rather
  // than a plain helper because it calls useMutation, and these must stay in a fixed order.
  const useLiveAction = (fn, message) =>
    useMutation({
      mutationFn: fn,
      onSuccess: () => {
        refresh()
        if (message) toast.success(message)
      },
      onError: (e) => toast.error(e.message),
    })

  const place = useLiveAction(placeLiveOrder, 'Order sent')
  const close = useLiveAction(closeLivePosition)
  const cancel = useLiveAction(([orderId, leg]) => cancelLiveOrder(orderId, leg))
  const sync = useLiveAction(syncLive)
  const panic = useLiveAction(livePanic, 'Halted for today, working orders cancelled')
  const resume = useLiveAction(resumeLive)
  const toggle = useLiveAction((enabled) => updateLiveSettings({ enabled }))
  const recover = useLiveAction(recoverLiveOrder, 'Reconciled with the broker')

  const open = positions.filter((p) => p.net_qty)
  const blocked = !status?.configured || !status?.settings?.enabled || status?.runtime?.halted

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Live trading</h1>
          <p className="text-sm text-muted-foreground">
            Your Dhan account, mirrored. Orders here are real; the paper version of this page is{' '}
            <Link to="/paper" className="underline">
              Paper Trading
            </Link>
            .
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" />}
          Sync
        </Button>
      </div>

      <StateBar
        status={status}
        busy={panic.isPending || resume.isPending || toggle.isPending || isPending}
        onPanic={() => panic.mutate()}
        onResume={() => resume.mutate()}
        onToggle={(enabled) => toggle.mutate(enabled)}
      />

      {status?.unconfirmed?.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-destructive/50 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertTriangleIcon className="size-4" />
            {status.unconfirmed.length} order{status.unconfirmed.length === 1 ? '' : 's'} sent without an
            answer
          </p>
          <p className="text-xs text-muted-foreground">
            The request timed out, so these may or may not have reached the exchange. Nothing was re-sent. Ask
            the broker what happened before trading the same symbol again.
          </p>
          {status.unconfirmed.map((intent) => (
            <div key={intent.correlation_id} className="flex items-center gap-2 text-xs">
              <span className="font-medium">{intent.symbol}</span>
              <span className="text-muted-foreground">{intent.correlation_id}</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => recover.mutate(intent.correlation_id)}
                disabled={recover.isPending}
              >
                Check with broker
              </Button>
            </div>
          ))}
        </div>
      )}

      <Ticket onPlace={(payload) => place.mutate(payload)} busy={place.isPending} disabled={blocked} />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Position</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Avg</TableHead>
                  <TableHead>Last</TableHead>
                  <TableHead>Unrealised</TableHead>
                  <TableHead>Realised</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      No open positions.
                    </TableCell>
                  </TableRow>
                ) : (
                  open.map((p) => (
                    <TableRow key={p.security_id}>
                      <TableCell>
                        <Link
                          to="/live/$symbol"
                          params={{ symbol: p.symbol }}
                          className="font-medium hover:underline"
                        >
                          {p.symbol}
                        </Link>
                        <p className="text-xs text-muted-foreground">{p.product}</p>
                      </TableCell>
                      <TableCell className="tabular-nums">{p.net_qty}</TableCell>
                      <TableCell className="tabular-nums">
                        {inr(p.net_qty > 0 ? p.buy_avg : p.sell_avg)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {p.current_price == null ? '—' : inr(p.current_price)}
                      </TableCell>
                      <TableCell
                        className={`tabular-nums ${(p.mark_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}
                      >
                        {p.mark_pnl == null ? '—' : inr(p.mark_pnl)}
                      </TableCell>
                      <TableCell className="tabular-nums">{inr(p.realised ?? 0)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => close.mutate(p.security_id)}
                          disabled={close.isPending}
                        >
                          Close
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Nothing sent today.
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((o) => (
                    <TableRow key={o.order_id}>
                      <TableCell>
                        <span className="font-medium">{o.symbol}</span>
                        <p className="text-xs text-muted-foreground">
                          {o.side} · {o.order_type}
                          {o.leg && o.leg !== 'ENTRY_LEG'
                            ? ` · ${o.leg.replace('_LEG', '').toLowerCase()}`
                            : ''}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusTone(o.status)}>{o.status}</Badge>
                        {o.error && <p className="mt-0.5 text-xs text-destructive">{o.error}</p>}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {o.filled_qty ?? 0}/{o.quantity}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {inr(o.avg_price || o.price || o.trigger_price)}
                      </TableCell>
                      <TableCell>
                        {OPEN_STATUSES.includes(o.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              cancel.mutate(
                                o.parent_order_id ? [o.parent_order_id, o.leg] : [o.order_id, null],
                              )
                            }
                            disabled={cancel.isPending}
                          >
                            Cancel
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <AlertsPanel />
      </div>
    </div>
  )
}

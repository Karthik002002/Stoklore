import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ResultsBadge from '@/components/ResultsBadge'
import { Link } from '@tanstack/react-router'
import { AlertTriangleIcon, OctagonXIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import LiveOrderTicket from './LiveOrderTicket'
import type { LiveStatus } from '@/services/api'
import {
  cancelLiveOrder,
  closeLivePosition,
  getLiveOrders,
  getLivePositions,
  getLiveStatus,
  livePanic,
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

const legLabel = (leg: string | null) =>
  leg === 'STOP_LOSS_LEG' ? 'stop loss' : leg === 'TARGET_LEG' ? 'target' : 'entry'

const statusTone = (status: string) =>
  status === 'TRADED'
    ? 'success'
    : status === 'REJECTED'
      ? 'destructive'
      : OPEN_STATUSES.includes(status)
        ? 'default'
        : 'outline'

/** The one-line answer to "can I trade right now", and the button that takes it away. */
function StateBar({
  status,
  onPanic,
  onResume,
  onToggle,
  busy,
}: {
  status?: LiveStatus
  onPanic: () => void
  onResume: () => void
  onToggle: (enabled: boolean) => void
  busy: boolean
}) {
  const settings = status?.settings
  const runtime = status?.runtime
  const blocked = !status?.configured || !settings?.enabled || runtime?.halted

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 ${
        blocked ? 'border-dashed' : 'border-primary/40 bg-primary/5'
      }`}
    >
      <Badge variant={blocked ? 'outline' : 'success'}>{blocked ? 'Not trading' : 'Live'}</Badge>
      {/* The wallet, straight from Dhan's fund limit (cached 30s server-side). Shown even when
          trading is off - it is the number every size on this page is measured against. */}
      {status?.balance != null && (
        <span className="text-xs tabular-nums">
          <span className="text-muted-foreground">Wallet </span>
          <span className="font-semibold">{inr(status.balance)}</span>
        </span>
      )}
      {status?.sandbox && <Badge variant="secondary">Sandbox</Badge>}
      {!status?.configured && (
        <span className="text-xs text-muted-foreground">
          No Dhan credentials —{' '}
          <Link to="/settings" search={{ tab: 'broker' }} className="underline">
            add them in Settings
          </Link>
        </span>
      )}
      {runtime?.halted && (
        <span className="flex items-center gap-1 text-xs text-destructive">
          <AlertTriangleIcon className="size-3.5" />
          Halted today: {runtime.halt_reason}
        </span>
      )}
      <span className="text-xs text-muted-foreground tabular-nums">
        {runtime?.orders_today ?? 0}/{settings?.max_orders_per_day} orders · realised{' '}
        {inr(runtime?.realised_today ?? 0)} · cap {inr(settings?.max_order_value)}/order ·{' '}
        {settings?.max_position_pct}
        %/position · stop {inr(settings?.daily_loss_limit)}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        {runtime?.halted ? (
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
          variant={settings?.enabled ? 'secondary' : 'default'}
          onClick={() => onToggle(!settings?.enabled)}
          disabled={busy || !status?.configured}
        >
          {settings?.enabled ? 'Switch off' : 'Switch on'}
        </Button>
      </div>
    </div>
  )
}

/** The live books and every action on them. Self-contained so any page can show a piece of them
 *  (Holdings' Positions / Orders tabs): react-query shares the three polls between the pieces. */
function useLiveBook() {
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
  return { status, isPending, positions, orders, refresh }
}

// Every action does the same three things on success - refetch the books, say so, and surface a
// refusal as the toast rather than a silent no-op.
function useLiveAction<TVars>(fn: (vars: TVars) => Promise<unknown>, message?: string) {
  const { refresh } = useLiveBook()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      refresh()
      if (message) toast.success(message)
    },
    onError: (e) => toast.error(e.message),
  })
}

/** Whether an order can be sent right now, the kill switch, and anything a timeout left unconfirmed. */
export function LiveStateBar() {
  const { status, isPending } = useLiveBook()
  const panic = useLiveAction<void>(livePanic, 'Halted for today, working orders cancelled')
  const resume = useLiveAction<void>(resumeLive)
  const toggle = useLiveAction((enabled: boolean) => updateLiveSettings({ enabled }))
  const recover = useLiveAction(recoverLiveOrder, 'Reconciled with the broker')
  return (
    <>
      <StateBar
        status={status}
        busy={panic.isPending || resume.isPending || toggle.isPending || isPending}
        onPanic={() => panic.mutate()}
        onResume={() => resume.mutate()}
        onToggle={(enabled) => toggle.mutate(enabled)}
      />
      {(status?.unconfirmed?.length ?? 0) > 0 && status && (
        <div className="space-y-1.5 rounded-xl border border-destructive/50 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertTriangleIcon className="size-4" />
            {status.unconfirmed.length} order
            {status.unconfirmed.length === 1 ? '' : 's'} sent without an answer
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
    </>
  )
}

/** Open positions on the Dhan account, each closable at market. */
export function LivePositionsTable() {
  const { positions } = useLiveBook()
  const close = useLiveAction(closeLivePosition)
  const open = positions.filter((p) => p.net_qty)
  return (
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
                    params={{ symbol: p.symbol ?? '' }}
                    className="font-medium hover:underline"
                  >
                    {p.symbol}
                  </Link>
                  {p.symbol && <ResultsBadge symbol={p.symbol} className="ml-1.5" />}
                  <p className="text-xs text-muted-foreground">{p.product}</p>
                </TableCell>
                <TableCell className="tabular-nums">{p.net_qty}</TableCell>
                <TableCell className="tabular-nums">{inr(p.net_qty > 0 ? p.buy_avg : p.sell_avg)}</TableCell>
                <TableCell className="tabular-nums">
                  {p.current_price == null ? '—' : inr(p.current_price)}
                </TableCell>
                <TableCell className={`tabular-nums ${(p.mark_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                  {p.mark_pnl == null ? '—' : inr(p.mark_pnl)}
                </TableCell>
                <TableCell className="tabular-nums">{inr(p.realised ?? 0)}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      window.confirm(
                        `Close ${p.symbol} (${p.net_qty} shares) at market on your Dhan account?`,
                      ) && close.mutate(p.security_id)
                    }
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
  )
}

/** Today's order book on the Dhan account - every order, including ones placed outside this app
 *  (the mirror is Dhan's whole book) - with a Super Order's legs as rows of their own. */
export function LiveOrdersTable({ openOnly = false }: { openOnly?: boolean }) {
  const { orders: all } = useLiveBook()
  const cancel = useLiveAction(
    ([orderId, leg]: [string, string | null]) => cancelLiveOrder(orderId, leg),
    'Cancelled',
  )
  const orders = openOnly ? all.filter((o) => OPEN_STATUSES.includes(o.status)) : all
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Time</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                {openOnly ? 'No working orders.' : 'No orders today.'}
              </TableCell>
            </TableRow>
          ) : (
            orders.map((o) => (
              <TableRow key={o.order_id}>
                <TableCell>
                  <span className="font-medium">{o.symbol}</span>
                  <p className={`text-xs ${o.side === 'BUY' ? 'text-up' : 'text-down'}`}>
                    {o.side} <span className="text-muted-foreground">· {o.product}</span>
                  </p>
                </TableCell>
                <TableCell>
                  {o.order_type}
                  {/* A super order's stop and target are rows of their own; without this
                      they read as three unexplained orders on the same symbol. */}
                  {o.parent_order_id && <p className="text-xs text-muted-foreground">{legLabel(o.leg)}</p>}
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
                  {o.trigger_price ? (
                    <p className="text-xs text-muted-foreground">trigger {inr(o.trigger_price)}</p>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {o.time ? o.time.slice(11, 19) : '—'}
                </TableCell>
                <TableCell>
                  {OPEN_STATUSES.includes(o.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        cancel.mutate(o.parent_order_id ? [o.parent_order_id, o.leg] : [o.order_id, null])
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
  )
}

export default function LiveTrading() {
  usePageTitle('Live trading')
  const sync = useLiveAction<void>(syncLive)

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

      <LiveStateBar />
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <LiveOrderTicket className="h-fit rounded-xl border bg-card p-3" />
        <div className="min-w-0 space-y-4">
          <LivePositionsTable />
          <LiveOrdersTable />
        </div>
      </div>
    </div>
  )
}

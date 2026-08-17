import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { inr } from '@/lib/format'
import { closePaperPosition, modifyPaperPosition } from '@/services/api'

// Flashes green/red for a moment whenever the price this cell shows actually changes, then fades.
// Keyed on the value rather than on a refetch, so a poll that returned the same price doesn't
// blink - the pulse means "this moved", not "we asked".
function PriceCell({ price }) {
  const [flash, setFlash] = useState(null)
  const previous = useRef(price)

  useEffect(() => {
    if (price == null || previous.current == null || price === previous.current) {
      previous.current = price
      return
    }
    setFlash(price > previous.current ? 'up' : 'down')
    previous.current = price
    const t = setTimeout(() => setFlash(null), 900)
    return () => clearTimeout(t)
  }, [price])

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 tabular-nums transition-colors duration-500 ${
        flash === 'up' ? 'bg-success/20 text-up' : flash === 'down' ? 'bg-destructive/20 text-down' : ''
      }`}
    >
      {price == null ? '—' : inr(price)}
    </span>
  )
}

// The rows above are marked to the last price the backend stored, which it serves without waiting
// on the feed - so the table needs to say how old that is, and whether a fresh quote is on its
// way. `price_stale` is the backend's own answer to "I'm refetching this one right now".
function PriceFooter({ positions, isFetching }) {
  const stamps = positions.map((p) => p.price_as_of).filter(Boolean)
  const oldest = stamps.length ? stamps.reduce((a, b) => (a < b ? a : b)) : null
  const fetching = isFetching || positions.some((p) => p.price_stale)

  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      {fetching && <Spinner className="size-3" />}
      {fetching ? 'Fetching latest price data…' : 'Prices up to date'}
      {oldest && <span>· priced as of {new Date(oldest).toLocaleTimeString()}</span>}
    </p>
  )
}

// Editing a ladder in place. Each row is one leg: a price and the slice of the position it closes.
function LegEditor({ label, legs, onChange, max }) {
  const covered = legs.reduce((s, l) => s + (Number(l.qty) || 0), 0)
  const set = (i, key) => (e) => onChange(legs.map((l, j) => (j === i ? { ...l, [key]: e.target.value } : l)))

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <span className={`text-xs tabular-nums ${covered > max ? 'text-down' : 'text-muted-foreground'}`}>
          {covered} / {max} covered
        </span>
      </div>
      {legs.map((leg, i) => (
        <div key={leg.id} className="flex items-center gap-2">
          <Input
            type="number"
            step="0.01"
            value={leg.price}
            onChange={set(i, 'price')}
            placeholder="Price"
            className="h-8"
          />
          <Input
            type="number"
            value={leg.qty}
            onChange={set(i, 'qty')}
            placeholder="Qty"
            className="h-8 w-24"
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove level"
            onClick={() => onChange(legs.filter((_, j) => j !== i))}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => onChange([...legs, { id: crypto.randomUUID(), price: '', qty: '' }])}
      >
        Add level
      </Button>
    </div>
  )
}

function ModifyDialog({ position, open, onOpenChange }) {
  const queryClient = useQueryClient()
  const [stopLosses, setStopLosses] = useState([])
  const [targets, setTargets] = useState([])

  useEffect(() => {
    if (open && position) {
      setStopLosses(position.stop_losses ?? [])
      setTargets(position.targets ?? [])
    }
  }, [open, position])

  const save = useMutation({
    mutationFn: () => {
      const clean = (legs) =>
        legs
          .filter((l) => Number(l.price) > 0 && Number(l.qty) > 0)
          .map((l) => ({ id: l.id, price: Number(l.price), qty: Number(l.qty) }))
      return modifyPaperPosition(position.id, { stop_losses: clean(stopLosses), targets: clean(targets) })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paperPositions'] })
      toast.success('Exit levels updated')
      onOpenChange(false)
    },
    onError: (e) => toast.error(e.message),
  })

  if (!position) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Exit levels — {position.symbol} ({position.quantity} @ {inr(position.entry_price)})
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <LegEditor label="Stop loss" legs={stopLosses} onChange={setStopLosses} max={position.quantity} />
          <LegEditor label="Targets" legs={targets} onChange={setTargets} max={position.quantity} />
          <p className="text-xs text-muted-foreground">
            Levels may cover less than the position — the uncovered slice simply runs unprotected. Covering
            more than it would close shares you don't hold, and is rejected.
          </p>
          <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner className="size-4" />}
            Save levels
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function PaperHoldings({ positions, isFetching, isPending, accountId }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [modifying, setModifying] = useState(null)

  const close = useMutation({
    mutationFn: (id) => closePaperPosition(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['paperPositions'] })
      queryClient.invalidateQueries({ queryKey: ['manualTrades'] })
      toast.success(`Closed at ${inr(data.closed_at)}`)
    },
    onError: (e) => toast.error(e.message),
  })

  // "Nothing here" and "haven't heard back yet" are different answers, and only one of them is
  // safe to show. The positions come from the DB but the endpoint marks each one to a live price,
  // so on a slow connection the response is late - and claiming "no open positions" while the
  // request is still in flight tells the user their book is empty when it isn't.
  if (isPending) {
    return (
      <p className="flex items-center justify-center gap-2 rounded-xl border bg-card py-16 text-center text-sm text-muted-foreground">
        <Spinner className="size-4" /> Loading positions…
      </p>
    )
  }

  if (positions.length === 0) {
    return (
      <p className="rounded-xl border bg-card py-16 text-center text-sm text-muted-foreground">
        No open paper positions — place an order from the Trades tab.
      </p>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Ticker</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">P&amp;L</TableHead>
              <TableHead>Stop loss</TableHead>
              <TableHead>Targets</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.map((p) => (
              <TableRow
                key={p.id}
                className="cursor-pointer"
                onClick={() =>
                  navigate({
                    to: '/paper/$symbol',
                    params: { symbol: p.symbol },
                    search: { account: accountId },
                  })
                }
              >
                <TableCell className="font-medium whitespace-nowrap">
                  {p.symbol}
                  <Badge variant="secondary" className="ml-1.5 capitalize">
                    {p.direction}
                  </Badge>
                  {p.status === 'pending' && (
                    <Badge variant="outline" className="ml-1">
                      Limit resting
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{inr(p.entry_price)}</TableCell>
                <TableCell className="text-right">
                  <PriceCell price={p.current_price} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.value == null ? '—' : inr(p.value)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    p.pnl == null ? '' : p.pnl >= 0 ? 'text-up' : 'text-down'
                  }`}
                >
                  {p.pnl == null ? '—' : `${inr(p.pnl)} (${p.pnl_pct}%)`}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {(p.stop_losses ?? []).length === 0
                    ? '—'
                    : p.stop_losses.map((l) => `${inr(l.price)}×${l.qty}`).join(', ')}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {(p.targets ?? []).length === 0
                    ? '—'
                    : p.targets.map((l) => `${inr(l.price)}×${l.qty}`).join(', ')}
                </TableCell>
                {/* The row navigates; the buttons act. Without stopping propagation here, Modify
                    would open its dialog and then immediately navigate away underneath it. */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setModifying(p)}>
                      Modify
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={close.isPending || p.status === 'pending'}
                      onClick={() => close.mutate(p.id)}
                    >
                      Close
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <PriceFooter positions={positions} isFetching={isFetching} />
      <ModifyDialog
        position={modifying}
        open={!!modifying}
        onOpenChange={(next) => !next && setModifying(null)}
      />
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangleIcon, ChevronRightIcon } from 'lucide-react'
import { toast } from 'sonner'
import SymbolCombobox from '@/components/SymbolCombobox'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { fmt, inr } from '@/lib/format'
import { positionSize, ticketErrors } from '@/lib/liveSizing'
import { cn } from '@/lib/utils'
import { consumePrefill, toTick, useTicketPrefill } from '@/lib/ticketPrefill'
import { F, PriceField, Seg, TicketFooter, num } from '@/components/OrderTicketParts'
import type { LiveOrderRequest } from '@/services/api'
import { getLiveStatus, getStockDetail, placeLiveOrder, updateLiveSettings } from '@/services/api'

// A real order on the Dhan account, with every option Dhan's order API takes for NSE cash equity:
// product (intraday / delivery / MTF), market, limit, stop-limit and stop-market, DAY or IOC,
// disclosed quantity, after-market orders - and a Super Order (stop-loss + target held at the
// broker) on a market or limit entry. Nothing is sent until the confirmation dialog is accepted.
//
// The backend (app/core/dhan_orders.py guardrail_errors) checks all of this again and is the one
// that decides; the checks here only stop a round trip and say what's wrong while it's typed.

type Product = NonNullable<LiveOrderRequest['product']>
type OrderType = NonNullable<LiveOrderRequest['order_type']>
type AmoTime = NonNullable<LiveOrderRequest['amo_time']>

const PRODUCTS: { value: Product; label: string; hint: string }[] = [
  { value: 'INTRADAY', label: 'Intraday', hint: 'MIS - squared off by the broker before the close' },
  { value: 'CNC', label: 'Delivery', hint: 'CNC - held in your demat, no auto square-off' },
  { value: 'MTF', label: 'MTF', hint: 'Margin trade funding - delivery bought partly on borrowed money' },
]
const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: 'MARKET', label: 'Market' },
  { value: 'LIMIT', label: 'Limit' },
  { value: 'STOP_LOSS', label: 'Stop-limit (SL)' },
  { value: 'STOP_LOSS_MARKET', label: 'Stop-market (SL-M)' },
]
const AMO_TIMES: { value: AmoTime; label: string }[] = [
  { value: 'PRE_OPEN', label: 'Pre-open (9:00)' },
  { value: 'OPEN', label: 'At open (9:15)' },
  { value: 'OPEN_30', label: '30 min after open' },
  { value: 'OPEN_60', label: '60 min after open' },
]
const label = <T extends string>(list: { value: T; label: string }[], v: T | null | undefined) =>
  list.find((x) => x.value === v)?.label ?? v ?? '—'

/** The Dhan order ticket. `symbol` fixes the ticker (the chart modal); without it, it's picked here. */
export default function LiveOrderTicket({
  symbol: fixed,
  className,
}: {
  symbol?: string
  className?: string
}) {
  const queryClient = useQueryClient()
  const { data: status } = useQuery({
    queryKey: ['liveStatus'],
    queryFn: getLiveStatus,
    refetchInterval: 10_000,
  })

  const [picked, setPicked] = useState('')
  const symbol = fixed ?? picked
  const [direction, setDirection] = useState<'long' | 'short'>('long')
  const [product, setProduct] = useState<Product | null>(null)
  const [orderType, setOrderType] = useState<OrderType>('MARKET')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [trigger, setTrigger] = useState('')
  const [validity, setValidity] = useState<'DAY' | 'IOC'>('DAY')
  const [disclosed, setDisclosed] = useState('')
  const [amo, setAmo] = useState(false)
  const [amoTime, setAmoTime] = useState<AmoTime>('OPEN')
  const [superOn, setSuperOn] = useState(false)
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [trail, setTrail] = useState('')
  const [confirming, setConfirming] = useState<LiveOrderRequest | null>(null)
  const qtyRef = useRef<HTMLInputElement>(null)

  // A chart's right-click "Buy/Sell here": side, type and price filled in, the cursor in Quantity.
  // Nothing is sent - the confirmation still comes after Review.
  const prefill = useTicketPrefill((s) => s.prefill)
  useEffect(() => {
    if (!prefill || (fixed && prefill.symbol !== fixed)) return
    if (!fixed) setPicked(prefill.symbol)
    setDirection(prefill.direction)
    setOrderType(prefill.price == null ? 'MARKET' : 'LIMIT')
    if (prefill.price != null) setPrice(toTick(prefill.price))
    consumePrefill()
    requestAnimationFrame(() => qtyRef.current?.focus())
  }, [prefill, fixed])

  const { data: detail } = useQuery({
    queryKey: ['stockDetail', symbol],
    queryFn: () => getStockDetail(symbol),
    enabled: !!symbol,
    staleTime: 60_000,
  })
  const ltp = detail?.quote?.currentPrice ?? null

  const productValue = product ?? ((status?.settings.product as Product | undefined) || 'INTRADAY')
  const priced = orderType === 'LIMIT' || orderType === 'STOP_LOSS'
  const triggered = orderType === 'STOP_LOSS' || orderType === 'STOP_LOSS_MARKET'
  // Dhan's Super Order takes a plain DAY market/limit entry only.
  const superAllowed =
    (orderType === 'MARKET' || orderType === 'LIMIT') && !amo && validity === 'DAY' && !disclosed
  const superUsed = superOn && superAllowed

  const reference = (priced ? num(price) : null) ?? (triggered ? num(trigger) : null) ?? ltp
  const order: LiveOrderRequest = {
    symbol,
    direction,
    quantity: Math.trunc(Number(qty) || 0),
    product: productValue,
    order_type: orderType,
    limit_price: priced ? num(price) : null,
    trigger_price: triggered ? num(trigger) : null,
    validity,
    disclosed_quantity: num(disclosed),
    amo,
    amo_time: amo ? amoTime : null,
    stop_price: superUsed ? num(stop) : null,
    target_price: superUsed ? num(target) : null,
    trailing_jump: superUsed ? num(trail) : null,
    reference_price: reference,
  }
  const errors = ticketErrors(order, superUsed)
  const { value, pctOfWallet, warnings } = positionSize(
    order.quantity,
    reference,
    status?.balance,
    status?.settings,
  )
  const risk =
    superUsed && order.stop_price && reference
      ? Math.abs(reference - order.stop_price) * order.quantity
      : null
  const reward =
    superUsed && order.target_price && reference
      ? Math.abs(order.target_price - reference) * order.quantity
      : null

  const blocked = !status?.configured
    ? 'No Dhan credentials - add them in Settings › Broker.'
    : !status.settings.enabled
      ? 'Live trading is switched off - switch it on on the Live Trading page.'
      : status.runtime.halted
        ? `Trading is halted for today (${status.runtime.halt_reason ?? 'kill switch'}).`
        : null

  const place = useMutation({
    mutationFn: placeLiveOrder,
    onSuccess: () => {
      for (const key of ['liveOrders', 'livePositions', 'liveStatus'])
        queryClient.invalidateQueries({ queryKey: [key] })
      toast.success(`${direction === 'long' ? 'Buy' : 'Sell'} ${order.quantity} ${symbol} sent to Dhan`)
      setConfirming(null)
      setQty('')
      setStop('')
      setTarget('')
      setTrail('')
    },
    onError: (e) => toast.error(e.message),
  })

  const enable = useMutation({
    mutationFn: () => updateLiveSettings({ enabled: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['liveStatus'] }),
    onError: (e) => toast.error(e.message),
  })

  const buy = direction === 'long'
  const balance = status?.balance ?? null
  const maxQty = balance && reference ? Math.floor(balance / reference) : null
  const productHint = PRODUCTS.find((p) => p.value === productValue)?.hint
  // What the button says when it can't go yet: the first thing missing, in plain words.
  const missing = blocked
    ? 'Live trading is not available'
    : !symbol
      ? 'Pick a symbol'
      : !(order.quantity > 0)
        ? 'Enter a quantity'
        : (errors[0] ?? null)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!missing) setConfirming(order)
      }}
      className={cn('flex flex-col gap-3', className)}
    >
      {/* header: what, at what price, against which wallet */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {fixed ? (
            <p className="truncate text-base font-semibold">{fixed}</p>
          ) : (
            <p className="text-sm font-semibold">Live order</p>
          )}
          <p className="text-xs text-muted-foreground tabular-nums">
            {ltp != null && <>LTP {inr(ltp)} · </>}
            wallet {balance == null ? '—' : inr(balance)}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-down/40 bg-down/10 px-2 py-0.5 text-[11px] font-medium text-down">
          <span className="size-1.5 animate-pulse rounded-full bg-down" />
          {status?.sandbox ? 'Dhan sandbox' : 'Dhan · real money'}
        </span>
      </div>

      {blocked && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangleIcon className="size-3.5 shrink-0" />
          <span className="flex-1">
            {!status?.configured
              ? 'Add your Dhan credentials first.'
              : !status.settings.enabled
                ? 'Live trading is off.'
                : blocked}
          </span>
          {status?.configured && !status.settings.enabled ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              disabled={enable.isPending}
              onClick={() => enable.mutate()}
            >
              {enable.isPending && <Spinner className="size-3" />}
              Switch on
            </Button>
          ) : (
            <Link
              to={status?.configured ? '/live' : '/settings'}
              search={status?.configured ? undefined : { tab: 'broker' }}
              className="font-medium underline underline-offset-2"
            >
              {status?.configured ? 'Manage' : 'Settings'}
            </Link>
          )}
        </div>
      )}

      {!fixed && (
        <F label="Symbol">
          <SymbolCombobox value={picked} onChange={setPicked} className="w-full" />
        </F>
      )}

      <Seg
        size="lg"
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'long', label: 'Buy' },
          { value: 'short', label: 'Sell' },
        ]}
        tone={(v) => (v === 'long' ? 'bg-up text-white shadow-sm' : 'bg-down text-white shadow-sm')}
      />

      <div className="space-y-1">
        <Seg value={productValue} onChange={setProduct} options={PRODUCTS} />
        <p className="px-0.5 text-[11px] text-muted-foreground">{productHint}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <F label="Order type">
          <Select value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
            <SelectTrigger size="sm" className="h-8 w-full">
              <SelectValue>{(v: OrderType) => label(ORDER_TYPES, v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ORDER_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </F>
        <F
          label="Quantity"
          aside={
            maxQty != null &&
            maxQty > 0 && (
              <button
                type="button"
                className="text-[11px] text-primary hover:underline"
                title="As many as the wallet pays for at this price"
                onClick={(e) => {
                  e.preventDefault()
                  setQty(String(maxQty))
                }}
              >
                max {maxQty}
              </button>
            )
          }
        >
          <Input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            placeholder="0"
            ref={qtyRef}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="h-8 tabular-nums"
          />
        </F>
        {triggered && <PriceField label="Trigger" value={trigger} onChange={setTrigger} reference={ltp} />}
        {priced && <PriceField label="Limit price" value={price} onChange={setPrice} reference={ltp} />}
      </div>

      {/* Super Order: a switch, since it changes what kind of order this is */}
      <div className={cn('rounded-lg border', superUsed && 'border-primary/40 bg-primary/5')}>
        <button
          type="button"
          role="switch"
          aria-checked={superUsed}
          disabled={!superAllowed}
          onClick={() => setSuperOn((v) => !v)}
          className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left disabled:opacity-60"
        >
          <span
            className={cn(
              'relative h-4 w-7 shrink-0 rounded-full transition-colors',
              superUsed ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 size-3 rounded-full bg-white shadow transition-transform',
                superUsed ? 'translate-x-3.5' : 'translate-x-0.5',
              )}
            />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium">Stop-loss &amp; target</span>
            <span className="block text-[11px] text-muted-foreground">
              {superAllowed ? 'Super Order - both held at the broker' : 'Only on a Day market or limit order'}
            </span>
          </span>
        </button>
        {superUsed && (
          <div className="grid grid-cols-2 gap-2 border-t px-2.5 pt-2 pb-2.5">
            <PriceField label="Stop-loss" value={stop} onChange={setStop} reference={reference} tone="down" />
            <PriceField label="Target" value={target} onChange={setTarget} reference={reference} tone="up" />
            <PriceField
              label="Trailing jump"
              value={trail}
              onChange={setTrail}
              placeholder="optional - ₹ step the stop trails by"
              className="col-span-2"
            />
          </div>
        )}
      </div>

      <details className="group rounded-lg border text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 select-none">
          <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
          <span className="font-medium">More options</span>
          <span className="ml-auto truncate text-muted-foreground">
            {[validity === 'IOC' && 'IOC', disclosed && `disclose ${disclosed}`, amo && 'AMO']
              .filter(Boolean)
              .join(' · ') || 'Day · AMO off'}
          </span>
        </summary>
        <div className="space-y-2 border-t px-2.5 pt-2 pb-2.5">
          <div className="grid grid-cols-2 gap-2">
            <F label="Validity">
              <Seg
                value={validity}
                onChange={setValidity}
                options={[
                  { value: 'DAY', label: 'Day', hint: 'Works until the close' },
                  {
                    value: 'IOC',
                    label: 'IOC',
                    hint: 'Immediate or cancel - fills what it can now, cancels the rest',
                  },
                ]}
              />
            </F>
            <F label="Disclosed qty">
              <Input
                type="number"
                min="0"
                step="1"
                value={disclosed}
                onChange={(e) => setDisclosed(e.target.value)}
                placeholder="all"
                className="h-7"
              />
            </F>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={amo}
              onChange={(e) => setAmo(e.target.checked)}
            />
            After-market order
          </label>
          {amo && (
            <Select value={amoTime} onValueChange={(v) => setAmoTime(v as AmoTime)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue>{(v: AmoTime) => `Send ${label(AMO_TIMES, v).toLowerCase()}`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {AMO_TIMES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </details>

      <TicketFooter
        quantity={order.quantity}
        price={reference}
        priceNote={!priced && !triggered ? 'LTP' : undefined}
        value={value}
        pct={pctOfWallet}
        risk={risk}
        reward={reward}
        warnings={warnings}
      >
        <Button
          type="submit"
          className={cn(
            'h-10 w-full text-sm font-semibold text-white',
            buy ? 'bg-up hover:bg-up/90' : 'bg-down hover:bg-down/90',
          )}
          disabled={!!missing || place.isPending}
        >
          {missing && order.quantity > 0 && errors.length && !blocked
            ? 'Fix the order to continue'
            : `${buy ? 'Buy' : 'Sell'}${order.quantity > 0 ? ` ${order.quantity}` : ''}${symbol ? ` ${symbol}` : ''} · review`}
        </Button>
        {missing && <p className="text-center text-[11px] text-muted-foreground">{missing}</p>}
      </TicketFooter>

      <ConfirmLiveOrder
        order={confirming}
        sandbox={!!status?.sandbox}
        value={value}
        pctOfWallet={pctOfWallet}
        risk={risk}
        reward={reward}
        warnings={warnings}
        busy={place.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && place.mutate(confirming)}
      />
    </form>
  )
}

/** The last look before real money moves: every field that will be sent, in words. */
function ConfirmLiveOrder({
  order,
  sandbox,
  value,
  pctOfWallet,
  risk,
  reward,
  warnings,
  busy,
  onCancel,
  onConfirm,
}: {
  order: LiveOrderRequest | null
  sandbox: boolean
  value: number | null
  pctOfWallet: number | null
  risk: number | null
  reward: number | null
  warnings: string[]
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!order) return null
  const buy = order.direction === 'long'
  const kind = order.order_type ?? 'MARKET'
  const rows: [string, React.ReactNode][] = [
    ['Account', `Dhan${sandbox ? ' (sandbox)' : ' - live'}`],
    ['Symbol', `${order.symbol} · NSE`],
    ['Side', <span className={buy ? 'text-up' : 'text-down'}>{buy ? 'BUY' : 'SELL'}</span>],
    ['Product', label(PRODUCTS, order.product)],
    ['Order type', label(ORDER_TYPES, kind)],
    ['Quantity', `${order.quantity} shares`],
  ]
  if (order.trigger_price) rows.push(['Trigger', inr(order.trigger_price)])
  rows.push([
    'Price',
    order.limit_price ? inr(order.limit_price) : `Market (≈ ${inr(order.reference_price)})`,
  ])
  rows.push(['Validity', order.validity === 'IOC' ? 'IOC - immediate or cancel' : 'Day'])
  if (order.disclosed_quantity) rows.push(['Disclosed', `${order.disclosed_quantity} shares`])
  if (order.amo) rows.push(['After-market', label(AMO_TIMES, order.amo_time)])
  if (order.stop_price != null) {
    rows.push([
      'Stop-loss',
      <span className="text-down">
        {inr(order.stop_price)}
        {risk ? ` · ${inr(risk)} risk` : ''}
      </span>,
    ])
    rows.push([
      'Target',
      <span className="text-up">
        {inr(order.target_price)}
        {reward ? ` · ${inr(reward)} reward` : ''}
      </span>,
    ])
    if (order.trailing_jump) rows.push(['Trailing jump', inr(order.trailing_jump)])
  }
  rows.push([
    'Est. value',
    `${value == null ? '—' : inr(value)}${pctOfWallet == null ? '' : ` · ${fmt(pctOfWallet, 1)}% of wallet`}`,
  ])

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Confirm {buy ? 'buy' : 'sell'} · {order.quantity} {order.symbol}
          </AlertDialogTitle>
          <AlertDialogDescription>
            This sends a real order to your Dhan account
            {order.stop_price != null ? ' as a Super Order (entry, stop and target together)' : ''}. It can't
            be undone from here once it fills.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {warnings.map((w) => (
          <p key={w} className="flex gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            {w}
          </p>
        ))}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            className={cn('text-white', buy ? 'bg-up hover:bg-up/90' : 'bg-down hover:bg-down/90')}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy && <Spinner className="size-4" />}
            Place {buy ? 'buy' : 'sell'} order
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
